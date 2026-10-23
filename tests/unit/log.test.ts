import { describe, expect, it, vi } from 'vitest';
import { logEvent } from '../../api/_lib/log';

describe('logEvent', () => {
  it('drops free text and keeps numbers and short codes', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    logEvent({
      route: 'analyze',
      status: 200,
      ms: 12,
      error: 'invalid_output',
      note: 'the client said hello',
    });
    const line = JSON.parse(String(spy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(line).toEqual({
      evt: 'api',
      route: 'analyze',
      status: 200,
      ms: 12,
      error: 'invalid_output',
    });
  });
});
