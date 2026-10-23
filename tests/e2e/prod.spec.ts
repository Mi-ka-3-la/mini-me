import { expect, test } from '@playwright/test';

test('production build runs under the strict CSP with bundled fonts', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  const res = await page.goto('/');
  expect(res?.headers()['content-security-policy']).toContain("default-src 'self'");
  await page.getByRole('button', { name: 'Continue without analysis' }).click();
  await expect(page.getByRole('heading', { name: 'Meeting Copilot' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() => {
    const loaded = (name: string) =>
      Array.from(document.fonts).some((f) => f.family.includes(name) && f.status === 'loaded');
    return {
      display: loaded('Bricolage Grotesque'),
      body: loaded('IBM Plex Sans'),
      mono: loaded('IBM Plex Mono'),
    };
  });
  expect(fonts).toEqual({ display: true, body: true, mono: true });
  expect(violations).toEqual([]);
});
