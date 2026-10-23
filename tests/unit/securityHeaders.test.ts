import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SECURITY_HEADERS } from '../../config/securityHeaders';

describe('security headers', () => {
  it('vercel.json sends exactly the headers defined in config/securityHeaders.ts', () => {
    const v = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      headers: { source: string; headers: { key: string; value: string }[] }[];
    };
    const all = v.headers.find((h) => h.source === '/(.*)');
    const sent = Object.fromEntries((all?.headers ?? []).map((h) => [h.key, h.value]));
    expect(sent).toEqual(SECURITY_HEADERS);
  });
  it('the CSP allows nothing from other hosts', () => {
    expect(SECURITY_HEADERS['Content-Security-Policy']).not.toMatch(/https?:|\*/);
  });
});
