/** Trigger rules of docs/02 §5. Pure, so they can be tested without timers. */
export const N_MIN_WORDS = 60;
export const N_WORDS = 150;
export const T_MAX_MS = 45_000;

export type TriggerInput = {
  running: boolean;
  newWords: number;
  /** ms since the last call started, or since the first unanalysed line if there was no call yet */
  sinceLastMs: number;
  manual: boolean;
  callsUsed: number;
  maxCalls: number;
  /** epoch ms before which automatic calls wait after an error */
  retryAt: number;
  now: number;
  /** false when there is no passcode, or the server refused it */
  canCall: boolean;
  /** a new line from someone else looks like a question (ADR-23) */
  questionPending?: boolean;
};

/** Fast path (ADR-23): a question triggers a watch call at once, at most every 8 s. */
export const Q_MIN_WORDS = 4;
export const Q_MIN_GAP_MS = 8_000;

export type Decision = { run: boolean; reason: string };

export function decide(i: TriggerInput): Decision {
  if (!i.canCall) return { run: false, reason: 'no-access' };
  if (i.running) return { run: false, reason: 'running' };
  if (i.manual) {
    // "Analyze now" works with any new text, and after the cap (deviation noted in the PR).
    return i.newWords > 0 ? { run: true, reason: 'manual' } : { run: false, reason: 'nothing-new' };
  }
  if (i.callsUsed >= i.maxCalls) return { run: false, reason: 'cap' };
  if (i.now < i.retryAt) return { run: false, reason: 'backoff' };
  if (i.questionPending && i.newWords >= Q_MIN_WORDS && i.sinceLastMs >= Q_MIN_GAP_MS) {
    return { run: true, reason: 'question' };
  }
  if (i.newWords < N_MIN_WORDS) return { run: false, reason: 'too-few-words' };
  if (i.newWords >= N_WORDS) return { run: true, reason: 'words' };
  if (i.sinceLastMs >= T_MAX_MS) return { run: true, reason: 'time' };
  return { run: false, reason: 'waiting' };
}

export function countWords(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

/** Wait after a failed call: the server's retry-after, else 15 s doubling to 2 min. */
export function backoffMs(consecutiveErrors: number, retryAfterSec?: number): number {
  if (retryAfterSec) return retryAfterSec * 1000;
  return Math.min(120_000, 15_000 * 2 ** Math.max(0, consecutiveErrors - 1));
}

/** Summary cadence (ADR-19): every 3 minutes with at least 60 new words, or on "Analyze now". */
export const SUMMARY_EVERY_MS = 3 * 60_000;

export type SummaryTriggerInput = {
  running: boolean;
  newWords: number;
  sinceLastMs: number;
  manual: boolean;
  callsUsed: number;
  maxCalls: number;
  retryAt: number;
  now: number;
  canCall: boolean;
  /** true until the first summary exists */
  noSummaryYet: boolean;
};

export function decideSummary(i: SummaryTriggerInput): Decision {
  if (!i.canCall) return { run: false, reason: 'no-access' };
  if (i.running) return { run: false, reason: 'running' };
  if (i.manual) {
    return i.newWords > 0 ? { run: true, reason: 'manual' } : { run: false, reason: 'nothing-new' };
  }
  if (i.callsUsed >= i.maxCalls) return { run: false, reason: 'cap' };
  if (i.now < i.retryAt) return { run: false, reason: 'backoff' };
  if (i.newWords < N_MIN_WORDS) return { run: false, reason: 'too-few-words' };
  // The first summary comes early (with the first watch threshold), then every 3 minutes.
  if (i.noSummaryYet && i.newWords >= N_WORDS) return { run: true, reason: 'first' };
  if (i.sinceLastMs >= SUMMARY_EVERY_MS) return { run: true, reason: 'time' };
  return { run: false, reason: 'waiting' };
}

const Q_START = [
  // English
  'who',
  'what',
  'when',
  'where',
  'why',
  'how',
  'which',
  'can you',
  'could you',
  'would you',
  'do you',
  'did you',
  'have you',
  'are you',
  'were you',
  'is there',
  'is it',
  'tell me',
  'walk me through',
  'describe',
  'give me an example',
  // Romanian, without diacritics
  'ce',
  'cum',
  'cand',
  'unde',
  'de ce',
  'cine',
  'care',
  'cat',
  'cate',
  'cati',
  'poti',
  'puteti',
  'ai putea',
  'ati putea',
  'spune-mi',
  'spuneti-mi',
  'povesteste',
  'povestiti',
  'ai lucrat',
  'ati lucrat',
  'ai avut',
  'exista',
];
const Q_RE = new RegExp(
  `(^|[.!,;:]\\s+)((so|and|but|then|okay|ok|si|deci|bun|dar)\\s+)?(${Q_START.map((w) => w.replace('-', '\\-')).join('|')})\\b`,
);

/**
 * Cheap browser-side check that a line is probably a question (ADR-23). Browser speech often
 * has no punctuation, so question openers count as well as "?". False positives only cost an
 * early watch call; the model decides what is really a question.
 */
export function looksLikeQuestion(text: string): boolean {
  const t = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  return t.includes('?') || Q_RE.test(t);
}
