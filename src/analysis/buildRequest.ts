import type { AnalyzeRequestInput } from '../../shared/schema';
import { MAX_CONTEXT } from '../../shared/schema';
import { mmss } from '../lib/time';
import type { Session } from '../store/types';

export const WINDOW_MS = 15 * 60_000;
export const WINDOW_CHARS = 12_000;

export function formatLine(s: Session, i: number): string {
  const l = s.lines[i];
  if (!l) return '';
  const who = l.speakerId ? s.speakers[l.speakerId]?.label : undefined;
  return `[${mmss(l.t)}] ${who ? who + ': ' : ''}${l.text}`;
}

/**
 * The transcript window (docs/02 §5): the last 15 minutes, cut further to the last
 * ~12 000 characters if that is shorter. Older text reaches the model only through the
 * previous analysis.
 */
export function transcriptWindow(s: Session): { text: string; trimmed: boolean } {
  const n = s.lines.length;
  if (n === 0) return { text: '', trimmed: false };
  const lastT = s.lines[n - 1]?.t ?? 0;
  const out: string[] = [];
  let chars = 0;
  let first = n;
  for (let i = n - 1; i >= 0; i--) {
    const l = s.lines[i];
    if (!l || l.t < lastT - WINDOW_MS) break;
    const row = formatLine(s, i);
    if (chars + row.length + 1 > WINDOW_CHARS && out.length > 0) break;
    out.push(row);
    chars += row.length + 1;
    first = i;
  }
  return { text: out.reverse().join('\n'), trimmed: first > 0 };
}

export function buildAnalyzeRequest(s: Session): AnalyzeRequestInput {
  const { text, trimmed } = transcriptWindow(s);
  const speakers: Record<string, string> = {};
  for (const sp of Object.values(s.speakers)) speakers[sp.label] = sp.label;
  const live = s.flags.filter((f) => f.status === 'active' || f.status === 'pinned');
  return {
    language: s.language,
    context: s.context.slice(0, MAX_CONTEXT),
    speakers,
    previous: s.summary
      ? {
          tldr: s.summary.tldr,
          topics: s.summary.topics,
          flags: live.map(({ id, type, title, quote, why, ask, who }) => ({
            id,
            type,
            title,
            quote,
            why,
            ask,
            who,
          })),
        }
      : null,
    dismissedQuotes: s.flags.filter((f) => f.status === 'dismissed').map((f) => f.quote),
    askedFlags: s.flags
      .filter((f) => f.status === 'asked')
      .map((f) => ({ title: f.title, quote: f.quote })),
    transcript: text,
    transcriptTrimmed: trimmed,
  };
}
