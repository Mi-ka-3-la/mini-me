import { z } from 'zod';
import { KEYS, readJson, remove, writeJson } from '../lib/storage';
import type { Session } from './types';

const topic = z.object({
  topic: z.string(),
  points: z.array(z.string()),
  decisions: z.array(z.string()),
  actions: z.array(z.string()),
  open: z.array(z.string()),
});

const flag = z.object({
  id: z.string(),
  type: z.enum(['trap', 'logic', 'question']),
  title: z.string(),
  quote: z.string(),
  why: z.string(),
  ask: z.string(),
  who: z.string(),
  firstSeenAt: z.number(),
  status: z.enum(['active', 'pinned', 'dismissed', 'asked']),
});

const sessionSchema = z.object({
  id: z.string(),
  startedAt: z.number(),
  language: z.enum(['en-US', 'ro-RO']),
  context: z.string(),
  lines: z.array(
    z.object({
      id: z.string(),
      t: z.number(),
      speakerId: z.string().optional(),
      text: z.string(),
      final: z.literal(true),
      origin: z.enum(['stt', 'manual']),
    }),
  ),
  speakers: z.record(
    z.string(),
    z.object({
      id: z.string(),
      label: z.string(),
      source: z.enum(['mic', 'tab', 'diarized', 'manual']),
    }),
  ),
  gaps: z.array(z.object({ t: z.number(), ms: z.number() })),
  summary: z.object({ tldr: z.string(), topics: z.array(topic) }).nullable(),
  flags: z.array(flag),
  analyzedUpToLineIndex: z.number(),
  analysisCalls: z.number(),
  lastAnalysisAt: z.number().nullable(),
  summaryUpToLineIndex: z.number().default(0),
  lastSummaryAt: z.number().nullable().default(null),
  questions: z
    .array(
      z.object({
        id: z.string(),
        t: z.number(),
        quote: z.string(),
        question: z.string(),
        answer: z
          .object({
            question: z.string(),
            trap: z.string(),
            headline: z.string(),
            steps: z.array(z.object({ label: z.string(), detail: z.string() })),
          })
          .optional(),
      }),
    )
    .default([]),
});

const STORED_VERSION = 1;

export function loadSession(): Session | null {
  const raw = readJson(KEYS.session);
  if (!raw || typeof raw !== 'object') return null;
  const wrapper = raw as { v?: unknown; session?: unknown };
  if (wrapper.v !== STORED_VERSION) return null;
  const parsed = sessionSchema.safeParse(wrapper.session);
  return parsed.success ? (parsed.data as Session) : null;
}

export function saveSession(session: Session): boolean {
  return writeJson(KEYS.session, { v: STORED_VERSION, session });
}

export function clearSession(): void {
  remove(KEYS.session);
}

/** A session worth offering to resume: something was said or analysed. */
export function hasContent(s: Session | null): boolean {
  return (
    !!s &&
    (s.lines.length > 0 || s.summary !== null || s.flags.length > 0 || s.questions.length > 0)
  );
}
