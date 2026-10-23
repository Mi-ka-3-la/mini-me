import { sameQuote, tokens } from '../../shared/normalize';
import type { ModelFlag } from '../../shared/types';
import type { ClientFlag } from '../store/types';

/** Jaccard similarity of word sets. */
function similarity(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

const text = (f: Pick<ModelFlag, 'title' | 'why' | 'ask'>) => `${f.title} ${f.why} ${f.ask}`;

/** Wording changes below this level of difference are ignored, so cards do not shimmer (US-04 AC2). */
export const MINOR_CHANGE = 0.8;

/**
 * Merges the model's flags into what is on screen (docs/02 §5, ADR-4):
 * - known id (or, as a fallback, same quote): keep status and first-seen time, update the text
 *   unless the change is minor;
 * - new: add as active, reported in `newIds` for the highlight;
 * - active flags the model dropped: removed (resolved);
 * - pinned and asked flags: never removed by the model;
 * - anything matching a dismissed quote: never comes back.
 */
export function mergeFlags(
  current: ClientFlag[],
  incoming: ModelFlag[],
  now: number,
): { flags: ClientFlag[]; newIds: string[] } {
  const byId = new Map(current.map((f) => [f.id, f]));
  const dismissed = current.filter((f) => f.status === 'dismissed');
  const asked = current.filter((f) => f.status === 'asked');
  const updated = new Map<string, ClientFlag>();
  const added: ClientFlag[] = [];
  const newIds: string[] = [];

  for (const inc of incoming) {
    if (dismissed.some((d) => d.id === inc.id || sameQuote(d.quote, inc.quote))) continue;
    let existing = byId.get(inc.id);
    if (!existing || existing.status === 'dismissed') {
      existing = current.find(
        (c) => c.status !== 'dismissed' && !updated.has(c.id) && sameQuote(c.quote, inc.quote),
      );
    }
    if (existing) {
      if (updated.has(existing.id)) continue; // two incoming flags for one card: keep the first
      const minor = similarity(text(existing), text(inc)) >= MINOR_CHANGE;
      updated.set(existing.id, {
        ...existing,
        ...(minor
          ? {}
          : { type: inc.type, title: inc.title, quote: inc.quote, why: inc.why, ask: inc.ask }),
        who: inc.who || existing.who,
        topic: inc.topic || existing.topic,
      });
      continue;
    }
    if (asked.some((a) => sameQuote(a.quote, inc.quote))) continue;
    if (added.some((a) => a.id === inc.id)) continue;
    added.push({ ...inc, firstSeenAt: now, status: 'active' });
    newIds.push(inc.id);
  }

  const flags: ClientFlag[] = [];
  for (const f of current) {
    const u = updated.get(f.id);
    if (u) flags.push(u);
    else if (f.status !== 'active') flags.push(f); // pinned, asked, dismissed stay
    // active and missing: the model judged it resolved
  }
  flags.push(...added);
  return { flags, newIds };
}
