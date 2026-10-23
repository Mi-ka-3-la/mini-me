import { describe, expect, it } from 'vitest';
import {
  buildAnalyzeRequest,
  transcriptWindow,
  WINDOW_CHARS,
} from '../../src/analysis/buildRequest';
import { analyzeRequestSchema } from '../../shared/schema';
import type { Session } from '../../src/store/types';

const session = (over: Partial<Session> = {}): Session => ({
  id: 's',
  startedAt: 0,
  language: 'en-US',
  context: 'ctx',
  lines: [],
  speakers: {},
  gaps: [],
  summary: null,
  flags: [],
  analyzedUpToLineIndex: 0,
  analysisCalls: 0,
  lastAnalysisAt: null,
  ...over,
});
const line = (t: number, text: string, speakerId?: string) => ({
  id: `l${t}`,
  t,
  text,
  final: true as const,
  origin: 'stt' as const,
  ...(speakerId ? { speakerId } : {}),
});

describe('transcript window', () => {
  it('formats lines with time and speaker', () => {
    const s = session({
      lines: [line(65_000, 'We go live on the 15th.', 'm-pm')],
      speakers: { 'm-pm': { id: 'm-pm', label: 'Client PM', source: 'manual' } },
    });
    expect(transcriptWindow(s)).toEqual({
      text: '[01:05] Client PM: We go live on the 15th.',
      trimmed: false,
    });
  });

  it('keeps only the last 15 minutes', () => {
    const s = session({
      lines: [line(0, 'old'), line(10 * 60_000, 'mid'), line(20 * 60_000, 'new')],
    });
    const w = transcriptWindow(s);
    expect(w.text).toBe('[10:00] mid\n[20:00] new');
    expect(w.trimmed).toBe(true);
  });

  it('cuts to about 12 000 characters', () => {
    const lines = Array.from({ length: 400 }, (_, i) => line(i * 1000, 'x'.repeat(100)));
    const w = transcriptWindow(session({ lines }));
    expect(w.text.length).toBeLessThanOrEqual(WINDOW_CHARS);
    expect(w.text.length).toBeGreaterThan(WINDOW_CHARS - 200);
    expect(w.trimmed).toBe(true);
  });
});

describe('buildAnalyzeRequest', () => {
  it('sends active and pinned flags as previous, dismissed and asked separately', () => {
    const f = (id: string, status: 'active' | 'pinned' | 'dismissed' | 'asked') => ({
      id,
      type: 'trap' as const,
      title: `t-${id}`,
      quote: `q-${id}`,
      why: 'w',
      ask: 'a',
      who: '',
      status,
      firstSeenAt: 1,
    });
    const s = session({
      lines: [line(0, 'hello')],
      summary: { tldr: 'x', topics: [] },
      flags: [f('a', 'active'), f('b', 'pinned'), f('c', 'dismissed'), f('d', 'asked')],
    });
    const req = analyzeRequestSchema.parse(buildAnalyzeRequest(s));
    expect(req.previous?.flags.map((x) => x.id)).toEqual(['a', 'b']);
    expect(req.previous?.flags[0]).not.toHaveProperty('status');
    expect(req.dismissedQuotes).toEqual(['q-c']);
    expect(req.askedFlags).toEqual([{ title: 't-d', quote: 'q-d' }]);
    expect(req.context).toBe('ctx');
  });
});
