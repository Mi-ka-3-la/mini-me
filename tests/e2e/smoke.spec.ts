import { expect, test } from '@playwright/test';

test('layout: three columns on desktop, tabs when narrow', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue without analysis' }).click();
  await expect(page.getByRole('heading', { name: 'Meeting Copilot' })).toBeVisible();
  const width = page.viewportSize()?.width ?? 1280;
  const tabs = page.getByRole('tablist', { name: 'Views' });
  if (width > 980) {
    await expect(tabs).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Watch list' })).toBeVisible();
  } else {
    await expect(tabs).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Watch list' })).toBeHidden();
    await page.getByRole('tab', { name: 'Watch list' }).click();
    await expect(page.getByRole('heading', { name: 'Watch list' })).toBeVisible();
  }
  // No horizontal page scroll at any width.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
