import { createHash, timingSafeEqual } from 'node:crypto';
import { errorResponse, type ApiRequest, type ApiResponse } from './http.js';

const HEADER = 'x-app-passcode';

function digest(s: string): Buffer {
  return createHash('sha256').update(s, 'utf8').digest();
}

/**
 * Constant-time comparison. Both sides are hashed first so the compared buffers
 * always have the same length, whatever was sent.
 */
export function passcodeMatches(given: string | undefined, expected: string): boolean {
  const same = timingSafeEqual(digest(given ?? ''), digest(expected));
  return same && given !== undefined && expected.length > 0;
}

/** The browser sends the passcode URI-encoded, because HTTP headers cannot carry non-Latin-1 text. */
export function readPasscodeHeader(req: ApiRequest): string | undefined {
  const raw = req.headers[HEADER];
  if (raw === undefined) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Returns an error response when the request may not proceed, or null when it may. */
export function requirePasscode(req: ApiRequest): ApiResponse | null {
  const expected = process.env.APP_PASSCODE;
  if (!expected) {
    return errorResponse(500, 'server_misconfigured', 'APP_PASSCODE is not set on the server.');
  }
  if (!passcodeMatches(readPasscodeHeader(req), expected)) {
    return errorResponse(401, 'unauthorized', 'Wrong or missing passcode.');
  }
  return null;
}
