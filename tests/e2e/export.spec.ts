import { expect, test } from '@playwright/test';
import { installFakeSpeech } from './fakeSpeech';
import { LONG, OUTPUT, paste, unlock } from './helpers';

test('copy notes puts Markdown on the clipboard, transcript optional', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await installFakeSpeech(page);
  await page.route('**/api/analyze', (route) => route.fulfill({ json: OUTPUT }));
  await unlock(page);
  await paste(page, LONG);
  await expect(page.getByTestId('call-counter')).toHaveText('1/150 analyses');
  await page.getByRole('button', { name: 'Copy notes' }).click();
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Copied as Markdown' })).toBeVisible();
  let clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('### Go-live date');
  expect(clip).toContain('**[Trap]** Dependency stated as a formality');
  expect(clip).not.toContain('## Transcript');
  await page.getByLabel('Include the transcript').check();
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('## Transcript');
});

test('when the clipboard is blocked, the notes are shown selected', async ({ page }) => {
  await installFakeSpeech(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('blocked')) },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue without analysis' }).click();
  await paste(page, 'Client PM: a line to export');
  await page.getByRole('button', { name: 'Copy notes' }).click();
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('blocked the clipboard');
  const selected = await page.evaluate(() => {
    const el = document.activeElement as HTMLTextAreaElement;
    return el.value.slice(el.selectionStart, el.selectionEnd);
  });
  expect(selected).toContain('# Meeting notes');
});
