import { z } from 'zod';
import {
  MAX_BODY_BYTES,
  analysisOutputSchema,
  analyzeRequestSchema,
  type AnalyzeRequest,
} from '../../../shared/schema.js';
import type { AnalysisOutput } from '../../../shared/types.js';
import { requirePasscode } from '../auth.js';
import { errorResponse, json, type ApiResponse, type Handler } from '../http.js';
import { logEvent } from '../log.js';
import {
  anthropicCall,
  settingsFromEnv,
  UpstreamError,
  type ModelCall,
  type ModelSettings,
} from '../model.js';
import { postprocess, type PostStats } from '../postprocess.js';
import { buildUserPrompt, retrySuffix, SYSTEM_PROMPT } from '../prompt.js';
import { checkRateLimit } from '../rateLimit.js';

/** Time budget (docs/02 §6 as amended): first attempt 50 s, retry only with ≥ 20 s of 75 s left. */
export const BUDGET = { totalMs: 75_000, firstMs: 50_000, minRetryMs: 20_000 };

export type AnalyzeDeps = {
  call?: ModelCall;
  now?: () => number;
  settings?: ModelSettings;
};

type Attempt =
  | { ok: true; output: AnalysisOutput; inputTokens: number; outputTokens: number }
  | { ok: false; problem: string; inputTokens: number; outputTokens: number };

/** Describes why output was unusable, by shape only, so no content reaches the retry note or logs. */
function describeIssues(err: z.ZodError): string {
  const paths = err.issues.slice(0, 5).map((i) => `${i.path.join('.') || 'root'}: ${i.code}`);
  return `it did not match the schema (${paths.join('; ')})`;
}

function parseOutput(
  text: string,
): { ok: true; output: AnalysisOutput } | { ok: false; problem: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, problem: 'it was not valid JSON' };
  }
  const parsed = analysisOutputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: describeIssues(parsed.error) };
  return { ok: true, output: parsed.data as AnalysisOutput };
}

async function attempt(
  call: ModelCall,
  settings: ModelSettings,
  user: string,
  timeoutMs: number,
): Promise<Attempt> {
  const res = await call({ ...settings, system: SYSTEM_PROMPT, user, timeoutMs });
  const tokens = { inputTokens: res.inputTokens, outputTokens: res.outputTokens };
  if (res.stopReason === 'max_tokens') return { ok: false, problem: 'it was cut off', ...tokens };
  if (res.stopReason === 'refusal') return { ok: false, problem: 'it was a refusal', ...tokens };
  const parsed = parseOutput(res.text);
  return parsed.ok
    ? { ok: true, output: parsed.output, ...tokens }
    : { ok: false, problem: parsed.problem, ...tokens };
}

function upstreamResponse(e: UpstreamError): { res: ApiResponse; code: string } {
  switch (e.kind) {
    case 'rate_limited':
      return {
        code: 'upstream_429',
        res: errorResponse(
          429,
          'rate_limited',
          'The analysis service is busy. It will retry shortly.',
          e.retryAfter ? { 'retry-after': e.retryAfter } : undefined,
        ),
      };
    case 'overloaded':
      return {
        code: 'upstream_529',
        res: errorResponse(
          502,
          'upstream_overloaded',
          'The analysis service is overloaded. Retry in a moment.',
        ),
      };
    case 'auth':
      return {
        code: 'upstream_auth',
        res: errorResponse(
          500,
          'server_misconfigured',
          'The server’s Anthropic API key is missing or was rejected.',
        ),
      };
    case 'timeout':
      return {
        code: 'upstream_timeout',
        res: errorResponse(504, 'upstream_timeout', 'The analysis took too long. It will retry.'),
      };
    case 'bad_request':
      return {
        code: 'upstream_400',
        res: errorResponse(502, 'upstream_error', 'The analysis service refused the request.'),
      };
    default:
      return {
        code: `upstream_${e.status || 'other'}`,
        res: errorResponse(502, 'upstream_error', 'The analysis service failed. It will retry.'),
      };
  }
}

