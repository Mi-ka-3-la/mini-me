// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeAnalyzeHandler } from '../../api/_lib/handlers/analyze';
import type { ApiRequest } from '../../api/_lib/http';
import type { ModelCall } from '../../api/_lib/model';
import { applyQuestions, cleanPrep } from '../../api/_lib/postprocess';
import { buildPrepPrompt, buildWatchPrompt } from '../../api/_lib/prompt';
import { resetRateLimit } from '../../api/_lib/rateLimit';
import { analyzeRequestSchema, prepResponseSchema } from '../../shared/schema';

const T = '[00:01] Have you ever worked with generative AI as a product material?';
const req = (over: Record<string, unknown> = {}) =>
  analyzeRequestSchema.parse({
    mode: 'watch',
    language: 'en-US',
    transcript: '',
    newTranscript: T,
    ...over,
  });

const PREP = {
  questions: [
    {
      question: ' Have you worked with generative AI? ',
      likely: 'The ad says AI is the product.',
      trap: 'Easy to read as images only.',
      headline: 'Yes, LLMs are generative AI',
      steps: [{ label: 'Reframe', detail: 'LLMs are generative AI', why: 'Avoids a false no.' }],
    },
    { question: '', likely: '', trap: '', headline: '', steps: [] },
  ],
  askBack: ['How is quality measured? ', ''],
};

describe('prep (ADR-25)', () => {
  it('the prep prompt carries the brief, the background and the rules', () => {
    const p = buildPrepPrompt(
      req({ mode: 'prep', brief: 'PO for an AI image SaaS', background: 'PSPO II' }),
    );
    expect(p).toContain('PO for an AI image SaaS');
    expect(p).toContain('PSPO II');
    expect(p).toContain('questions: 8 to 10 questions');
    expect(p).toContain('askBack');
  });

  it('cleanPrep trims and drops empty questions and empty ask-backs', () => {
    const c = cleanPrep(PREP);
    expect(c.questions).toHaveLength(1);
    expect(c.questions[0]?.question).toBe('Have you worked with generative AI?');
    expect(c.askBack).toEqual(['How is quality measured?']);
  });

  it('the watch prompt lists prepared questions, and only known ids are kept', () => {
    const r = req({
      preparedQuestions: [{ id: 'p-1', question: 'Have you worked with generative AI?' }],
    });
    expect(buildWatchPrompt(r)).toContain(
      'PREPARED QUESTIONS (answers ready before the meeting):\n[{"id":"p-1"',
    );
    const out = { add: [], update: [], drop: [] };
    const q = (prepared: string) =>
      applyQuestions(
        {
          ...out,
          questions: [
            {
              quote: 'Have you ever worked with generative AI as a product material?',
              question: 'GenAI?',
              prepared,
            },
          ],
        },
        r,
        () => 'q-1',
      )[0]?.prepared;
    expect(q('p-1')).toBe('p-1');
    expect(q('p-9')).toBe('');
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
      model: 'm',
      effort: 'medium' as const,
      thinking: 'adaptive' as const,
      maxTokens: 8000,
    };
    const request = (body: unknown): ApiRequest => ({
      method: 'POST',
      headers: { 'x-app-passcode': 'pc' },
      body,
      ip: '7.7.7.8',
    });

    it('returns a cleaned prep and refuses a request without a brief', async () => {
      const call = vi.fn<ModelCall>(async () => ({
        text: JSON.stringify(PREP),
        stopReason: 'end_turn',
        inputTokens: 1,
        outputTokens: 1,
      }));
      const h = makeAnalyzeHandler({ call, settings });
      const ok = await h(
        request({ mode: 'prep', language: 'en-US', transcript: '', brief: 'Job ad' }),
      );
      expect(ok.status).toBe(200);
      expect(prepResponseSchema.parse(ok.body).prep.questions).toHaveLength(1);
      const bad = await h(request({ mode: 'prep', language: 'en-US', transcript: '' }));
      expect(bad.status).toBe(400);
    });
  });
});

describe('prepared answers in the store', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('a question that matches a prepared one gets its answer at once', async () => {
    const { useSession } = await import('../../src/store/session');
    const st = useSession.getState();
    st.setPrep({
      brief: 'b',
      at: 1,
      askBack: [],
      questions: [
        {
          id: 'p-1',
          question: 'GenAI?',
          likely: '',
          trap: 't',
          headline: 'Yes',
          steps: [{ label: 'a', detail: 'b' }],
        },
      ],
    });
    const sid = useSession.getState().session.id;
    st.addQuestions({
      sessionId: sid,
      at: Date.now(),
      questions: [
        { id: 'q-1', quote: 'x', question: 'x', prepared: 'p-1' },
        { id: 'q-2', quote: 'y', question: 'y', prepared: '' },
      ],
    });
    const qs = useSession.getState().session.questions;
    expect(qs[0]?.answer?.headline).toBe('Yes');
    expect(qs[1]?.answer).toBeUndefined();
    expect(JSON.parse(localStorage.getItem('mc.prep') ?? '{}').brief).toBe('b');
  });
});
