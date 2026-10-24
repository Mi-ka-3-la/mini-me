import { z } from 'zod';
import {
  MAX_BODY_BYTES,
  ANSWER_JSON_SCHEMA,
  PREP_JSON_SCHEMA,
  SUMMARY_JSON_SCHEMA,
  WATCH_JSON_SCHEMA,
  analyzeRequestSchema,
  answerOutputSchema,
  prepOutputSchema,
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
import {
  applyQuestions,
  applyThreads,
  applyWatch,
  cleanAnswer,
  cleanPrep,
  cleanSummary,
  type Answer,
  type DetectedQuestion,
  type PostStats,
  type Prep,
  type WatchModelOutput,
} from '../postprocess.js';
import {
  buildAnswerPrompt,
  buildPrepPrompt,
  buildSummaryPrompt,
  buildWatchPrompt,
  retrySuffix,
  SYSTEM_PROMPT,
} from '../prompt.js';
import { checkRateLimit } from '../rateLimit.js';

/** Time budget (docs/02 §6 as amended): first attempt 50 s, retry only with ≥ 20 s of 75 s left. */
export const BUDGET = { totalMs: 75_000, firstMs: 50_000, minRetryMs: 20_000 };
/** Prep writes 8–10 answers at once, before the meeting: one long attempt, no retry (ADR-25). */
export const PREP_BUDGET = { totalMs: 85_000, firstMs: 82_000, minRetryMs: 20_000 };

export type AnalyzeDeps = {
  call?: ModelCall;
  now?: () => number;
  /** Overrides the env settings for both modes (tests, eval). */
  settings?: ModelSettings;
  watchSettings?: ModelSettings;
};

type ModelOutput = WatchModelOutput | { tldr: string; topics: Topic[] } | Answer | Prep;

type Attempt =
  | { ok: true; output: ModelOutput; inputTokens: number; outputTokens: number }
  | { ok: false; problem: string; inputTokens: number; outputTokens: number };

export type AnalyzeResult =
  | {
      flags: ModelFlag[];
      questions: DetectedQuestion[];
      segments: { t: number; topic: string }[];
      answered: { id: string; quote: string }[];
    }
  | { tldr: string; topics: Topic[] }
  | { answer: Answer }
  | { prep: Prep };

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
    mode === 'watch'
      ? watchModelOutputSchema.safeParse(raw)
      : mode === 'answer'
        ? answerOutputSchema.safeParse(raw)
        : mode === 'prep'
          ? prepOutputSchema.safeParse(raw)
          : summaryOutputSchema.safeParse(raw);
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
  const schema = (mode === 'watch'
    ? WATCH_JSON_SCHEMA
    : mode === 'answer'
      ? ANSWER_JSON_SCHEMA
      : mode === 'prep'
        ? PREP_JSON_SCHEMA
        : SUMMARY_JSON_SCHEMA) as unknown as Record<string, unknown>;
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
  // The answer call is read live, so it uses the fast watch settings (ADR-20).
  const settings =
    req.mode === 'summary' || req.mode === 'prep'
      ? (deps.settings ?? settingsFromEnv())
      : (deps.watchSettings ?? deps.settings ?? watchSettingsFromEnv());
  const started = now();
  const user =
    req.mode === 'watch'
      ? buildWatchPrompt(req)
      : req.mode === 'answer'
        ? buildAnswerPrompt(req)
        : req.mode === 'prep'
          ? buildPrepPrompt(req)
          : buildSummaryPrompt(req);
  let inputTokens = 0;
  let outputTokens = 0;
  let attempts = 0;
  let problem = '';

  try {
    for (const isRetry of [false, true]) {
      const budget = req.mode === 'prep' ? PREP_BUDGET : BUDGET;
      const left = budget.totalMs - (now() - started);
      if (isRetry && left < budget.minRetryMs) break;
      attempts++;
      const a = await attempt(
        call,
        settings,
        req.mode,
        isRetry ? user + retrySuffix(problem) : user,
        isRetry ? left : budget.firstMs,
      );
      inputTokens += a.inputTokens;
      outputTokens += a.outputTokens;
      if (a.ok) {
        if (req.mode === 'watch') {
          const w = a.output as WatchModelOutput;
          const { flags, stats } = applyWatch(w, req);
          const questions = applyQuestions(w, req);
          const { segments, answered } = applyThreads(w, req);
          return {
            ok: true,
            result: { flags, questions, segments, answered },
            stats,
            attempts,
            inputTokens,
            outputTokens,
          };
        }
        if (req.mode === 'prep') {
          const prep = cleanPrep(a.output as Prep);
          return { ok: true, result: { prep }, stats: null, attempts, inputTokens, outputTokens };
        }
        if (req.mode === 'answer') {
          const answer = cleanAnswer(a.output as Answer);
          return { ok: true, result: { answer }, stats: null, attempts, inputTokens, outputTokens };
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
    if (parsed.success && parsed.data.mode === 'prep' && !parsed.data.brief.trim()) {
      return errorResponse(400, 'bad_request', 'A prep request needs a brief.');
    }
    if (parsed.success && parsed.data.mode === 'answer' && !parsed.data.question) {
      log(400, { error: 'bad_request' });
      return errorResponse(400, 'bad_request', 'An answer request needs a question.');
    }
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
      ...('questions' in out.result ? { questions: out.result.questions.length } : {}),
      ...('answer' in out.result ? { steps: out.result.answer.steps.length } : {}),
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
