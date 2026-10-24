import { z } from 'zod';

export const MAX_FLAGS = 12;
export const MAX_CONTEXT = 2000;
export const MAX_TRANSCRIPT_CHARS = 60_000;
export const MAX_BODY_BYTES = 200 * 1024;
export const MAX_BACKGROUND = 4000;
export const MAX_BRIEF = 12_000;
export const MAX_PREPARED = 12;

const str = (max: number) => z.string().max(max);

export const flagTypeSchema = z.preprocess(
  (v) => (typeof v === 'string' ? v.toLowerCase().trim() : v),
  z.enum(['trap', 'logic', 'question', 'important']),
);

export const topicSchema = z.object({
  topic: z.string(),
  points: z.array(z.string()),
  decisions: z.array(z.string()),
  actions: z.array(z.string()),
  open: z.array(z.string()),
});

export const modelFlagSchema = z.object({
  id: z.string(),
  type: flagTypeSchema,
  title: z.string(),
  quote: z.string(),
  why: z.string(),
  ask: z.string(),
  who: z.string(),
  /** Topic thread the flag belongs to (ADR-21); empty when unknown. */
  topic: z.string().default(''),
});

/** Full analysis state kept by the browser. */
export const analysisOutputSchema = z.object({
  tldr: z.string(),
  topics: z.array(topicSchema),
  flags: z.array(modelFlagSchema),
});

const newFlagSchema = modelFlagSchema.omit({ id: true });

export const detectedQuestionSchema = z.object({
  quote: z.string(),
  question: z.string(),
  topic: z.string().default(''),
  /** id of the prepared question that asks the same thing, or '' (ADR-25) */
  prepared: z.string().default(''),
});

/** "From this moment on, the talk is about this topic" (ADR-21). at = "mm:ss". */
export const segmentSchema = z.object({ at: z.string(), topic: z.string() });

/** What the model returns for a watch call (ADR-19): only the changes to the watch list. */
export const watchModelOutputSchema = z.object({
  add: z.array(newFlagSchema),
  update: z.array(modelFlagSchema),
  drop: z.array(z.string()),
  questions: z.array(detectedQuestionSchema).default([]),
  segments: z.array(segmentSchema).default([]),
  answered: z.array(z.object({ id: z.string(), quote: z.string() })).default([]),
});

export const answerStepSchema = z.object({
  label: z.string(),
  detail: z.string(),
  /** why this step belongs in the answer (ADR-24) */
  why: z.string().default(''),
});

/** One short teaching section under "Understand it" (ADR-24). */
export const explainSectionSchema = z.object({
  label: z.string(),
  title: z.string(),
  body: z.string(),
});

/** What the model returns for an answer call (ADR-20). */
export const answerOutputSchema = z.object({
  question: z.string(),
  trap: z.string(),
  headline: z.string(),
  steps: z.array(answerStepSchema),
  explain: z.array(explainSectionSchema).default([]),
});

/** One likely question, prepared before the meeting (ADR-25). */
export const preparedQuestionSchema = z.object({
  question: z.string(),
  likely: z.string(),
  trap: z.string(),
  headline: z.string(),
  steps: z.array(answerStepSchema),
});

/** What the model returns for a prep call (ADR-25). */
export const prepOutputSchema = z.object({
  questions: z.array(preparedQuestionSchema),
  askBack: z.array(z.string()),
});

/** What /api/analyze returns for a prep call. */
export const prepResponseSchema = z.object({ prep: prepOutputSchema });

/** What the model returns for a summary call (ADR-19). */
export const summaryOutputSchema = z.object({
  tldr: z.string(),
  topics: z.array(topicSchema),
});

/** What /api/analyze returns for a watch call: the complete updated watch list, plus new questions. */
export const watchResponseSchema = z.object({
  flags: z.array(modelFlagSchema),
  questions: z
    .array(
      z.object({
        id: z.string(),
        quote: z.string(),
        question: z.string(),
        topic: z.string().default(''),
        prepared: z.string().default(''),
      }),
    )
    .default([]),
  /** t = ms since session start */
  segments: z.array(z.object({ t: z.number(), topic: z.string() })).default([]),
  answered: z.array(z.object({ id: z.string(), quote: z.string() })).default([]),
});

