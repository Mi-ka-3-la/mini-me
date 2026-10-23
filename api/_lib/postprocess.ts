import { randomBytes } from 'node:crypto';
import { sameQuote, quoteFound, tokens } from '../../shared/normalize.js';
import { MAX_FLAGS, type AnalyzeRequest } from '../../shared/schema.js';

/** Important markers have their own cap, so they never push problems off the list (ADR-21). */
export const MAX_IMPORTANT = 8;
import type { ModelFlag, Topic } from '../../shared/types.js';

const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/** Random ids, so a stateless server never reissues an id the client has seen (ADR-7). */
export function newFlagId(): string {
  const bytes = randomBytes(8);
  let id = 'f-';
  for (const b of bytes) id += ID_ALPHABET[b % ID_ALPHABET.length];
  return id;
}

export type PostStats = {
  added: number;
  updated: number;
  dropped: number;
  flagsOut: number;
  droppedUngrounded: number;
  droppedDismissed: number;
  droppedAsked: number;
  droppedDuplicate: number;
  droppedOverCap: number;
  idsReassigned: number;
};

export type WatchModelOutput = {
  add: Omit<ModelFlag, 'id'>[];
  update: ModelFlag[];
  drop: string[];
  questions?: { quote: string; question: string; topic?: string }[];
  segments?: { at: string; topic: string }[];
  answered?: { id: string; quote: string }[];
};

export type DetectedQuestion = { id: string; quote: string; question: string; topic: string };

export type Answer = {
  question: string;
  trap: string;
  headline: string;
  steps: { label: string; detail: string }[];
};

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