/** Runs the analysis on a validated request. Used by the route and by `npm run eval` (ADR-14). */
export async function runAnalysis(
  req: AnalyzeRequest,
  deps: AnalyzeDeps = {},
): Promise<
  | {
      ok: true;
      result: AnalysisOutput;
      stats: PostStats;
      attempts: number;
      inputTokens: number;
      outputTokens: number;
    }
  | {
      ok: false;
      res: ApiResponse;
      code: string;
      attempts: number;
      inputTokens: number;
      outputTokens: number;
    }
> {
  const call = deps.call ?? anthropicCall;
  const now = deps.now ?? Date.now;
  const settings = deps.settings ?? settingsFromEnv();
  const started = now();
  const user = buildUserPrompt(req);
  let inputTokens = 0;
  let outputTokens = 0;
  let attempts = 0;
  let problem = '';

  try {
    for (const isRetry of [false, true]) {
      const left = BUDGET.totalMs - (now() - started);
      if (isRetry && left < BUDGET.minRetryMs) break;
      attempts++;
      const a = await attempt(
        call,
        settings,
        isRetry ? user + retrySuffix(problem) : user,
        isRetry ? left : BUDGET.firstMs,
      );
      inputTokens += a.inputTokens;
      outputTokens += a.outputTokens;
      if (a.ok) {
        const { result, stats } = postprocess(a.output, req);
        return { ok: true, result, stats, attempts, inputTokens, outputTokens };
      }
      problem = a.problem;
    }
  } catch (e) {
    const err = e instanceof UpstreamError ? e : new UpstreamError('other', 0);
    const { res, code } = upstreamResponse(err);
    return { ok: false, res, code, attempts, inputTokens, outputTokens };
  }
  return {
    ok: false,
    code: 'invalid_output',
    res: errorResponse(502, 'invalid_output', 'The analysis came back malformed. It will retry.'),
    attempts,
    inputTokens,
    outputTokens,
  };
}

export function makeAnalyzeHandler(deps: AnalyzeDeps = {}): Handler {
  return async (req) => {
    const now = deps.now ?? Date.now;
    const started = now();
    const log = (
      status: number,
      extra: Record<string, number | boolean | string | undefined> = {},
    ) => logEvent({ route: 'analyze', status, ms: now() - started, ...extra });

    if (req.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Use POST.');
    const limited = checkRateLimit(req.ip, now());
    if (limited) {
      log(429, { error: 'rate_limited_local' });
      return limited;
    }
    const denied = requirePasscode(req);
    if (denied) {
      log(denied.status);
      return denied;
    }
    const size = req.bodyBytes ?? Buffer.byteLength(JSON.stringify(req.body ?? null), 'utf8');
    if (size > MAX_BODY_BYTES) {
      log(413);
      return errorResponse(413, 'too_large', 'The request is too large.');
    }
    const parsed = analyzeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      log(400, { error: 'bad_request' });
      return errorResponse(400, 'bad_request', 'The request body is not valid.');
    }
    if (!process.env.ANTHROPIC_API_KEY && !deps.call) {
      log(500, { error: 'no_api_key' });
      return errorResponse(
        500,
        'server_misconfigured',
        'ANTHROPIC_API_KEY is not set on the server.',
      );
    }

    const out = await runAnalysis(parsed.data, deps);
    const common = {
      attempts: out.attempts,
      in_tokens: out.inputTokens,
      out_tokens: out.outputTokens,
      transcript_chars: parsed.data.transcript.length,
    };
    if (!out.ok) {
      log(out.res.status, { error: out.code, ...common });
      return out.res;
    }
    log(200, {
      ...common,
      topics: out.result.topics.length,
      flags_in: out.stats.flagsIn,
      flags_out: out.stats.flagsOut,
      dropped_ungrounded: out.stats.droppedUngrounded,
      dropped_filtered: out.stats.droppedDismissed + out.stats.droppedAsked,
      ids_reassigned: out.stats.idsReassigned,
    });
    return json(out.result);
  };
}

export const analyzeHandler = makeAnalyzeHandler();
