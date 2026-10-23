/**
 * Splits pasted captions or typed notes into lines (US-05).
 * "Name: text" keeps the speaker. Names may contain letters of any script (ș, ț, ă…),
 * digits, spaces, dots, apostrophes and hyphens, up to 41 characters.
 */
const SPEAKER = /^(\p{L}[\p{L}\p{N} .'’-]{0,40}?)\s*[:：]\s+(.+)$/u;

export type ManualLine = { speaker?: string; text: string };

export function parseManual(raw: string): ManualLine[] {
  const out: ManualLine[] = [];
  for (const row of raw.split(/\r?\n+/)) {
    const r = row.trim();
    if (!r) continue;
    const m = SPEAKER.exec(r);
    if (m?.[1] && m[2]) out.push({ speaker: m[1].trim(), text: m[2].trim() });
    else out.push({ text: r });
  }
  return out;
}
