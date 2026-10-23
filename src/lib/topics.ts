import type { Segment } from '../store/types';

export const TOPIC_COLOURS = 6;

/** Colour slot of a topic: its first-appearance order, cycling through six hues (ADR-21). */
export function topicSlot(topics: string[], name: string | undefined): number | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  const i = topics.findIndex((t) => t.trim().toLowerCase() === n);
  return i < 0 ? null : i % TOPIC_COLOURS;
}

/** The topic being discussed at time t: the last segment that started at or before it. */
export function topicAt(segments: Segment[], t: number): string | undefined {
  let found: string | undefined;
  for (const s of segments) {
    if (s.t <= t) found = s.topic;
    else break;
  }
  return found;
}

/** Adds topic names not seen before, keeping first-appearance order (so colours stay put). */
export function withTopics(topics: string[], names: (string | undefined)[]): string[] {
  const out = [...topics];
  const norm = (x: string) => x.trim().toLowerCase();
  for (const n of names) {
    if (n && n.trim() && !out.some((t) => norm(t) === norm(n))) out.push(n.trim());
  }
  return out;
}
