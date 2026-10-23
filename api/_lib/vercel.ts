import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clientIp, normalizeHeaders, type Handler } from './http.js';
import { logEvent } from './log.js';

/** Wraps a neutral handler as a Vercel Node function. */
export function toVercel(name: string, handler: Handler) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    const started = Date.now();
    const headers = normalizeHeaders(req.headers);
    const lengthHeader = headers['content-length'];
    let status = 500;
    try {
      const out = await handler({
        method: req.method ?? 'GET',
        headers,
        // Vercel parses JSON bodies; a malformed body throws on access.
        body: safeBody(req),
        bodyBytes: lengthHeader ? Number(lengthHeader) : undefined,
        ip: clientIp(headers, req.socket?.remoteAddress ?? 'unknown'),
      });
      status = out.status;
      for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, v);
      res.setHeader('cache-control', 'no-store');
      res.status(out.status).json(out.body);
    } catch {
      status = 500;
      res.status(500).json({ error: 'upstream_error', message: 'Unexpected server error.' });
    } finally {
      logEvent({ route: name, status, ms: Date.now() - started });
    }
  };
}

function safeBody(req: VercelRequest): unknown {
  try {
    return req.body as unknown;
  } catch {
    return undefined;
  }
}
