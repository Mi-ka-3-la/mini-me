import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeAnalyzeHandler } from '../../api/_lib/handlers/analyze';
import type { ApiRequest } from '../../api/_lib/http';
import type { ModelCall } from '../../api/_lib/model';
import { applyQuestions, cleanAnswer } from '../../api/_lib/postprocess';
import { buildAnswerPrompt, buildWatchPrompt } from '../../api/_lib/prompt';
import { resetRateLimit } from '../../api/_lib/rateLimit';
import { analyzeRequestSchema, answerResponseSchema } from '../../shared/schema';
import { buildAnswerRequest } from '../../src/analysis/buildRequest';
import type { Session } from '../../src/store/types';

const T =
  '[00:01] How would you sort out a pile of technical debt in a team that ships every day?\n[00:09] Fine, thanks.';
const req = (over: Record<string, unknown> = {}) =>
  analyzeRequestSchema.parse({
    mode: 'watch',
    language: 'en-US',
    transcript: '',
    newTranscript: T,
    ...over,
  });
const empty = { add: [], update: [], drop: [] };
let n = 0;
const ids = () => `q-${++n}`;

describe('question detection', () => {
  it('keeps grounded, new questions and drops invented or known ones', () => {
    const qs = applyQuestions(
      {
        ...empty,
        questions: [
          {
            quote:
              'How would you sort out a pile of technical debt in a team that ships every day?',
            question: 'How would you reduce technical debt without stopping delivery?',
          },
          { quote: 'What is your salary expectation?', question: 'Salary?' },
        ],
      },
      req(),
      ids,
    );
    expect(qs).toEqual([
      expect.objectContaining({
        id: 'q-1',
        question: 'How would you reduce technical debt without stopping delivery?',
      }),
    ]);
    const again = applyQuestions(
      {
        ...empty,
        questions: [
          {
            quote: 'sort out a pile of technical debt in a team that ships every day',
            question: 'x',
          },
        ],
      },
      req({
        knownQuestions: [
          'How would you sort out a pile of technical debt in a team that ships every day?',
        ],
      }),
      ids,
    );
    expect(again).toEqual([]);
  });

  it('the watch prompt asks for questions and lists known ones', () => {
    const p = buildWatchPrompt(req({ knownQuestions: ['Who owns this?'] }));
    expect(p).toContain('12. questions: every real question asked in NEW TRANSCRIPT');
    expect(p).toContain('KNOWN QUESTIONS (already reported):\n- "Who owns this?"');
  });
});

describe('answer call', () => {
  const answer = {
    question: ' How would you reduce technical debt without stopping delivery? ',
    trap: 'It assumes you must choose between debt and delivery.',
    headline: 'Make debt visible, then pay it down inside the flow',
    steps: [
      {
        label: 'Map the debt',
        detail: 'List hotspots by incident count and change frequency',
        why: ' Makes it rankable. ',
      },
      { label: 'Agree a budget', detail: '15–20% of each sprint, owned by the team', why: '' },
      { label: 'Fix where you touch', detail: 'Boy-scout rule on every story', why: '' },
    ],
    explain: [
      { label: 'what it is', title: ' Debt is deferred work ', body: 'It costs more later.' },
      { label: 'empty', title: '', body: 'dropped' },
    ],
  };

  it('prompt carries the question, the background and the trap and step rules', () => {
    const p = buildAnswerPrompt(
      req({
        mode: 'answer',
        question: {
          quote: 'How would you sort out tech debt?',
          question: 'How to reduce tech debt?',
        },
        background: 'PSPO II. Owns a 9-developer backlog.',
      }),
    );
    expect(p).toContain('"How would you sort out tech debt?"');
    expect(p).toContain('PSPO II. Owns a 9-developer backlog.');
    expect(p).toContain('never invent experience');
    expect(p).toContain('- trap: if the question hides a trap');
    expect(p).toContain('steps: 3 to 5 steps');
    expect(p).toContain('- explain:');
    expect(p).toContain('common confusion');
  });

  it('cleanAnswer trims and caps steps at 6', () => {
    const many = {
      ...answer,
      steps: Array.from({ length: 9 }, (_, i) => ({ label: ` s${i} `, detail: 'd', why: '' })),
    };
    const c = cleanAnswer(many);
    expect(c.question).toBe('How would you reduce technical debt without stopping delivery?');
    expect(c.steps).toHaveLength(6);
    expect(c.steps[0]?.label).toBe('s0');
    const e = cleanAnswer(answer);
    expect(e.steps[0]?.why).toBe('Makes it rankable.');
    expect(e.explain).toEqual([
      { label: 'WHAT IT IS', title: 'Debt is deferred work', body: 'It costs more later.' },
    ]);
  });

  describe('handler', () => {
    beforeEach(() => {
      process.env.APP_PASSCODE = 'pc';
      resetRateLimit();
    });
    afterEach(() => {
      delete process.env.APP_PASSCODE;
    });
    const settings = {
      model: 'claude-sonnet-5-5',
      effort: 'medium' as const,
      thinking: 'adaptive' as const,
      maxTokens: 8000,
    };
    const watchSettings = { ...settings, model: 'claude-haiku-5-5', maxTokens: 4000 };
    const request = (body: unknown): ApiRequest => ({
      method: 'POST',
      headers: { 'x-app-passcode': 'pc' },
      body,
      ip: '7.7.7.7',
    });

    it('returns the answer, using the fast watch settings', async () => {
      const call = vi.fn<ModelCall>(async () => ({
        text: JSON.stringify(answer),
        stopReason: 'end_turn',
        inputTokens: 1,
        outputTokens: 1,
      }));
      const h = makeAnalyzeHandler({ call, settings, watchSettings });
      const res = await h(
        request({
          mode: 'answer',
          language: 'en-US',
          transcript: T,
          question: { quote: 'q', question: 'q' },
        }),
      );
      expect(res.status).toBe(200);
      expect(answerResponseSchema.parse(res.body).answer.steps).toHaveLength(3);
      expect(call.mock.calls[0]![0].model).toBe('claude-haiku-5-5');
      expect(call.mock.calls[0]![0].schema).toHaveProperty('required', [
        'question',
        'trap',
        'headline',
        'steps',
        'explain',
      ]);
    });

    it('refuses an answer request without a question', async () => {
      const h = makeAnalyzeHandler({ call: vi.fn<ModelCall>(), settings });
      expect((await h(request({ mode: 'answer', language: 'en-US', transcript: '' }))).status).toBe(
        400,
      );
    });
  });
});

describe('buildAnswerRequest', () => {
  it('sends the question, background and recent conversation', () => {
    const s = {
      id: 's',
      startedAt: 0,
      language: 'en-US',
      context: '',
      speakers: {},
      gaps: [],
      summary: null,
      flags: [],
      analyzedUpToLineIndex: 0,
      analysisCalls: 0,
      lastAnalysisAt: null,
      summaryUpToLineIndex: 0,
      lastSummaryAt: null,
      questions: [],
      topics: [],
      segments: [],
      lines: [
        { id: 'a', t: 1000, text: 'How would you sort out tech debt?', final: true, origin: 'stt' },
      ],
    } as Session;
    const r = analyzeRequestSchema.parse(
      buildAnswerRequest(s, { quote: 'q', question: 'Q?' }, 'My CV'),
    );
    expect(r).toMatchObject({
      mode: 'answer',
      background: 'My CV',
      question: { quote: 'q', question: 'Q?' },
    });
    expect(r.transcript).toContain('How would you sort out tech debt?');
  });
});
