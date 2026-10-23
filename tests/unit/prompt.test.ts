import { describe, expect, it } from 'vitest';
import { buildSummaryPrompt, buildWatchPrompt, SYSTEM_PROMPT } from '../../api/_lib/prompt';
import { analyzeRequestSchema } from '../../shared/schema';
import { EXAMPLE_TRANSCRIPT } from '../fixtures/example';

const lines = EXAMPLE_TRANSCRIPT.split('\n');
const base = analyzeRequestSchema.parse({
  mode: 'watch',
  language: 'en-US',
  transcript: lines.slice(0, 3).join('\n'),
  newTranscript: lines.slice(3).join('\n'),
});

describe('watch prompt', () => {
  it('asks only for changes, with the taxonomy and the new rules', () => {
    const p = buildWatchPrompt(base);
    expect(p).toContain('Return only the CHANGES to the watch list');
    expect(p).toContain('LANGUAGE: Write every field in English');
    expect(p).toContain('SPEAKERS: unknown (single microphone');
    expect(p).toContain('dependency dismissed ("it\'s a formality"');
    expect(p).toContain('hasty generalization');
    expect(p).toContain('is NOT a flag. Do not ask for proof that was just given');
    expect(p).toContain('drop the weakest flags that are not pinned');
    expect(p).toContain('CURRENT WATCH LIST (JSON):\nempty');
    expect(p).toMatch(/EARLIER TRANSCRIPT, for context:\n\[00:02\]/);
    expect(p).toMatch(/NEW TRANSCRIPT \(look for flags here\):\n\[01:05\]/);
    expect(SYSTEM_PROMPT).toContain('neutral meeting analyst');
  });

  it('marks pinned flags and lists dismissed and asked items', () => {
    const p = buildWatchPrompt(
      analyzeRequestSchema.parse({
        mode: 'watch',
        language: 'ro-RO',
        context: 'Vreau un owner pentru regulile fiscale',
        previous: {
          tldr: '',
          topics: [],
          flags: [{ id: 'f-a', type: 'trap', title: 't', quote: 'q', why: 'w', ask: 'a', who: '' }],
        },
        pinnedIds: ['f-a'],
        dismissedQuotes: ['a formality'],
        askedFlags: [{ title: 'Owner missing', quote: 'tax rules are frozen' }],
        transcript: '[00:01] x',
        newTranscript: '[00:02] y',
        transcriptTrimmed: true,
      }),
    );
    expect(p).toContain('For Romanian, use correct diacritics');
    expect(p).toContain('Vreau un owner pentru regulile fiscale');
    expect(p).toContain('"id":"f-a","pinned":true');
    expect(p).toContain('- "a formality"');
    expect(p).toContain('- Owner missing — "tax rules are frozen"');
    expect(p).toContain('the start of the meeting is omitted');
  });
});

describe('summary prompt', () => {
  it('asks for the full summary and no flags', () => {
    const p = buildSummaryPrompt({ ...base, mode: 'summary' });
    expect(p).toContain('Return the complete, updated summary');
    expect(p).toContain('A proposal is not a decision');
    expect(p).toContain('PREVIOUS SUMMARY (JSON):\nnone yet');
    expect(p).not.toContain('watch list');
  });
});
