import { describe, expect, it } from 'vitest';
import { clientIp, errorResponse, normalizeHeaders } from '../../api/_lib/http';

describe('http helpers', () => {
  it('normalizes header names and arrays', () => {
    expect(normalizeHeaders({ 'X-App-Passcode': 'a', 'X-Multi': ['b', 'c'] })).toEqual({
      'x-app-passcode': 'a',
      'x-multi': 'b, c',
    });
  });
  it('takes the first forwarded ip', () => {
    expect(clientIp({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })).toBe('1.2.3.4');
    expect(clientIp({}, 'fallback')).toBe('fallback');
  });
  it('builds the error contract body', () => {
    expect(errorResponse(401, 'unauthorized', 'Wrong passcode.').body).toEqual({
      error: 'unauthorized',
      message: 'Wrong passcode.',
    });
  });
});