/** POST /api/analyze body (docs/02 §6, ADR-19). */
export const analyzeRequestSchema = z.object({
  mode: z.enum(['watch', 'summary', 'answer', 'prep']),
  language: z.enum(['en-US', 'ro-RO']),
  context: str(MAX_CONTEXT).default(''),
  speakers: z.record(z.string().max(80), z.string().max(80)).default({}),
  previous: z
    .object({
      tldr: str(4000),
      topics: z.array(topicSchema).max(60),
      flags: z.array(modelFlagSchema).max(40),
    })
    .nullable()
    .default(null),
  pinnedIds: z.array(str(40)).max(40).default([]),
  dismissedQuotes: z.array(str(600)).max(300).default([]),
  askedFlags: z
    .array(z.object({ title: str(400), quote: str(600) }))
    .max(300)
    .default([]),
  /** Older part of the window: context only. */
  transcript: str(MAX_TRANSCRIPT_CHARS),
  /** Lines since the last call of this mode: where new flags are looked for. */
  newTranscript: str(MAX_TRANSCRIPT_CHARS).default(''),
  transcriptTrimmed: z.boolean().default(false),
  /** Questions already detected (quotes), so the watch call does not report them again. */
  knownQuestions: z.array(str(600)).max(200).default([]),
  /** Questions still without an answer, so the watch call can mark them answered (ADR-21). */
  openQuestions: z
    .array(z.object({ id: str(40), question: str(600) }))
    .max(50)
    .default([]),
  /** Topic names already in use, so every call reuses the same names (ADR-21). */
  knownTopics: z.array(str(120)).max(40).default([]),
  /** Answer mode: the question to answer, and the listener's background (ADR-20). */
  question: z
    .object({ quote: str(600), question: str(600) })
    .nullable()
    .default(null),
  background: str(MAX_BACKGROUND).default(''),
  /** Prep mode: what the meeting is about, e.g. a job ad or an agenda (ADR-25). */
  brief: str(MAX_BRIEF).default(''),
  /** Watch mode: questions prepared before the meeting, so a live question can be matched. */
  preparedQuestions: z
    .array(z.object({ id: str(40), question: str(600) }))
    .max(MAX_PREPARED)
    .default([]),
});

export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;
export type AnalyzeRequestInput = z.input<typeof analyzeRequestSchema>;

const FLAG_PROPS = {
  type: { type: 'string', enum: ['trap', 'logic', 'question', 'important'] },
  topic: { type: 'string' },
  title: { type: 'string' },
  quote: { type: 'string' },
  why: { type: 'string' },
  ask: { type: 'string' },
  who: { type: 'string' },
} as const;

/**
 * JSON Schemas sent as output_config.format (docs/04 §5, ADR-10, ADR-19).
 * JSON outputs need additionalProperties:false and do not accept maxItems.
 */
export const WATCH_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['add', 'update', 'drop', 'questions', 'segments', 'answered'],
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['quote', 'question', 'topic', 'prepared'],
        properties: {
          quote: { type: 'string' },
          question: { type: 'string' },
          topic: { type: 'string' },
          prepared: { type: 'string' },
        },
      },
    },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['at', 'topic'],
        properties: { at: { type: 'string' }, topic: { type: 'string' } },
      },
    },
    answered: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'quote'],
        properties: { id: { type: 'string' }, quote: { type: 'string' } },
      },
    },
    add: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'title', 'quote', 'why', 'ask', 'who', 'topic'],
        properties: FLAG_PROPS,
      },
    },
    update: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'type', 'title', 'quote', 'why', 'ask', 'who', 'topic'],
        properties: { id: { type: 'string' }, ...FLAG_PROPS },
      },
    },
    drop: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const SUMMARY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tldr', 'topics'],
  properties: {
    tldr: { type: 'string' },
    topics: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['topic', 'points', 'decisions', 'actions', 'open'],
        properties: {
          topic: { type: 'string' },
          points: { type: 'array', items: { type: 'string' } },
          decisions: { type: 'array', items: { type: 'string' } },
          actions: { type: 'array', items: { type: 'string' } },
          open: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;

/** What /api/analyze returns for an answer call. */
export const answerResponseSchema = z.object({ answer: answerOutputSchema });

export const ANSWER_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['question', 'trap', 'headline', 'steps', 'explain'],
  properties: {
    question: { type: 'string' },
    trap: { type: 'string' },
    headline: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'detail', 'why'],
        properties: {
          label: { type: 'string' },
          detail: { type: 'string' },
          why: { type: 'string' },
        },
      },
    },
    explain: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'title', 'body'],
        properties: {
          label: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
        },
      },
    },
  },
} as const;

const STEP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'detail', 'why'],
  properties: { label: { type: 'string' }, detail: { type: 'string' }, why: { type: 'string' } },
} as const;

export const PREP_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['questions', 'askBack'],
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'likely', 'trap', 'headline', 'steps'],
        properties: {
          question: { type: 'string' },
          likely: { type: 'string' },
          trap: { type: 'string' },
          headline: { type: 'string' },
          steps: { type: 'array', items: STEP_SCHEMA },
        },
      },
    },
    askBack: { type: 'array', items: { type: 'string' } },
  },
} as const;
