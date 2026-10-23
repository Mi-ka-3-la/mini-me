import { z } from 'zod';

export const MAX_FLAGS = 12;
export const MAX_CONTEXT = 2000;
export const MAX_TRANSCRIPT_CHARS = 60_000;
export const MAX_BODY_BYTES = 200 * 1024;

const str = (max: number) => z.string().max(max);

export const flagTypeSchema = z.preprocess(
  (v) => (typeof v === 'string' ? v.toLowerCase().trim() : v),
  z.enum(['trap', 'logic', 'question']),
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
});

/** What the model must return, and what /api/analyze returns. */
export const analysisOutputSchema = z.object({
  tldr: z.string(),
  topics: z.array(topicSchema),
  flags: z.array(modelFlagSchema),
});

/** POST /api/analyze body (docs/02 §6). */
export const analyzeRequestSchema = z.object({
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
  dismissedQuotes: z.array(str(600)).max(300).default([]),
  askedFlags: z
    .array(z.object({ title: str(400), quote: str(600) }))
    .max(300)
    .default([]),
  transcript: str(MAX_TRANSCRIPT_CHARS),
  transcriptTrimmed: z.boolean().default(false),
});

export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;
export type AnalyzeRequestInput = z.input<typeof analyzeRequestSchema>;

/**
 * JSON Schema sent as output_config.format (docs/04 §5, ADR-10).
 * JSON outputs need additionalProperties:false and do not accept maxItems.
 */
export const OUTPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tldr', 'topics', 'flags'],
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
    flags: {
      type: 'array',
      description: 'At most 12 items.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'type', 'title', 'quote', 'why', 'ask', 'who'],
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: ['trap', 'logic', 'question'] },
          title: { type: 'string' },
          quote: { type: 'string' },
          why: { type: 'string' },
          ask: { type: 'string' },
          who: { type: 'string' },
        },
      },
    },
  },
} as const;
