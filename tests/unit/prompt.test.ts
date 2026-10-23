import { describe, expect, it } from 'vitest';
import { buildUserPrompt, SYSTEM_PROMPT } from '../../api/_lib/prompt';
import { analyzeRequestSchema } from '../../shared/schema';
import { EXAMPLE_TRANSCRIPT } from '../fixtures/example';

const base = analyzeRequestSchema.parse({ language: 'en-US', transcript: EXAMPLE_TRANSCRIPT });

describe('buildUserPrompt', () => {
  it('fills the template from docs/04 §3', () => {
    const p = buildUserPrompt(base);
    expect(p).toContain('LANGUAGE: Write every field in English');
    expect(p).toContain("LISTENER'S CONTEXT (what they care about; prioritize it):\nnone given");
    expect(p).toContain('SPEAKERS: unknown (single microphone');
    expect(p).toContain('PREVIOUS ANALYSIS (JSON):\nnone yet');
    expect(p).toContain('TRANSCRIPT:\n[00:02] Client PM');
    expect(p).toContain('dependency dismissed ("it\'s a formality"');
    expect(p).toContain('hasty generalization');
    expect(p).not.toContain('diacritics');
    expect(SYSTEM_PROMPT).toContain('neutral meeting analyst');
  });

  it('adds Romanian, context, speakers, previous state, dismissed, asked and the trimmed note', () => {
    const p = buildUserPrompt(
      analyzeRequestSchema.parse({
        language: 'ro-RO',
        context: 'Vreau un owner pentru regulile fiscale',
        speakers: { 'Client PM': 'Client PM' },
        previous: { tldr: 'x', topics: [], flags: [] },
        dismissedQuotes: ['a formality'],
        askedFlags: [{ title: 'Owner missing', quote: 'tax rules are frozen' }],
        transcript: '[00:01] x',
        transcriptTrimmed: true,
      }),
    );
    expect(p).toContain(
      'Write every field in Romanian, the language of the meeting. For Romanian, use correct diacritics',
    );
    expect(p).toContain('Vreau un owner pentru regulile fiscale');
    expect(p).toContain('SPEAKERS: Client PM');
    expect(p).toContain('{"tldr":"x","topics":[],"flags":[]}');
    expect(p).toContain('DISMISSED BY THE LISTENER (do not raise again):\n- "a formality"');
    expect(p).toContain('- Owner missing — "tax rules are frozen"');
    expect(p).toContain(
      'TRANSCRIPT (earlier part omitted; it is reflected in the previous analysis):',
    );
  });
});
