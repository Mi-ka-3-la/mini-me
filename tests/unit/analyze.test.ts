import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUDGET, makeAnalyzeHandler } from '../../api/_lib/handlers/analyze';
import type { ApiRequest } from '../../api/_lib/http';
import { UpstreamError, type ModelCall, type ModelResult } from '../../api/_lib/model';
import { resetRateLimit } from '../../api/_lib/rateLimit';
import { analysisOutputSchema } from '../../shared/schema';
import { EXAMPLE_OUTPUT, EXAMPLE_TRANSCRIPT } from '../fixtures/example';

const settings = {
  model: 'claude-sonnet-5-5',
  effort: 'medium' as const,
  thinking: 'adaptive' as const,
  maxTokens: 8000,
};
const ok = (text: string, stopReason = 'end_turn'): ModelResult => ({
  text,
  stopReason,
  inputTokens: 1000,
  outputTokens: 300,
});
const body = {
  language: 'en-US',
  context: 'Need a firm go-live owner',
  transcript: EXAMPLE_TRANSCRIPT,
};
const request = (over: Partial<ApiRequest> = {}): ApiRequest => ({
  method: 'POST',
  headers: { 'x-app-passcode': 'pc' },
  body,
  ip: '9.9.9.9',
  ...over,
});

beforeEach(() => {
  process.env.APP_PASSCODE = 'pc';
  resetRateLimit();
});
afterEach(() => {
  delete process.env.APP_PASSCODE;
});

function handler(call: ModelCall, now?: () => number) {
  return makeAnalyzeHandler({ call, settings, ...(now ? { now } : {}) });
}

describe('/api/analyze', () => {
  it('returns a valid analysis state for the example transcript', async () => {
    const call = vi.fn<ModelCall>(async () => ok(JSON.stringify(EXAMPLE_OUTPUT)));
    const res = await handler(call)(request());
    expect(res.status).toBe(200);
    const parsed = analysisOutputSchema.parse(res.body);
    expect(parsed.flags).toHaveLength(2);
    expect(parsed.flags.every((f) => /^f-/.test(f.id))).toBe(true);
    const args = call.mock.calls[0]![0];
    expect(args.user).toContain('Need a firm go-live owner');
    expect(args.timeoutMs).toBe(BUDGET.firstMs);
  });

  it('refuses without the passcode, wrong methods and invalid bodies', async () => {
    const call = vi.fn<ModelCall>();
    expect((await handler(call)(request({ headers: {} }))).status).toBe(401);
    expect((await handler(call)(request({ method: 'GET' }))).status).toBe(405);
    const bad = await handler(call)(request({ body: { language: 'fr-FR', transcript: 'x' } }));
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: 'bad_request', message: expect.any(String) });
    expect((await handler(call)(request({ bodyBytes: 300 * 1024 }))).status).toBe(413);
    expect(call).not.toHaveBeenCalled();
  });

  it('retries once with the validation problem appended, then succeeds', async () => {
    const call = vi
      .fn<ModelCall>()
      .mockResolvedValueOnce(ok('{"tldr": 3}'))
      .mockResolvedValueOnce(ok(JSON.stringify(EXAMPLE_OUTPUT)));
    const res = await handler(call)(request());
    expect(res.status).toBe(200);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[1]![0].user).toContain(
      'YOUR PREVIOUS ANSWER COULD NOT BE USED: it did not match the schema',
    );
  });

  it('treats a cut-off answer as invalid and returns 502 after the retry fails', async () => {
    const call = vi.fn<ModelCall>(async () => ok('{"tldr": "x", "topi', 'max_tokens'));
    const res = await handler(call)(request());
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: 'invalid_output' });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('skips the retry when the time budget is spent', async () => {
    let t = 0;
    const call = vi.fn<ModelCall>(async () => {
      t += 60_000;
      return ok('not json');
    });
    const res = await handler(call, () => t)(request());
    expect(res.status).toBe(502);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('maps upstream errors to the contract', async () => {
    const cases: [UpstreamError, number, string][] = [
      [new UpstreamError('rate_limited', 429, '7'), 429, 'rate_limited'],
      [new UpstreamError('overloaded', 529), 502, 'upstream_overloaded'],
      [new UpstreamError('auth', 401), 500, 'server_misconfigured'],
      [new UpstreamError('timeout', 504), 504, 'upstream_timeout'],
      [new UpstreamError('other', 500), 502, 'upstream_error'],
    ];
    for (const [err, status, code] of cases) {
      const res = await handler(async () => {
        throw err;
      })(request());
      expect(res.status).toBe(status);
      expect(res.body).toMatchObject({ error: code });
      if (status === 429) expect(res.headers?.['retry-after']).toBe('7');
    }
  });

  it('never logs transcript, context or analysis text', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await handler(async () => ok(JSON.stringify(EXAMPLE_OUTPUT)))(request());
    await handler(async () => ok('garbage'))(request());
    const logged = spy.mock.calls.map((c) => String(c[0])).join('\n');
    for (const word of ['invoicing', 'formality', 'go-live', 'Germany', 'Client', 'owner', 'UAT']) {
      expect(logged).not.toContain(word);
    }
    expect(logged).toContain('"route":"analyze"');
    expect(logged).toContain('"in_tokens"');
  });

  it('rate-limits a burst from one IP', async () => {
    const h = handler(async () => ok(JSON.stringify(EXAMPLE_OUTPUT)));
    let last = 200;
    for (let i = 0; i < 31; i++) last = (await h(request({ headers: {} }))).status;
    expect(last).toBe(429);
  });
});
