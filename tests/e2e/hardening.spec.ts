import { expect, test } from '@playwright/test';
import { installFakeSpeech } from './fakeSpeech';
import { LONG, OUTPUT, paste, unlock } from './helpers';

test('offline shows a banner, pauses analysis, and resumes when back online', async ({
  page,
  context,
}) => {
  await installFakeSpeech(page);
  let calls = 0;
  await page.route('**/api/analyze', (route) => {
    calls++;
    return route.fulfill({ json: OUTPUT });
  });
  await unlock(page);
  await page.getByRole('button', { name: 'Start listening' }).click();
  await context.setOffline(true);
  await expect(page.getByRole('alert')).toContainText('You are offline');
  await paste(page, LONG);
  await page.waitForTimeout(2500);
  expect(calls).toBe(0);
  await context.setOffline(false);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('call-counter')).toHaveText('1/150 analyses');
});

test('server errors map to readable messages and keep the screen', async ({ page }) => {
  await installFakeSpeech(page);
  const errors = [
    {
      status: 429,
      json: { error: 'rate_limited', message: 'x' },
      headers: { 'retry-after': '9' },
      text: 'Analysis is busy',
    },
    {
      status: 500,
      json: {
        error: 'server_misconfigured',
        message: 'ANTHROPIC_API_KEY is not set on the server.',
      },
      text: 'Server setup problem',
    },
    {
      status: 504,
      json: { error: 'upstream_timeout', message: 'x' },
      text: 'Analysis failed (upstream_timeout)',
    },
    {
      status: 413,
      json: { error: 'too_large', message: 'x' },
      text: 'could not be analyzed (too_large)',
    },
  ];
  let i = 0;
  await page.route('**/api/analyze', (route) => {
    const e = errors[i++]!;
    return route.fulfill({ status: e.status, json: e.json, headers: e.headers ?? {} });
  });
  await unlock(page);
  for (const e of errors) {
    await paste(page, `Client PM: line ${e.status}`);
    await page.getByRole('button', { name: 'Analyze now' }).click();
    await expect(page.getByRole('alert')).toContainText(e.text);
  }
  await expect(page.getByText('line 413')).toBeVisible();
});
