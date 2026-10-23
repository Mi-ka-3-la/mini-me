/** Types shared by the browser and the server. See docs/02-architecture.md §4. */
export type Language = 'en-US' | 'ro-RO';
export const LANGUAGES: { id: Language; label: string; name: string }[] = [
  { id: 'en-US', label: 'English', name: 'English' },
  { id: 'ro-RO', label: 'Romanian', name: 'Romanian' },
];

export type FlagType = 'trap' | 'logic' | 'question' | 'important';

export type Topic = {
  topic: string;
  points: string[];
  decisions: string[];
  actions: string[];
  open: string[];
};

/** A flag as the model and the API return it. */
export type ModelFlag = {
  id: string;
  type: FlagType;
  title: string;
  quote: string;
  why: string;
  ask: string;
  who: string;
  /** Topic thread (ADR-21) */
  topic?: string;
};

export type AnalysisOutput = { tldr: string; topics: Topic[]; flags: ModelFlag[] };
