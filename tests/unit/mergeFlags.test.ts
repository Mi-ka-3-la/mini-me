import { describe, expect, it } from 'vitest';
import { mergeFlags } from '../../src/analysis/mergeFlags';
import type { ModelFlag } from '../../shared/types';
import type { ClientFlag } from '../../src/store/types';

const m = (id: string, quote: string, over: Partial<ModelFlag> = {}): ModelFlag => ({
  id,
  type: 'trap',
  title: 'Dependency stated as a formality',
  quote,
  why: 'The date depends on it.',
  ask: 'When is sign-off expected?',
  who: '',
  ...over,
});
const c = (f: ModelFlag, status: ClientFlag['status'] = 'active', firstSeenAt = 1): ClientFlag => ({
  ...f,
  status,
  firstSeenAt,
});

const Q1 = "Legal just needs to sign off, it's a formality.";
const Q2 = 'Since nobody raised concerns in UAT, we can skip the second test cycle.';
const Q3 = "We'll fix anything after go-live.";

describe('mergeFlags', () => {
  it('adds new flags as active with a first-seen time', () => {
    const { flags, newIds } = mergeFlags([], [m('f-a', Q1)], 50);
    expect(flags).toEqual([{ ...m('f-a', Q1), status: 'active', firstSeenAt: 50 }]);
    expect(newIds).toEqual(['f-a']);
  });

  it('keeps status and first-seen time for known ids, updates real changes', () => {
    const cur = [c(m('f-a', Q1), 'pinned', 7)];
    const { flags, newIds } = mergeFlags(
      cur,
      [
        m('f-a', Q1, {
          title: 'Legal sign-off has no date',
          why: 'Nobody owns the sign-off and the go-live hangs on it.',
          ask: 'Who owns legal sign-off, by which day?',
        }),
      ],
      99,
    );
    expect(flags[0]).toMatchObject({
      status: 'pinned',
      firstSeenAt: 7,
      title: 'Legal sign-off has no date',
    });
    expect(newIds).toEqual([]);
  });

  it('ignores minor rewording so cards do not shimmer', () => {
    const cur = [c(m('f-a', Q1))];
    const { flags } = mergeFlags(cur, [m('f-a', Q1, { why: 'The date depends on it!' })], 99);
    expect(flags[0]?.why).toBe('The date depends on it.');
  });

  it('removes active flags the model dropped, never pinned or asked ones', () => {
    const cur = [c(m('f-a', Q1)), c(m('f-b', Q2), 'pinned'), c(m('f-c', Q3), 'asked')];
    const { flags } = mergeFlags(cur, [], 99);
    expect(flags.map((f) => [f.id, f.status])).toEqual([
      ['f-b', 'pinned'],
      ['f-c', 'asked'],
    ]);
  });

  it('never brings back a dismissed flag, by id or by quote', () => {
    const cur = [c(m('f-a', Q1), 'dismissed')];
    expect(mergeFlags(cur, [m('f-a', Q1)], 99).newIds).toEqual([]);
    const { flags, newIds } = mergeFlags(
      cur,
      [m('f-zz', "it's a formality, legal just needs to sign off")],
      99,
    );
    expect(newIds).toEqual([]);
    expect(flags.filter((f) => f.status !== 'dismissed')).toHaveLength(0);
  });

  it('does not re-add an asked flag under a new id', () => {
    const cur = [c(m('f-c', Q3), 'asked')];
    expect(mergeFlags(cur, [m('f-new', Q3)], 99).newIds).toEqual([]);
  });

  it('falls back to quote matching when the id changed', () => {
    const cur = [c(m('f-a', Q1), 'active', 3)];
    const { flags, newIds } = mergeFlags(cur, [m('f-other', Q1)], 99);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ id: 'f-a', firstSeenAt: 3 });
    expect(newIds).toEqual([]);
  });
});
