import { errorResponse, type ApiResponse } from './http.js';

/**
 * 30 requests per minute per IP, in memory (docs/02 §8, ADR-11).
 * Each serverless instance has its own memory, so this only slows one burst on one instance.
 * The passcode and the Console spend limit are the real protections.
 */
export const RATE = { windowMs: 60_000, max: 30 };

/** RATE_LIMIT_PER_MIN overrides the limit; used by the end-to-end tests, which run many sessions from one IP. */
function maxPerWindow(): number {
  const n = Number(process.env.RATE_LIMIT_PER_MIN);
  return Number.isInteger(n) && n > 0 ? n : RATE.max;
}

const hits = new Map<string, number[]>();

export function checkRateLimit(ip: string, now = Date.now()): ApiResponse | null {
  const since = now - RATE.windowMs;
  const list = (hits.get(ip) ?? []).filter((t) => t > since);
  if (list.length >= maxPerWindow()) {
    hits.set(ip, list);
    const retry = Math.max(1, Math.ceil(((list[0] ?? now) + RATE.windowMs - now) / 1000));
    return errorResponse(429, 'rate_limited', 'Too many requests. Wait a moment.', {
      'retry-after': String(retry),
    });
  }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some((t) => t > since)) hits.delete(k);
  }
  return null;
}

export function resetRateLimit(): void {
  hits.clear();
}
