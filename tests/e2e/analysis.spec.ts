import { expect, test, type Page } from '@playwright/test';
import { installFakeSpeech } from './fakeSpeech';

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

export async function paste(page: Page, text: string) {
  await page.getByLabel('Paste captions or type notes').fill(text);
  await page.getByRole('button', { name: 'Add to transcript' }).click();
}

export const LONG =
  "Client PM: So the plan is to go live with the new invoicing module on the 15th, same as agreed.\nDev lead: We can do the 15th if the tax rules for Germany are frozen this week.\nClient PM: They're basically final. Legal just needs to sign off, it's a formality.\n" +
  'Finance: ' +
  Array.from({ length: 140 }, (_, i) => `word${i}`).join(' ');

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
