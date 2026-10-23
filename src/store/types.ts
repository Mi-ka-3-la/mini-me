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
  lastAnalysisAt: number | null;
};
