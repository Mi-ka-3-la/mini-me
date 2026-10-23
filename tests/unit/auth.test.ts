import { afterEach, describe, expect, it } from 'vitest';
import { passcodeMatches, requirePasscode } from '../../api/_lib/auth';
import { pingHandler } from '../../api/_lib/handlers/ping';
import { configHandler } from '../../api/_lib/handlers/config';
import type { ApiRequest } from '../../api/_lib/http';

const req = (headers: Record<string, string> = {}, method = 'GET'): ApiRequest => ({
  method,
  headers,
  body: undefined,
  ip: '1.1.1.1',
});

afterEach(() => {
  delete process.env.APP_PASSCODE;
  delete process.env.MAX_CALLS_PER_SESSION;
});

describe('passcode', () => {
  it('compares exactly', () => {
    expect(passcodeMatches('blue fox', 'blue fox')).toBe(true);
    expect(passcodeMatches('blue fo', 'blue fox')).toBe(false);
    expect(passcodeMatches(undefined, 'blue fox')).toBe(false);
    expect(passcodeMatches('', '')).toBe(false);
  });

  it('refuses when the server has no passcode configured', () => {
    expect(requirePasscode(req({ 'x-app-passcode': 'x' }))?.status).toBe(500);
  });

  it('accepts URI-encoded non-Latin passcodes', () => {
    process.env.APP_PASSCODE = 'țară albastră';
    const ok = requirePasscode(req({ 'x-app-passcode': encodeURIComponent('țară albastră') }));
    expect(ok).toBeNull();
  });

  it('ping returns 401 without the passcode and 200 with it', async () => {
    process.env.APP_PASSCODE = 'secret words';
    expect((await pingHandler(req())).status).toBe(401);
    expect((await pingHandler(req({ 'x-app-passcode': 'nope' }))).status).toBe(401);
    expect((await pingHandler(req({ 'x-app-passcode': 'secret%20words' }))).status).toBe(200);
    expect((await pingHandler(req({ 'x-app-passcode': 'secret words' }, 'POST'))).status).toBe(405);
  });

  it('config is protected and returns the call cap', async () => {
    process.env.APP_PASSCODE = 'p';
    process.env.MAX_CALLS_PER_SESSION = '40';
    expect((await configHandler(req())).status).toBe(401);
    const res = await configHandler(req({ 'x-app-passcode': 'p' }));
    expect(res.body).toEqual({ maxCallsPerSession: 40 });
  });
});
