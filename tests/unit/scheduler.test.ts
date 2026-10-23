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
