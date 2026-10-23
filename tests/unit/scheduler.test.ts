import { describe, expect, it } from 'vitest';
import { backoffMs, countWords, decide, type TriggerInput } from '../../src/analysis/scheduler';

const base: TriggerInput = {
  running: false,
  newWords: 0,
  sinceLastMs: 0,
  manual: false,
  callsUsed: 0,
  maxCalls: 150,
  retryAt: 0,
  now: 1000,
  canCall: true,
};
const d = (over: Partial<TriggerInput>) => decide({ ...base, ...over });

describe('scheduler (docs/02 §5)', () => {
  it('needs at least 60 new words', () => {
    expect(d({ newWords: 59, sinceLastMs: 120_000 }).run).toBe(false);
  });
  it('runs at 150 words, or at 45 s with ≥ 60 words', () => {
    expect(d({ newWords: 150 }).run).toBe(true);
    expect(d({ newWords: 149, sinceLastMs: 44_999 }).run).toBe(false);
    expect(d({ newWords: 60, sinceLastMs: 45_000 })).toEqual({ run: true, reason: 'time' });
  });
  it('never runs two calls at once', () => {
    expect(d({ newWords: 500, running: true }).run).toBe(false);
    expect(d({ newWords: 500, running: true, manual: true }).run).toBe(false);
  });
  it('Analyze now runs with any new words, even past the cap', () => {
    expect(d({ manual: true, newWords: 3 }).run).toBe(true);
    expect(d({ manual: true, newWords: 3, callsUsed: 150 }).run).toBe(true);
    expect(d({ manual: true, newWords: 0 }).run).toBe(false);
  });
  it('stops automatic calls at the cap, during back-off, and without access', () => {
    expect(d({ newWords: 500, callsUsed: 150 }).reason).toBe('cap');
    expect(d({ newWords: 500, retryAt: 5000 }).reason).toBe('backoff');
    expect(d({ newWords: 500, canCall: false }).reason).toBe('no-access');
  });
  it('counts words and backs off', () => {
    expect(countWords('  We go   live on the 15th. ')).toBe(6);
    expect(countWords('')).toBe(0);
    expect(backoffMs(1)).toBe(15_000);
    expect(backoffMs(3)).toBe(60_000);
    expect(backoffMs(10)).toBe(120_000);
    expect(backoffMs(1, 7)).toBe(7000);
  });
});

import { decideSummary, SUMMARY_EVERY_MS } from '../../src/analysis/scheduler';

describe('summary cadence (ADR-19)', () => {
  const s = {
    running: false,
    newWords: 0,
    sinceLastMs: 0,
    manual: false,
    callsUsed: 0,
    maxCalls: 150,
    retryAt: 0,
    now: 1000,
    canCall: true,
    noSummaryYet: false,
  };
  it('first summary at 150 words, then every 3 minutes with ≥ 60 new words', () => {
    expect(decideSummary({ ...s, noSummaryYet: true, newWords: 150 }).run).toBe(true);
    expect(decideSummary({ ...s, newWords: 400, sinceLastMs: SUMMARY_EVERY_MS - 1 }).run).toBe(
      false,
    );
    expect(decideSummary({ ...s, newWords: 60, sinceLastMs: SUMMARY_EVERY_MS }).run).toBe(true);
    expect(decideSummary({ ...s, newWords: 59, sinceLastMs: SUMMARY_EVERY_MS }).run).toBe(false);
  });
  it('Analyze now and the usual guards', () => {
    expect(decideSummary({ ...s, manual: true, newWords: 1 }).run).toBe(true);
    expect(decideSummary({ ...s, running: true, manual: true, newWords: 1 }).run).toBe(false);
    expect(decideSummary({ ...s, newWords: 500, sinceLastMs: 1e9, callsUsed: 150 }).reason).toBe(
      'cap',
    );
  });
});

describe('question fast path (ADR-23)', () => {
  it('runs at once on a question, with a few words and 8 s since the last call', () => {
    expect(d({ questionPending: true, newWords: 6, sinceLastMs: 8_000 })).toEqual({
      run: true,
      reason: 'question',
    });
    expect(d({ questionPending: true, newWords: 6, sinceLastMs: 7_999 }).run).toBe(false);
    expect(d({ questionPending: true, newWords: 3, sinceLastMs: 60_000 }).run).toBe(false);
    expect(d({ questionPending: true, newWords: 50, sinceLastMs: 60_000, running: true }).run).toBe(
      false,
    );
    expect(
      d({ questionPending: true, newWords: 50, sinceLastMs: 60_000, callsUsed: 150 }).run,
    ).toBe(false);
  });
  it('recognises questions with or without a question mark, in English and Romanian', async () => {
    const { looksLikeQuestion } = await import('../../src/analysis/scheduler');
    expect(looksLikeQuestion('Have you ever worked with generative AI as a product material')).toBe(
      true,
    );
    expect(looksLikeQuestion('Okay, so how would you approach breaking that down')).toBe(true);
    expect(looksLikeQuestion('Cum ai pune ordine în datoria tehnică')).toBe(true);
    expect(looksLikeQuestion('Când poți începe?')).toBe(true);
    expect(looksLikeQuestion('We are building a team from scratch.')).toBe(false);
    expect(looksLikeQuestion('Am lucrat doi ani pe facturare.')).toBe(false);
  });
});
