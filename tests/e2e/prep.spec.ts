import { expect, test } from '@playwright/test';
import { installFakeSpeech } from './fakeSpeech';
import { OUTPUT, openColumn, paste, unlock } from './helpers';

const PREP = {
  prep: {
    questions: [
      {
        question: 'Have you worked with generative AI as product material?',
        likely: 'The ad says AI is the whole product.',
        trap: 'Easy to read as images only; language models count too.',
        headline: 'Yes: LLMs are generative AI, and my products run on them',
        steps: [
          {
            label: 'Reframe it',
            detail: 'LLMs like Claude are generative AI',
            why: 'Avoids a false no.',
          },
          {
            label: 'Show the product',
            detail: 'KPI extraction, then chat',
            why: 'AI as material.',
          },
          {
            label: 'Name the limits',
            detail: 'Context, tables in images',
            why: 'Shows judgement.',
          },
        ],
      },
    ],
    askBack: ['How do you measure output quality today?'],
  },
};

test('prepared answers appear the moment a matching question is asked, without a tap', async ({
  page,
}) => {
  await installFakeSpeech(page);
  let answerCalls = 0;
  let sentPrepared: unknown = null;
  await page.route('**/api/analyze', (route) => {
    const body = route.request().postDataJSON() as { mode: string; preparedQuestions?: unknown };
    if (body.mode === 'prep') return route.fulfill({ json: PREP });
    if (body.mode === 'answer') {
      answerCalls++;
      return route.fulfill({ status: 500, json: {} });
    }
    if (body.mode === 'summary') return route.fulfill({ json: { tldr: 'x', topics: [] } });
    sentPrepared = body.preparedQuestions;
    return route.fulfill({
      json: {
        ...OUTPUT,
        questions: [
          {
            id: 'q-1',
            quote: 'Have you ever worked with generative AI as a product material?',
            question: 'Have you worked with generative AI as product material?',
            topic: '',
            prepared: 'p-1',
          },
        ],
      },
    });
  });
  await unlock(page);
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: 'Prepare for a meeting…' }).click();
  await page.getByLabel('What the meeting is about').fill('Product Owner for an AI image SaaS.');
  await page.getByRole('button', { name: 'Prepare', exact: true }).click();
  const list = page.getByRole('region', { name: 'Prepared questions' });
  await expect(
    list.getByText('Have you worked with generative AI as product material?'),
  ).toBeVisible();
  await expect(list.getByText('How do you measure output quality today?')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

  await paste(page, 'Them: Have you ever worked with generative AI as a product material?');
  await page.getByRole('button', { name: 'Analyze now' }).click();
  const col = await openColumn(page, 'Watch list', 'Watch list');
  await col.getByRole('button', { name: /Questions asked/ }).click();
  const q = col.getByRole('article', { name: /Question: Have you worked with generative AI/ });
  await expect(q.getByText('Prepared', { exact: true })).toBeVisible();
  await expect(
    q.getByText('Yes: LLMs are generative AI, and my products run on them'),
  ).toBeVisible();
  await expect(q.getByRole('button', { name: 'Explain it' })).toBeVisible();
  expect(answerCalls).toBe(0);
  expect(sentPrepared).toEqual([
    { id: 'p-1', question: 'Have you worked with generative AI as product material?' },
  ]);
});
