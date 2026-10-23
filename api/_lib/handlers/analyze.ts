import { z } from 'zod';
import {
  MAX_BODY_BYTES,
  SUMMARY_JSON_SCHEMA,
  WATCH_JSON_SCHEMA,
  analyzeRequestSchema,
  summaryOutputSchema,
  watchModelOutputSchema,
  type AnalyzeRequest,
} from '../../../shared/schema.js';
import type { ModelFlag, Topic } from '../../../shared/types.js';
import { requirePasscode } from '../auth.js';
import { errorResponse, json, type ApiResponse, type Handler } from '../http.js';
import { logEvent } from '../log.js';
import {
  anthropicCall,
  settingsFromEnv,
  watchSettingsFromEnv,
  UpstreamError,
  type ModelCall,
  type ModelSettings,
} from '../model.js';
import { applyWatch, cleanSummary, type PostStats, type WatchModelOutput } from '../postprocess.js';
import { buildSummaryPrompt, buildWatchPrompt, retrySuffix, SYSTEM_PROMPT } from '../prompt.js';
import { checkRateLimit } from '../rateLimit.js';

/** Time budget (docs/02 §6 as amended): first attempt 50 s, retry only with ≥ 20 s of 75 s left. */
export const BUDGET = { totalMs: 75_000, firstMs: 50_000, minRetryMs: 20_000 };

export type AnalyzeDeps = {
  call?: ModelCall;
  now?: () => number;
  /** Overrides the env settings for both modes (tests, eval). */
  settings?: ModelSettings;
  watchSettings?: ModelSettings;
};

type ModelOutput = WatchModelOutput | { tldr: string; topics: Topic[] };

type Attempt =
  | { ok: true; output: ModelOutput; inputTokens: number; outputTokens: number }
  | { ok: false; problem: string; inputTokens: number; outputTokens: number };

export type AnalyzeResult = { flags: ModelFlag[] } | { tldr: string; topics: Topic[] };

/** Describes why output was unusable, by shape only, so no content reaches the retry note or logs. */
function describeIssues(err: z.ZodError): string {
  const paths = err.issues.slice(0, 5).map((i) => `${i.path.join('.') || 'root'}: ${i.code}`);
  return `it did not match the schema (${paths.join('; ')})`;
}

function parseOutput(
  text: string,
  mode: AnalyzeRequest['mode'],
): { ok: true; output: ModelOutput } | { ok: false; problem: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, problem: 'it was not valid JSON' };
  }
  const parsed =
    mode === 'watch' ? watchModelOutputSchema.safeParse(raw) : summaryOutputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: describeIssues(parsed.error) };
  return { ok: true, output: parsed.data as ModelOutput };
}

async function attempt(
  call: ModelCall,
  settings: ModelSettings,
  mode: AnalyzeRequest['mode'],
  user: string,
  timeoutMs: number,
): Promise<Attempt> {
  const schema = (mode === 'watch' ? WATCH_JSON_SCHEMA : SUMMARY_JSON_SCHEMA) as unknown as Record<
    string,
    unknown
  >;
  const res = await call({ ...settings, system: SYSTEM_PROMPT, user, timeoutMs, schema });
  const tokens = { inputTokens: res.inputTokens, outputTokens: res.outputTokens };
  if (res.stopReason === 'max_tokens') return { ok: false, problem: 'it was cut off', ...tokens };
  if (res.stopReason === 'refusal') return { ok: false, problem: 'it was a refusal', ...tokens };
  const parsed = parseOutput(res.text, mode);
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
      result: AnalyzeResult;
      stats: PostStats | null;
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
  const settings =
    req.mode === 'watch'
      ? (deps.watchSettings ?? deps.settings ?? watchSettingsFromEnv())
      : (deps.settings ?? settingsFromEnv());
  const started = now();
  const user = req.mode === 'watch' ? buildWatchPrompt(req) : buildSummaryPrompt(req);
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
        req.mode,
        isRetry ? user + retrySuffix(problem) : user,
        isRetry ? left : BUDGET.firstMs,
      );
      inputTokens += a.inputTokens;
      outputTokens += a.outputTokens;
      if (a.ok) {
        if (req.mode === 'watch') {
          const { flags, stats } = applyWatch(a.output as WatchModelOutput, req);
          return { ok: true, result: { flags }, stats, attempts, inputTokens, outputTokens };
        }
        const result = cleanSummary(a.output as { tldr: string; topics: Topic[] });
        return { ok: true, result, stats: null, attempts, inputTokens, outputTokens };
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
      mode: parsed.data.mode,
      attempts: out.attempts,
      in_tokens: out.inputTokens,
      out_tokens: out.outputTokens,
      transcript_chars: parsed.data.transcript.length,
    };
    if (!out.ok) {
      log(out.res.status, { error: out.code, ...common });
      return out.res;
    }
    const st = out.stats;
    log(200, {
      ...common,
      ...('topics' in out.result ? { topics: out.result.topics.length } : {}),
      ...(st
        ? {
            added: st.added,
            updated: st.updated,
            dropped: st.dropped,
            flags_out: st.flagsOut,
            dropped_ungrounded: st.droppedUngrounded,
            dropped_filtered: st.droppedDismissed + st.droppedAsked,
            dropped_cap: st.droppedOverCap,
          }
        : {}),
    });
    return json(out.result);
  };
}

export const analyzeHandler = makeAnalyzeHandler();
