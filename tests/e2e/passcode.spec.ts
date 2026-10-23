import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 } });

test('wrong passcode is refused, right one unlocks, sign out returns to the gate', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Passcode').fill('wrong');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toContainText('not right');
  await page.getByLabel('Passcode').fill('test-passcode');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Live transcript' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Live transcript' })).toBeVisible();
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByLabel('Passcode')).toBeVisible();
});

test('continue without analysis opens the app', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue without analysis' }).click();
  await expect(page.getByRole('heading', { name: 'Live transcript' })).toBeVisible();
});
