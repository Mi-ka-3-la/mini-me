import type { AnalyzeRequestInput } from '../../shared/schema';
import { MAX_CONTEXT } from '../../shared/schema';
import { mmss } from '../lib/time';
import type { Session } from '../store/types';

export const WINDOW_MS = 15 * 60_000;
export const WINDOW_CHARS = 12_000;
/** The watch call needs less earlier context than the summary, and a shorter prompt is faster. */
export const WATCH_CONTEXT_CHARS = 6_000;

export function formatLine(s: Session, i: number): string {
  const l = s.lines[i];
  if (!l) return '';
  const who = l.speakerId ? s.speakers[l.speakerId]?.label : undefined;
  return `[${mmss(l.t)}] ${who ? who + ': ' : ''}${l.text}`;
}

/**
 * The transcript window (docs/02 §5, ADR-19), in two parts:
 * `fresh` = lines from `newFrom` on (where the model looks for new things), kept in full up to
 * the character budget; `earlier` = the lines before it, within the last 15 minutes, filling what
 * is left of `contextChars`. Older text reaches the model only through the current state.
 */
export function transcriptWindow(
  s: Session,
  newFrom: number,
  contextChars = WINDOW_CHARS,
): { earlier: string; fresh: string; trimmed: boolean } {
  const n = s.lines.length;
  if (n === 0) return { earlier: '', fresh: '', trimmed: false };
  const from = Math.min(Math.max(0, newFrom), n);
  const freshRows: string[] = [];
  let chars = 0;
  let firstFresh = n;
  for (let i = n - 1; i >= from; i--) {
    const row = formatLine(s, i);
    if (chars + row.length + 1 > WINDOW_CHARS && freshRows.length > 0) break;
    freshRows.push(row);
    chars += row.length + 1;
    firstFresh = i;
  }
  const lastT = s.lines[n - 1]?.t ?? 0;
  const budget = Math.max(0, contextChars - chars);
  const earlierRows: string[] = [];
  let used = 0;
  let first = firstFresh;
  for (let i = firstFresh - 1; i >= 0; i--) {
    const l = s.lines[i];
    if (!l || l.t < lastT - WINDOW_MS) break;
    const row = formatLine(s, i);
    if (used + row.length + 1 > budget) break;
    earlierRows.push(row);
    used += row.length + 1;
    first = i;
  }
  return {
    earlier: earlierRows.reverse().join('\n'),
    fresh: freshRows.reverse().join('\n'),
    trimmed: first > 0,
  };
}

function common(s: Session) {
  const speakers: Record<string, string> = {};
  for (const sp of Object.values(s.speakers)) speakers[sp.label] = sp.label;
  return { language: s.language, context: s.context.slice(0, MAX_CONTEXT), speakers };
}

/** Watch call: changes to the watch list since the last watch call (ADR-19). */
export function buildWatchRequest(s: Session): AnalyzeRequestInput {
  const live = s.flags.filter((f) => f.status === 'active' || f.status === 'pinned');
  const w = transcriptWindow(s, s.analyzedUpToLineIndex, WATCH_CONTEXT_CHARS);
  return {
    mode: 'watch',
    ...common(s),
    previous: {
      tldr: '',
      topics: [],
      flags: live.map(({ id, type, title, quote, why, ask, who }) => ({
        id,
        type,
        title,
        quote,
        why,
        ask,
        who,
      })),
    },
    pinnedIds: live.filter((f) => f.status === 'pinned').map((f) => f.id),
    dismissedQuotes: s.flags.filter((f) => f.status === 'dismissed').map((f) => f.quote),
    askedFlags: s.flags
      .filter((f) => f.status === 'asked')
      .map((f) => ({ title: f.title, quote: f.quote })),
    transcript: w.earlier,
    newTranscript: w.fresh,
    transcriptTrimmed: w.trimmed,
  };
}

/** Summary call: the whole summary, updated with the lines since the last summary (ADR-19). */
export function buildSummaryRequest(s: Session): AnalyzeRequestInput {
  const w = transcriptWindow(s, s.summaryUpToLineIndex, WINDOW_CHARS);
  return {
    mode: 'summary',
    ...common(s),
    previous: s.summary ? { tldr: s.summary.tldr, topics: s.summary.topics, flags: [] } : null,
    transcript: w.earlier,
    newTranscript: w.fresh,
    transcriptTrimmed: w.trimmed,
  };
}
