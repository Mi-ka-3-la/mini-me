import { describe, expect, it } from 'vitest';
import { applyWatch, newFlagId, type WatchModelOutput } from '../../api/_lib/postprocess';
import { analyzeRequestSchema } from '../../shared/schema';
import type { ModelFlag } from '../../shared/types';
import { EXAMPLE_TRANSCRIPT } from '../fixtures/example';

let n = 0;
const ids = () => `f-new${++n}`;
const Q1 = "Legal just needs to sign off, it's a formality.";
const Q2 = 'Since nobody raised concerns in UAT, we can skip the second test cycle.';
const Q3 = 'Only three users did UAT though, all from the UK team.';
const flag = (over: Partial<ModelFlag> = {}): ModelFlag => ({
  id: '',
  type: 'trap',
  title: 't',
  quote: Q1,
  why: 'w',
  ask: 'a',
  who: '',
  ...over,
});
const add = (over: Partial<ModelFlag> = {}) => {
  const { id: _id, ...rest } = flag(over);
  return rest;
};
const req = (over: Record<string, unknown> = {}) =>
  analyzeRequestSchema.parse({
    mode: 'watch',
    language: 'en-US',
    transcript: '',
    newTranscript: EXAMPLE_TRANSCRIPT,
    ...over,
  });
const out = (o: Partial<WatchModelOutput>): WatchModelOutput => ({
  add: [],
  update: [],
  drop: [],
  ...o,
});
const prevOf = (flags: ModelFlag[]) => ({ previous: { tldr: '', topics: [], flags } });

describe('applyWatch', () => {
  it('gives new flags random ids', () => {
    expect(newFlagId()).toMatch(/^f-[a-z2-9]{8}$/);
    const { flags } = applyWatch(out({ add: [add(), add({ quote: Q2 })] }), req(), ids);
    expect(flags.map((f) => f.id)).toEqual(['f-new1', 'f-new2']);
  });

  it('keeps existing flags the model did not mention', () => {
    const prev = [flag({ id: 'f-old', quote: 'We signed the contract in March.' })];
    const { flags } = applyWatch(out({ add: [add()] }), req(prevOf(prev)), ids);
    expect(flags.map((f) => f.id)).toEqual(['f-old', expect.stringMatching(/^f-new/)]);
  });

  it('drops resolved flags, but never pinned ones', () => {
    const prev = [flag({ id: 'f-a' }), flag({ id: 'f-b', quote: Q2 })];
    const { flags } = applyWatch(
      out({ drop: ['f-a', 'f-b'] }),
      req({ ...prevOf(prev), pinnedIds: ['f-b'] }),
      ids,
    );
    expect(flags.map((f) => f.id)).toEqual(['f-b']);
  });

  it('applies an update that keeps the quote, treats a changed quote as new', () => {
    const prev = [flag({ id: 'f-a', title: 'old' })];
    const same = applyWatch(
      out({ update: [flag({ id: 'f-a', title: 'new' })] }),
      req(prevOf(prev)),
      ids,
    );
    expect(same.flags).toEqual([expect.objectContaining({ id: 'f-a', title: 'new', quote: Q1 })]);
    const changed = applyWatch(
      out({ update: [flag({ id: 'f-a', quote: Q3, title: 'other' })] }),
      req(prevOf(prev)),
      ids,
    );
    expect(changed.flags).toHaveLength(2);
    expect(changed.stats.idsReassigned).toBe(1);
  });

  it('drops ungrounded, dismissed, asked and duplicate additions', () => {
    const prev = [flag({ id: 'f-a' })];
    const { flags, stats } = applyWatch(
      out({
        add: [
          add({ quote: 'We will certainly miss the deadline.' }),
          add({ quote: Q2 }),
          add({ quote: Q3 }),
          add({ quote: "it's a formality, legal just needs to sign off" }),
        ],
      }),
      req({
        ...prevOf(prev),
        dismissedQuotes: ['nobody raised concerns in UAT, we can skip the second test cycle'],
        askedFlags: [{ title: 'x', quote: Q3 }],
      }),
      ids,
    );
    expect(flags.map((f) => f.id)).toEqual(['f-a']);
    expect(stats).toMatchObject({
      droppedUngrounded: 1,
      droppedDismissed: 1,
      droppedAsked: 1,
      droppedDuplicate: 1,
    });
  });

  it('over the cap, removes the oldest unpinned flags and keeps new ones', () => {
    const words = [
      'alpha',
      'bravo',
      'charlie',
      'delta',
      'echo',
      'foxtrot',
      'golf',
      'hotel',
      'india',
      'juliet',
      'kilo',
      'lima',
      'mike',
      'november',
    ];
    const quotes = words.map(
      (w, i) => `${w} ${words[(i + 5) % 14]} ${words[(i + 9) % 14]} owner unclear`,
    );
    const transcript = quotes.map((q, i) => `[00:${String(i).padStart(2, '0')}] ${q}`).join('\n');
    const prev = quotes.slice(0, 12).map((q, i) => flag({ id: `f-${i}`, quote: q }));
    const { flags, stats } = applyWatch(
      out({ add: [add({ quote: quotes[12]! }), add({ quote: quotes[13]! })] }),
      req({ ...prevOf(prev), pinnedIds: ['f-0'], newTranscript: transcript }),
      ids,
    );
    expect(flags).toHaveLength(12);
    expect(stats.droppedOverCap).toBe(2);
    expect(flags.map((f) => f.id)).toContain('f-0'); // pinned survives
    expect(flags.map((f) => f.id)).not.toContain('f-1'); // oldest unpinned went first
    expect(flags.map((f) => f.id)).not.toContain('f-2');
  });

  it('strips wrapping quote marks and extra whitespace', () => {
    const { flags } = applyWatch(
      out({ add: [add({ quote: `“Legal just needs to sign off,   it's a formality.”` })] }),
      req(),
      ids,
    );
    expect(flags[0]?.quote).toBe(Q1);
  });
});
