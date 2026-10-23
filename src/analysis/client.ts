import {
  answerResponseSchema,
  summaryOutputSchema,
  watchResponseSchema,
} from '../../shared/schema';
import type { ModelFlag, Topic } from '../../shared/types';
import type { Answer } from '../store/types';
import type { AnalyzeRequestInput } from '../../shared/schema';
import { apiFetch, type ApiError } from '../lib/api';

/** Client-side ceiling: a little above the server's 90 s maxDuration. */
export const CLIENT_TIMEOUT_MS = 95_000;

export type AnalyzeData =
  | {
      flags: ModelFlag[];
      questions: { id: string; quote: string; question: string; topic: string }[];
      segments: { t: number; topic: string }[];
      answered: { id: string; quote: string }[];
    }
  | { tldr: string; topics: Topic[] }
  | { answer: Answer };
export type AnalyzeResult = { ok: true; data: AnalyzeData } | { ok: false; error: ApiError };

export async function callAnalyze(
  body: AnalyzeRequestInput,
  passcode: string,
  signal: AbortSignal,
): Promise<AnalyzeResult> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), CLIENT_TIMEOUT_MS);
  const onAbort = () => timeout.abort();
  signal.addEventListener('abort', onAbort);
  try {
    const res = await apiFetch<unknown>('/api/analyze', {
      method: 'POST',
      passcode,
      body,
      signal: timeout.signal,
    });
    if (!res.ok) {
      if (res.error.code === 'aborted' && !signal.aborted) {
        return { ok: false, error: { status: 0, code: 'client_timeout', message: 'Timed out.' } };
      }
      return res;
    }
    const parsed =
      body.mode === 'watch'
        ? watchResponseSchema.safeParse(res.data)
        : body.mode === 'answer'
          ? answerResponseSchema.safeParse(res.data)
          : summaryOutputSchema.safeParse(res.data);
    if (!parsed.success) {
      return { ok: false, error: { status: 200, code: 'invalid_output', message: 'Malformed.' } };
    }
    return { ok: true, data: parsed.data as AnalyzeData };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

/** What the user reads when an analysis call fails. What is on screen is always kept. */
export function errorText(e: ApiError, retryInSec: number): string {
  const retry = retryInSec > 0 ? ` Retrying in ${retryInSec} s.` : '';
  switch (e.code) {
    case 'unauthorized':
      return 'The passcode was refused. Analysis is paused; the transcript keeps running.';
    case 'rate_limited':
      return `Analysis is busy.${retry}`;
    case 'network':
      return `No connection to the server.${retry}`;
    case 'server_misconfigured':
      return `Server setup problem: ${e.message}`;
    case 'too_large':
    case 'bad_request':
      return `This part of the meeting could not be analyzed (${e.code}).${retry}`;
    default:
      return `Analysis failed (${e.code}). What is on screen is kept.${retry}`;
  }
}
