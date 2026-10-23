import { expect, test } from '@playwright/test';
import { installFakeSpeech } from './fakeSpeech';
import { LONG, OUTPUT, openColumn, paste, unlock } from './helpers';

test('analysis runs automatically after enough words and the counter goes up', async ({ page }) => {
  await installFakeSpeech(page);
  let calls = 0;
  let sentContext = '';
  await page.route('**/api/analyze', async (route) => {
    calls++;
    sentContext = (route.request().postDataJSON() as { context: string }).context;
    await route.fulfill({ json: OUTPUT });
  });
  await unlock(page);
  await page.getByLabel('Context (optional)').fill('Firm go-live owner');
  await paste(page, LONG);
  await expect(page.getByTestId('call-counter')).toHaveText('1/150 analyses');
  await expect(page.getByText(/updated \d\d:\d\d/)).toBeVisible();
  expect(calls).toBe(1);
  expect(sentContext).toBe('Firm go-live owner');
});

test('Analyze now runs with a few words; a failure keeps the transcript working', async ({
  page,
}) => {
  await installFakeSpeech(page);
  await page.route('**/api/analyze', (route) =>
    route.fulfill({ status: 502, json: { error: 'upstream_error', message: 'x' } }),
  );
  await unlock(page);
  await paste(page, 'Client PM: short note');
  await page.getByRole('button', { name: 'Analyze now' }).click();
  await expect(page.getByRole('alert')).toContainText('Analysis failed (upstream_error)');
  await paste(page, 'Dev lead: still typing works');
  await expect(page.getByText('still typing works')).toBeVisible();
});

test('a refused passcode pauses analysis and offers to re-enter it', async ({ page }) => {
  await installFakeSpeech(page);
  await page.route('**/api/analyze', (route) =>
    route.fulfill({ status: 401, json: { error: 'unauthorized', message: 'x' } }),
  );
  await unlock(page);
  await paste(page, 'a b c');
  await page.getByRole('button', { name: 'Analyze now' }).click();
  await expect(page.getByRole('alert')).toContainText('The passcode was refused');
  await expect(page.getByRole('button', { name: 'Analyze now' })).toBeDisabled();
  await paste(page, 'transcript continues');
  await expect(page.getByText('transcript continues')).toBeVisible();
});

test('summary shows "So far" and tagged topic items, and stays while the next update runs', async ({
  page,
}) => {
  await installFakeSpeech(page);
  let release: () => void = () => {};
  let n = 0;
  await page.route('**/api/analyze', async (route) => {
    n++;
    if (n === 2) await new Promise<void>((r) => (release = r));
    await route.fulfill({ json: OUTPUT });
  });
  await unlock(page);
  await paste(page, LONG);
  await expect(page.getByTestId('call-counter')).toHaveText('1/150 analyses');
  const summary = await openColumn(page, 'Summary', 'Running summary');
  await expect(summary.getByText('So far')).toBeVisible();
  await expect(summary.getByRole('heading', { name: 'Go-live date' })).toBeVisible();
  for (const tag of ['Decided', 'Action', 'Open'])
    await expect(summary.getByText(tag, { exact: true })).toBeVisible();
  await openColumn(page, 'Transcript', 'Live transcript');
  await paste(page, 'Dev lead: one more line');
  await page.getByRole('button', { name: 'Analyze now' }).click();
  await openColumn(page, 'Summary', 'Running summary');
  await expect(summary.getByText(/updating…/)).toBeVisible();
  await expect(summary.getByText('So far')).toBeVisible();
  release();
  await expect(summary.getByText(/updating…/)).toBeHidden();
});