function cleanFlag<T extends Omit<ModelFlag, 'id'>>(f: T): T {
  return {
    ...f,
    title: clean(f.title),
    quote: clean(f.quote).replace(/^["“„']+|["”']+$/g, ''),
    why: clean(f.why),
    ask: clean(f.ask),
    who: clean(f.who),
  };
}

/**
 * Applies a watch call's changes to the current watch list, then runs the checks of docs/04 §6:
 * quote grounding, dismissed and asked filters, stable ids (ADR-7), de-duplication and the
 * 12-flag cap. Pinned flags are never dropped; when over the cap, the oldest unpinned go first.
 */
export function applyWatch(
  out: WatchModelOutput,
  req: AnalyzeRequest,
  makeId: () => string = newFlagId,
): { flags: ModelFlag[]; stats: PostStats } {
  const prev = req.previous?.flags ?? [];
  const pinned = new Set(req.pinnedIds);
  const groundTokens = tokens(`${req.transcript}\n${req.newTranscript}`);
  const stats: PostStats = {
    added: 0,
    updated: 0,
    dropped: 0,
    flagsOut: 0,
    droppedUngrounded: 0,
    droppedDismissed: 0,
    droppedAsked: 0,
    droppedDuplicate: 0,
    droppedOverCap: 0,
    idsReassigned: 0,
  };

  const drop = new Set(out.drop.filter((id) => prev.some((p) => p.id === id) && !pinned.has(id)));
  stats.dropped = drop.size;

  // Existing flags, with updates applied when the update keeps the same quote.
  const list: ModelFlag[] = [];
  const asNew: Omit<ModelFlag, 'id'>[] = [];
  for (const p of prev) {
    if (drop.has(p.id)) continue;
    const u = out.update.find((x) => x.id === p.id);
    if (u && sameQuote(u.quote, p.quote)) {
      list.push({ ...cleanFlag(u), id: p.id, quote: p.quote });
      stats.updated++;
    } else {
      list.push(p);
    }
  }
  // An update whose id is unknown or whose quote changed is really a new flag.
  for (const u of out.update) {
    const p = prev.find((x) => x.id === u.id);
    if (!p || !sameQuote(u.quote, p.quote)) {
      asNew.push(u);
      if (u.id) stats.idsReassigned++;
    }
  }

  for (const raw of [...out.add, ...asNew]) {
    const f = cleanFlag({
      type: raw.type,
      title: raw.title,
      quote: raw.quote,
      why: raw.why,
      ask: raw.ask,
      who: raw.who,
      topic: clean(raw.topic ?? ''),
    });
    if (!quoteFound(f.quote, groundTokens)) {
      stats.droppedUngrounded++;
      continue;
    }
    if (req.dismissedQuotes.some((q) => sameQuote(q, f.quote))) {
      stats.droppedDismissed++;
      continue;
    }
    if (req.askedFlags.some((a) => sameQuote(a.quote, f.quote))) {
      stats.droppedAsked++;
      continue;
    }
    if (list.some((k) => sameQuote(k.quote, f.quote))) {
      stats.droppedDuplicate++;
      continue;
    }
    list.push({ ...f, id: makeId() });
    stats.added++;
  }

  // Cap: remove the oldest unpinned flags first (the list runs oldest → newest).
  const capKind = (isImportant: boolean, max: number) => {
    const ofKind = () => list.filter((f) => (f.type === 'important') === isImportant);
    while (ofKind().length > max) {
      const i = list.findIndex(
        (f) => (f.type === 'important') === isImportant && !pinned.has(f.id),
      );
      if (i < 0) break;
      list.splice(i, 1);
      stats.droppedOverCap++;
    }
  };
  capKind(true, MAX_IMPORTANT);
  while (list.filter((f) => f.type !== 'important').length > MAX_FLAGS) {
    const i = list.findIndex((f) => f.type !== 'important' && !pinned.has(f.id));
    if (i < 0) break;
    list.splice(i, 1);
    stats.droppedOverCap++;
  }
  stats.flagsOut = list.length;
  return { flags: list, stats };
}

/** New questions from a watch call (ADR-20): grounded in the transcript, not already known. */
export function applyQuestions(
  out: WatchModelOutput,
  req: AnalyzeRequest,
  makeId: () => string = () => newFlagId().replace(/^f-/, 'q-'),
): DetectedQuestion[] {
  const groundTokens = tokens(`${req.transcript}\n${req.newTranscript}`);
  const result: DetectedQuestion[] = [];
  for (const q of out.questions ?? []) {
    const quote = clean(q.quote).replace(/^["“„']+|["”']+$/g, '');
    const question = clean(q.question);
    if (!quote || !question || !quoteFound(quote, groundTokens)) continue;
    if (req.knownQuestions.some((k) => sameQuote(k, quote))) continue;
    if (result.some((r) => sameQuote(r.quote, quote))) continue;
    result.push({ id: makeId(), quote, question, topic: clean(q.topic ?? '') });
  }
  return result.slice(0, 5);
}

/** "mm:ss" → ms, or null when the model wrote something else. */
export function parseClock(at: string): number | null {
  const m = /^(\d{1,3}):([0-5]\d)$/.exec(at.trim().replace(/^\[|\]$/g, ''));
  return m ? (Number(m[1]) * 60 + Number(m[2])) * 1000 : null;
}

/**
 * Topic segments and answered questions from a watch call (ADR-21). Segments must point at a
 * time that appears in the transcript; answers must be grounded and belong to an open question.
 */
export function applyThreads(
  out: WatchModelOutput,
  req: AnalyzeRequest,
): { segments: { t: number; topic: string }[]; answered: { id: string; quote: string }[] } {
  const text = `${req.transcript}\n${req.newTranscript}`;
  const times = new Set(
    [...text.matchAll(/^\[(\d{1,3}:[0-5]\d)\]/gm)].map((m) => parseClock(m[1] ?? '')),
  );
  const segments = (out.segments ?? [])
    .map((sg) => ({ t: parseClock(sg.at), topic: clean(sg.topic) }))
    .filter(
      (sg): sg is { t: number; topic: string } => sg.t !== null && times.has(sg.t) && !!sg.topic,
    )
    .sort((a, b) => a.t - b.t)
    .slice(0, 10);
  const open = new Set(req.openQuestions.map((q) => q.id));
  const groundTokens = tokens(text);
  const answered = (out.answered ?? [])
    .map((a) => ({ id: a.id.trim(), quote: clean(a.quote).replace(/^["“„']+|["”']+$/g, '') }))
    .filter((a) => open.has(a.id) && quoteFound(a.quote, groundTokens));
  return { segments, answered };
}

export function cleanAnswer(a: Answer): Answer {
  return {
    question: clean(a.question),
    trap: clean(a.trap),
    headline: clean(a.headline),
    steps: a.steps
      .map((st) => ({ label: clean(st.label), detail: clean(st.detail) }))
      .filter((st) => st.label)
      .slice(0, 6),
  };
}

export function cleanSummary(out: { tldr: string; topics: Topic[] }): {
  tldr: string;
  topics: Topic[];
} {
  return {
    tldr: clean(out.tldr),
    topics: out.topics.map((t) => ({
      topic: clean(t.topic),
      points: t.points.map(clean).filter(Boolean),
      decisions: t.decisions.map(clean).filter(Boolean),
      actions: t.actions.map(clean).filter(Boolean),
      open: t.open.map(clean).filter(Boolean),
    })),
  };
}
