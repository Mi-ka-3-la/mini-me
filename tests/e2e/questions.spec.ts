import { expect, test } from '@playwright/test';
import { installFakeSpeech } from './fakeSpeech';
import { LONG, OUTPUT, openColumn, paste, unlock } from './helpers';

const ANSWER = {
  answer: {
    question: 'How would you reduce technical debt without stopping delivery?',
    trap: 'It assumes you must choose between paying debt and shipping.',
    headline: 'Make debt visible, then pay it down inside the flow',
    steps: [
      { label: 'Map the debt', detail: 'Hotspots by incidents and change frequency' },
      { label: 'Agree a budget', detail: '15–20% of each sprint, owned by the team' },
      { label: 'Fix where you touch', detail: 'Clean up on every story' },
    ],
  },
};

test('questions are listed and answered only on tap, as a step plan with the trap named', async ({
  page,
}) => {
  await installFakeSpeech(page);
  let answerCalls = 0;
  let sentBackground = '';
  await page.route('**/api/analyze', (route) => {
    const body = route.request().postDataJSON() as { mode: string; background?: string };
    if (body.mode === 'answer') {
      answerCalls++;
      sentBackground = body.background ?? '';
      return route.fulfill({ json: ANSWER });
    }
    return route.fulfill({
      json: {
        ...OUTPUT,
        questions: [
          {
            id: 'q-1',
            quote: 'How would you sort out a pile of technical debt?',
            question: 'How would you reduce technical debt without stopping delivery?',
          },
        ],
      },
    });
  });
  await unlock(page);
  await page.getByLabel('My background (for answers)').fill('PSPO II, owns a 9-developer backlog');
  await paste(page, LONG);
  const col = await openColumn(page, 'Watch list', 'Watch list');
  await col.getByRole('button', { name: /Questions asked \(1\)/ }).click();
  const q = col.getByRole('article', { name: /Question: How would you reduce technical debt/ });
  await expect(q).toBeVisible();
  expect(answerCalls).toBe(0); // nothing is answered without a tap
  await q.getByRole('button', { name: 'Answer' }).click();
  await expect(q.getByText('Make debt visible, then pay it down inside the flow')).toBeVisible();
  await expect(q.getByText('It assumes you must choose')).toBeVisible();
  await expect(q.locator('.answer-steps li')).toHaveCount(3);
  expect(answerCalls).toBe(1);
  expect(sentBackground).toBe('PSPO II, owns a 9-developer backlog');
});
