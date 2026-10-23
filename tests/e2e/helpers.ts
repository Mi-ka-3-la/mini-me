import { expect, type Page } from '@playwright/test';

export const OUTPUT = {
  tldr: 'Go-live is held at the 15th, but it rests on German tax rules and a UK-only UAT.',
  topics: [
    {
      topic: 'Go-live date',
      points: ['Target stays the 15th.'],
      decisions: ['Keep the 15th.'],
      actions: ['Dev lead — confirm tax rules freeze'],
      open: ['Who confirms the rules are frozen?'],
    },
  ],
  flags: [
    {
      id: 'f-aaaaaaaa',
      type: 'trap',
      title: 'Dependency stated as a formality',
      quote: "Legal just needs to sign off, it's a formality.",
      why: 'The 15th depends on this sign-off.',
      ask: 'When is legal sign-off expected?',
      who: 'Client PM',
    },
  ],
};

export async function unlock(page: Page) {
  await page.goto('/');
  await page.getByLabel('Passcode').fill('test-passcode');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Live transcript' })).toBeVisible();
}

/** Opens a column: on narrow screens it is a tab, on desktop a region. */
export async function openColumn(page: Page, tab: string, title: string) {
  if ((page.viewportSize()?.width ?? 1280) <= 980) {
    await page.getByRole('tab', { name: tab }).click();
    return page.getByRole('tabpanel', { name: tab });
  }
  return page.getByRole('region', { name: title });
}

export async function paste(page: Page, text: string) {
  await page.getByLabel('Paste captions or type notes').fill(text);
  await page.getByRole('button', { name: 'Add to transcript' }).click();
}

export const LONG =
  "Client PM: So the plan is to go live with the new invoicing module on the 15th, same as agreed.\nDev lead: We can do the 15th if the tax rules for Germany are frozen this week.\nClient PM: They're basically final. Legal just needs to sign off, it's a formality.\n" +
  'Finance: ' +
  Array.from({ length: 140 }, (_, i) => `word${i}`).join(' ');
