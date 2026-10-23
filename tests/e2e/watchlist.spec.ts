import { expect, test } from '@playwright/test';
import { installFakeSpeech } from './fakeSpeech';
import { LONG, OUTPUT, openColumn, paste, unlock } from './helpers';

const F = (id: string, type: string, title: string, quote: string) => ({
  id,
  type,
  title,
  quote,
  why: `Why ${title}`,
  ask: `Ask about ${title}?`,
  who: 'Client PM',
});
const A = F(
  'f-aaaaaaaa',
  'trap',
  'Dependency stated as a formality',
  "Legal just needs to sign off, it's a formality.",
);
const B = F('f-bbbbbbbb', 'logic', 'Tax rules assumed final', "They're basically final.");
const C = F(
  'f-cccccccc',
  'question',
  'Who confirms the freeze?',
  'We can do the 15th if the tax rules for Germany are frozen this week.',
);

test('pin survives, dismiss never returns, mark asked moves to the done section', async ({
  page,
}) => {
  await installFakeSpeech(page);
  const responses = [
    { ...OUTPUT, flags: [A, B, C] },
    // the model drops A (pinned) and B (active), raises C again, and re-raises B's quote under a new id
    { ...OUTPUT, flags: [C, { ...B, id: 'f-zzzzzzzz' }] },
  ];
  let n = 0;
  await page.route('**/api/analyze', (route) => {
    const mode = (route.request().postDataJSON() as { mode: string }).mode;
    if (mode === 'summary') return route.fulfill({ json: OUTPUT });
    return route.fulfill({ json: responses[Math.min(n++, 1)] });
  });
  await unlock(page);
  await paste(page, LONG);
  const watch = await openColumn(page, 'Watch list', 'Watch list');
  await expect(watch.getByRole('article')).toHaveCount(3);
  // newest first: all arrived together, so order is stable; check the filter chips
  await watch.getByRole('button', { name: 'Logic errors' }).click();
  await expect(watch.getByRole('article')).toHaveCount(1);
  await watch.getByRole('button', { name: 'All' }).click();

  const card = (title: string) => watch.getByRole('article', { name: new RegExp(title) });
  await card('Dependency stated').getByRole('button', { name: 'Pin' }).click();
  await card('Tax rules assumed').getByRole('button', { name: 'Dismiss' }).click();
  await expect(watch.getByRole('status')).toContainText('It will not be raised again');
  await card('Who confirms').getByRole('button', { name: 'Mark asked' }).click();
  await expect(watch.getByText('Asked (1)')).toBeVisible();

  await openColumn(page, 'Transcript', 'Live transcript');
  await paste(page, 'Dev lead: we resolved the legal question');
  await page.getByRole('button', { name: 'Analyze now' }).click();
  await expect(page.getByTestId('call-counter')).toHaveText('4/150 analyses');
  await openColumn(page, 'Watch list', 'Watch list');

  await expect(card('Dependency stated')).toBeVisible(); // pinned, dropped by the model, kept
  await expect(card('Dependency stated').getByRole('button', { name: 'Unpin' })).toBeVisible();
  await expect(card('Tax rules assumed')).toHaveCount(0); // dismissed, re-raised under a new id, still gone
  await expect(watch.getByText('Asked (1)')).toBeVisible(); // asked stays asked
  await expect(watch.locator('details .flag')).toHaveCount(1);
});

test('new flags are highlighted and counted on the Watch list tab when narrow', async ({
  page,
}) => {
  test.skip((page.viewportSize()?.width ?? 1280) > 980, 'tab badge exists only on narrow screens');
  await installFakeSpeech(page);
  await page.route('**/api/analyze', (route) =>
    route.fulfill({ json: { ...OUTPUT, flags: [A, B] } }),
  );
  await unlock(page);
  await paste(page, LONG);
  await expect(page.getByRole('tab', { name: /Watch list/ }).locator('.badge')).toHaveText('2');
  await page.getByRole('tab', { name: /Watch list/ }).click();
  await expect(page.locator('.flag.new')).toHaveCount(2);
  await expect(page.getByRole('tab', { name: /Watch list/ }).locator('.badge')).toHaveCount(0);
});
