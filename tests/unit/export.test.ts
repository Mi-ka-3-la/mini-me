import { describe, expect, it } from 'vitest';
import { notesMarkdown } from '../../src/lib/export';
import type { Session } from '../../src/store/types';

const s: Session = {
  id: 's',
  startedAt: Date.UTC(2026, 9, 23, 9, 0),
  language: 'en-US',
  context: 'Need a go-live owner',
  lines: [
    {
      id: 'a',
      t: 2000,
      text: 'We go live on the 15th.',
      final: true,
      origin: 'manual',
      speakerId: 'm-pm',
    },
    { id: 'b', t: 65_000, text: "It's a formality.", final: true, origin: 'stt' },
  ],
  speakers: { 'm-pm': { id: 'm-pm', label: 'Client PM', source: 'manual' } },
  gaps: [],
  summary: {
    tldr: 'Go-live held at the 15th.',
    topics: [
      {
        topic: 'Go-live',
        points: ['Target 15th'],
        decisions: ['Keep 15th'],
        actions: ['Dev — freeze rules'],
        open: ['Who signs?'],
      },
    ],
  },
  flags: [
    {
      id: '1',
      type: 'trap',
      title: 'Formality',
      quote: "It's a formality.",
      why: 'No date.',
      ask: 'When?',
      who: '',
      status: 'active',
      firstSeenAt: 2,
    },
    {
      id: '2',
      type: 'logic',
      title: 'Pinned one',
      quote: 'q2',
      why: 'w',
      ask: 'a',
      who: 'Client PM',
      status: 'pinned',
      firstSeenAt: 3,
    },
    {
      id: '3',
      type: 'question',
      title: 'Asked one',
      quote: 'q3',
      why: 'w',
      ask: 'a',
      who: '',
      status: 'asked',
      firstSeenAt: 1,
    },
    {
      id: '4',
      type: 'trap',
      title: 'Dismissed one',
      quote: 'q4',
      why: 'w',
      ask: 'a',
      who: '',
      status: 'dismissed',
      firstSeenAt: 1,
    },
  ],
  topics: [],
  segments: [],
  analyzedUpToLineIndex: 2,
  analysisCalls: 1,
  lastAnalysisAt: 1,
  summaryUpToLineIndex: 2,
  lastSummaryAt: 1,
  questions: [
    {
      id: 'q1',
      t: 90_000,
      quote: 'How would you fix the debt?',
      question: 'How would you reduce tech debt?',
      answer: {
        question: 'x',
        trap: 'False choice.',
        headline: 'Make it visible',
        steps: [{ label: 'Map it', detail: 'by hotspot' }],
      },
    },
  ],
};

describe('notesMarkdown', () => {
  it('writes summary by topic, then the watch list with pinned and asked, without dismissed', () => {
    const md = notesMarkdown(s, { includeTranscript: false });
    expect(md).toMatch(/^# Meeting notes — /);
    expect(md).toContain('**Context:** Need a go-live owner');
    expect(md).toContain('## Summary\n\nGo-live held at the 15th.');
    expect(md).toContain(
      '### Go-live\n- Target 15th\n- **Decided:** Keep 15th\n- **Action:** Dev — freeze rules\n- **Open:** Who signs?',
    );
    expect(md.indexOf('Pinned one')).toBeLessThan(md.indexOf('Formality'));
    expect(md).toContain('**[Logic error]** Pinned one (pinned)\n  > “q2” — Client PM');
    expect(md).toContain('### Asked\n- **[Ask this]** Asked one');
    expect(md).not.toContain('Dismissed one');
    expect(md).not.toContain('## Transcript');
  });

  it('lists questions with their answers', () => {
    const md = notesMarkdown(s, { includeTranscript: false });
    expect(md).toContain('## Questions\n- **How would you reduce tech debt?** (01:30)');
    expect(md).toContain(
      '  Trap: False choice.\n  Answer: Make it visible\n  1. Map it — by hotspot',
    );
  });

  it('adds the transcript only when asked to', () => {
    const md = notesMarkdown(s, { includeTranscript: true });
    expect(md).toContain(
      "## Transcript\n[00:02] Client PM: We go live on the 15th.\n[01:05] It's a formality.",
    );
  });
});
