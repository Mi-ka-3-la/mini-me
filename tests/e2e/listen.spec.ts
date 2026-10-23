import { expect, test } from '@playwright/test';
import { installFakeSpeech, skipGate } from './fakeSpeech';

test.use({ viewport: { width: 1280, height: 800 } });

test('start and stop listening in the chosen language', async ({ page }) => {
  await installFakeSpeech(page);
  await page.goto('/');
  await skipGate(page);
  await expect(
    page.getByText('Let participants know this meeting is being transcribed.'),
  ).toBeVisible();
  await page.getByLabel('Meeting language').selectOption('ro-RO');
  await page.getByRole('button', { name: 'Start listening' }).click();
  await expect(page.getByRole('status')).toHaveText('Listening');
  await expect(page.getByTestId('live-dot')).toHaveClass(/on/);
  await expect(page.getByLabel('Meeting language')).toBeDisabled();
  expect(
    await page.evaluate(() =>
      (window as unknown as { __speech: { lang(): string } }).__speech.lang(),
    ),
  ).toBe('ro-RO');
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('status')).toHaveText('Ready');
  await page.reload();
  await expect(page.getByLabel('Meeting language')).toHaveValue('ro-RO');
});

test('refused microphone shows help and keeps the app usable', async ({ page }) => {
  await installFakeSpeech(page, 'denied');
  await page.goto('/');
  await skipGate(page);
  await page.getByRole('button', { name: 'Start listening' }).click();
  await expect(page.getByRole('alert')).toContainText('Microphone access is blocked');
  await expect(page.getByRole('button', { name: 'Start listening' })).toBeVisible();
});

test('unsupported browser shows the fallback message', async ({ page }) => {
  await installFakeSpeech(page, 'none');
  await page.goto('/');
  await skipGate(page);
  await expect(
    page.getByText('This browser cannot transcribe. Use Chrome or Edge, or paste captions.'),
  ).toBeVisible();
});
