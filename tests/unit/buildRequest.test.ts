import { describe, expect, it } from 'vitest';
import {
  buildSummaryRequest,
  buildWatchRequest,
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
  summaryUpToLineIndex: 0,
  lastSummaryAt: null,
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
  it('splits earlier context from the new lines, with time and speaker', () => {
    const s = session({
      lines: [line(5_000, 'Hello.'), line(65_000, 'We go live on the 15th.', 'm-pm')],
      speakers: { 'm-pm': { id: 'm-pm', label: 'Client PM', source: 'manual' } },
    });
    expect(transcriptWindow(s, 1)).toEqual({
      earlier: '[00:05] Hello.',
      fresh: '[01:05] Client PM: We go live on the 15th.',
      trimmed: false,
    });
  });

  it('keeps earlier context to the last 15 minutes', () => {
    const s = session({
      lines: [line(0, 'old'), line(10 * 60_000, 'mid'), line(20 * 60_000, 'new')],
    });
    expect(transcriptWindow(s, 2)).toEqual({
      earlier: '[10:00] mid',
      fresh: '[20:00] new',
      trimmed: true,
    });
  });

  it('caps the new part at about 12 000 characters and leaves no room for context', () => {
    const lines = Array.from({ length: 400 }, (_, i) => line(i * 1000, 'x'.repeat(100)));
    const w = transcriptWindow(session({ lines }), 0);
    expect(w.fresh.length).toBeLessThanOrEqual(WINDOW_CHARS);
    expect(w.fresh.length).toBeGreaterThan(WINDOW_CHARS - 200);
    expect(w.earlier).toBe('');
    expect(w.trimmed).toBe(true);
  });
});

describe('request builders', () => {
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
    lines: [line(0, 'hello'), line(1000, 'world')],
    analyzedUpToLineIndex: 1,
    summaryUpToLineIndex: 0,
    summary: { tldr: 'x', topics: [] },
    flags: [f('a', 'active'), f('b', 'pinned'), f('c', 'dismissed'), f('d', 'asked')],
  });

  it('watch: current flags, pinned ids, dismissed, asked, and only lines since the last watch as new', () => {
    const req = analyzeRequestSchema.parse(buildWatchRequest(s));
    expect(req.mode).toBe('watch');
    expect(req.previous?.flags.map((x) => x.id)).toEqual(['a', 'b']);
    expect(req.previous?.flags[0]).not.toHaveProperty('status');
    expect(req.pinnedIds).toEqual(['b']);
    expect(req.dismissedQuotes).toEqual(['q-c']);
    expect(req.askedFlags).toEqual([{ title: 't-d', quote: 'q-d' }]);
    expect(req.transcript).toBe('[00:00] hello');
    expect(req.newTranscript).toBe('[00:01] world');
    expect(req.context).toBe('ctx');
  });

  it('summary: previous summary, no flags, lines since the last summary as new', () => {
    const req = analyzeRequestSchema.parse(buildSummaryRequest(s));
    expect(req.mode).toBe('summary');
    expect(req.previous).toEqual({ tldr: 'x', topics: [], flags: [] });
    expect(req.newTranscript).toBe('[00:00] hello\n[00:01] world');
    expect(req.dismissedQuotes).toEqual([]);
  });
});
