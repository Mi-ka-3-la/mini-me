import { requirePasscode } from '../auth.js';
import { errorResponse, json, type Handler } from '../http.js';

export const DEFAULT_MAX_CALLS = 150;

export function maxCallsPerSession(): number {
  const n = Number(process.env.MAX_CALLS_PER_SESSION);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_CALLS;
}

/** GET /api/config: values the browser needs but cannot read from env itself (ADR-9). */
export const configHandler: Handler = async (req) => {
  if (req.method !== 'GET') return errorResponse(405, 'method_not_allowed', 'Use GET.');
  const denied = requirePasscode(req);
  if (denied) return denied;
  return json({ maxCallsPerSession: maxCallsPerSession() });
};
