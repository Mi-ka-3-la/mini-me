import type { Language, ModelFlag, Topic } from '../../shared/types';

export type Speaker = { id: string; label: string; source: 'mic' | 'tab' | 'diarized' | 'manual' };

export type Line = {
  id: string;
  /** ms since session start */
  t: number;
  speakerId?: string;
  text: string;
  final: true;
  origin: 'stt' | 'manual';
};

export type Interim = { text: string; speakerId?: string } | null;

/** A pause in recognition the app could not avoid (US-02 AC4). */
export type Gap = { t: number; ms: number };

export type FlagStatus = 'active' | 'pinned' | 'dismissed' | 'asked';

export type ClientFlag = ModelFlag & {
  firstSeenAt: number;
  status: FlagStatus;
};

export type Summary = { tldr: string; topics: Topic[] };

export type Answer = {
  question: string;
  trap: string;
  headline: string;
  steps: { label: string; detail: string; why?: string }[];
  /** "Understand it" sections (ADR-24); empty for answers saved before it */
  explain?: { label: string; title: string; body: string }[];
};

/** A question someone asked in the meeting (ADR-20). Answered only when the listener taps. */
export type Question = {
  id: string;
  /** ms since session start */
  t: number;
  quote: string;
  question: string;
  answer?: Answer;
  /** Topic thread (ADR-21) */
  topic?: string;
  /** Answered in the conversation itself (ADR-21) */
  answeredQuote?: string;
  answeredAt?: number;
};

/** From time t (ms since start) on, the talk is about this topic (ADR-21). */
export type Segment = { t: number; topic: string };

/** The part of the session that is saved to localStorage. */
export type Session = {
  id: string;
  startedAt: number;
  language: Language;
  context: string;
  lines: Line[];
  speakers: Record<string, Speaker>;
  gaps: Gap[];
  summary: Summary | null;
  flags: ClientFlag[];
  analyzedUpToLineIndex: number;
  analysisCalls: number;
  /** epoch ms of the last watch call */
  lastAnalysisAt: number | null;
  /** lines up to this index are covered by the summary */
  summaryUpToLineIndex: number;
  questions: Question[];
  /** Topic names in order of first appearance; the index picks the colour (ADR-21). */
  topics: string[];
  segments: Segment[];
  /** epoch ms of the last summary call */
  lastSummaryAt: number | null;
};
