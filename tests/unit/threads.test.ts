// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyThreads, applyWatch, parseClock } from '../../api/_lib/postprocess';
import { analyzeRequestSchema } from '../../shared/schema';
import type { ModelFlag } from '../../shared/types';
import { topicAt, topicSlot } from '../../src/lib/topics';

const T =
  '[01:05] We go live on the 15th.\n[01:40] Testing: only three users did UAT.\n[02:10] Answer: Dan confirms the rules by Friday.';
const req = (over: Record<string, unknown> = {}) =>
  analyzeRequestSchema.parse({
    mode: 'watch',
    language: 'en-US',
    transcript: '',
    newTranscript: T,
    ...over,
  });
const base = { add: [], update: [], drop: [] };

describe('topic segments and answered questions (ADR-21)', () => {
  it('parses mm:ss', () => {
    expect(parseClock('01:05')).toBe(65_000);
    expect(parseClock('[12:30]')).toBe(750_000);
    expect(parseClock('soon')).toBeNull();
  });

  it('keeps segments that point at real transcript times, sorted', () => {
    const { segments } = applyThreads(
      {
        ...base,
        segments: [
          { at: '01:40', topic: 'Testing' },
          { at: '01:05', topic: 'Go-live' },
          { at: '09:99', topic: 'x' },
          { at: '03:00', topic: 'Ghost' },
        ],
      },
      req(),
    );
    expect(segments).toEqual([
      { t: 65_000, topic: 'Go-live' },
      { t: 100_000, topic: 'Testing' },
    ]);
  });

  it('marks only open questions as answered, with a grounded quote', () => {
    const { answered } = applyThreads(
      {
        ...base,
        answered: [
          { id: 'q-1', quote: 'Dan confirms the rules by Friday.' },
          { id: 'q-9', quote: 'Dan confirms the rules by Friday.' },
          { id: 'q-2', quote: 'It will be fine, trust me.' },
        ],
      },
      req({
        openQuestions: [
          { id: 'q-1', question: 'Who confirms?' },
          { id: 'q-2', question: 'Is it ok?' },
        ],
      }),
    );
    expect(answered).toEqual([{ id: 'q-1', quote: 'Dan confirms the rules by Friday.' }]);
  });

  it('important markers have their own cap and never push problems off the list', () => {
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
    ];
    const quotes = words.map(
      (w, i) => `${w} ${words[(i + 3) % 10]} ${words[(i + 7) % 10]} decided today`,
    );
    const transcript = quotes.map((q, i) => `[00:${String(i).padStart(2, '0')}] ${q}`).join('\n');
    const prev: ModelFlag[] = [
      { id: 'f-trap', type: 'trap', title: 't', quote: 'x y z w', why: '', ask: '', who: '' },
    ];
    const { flags, stats } = applyWatch(
      {
        ...base,
        add: quotes.map((q) => ({
          type: 'important' as const,
          title: 'i',
          quote: q,
          why: '',
          ask: '',
          who: '',
          topic: 'Go-live',
        })),
      },
      req({
        previous: { tldr: '', topics: [], flags: prev },
        newTranscript: transcript + '\n[00:59] x y z w',
      }),
    );
    expect(flags.filter((f) => f.type === 'important')).toHaveLength(8);
    expect(flags.map((f) => f.id)).toContain('f-trap');
    expect(stats.droppedOverCap).toBe(2);
    expect(flags.find((f) => f.type === 'important')?.topic).toBe('Go-live');
  });
});

describe('topic colours', () => {
  it('slot follows first appearance, case-insensitive, cycling at 6', () => {
    const topics = ['Go-live', 'Testing', 'a', 'b', 'c', 'd', 'Budget'];
    expect(topicSlot(topics, 'testing')).toBe(1);
    expect(topicSlot(topics, 'Budget')).toBe(0);
    expect(topicSlot(topics, 'unknown')).toBeNull();
    expect(topicSlot(topics, undefined)).toBeNull();
  });
  it('a line takes the topic of the last segment that started before it', () => {
    const segs = [
      { t: 0, topic: 'A' },
      { t: 60_000, topic: 'B' },
    ];
    expect(topicAt(segs, 30_000)).toBe('A');
    expect(topicAt(segs, 60_000)).toBe('B');
    expect(topicAt([], 1)).toBeUndefined();
  });
});

describe('store threads', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });
  it('registers topics in first-appearance order and marks questions answered', async () => {
    const { useSession, withTopics } = await import('../../src/store/session');
    expect(withTopics(['Go-live'], ['go-live', 'Testing', '', undefined])).toEqual([
      'Go-live',
      'Testing',
    ]);
    const st = useSession.getState();
    const id = st.session.id;
    st.addQuestions({
      sessionId: id,
      questions: [{ id: 'q-1', quote: 'who?', question: 'Who?', topic: 'Owners' }],
      at: st.session.startedAt + 5000,
    });
    useSession.getState().applyThreads({
      sessionId: id,
      segments: [{ t: 0, topic: 'Go-live' }],
      answered: [{ id: 'q-1', quote: 'Dan does' }],
      at: st.session.startedAt + 70_000,
    });
    const s = useSession.getState().session;
    expect(s.topics).toEqual(['Owners', 'Go-live']);
    expect(s.questions[0]).toMatchObject({ answeredQuote: 'Dan does', answeredAt: 70_000 });
    expect(s.segments).toEqual([{ t: 0, topic: 'Go-live' }]);
  });
});
