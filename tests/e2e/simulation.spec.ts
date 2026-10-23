import { expect, test } from '@playwright/test';
import { installFakeSpeech } from './fakeSpeech';
import { openColumn, unlock } from './helpers';

/** Mocked analysis that tags everything with two topics, so the colour threads can be checked. */
const WATCH = {
  flags: [
    {
      id: 'f-cert',
      type: 'trap',
      title: 'Certificarea tratată ca formalitate',
      quote: 'Certificarea e o formalitate, o rezolvăm noi.',
      why: 'Lansarea depinde de ea.',
      ask: 'Cine o semnează și până când?',
      who: '',
      topic: 'Lansarea din 1 martie',
    },
    {
      id: 'f-date',
      type: 'important',
      title: 'Lansare fixă pe 1 martie',
      quote: 'Noi lansăm noul checkout pe 1 martie',
      why: 'Data e comunicată clienților.',
      ask: '',
      who: '',
      topic: 'Lansarea din 1 martie',
    },
  ],
  questions: [
    {
      id: 'q-debt',
      quote: 'Cum ai pune tu ordine în toată datoria asta tehnică fără să oprești livrările?',
      question: 'Cum reduci datoria tehnică fără să oprești livrările?',
      topic: 'Datoria tehnică',
    },
  ],
  segments: [
    { t: 0, topic: 'Lansarea din 1 martie' },
    { t: 74_000, topic: 'Datoria tehnică' },
  ],
  answered: [],
};
const SUMMARY = {
  tldr: 'Interviu pentru PO; lansarea pe 1 martie depinde de o certificare fără responsabil.',
  topics: [
    {
      topic: 'Lansarea din 1 martie',
      points: ['Data e comunicată clienților.'],
      decisions: [],
      actions: [],
      open: ['Cine semnează certificarea?'],
    },
    {
      topic: 'Datoria tehnică',
      points: ['Cod vechi de cinci ani în checkout.'],
      decisions: [],
      actions: [],
      open: [],
    },
  ],
};

test('a simulated interview plays line by line and threads topics by colour across the columns', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await installFakeSpeech(page);
  await page.route('**/api/analyze', (route) => {
    const mode = (route.request().postDataJSON() as { mode: string }).mode;
    return route.fulfill({ json: mode === 'summary' ? SUMMARY : WATCH });
  });
  await unlock(page);
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: 'Simulate a meeting…' }).click();
  await page.getByLabel('Speed').selectOption('4');
  await page.getByRole('button', { name: 'Start simulation' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Simulation:' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Listening' }).first()).toBeVisible();
  // Lines arrive one by one, with interim text first.
  await expect(page.locator('.line.interim')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Andreea (Hiring manager)').first()).toBeVisible();
  // After the first analysis, lines, summary topics, flags and questions share topic colours.
  await expect(page.locator('.line[data-topic="0"]').first()).toBeVisible({ timeout: 40_000 });
  const summary = await openColumn(page, 'Summary', 'Running summary');
  await expect(summary.locator('.topic[data-topic="0"] h3')).toHaveText('Lansarea din 1 martie', {
    timeout: 40_000,
  });
  await expect(summary.locator('.topic[data-topic="1"] h3')).toHaveText('Datoria tehnică');
  const watch = await openColumn(page, 'Watch list', 'Watch list');
  await expect(watch.getByRole('article', { name: /Important: Lansare fixă/ })).toBeVisible();
  await expect(watch.locator('.flag .topic-chip[data-topic="0"]').first()).toBeVisible();
  await watch.getByRole('button', { name: /Questions asked \(1 open\)/ }).click();
  const q = watch.getByRole('article', { name: /Question: Cum reduci datoria tehnică/ });
  await expect(q.locator('.topic-chip[data-topic="1"]')).toHaveText('Datoria tehnică');
  await expect(q.getByText('Open', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop simulation' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Simulation:' })).toHaveCount(0);
});
