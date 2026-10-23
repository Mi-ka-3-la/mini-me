/**
 * Text normalization for comparing quotes (ADR-17).
 * NFD splits ă/â/î/ș/ț (and the cedilla forms ş/ţ) into a base letter plus a combining mark;
 * removing the marks makes "ș", "ş" and "s" compare equal, so STT and model spelling agree.
 */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function tokens(s: string): string[] {
  const n = normalizeText(s);
  return n ? n.split(' ') : [];
}

export const QUOTE_OVERLAP = 0.85;

/**
 * True when the quote appears in the text, allowing small STT/model differences:
 * at least 85% of the quote's tokens occur inside one window of the text that is
 * the quote's length plus 2 tokens.
 */
export function quoteFound(
  quote: string,
  textTokens: string[],
  threshold = QUOTE_OVERLAP,
): boolean {
  const q = tokens(quote);
  if (q.length === 0) return false;
  const needed = Math.ceil(q.length * threshold);
  const win = q.length + 2;
  const qCount = new Map<string, number>();
  for (const t of q) qCount.set(t, (qCount.get(t) ?? 0) + 1);
  for (let start = 0; start < Math.max(1, textTokens.length - q.length + 1); start++) {
    const have = new Map<string, number>();
    for (let i = start; i < Math.min(textTokens.length, start + win); i++) {
      const t = textTokens[i] as string;
      if (qCount.has(t)) have.set(t, (have.get(t) ?? 0) + 1);
    }
    let hits = 0;
    for (const [t, c] of qCount) hits += Math.min(c, have.get(t) ?? 0);
    if (hits >= needed) return true;
  }
  return false;
}

/** Two quotes are "the same flag" when either one is found in the other. */
export function sameQuote(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  // Very short quotes would match almost anything; require them to be identical.
  if (ta.length < 3 || tb.length < 3) return ta.join(' ') === tb.join(' ') && ta.length > 0;
  return quoteFound(a, tb) || quoteFound(b, ta);
}
