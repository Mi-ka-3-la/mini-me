import { describe, expect, it } from 'vitest';
import { newFlagId, postprocess } from '../../api/_lib/postprocess';
import { analyzeRequestSchema } from '../../shared/schema';
import type { ModelFlag } from '../../shared/types';
import { EXAMPLE_OUTPUT, EXAMPLE_TRANSCRIPT } from '../fixtures/example';

let n = 0;
const ids = () => `f-new${++n}`;
const flag = (over: Partial<ModelFlag>): ModelFlag => ({
  id: '',
  type: 'trap',
  title: 't',
  quote: "Legal just needs to sign off, it's a formality.",
  why: 'w',
  ask: 'a',
  who: '',
  ...over,
});
const req = (over: Record<string, unknown> = {}) =>
  analyzeRequestSchema.parse({ language: 'en-US', transcript: EXAMPLE_TRANSCRIPT, ...over });
const out = (flags: ModelFlag[]) => ({ ...EXAMPLE_OUTPUT, flags });

describe('postprocess', () => {
  it('assigns random-looking ids to new flags', () => {
    expect(newFlagId()).toMatch(/^f-[a-z2-9]{8}$/);
    expect(newFlagId()).not.toBe(newFlagId());
    const { result } = postprocess(EXAMPLE_OUTPUT, req(), ids);
    expect(result.flags.map((f) => f.id)).toEqual(['f-new1', 'f-new2']);
  });

  it('drops flags whose quote is not in the transcript', () => {
    const { result, stats } = postprocess(
      out([flag({ quote: 'We will certainly miss the deadline.' })]),
      req(),
      ids,
    );
    expect(result.flags).toHaveLength(0);
    expect(stats.droppedUngrounded).toBe(1);
  });

  it('keeps a quote that is only in a previous flag (older transcript trimmed)', () => {
    const prev = flag({ id: 'f-old', quote: 'We signed the contract in March.' });
    const { result } = postprocess(
      out([flag({ id: 'f-old', quote: 'We signed the contract in March.' })]),
      req({ previous: { tldr: '', topics: [], flags: [prev] } }),
      ids,
    );
    expect(result.flags[0]?.id).toBe('f-old');
  });

  it('drops dismissed and already-asked quotes', () => {
    const r = req({
      dismissedQuotes: ["it's a formality"],
      askedFlags: [
        { title: 'x', quote: 'nobody raised concerns in UAT, we can skip the second test cycle' },
      ],
    });
    const { result, stats } = postprocess(EXAMPLE_OUTPUT, r, ids);
    expect(result.flags).toHaveLength(0);
    expect(stats.droppedDismissed).toBe(1);
    expect(stats.droppedAsked).toBe(1);
  });

  it('keeps an id the model reuses for the same quote, replaces it for a different quote', () => {
    const prev = flag({ id: 'f-keep' });
    const r = req({ previous: { tldr: '', topics: [], flags: [prev] } });
    const same = postprocess(out([flag({ id: 'f-keep', title: 'reworded' })]), r, ids);
    expect(same.result.flags[0]?.id).toBe('f-keep');
    const hijack = postprocess(
      out([
        flag({ id: 'f-keep', quote: 'Only three users did UAT though, all from the UK team.' }),
      ]),
      r,
      ids,
    );
    expect(hijack.result.flags[0]?.id).toMatch(/^f-new/);
    expect(hijack.stats.idsReassigned).toBe(1);
  });

  it('recovers the id by quote when the model forgot it', () => {
    const prev = flag({ id: 'f-keep' });
    const { result } = postprocess(
      out([flag({ id: '' })]),
      req({ previous: { tldr: '', topics: [], flags: [prev] } }),
      ids,
    );
    expect(result.flags[0]?.id).toBe('f-keep');
  });

  it('replaces ids that were never issued', () => {
    const { result } = postprocess(out([flag({ id: 'f-3' })]), req(), ids);
    expect(result.flags[0]?.id).toMatch(/^f-new/);
  });

  it('removes duplicates and caps at 12', () => {
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
      'oscar',
      'papa',
      'quebec',
      'romeo',
      'sierra',
      'tango',
    ];
    const quotes = words.map(
      (w, i) => `${w} ${words[(i + 7) % 20]} ${words[(i + 13) % 20]} owner unclear`,
    );
    const transcript = quotes
      .map((q, i) => `[00:${String(i).padStart(2, '0')}] Speaker: ${q}`)
      .join('\n');
    const flags = quotes.map((q) => flag({ quote: q }));
    flags.push(flag({ quote: quotes[3]! }));
    const { result, stats } = postprocess(out(flags), req({ transcript }), ids);
    expect(result.flags).toHaveLength(12);
    expect(stats.droppedDuplicate).toBe(1);
    expect(stats.droppedOverCap).toBe(8);
  });

  it('strips wrapping quote marks and extra whitespace', () => {
    const { result } = postprocess(
      out([flag({ quote: "“Legal just needs to sign off,   it's a formality.”" })]),
      req(),
      ids,
    );
    expect(result.flags[0]?.quote).toBe("Legal just needs to sign off, it's a formality.");
  });
});
