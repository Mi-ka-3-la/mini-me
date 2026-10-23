import { randomBytes } from 'node:crypto';
import { sameQuote, quoteFound, tokens } from '../../shared/normalize.js';
import { MAX_FLAGS, type AnalyzeRequest } from '../../shared/schema.js';
import type { AnalysisOutput, ModelFlag } from '../../shared/types.js';

const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/** Random ids, so a stateless server never reissues an id the client has seen (ADR-7). */
export function newFlagId(): string {
  const bytes = randomBytes(8);
  let id = 'f-';
  for (const b of bytes) id += ID_ALPHABET[b % ID_ALPHABET.length];
  return id;
}

export type PostStats = {
  flagsIn: number;
  flagsOut: number;
  droppedUngrounded: number;
  droppedDismissed: number;
  droppedAsked: number;
  droppedDuplicate: number;
  droppedOverCap: number;
  idsReassigned: number;
};

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Server-side checks of docs/04 §6, applied after the model answers:
 * stable ids, quote grounding, dismissed and asked filters, de-duplication, the 12-flag cap.
 */
export function postprocess(
  out: AnalysisOutput,
  req: AnalyzeRequest,
  makeId: () => string = newFlagId,
): { result: AnalysisOutput; stats: PostStats } {
  const prev = req.previous?.flags ?? [];
  const prevById = new Map(prev.map((f) => [f.id, f]));
  const transcriptTokens = tokens(req.transcript);
  const stats: PostStats = {
    flagsIn: out.flags.length,
    flagsOut: 0,
    droppedUngrounded: 0,
    droppedDismissed: 0,
    droppedAsked: 0,
    droppedDuplicate: 0,
    droppedOverCap: 0,
    idsReassigned: 0,
  };

  const kept: ModelFlag[] = [];
  const usedIds = new Set<string>();

  for (const raw of out.flags) {
    const f: ModelFlag = {
      id: raw.id.trim(),
      type: raw.type,
      title: clean(raw.title),
      quote: clean(raw.quote).replace(/^["“„']+|["”']+$/g, ''),
      why: clean(raw.why),
      ask: clean(raw.ask),
      who: clean(raw.who),
    };

    // Grounding: the quote must be in the transcript window, or be a previous flag's quote.
    const grounded =
      quoteFound(f.quote, transcriptTokens) || prev.some((p) => sameQuote(p.quote, f.quote));
    if (!grounded) {
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

    // Ids: keep a previous id only when the quote still belongs to that flag.
    const prevSame = prevById.get(f.id);
    let id = prevSame && sameQuote(prevSame.quote, f.quote) ? f.id : '';
    if (!id) {
      const byQuote = prev.find((p) => !usedIds.has(p.id) && sameQuote(p.quote, f.quote));
      id = byQuote?.id ?? '';
    }
    if (!id || usedIds.has(id)) {
      if (f.id) stats.idsReassigned++;
      id = makeId();
    }

    if (kept.some((k) => sameQuote(k.quote, f.quote) && k.type === f.type)) {
      stats.droppedDuplicate++;
      continue;
    }
    usedIds.add(id);
    kept.push({ ...f, id });
  }

  if (kept.length > MAX_FLAGS) {
    stats.droppedOverCap = kept.length - MAX_FLAGS;
    kept.length = MAX_FLAGS;
  }
  stats.flagsOut = kept.length;

  return {
    result: {
      tldr: clean(out.tldr),
      topics: out.topics.map((t) => ({
        topic: clean(t.topic),
        points: t.points.map(clean).filter(Boolean),
        decisions: t.decisions.map(clean).filter(Boolean),
        actions: t.actions.map(clean).filter(Boolean),
        open: t.open.map(clean).filter(Boolean),
      })),
      flags: kept,
    },
    stats,
  };
}
