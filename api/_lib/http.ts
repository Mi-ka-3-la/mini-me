/**
 * Framework-neutral request/response types (ADR-14).
 * Route logic is written against these, then wrapped for Vercel (vercel.ts)
 * and for the local dev server (vite.config.ts).
 */
export type ApiRequest = {
  method: string;
  headers: Record<string, string | undefined>;
  /** Parsed JSON body, or undefined. Unvalidated: every handler validates it with zod. */
  body: unknown;
  /** Size of the raw body in bytes, when known. */
  bodyBytes?: number;
  ip: string;
};

export type ApiResponse = {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
};

export type Handler = (req: ApiRequest) => Promise<ApiResponse>;

export type ErrorCode =
  | 'bad_request'
  | 'method_not_allowed'
  | 'unauthorized'
  | 'too_large'
  | 'rate_limited'
  | 'server_misconfigured'
  | 'upstream_error'
  | 'upstream_overloaded'
  | 'invalid_output'
  | 'upstream_timeout';

export function errorResponse(
  status: number,
  error: ErrorCode,
  message: string,
  headers?: Record<string, string>,
): ApiResponse {
  return { status, headers: headers ?? {}, body: { error, message } };
}

export function json(body: unknown, status = 200, headers?: Record<string, string>): ApiResponse {
  return { status, headers: headers ?? {}, body };
}

/** Lower-cases header names and flattens array values. */
export function normalizeHeaders(
  raw: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}

export function clientIp(
  headers: Record<string, string | undefined>,
  fallback = 'unknown',
): string {
  const fwd = headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0]?.trim() || fallback;
  return headers['x-real-ip'] ?? fallback;
}
