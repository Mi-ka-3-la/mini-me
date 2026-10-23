import { expect, test, type Page } from '@playwright/test';
import { installFakeSpeech, skipGate } from './fakeSpeech';

const speech = (page: Page, kind: 'interim' | 'final', text: string) =>
  page.evaluate(
    ([k, t]) =>
      (window as unknown as { __speech: Record<string, (s: string) => void> }).__speech[k]!(t!),
    [kind, text] as const,
  );

test('interim text is muted, then replaced by the final line with a timestamp', async ({
  page,
}) => {
  await installFakeSpeech(page);
  await page.goto('/');
  await skipGate(page);
  await page.getByRole('button', { name: 'Start listening' }).click();
  await expect(page.getByRole('status')).toHaveText('Listening');
  await speech(page, 'interim', 'we go live');
  await expect(page.locator('.line.interim')).toHaveText(/we go live/);
  await speech(page, 'final', 'We go live on the 15th.');
  await expect(page.locator('.line.interim')).toHaveCount(0);
  const line = page.locator('.line').filter({ hasText: 'We go live on the 15th.' });
  await expect(line.locator('.ts')).toHaveText(/^\d\d:\d\d$/);
});

test('manual input keeps speakers and survives a reload through the resume prompt', async ({
  page,
}) => {
  await installFakeSpeech(page);
  await page.goto('/');
  await skipGate(page);
  await page.getByLabel('Context (optional)').fill('Need an owner for tax rules');
  await page
    .getByLabel('Paste captions or type notes')
    .fill('Client PM: They are basically final.\nLegal just needs to sign off.');
  await page.getByLabel('Paste captions or type notes').press('Control+Enter');
  await expect(page.locator('.spk')).toHaveText('Client PM');
  await expect(page.getByText('Legal just needs to sign off.')).toBeVisible();
  await page.waitForTimeout(2300); // debounced save
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Resume meeting?' })).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByText('They are basically final.')).toBeVisible();
  await expect(page.getByLabel('Context (optional)')).toHaveValue('Need an owner for tax rules');
});

test('scrolling up shows Jump to live and stops auto-scroll', async ({ page }) => {
  await installFakeSpeech(page);
  await page.goto('/');
  await skipGate(page);
  const many = Array.from({ length: 60 }, (_, i) => `Speaker ${i % 3}: line number ${i}`).join(
    '\n',
  );
  await page.getByLabel('Paste captions or type notes').fill(many);
  await page.getByRole('button', { name: 'Add to transcript' }).click();
  const scroller = page.getByTestId('transcript-scroll');
  await expect(page.getByText('line number 59')).toBeInViewport();
  await scroller.evaluate((el) => (el.scrollTop = 0));
  await expect(page.getByRole('button', { name: 'Jump to live' })).toBeVisible();
  await page.getByRole('button', { name: 'Jump to live' }).click();
  await expect(page.getByText('line number 59')).toBeInViewport();
});
