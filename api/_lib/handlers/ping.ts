import { requirePasscode } from '../auth.js';
import { errorResponse, json, type Handler } from '../http.js';

/** GET /api/ping: lets the passcode screen validate a code before saving it (ADR-15). */
export const pingHandler: Handler = async (req) => {
  if (req.method !== 'GET') return errorResponse(405, 'method_not_allowed', 'Use GET.');
  const denied = requirePasscode(req);
  if (denied) return denied;
  return json({ ok: true });
};
