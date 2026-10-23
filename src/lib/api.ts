/** Thin fetch wrapper for /api routes. Sends the passcode header; never logs bodies. */
export type ApiError = {
  status: number;
  code: string;
  message: string;
  retryAfterSec?: number;
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export async function apiFetch<T>(
  path: string,
  opts: { passcode: string | null; method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal },
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (opts.passcode) headers['x-app-passcode'] = encodeURIComponent(opts.passcode);
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      return { ok: false, error: { status: 0, code: 'aborted', message: 'Cancelled.' } };
    }
    return {
      ok: false,
      error: { status: 0, code: 'network', message: 'Could not reach the server.' },
    };
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.ok) return { ok: true, data: data as T };
  const body = (data ?? {}) as { error?: unknown; message?: unknown };
  const retry = Number(res.headers.get('retry-after'));
  return {
    ok: false,
    error: {
      status: res.status,
      code: typeof body.error === 'string' ? body.error : `http_${res.status}`,
      message: typeof body.message === 'string' ? body.message : `Request failed (${res.status}).`,
      retryAfterSec: Number.isFinite(retry) && retry > 0 ? retry : undefined,
    },
  };
}
