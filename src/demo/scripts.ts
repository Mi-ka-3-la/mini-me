import roInterview from './ro-interviu-po.txt?raw';
import enSteering from './en-steering-golive.txt?raw';
import roErp from './ro-efactura-erp.txt?raw';
import type { Language } from '../../shared/types';

export type ScriptLine = { t: number; speaker?: string; text: string };
export type Script = { id: string; title: string; language: Language; lines: ScriptLine[] };

const LINE = /^\[(\d+):(\d\d)\]\s+(?:([^:]{1,60}):\s+)?(.+)$/;

/** Parses "[mm:ss] Name (Role): text" lines. */
export function parseScript(raw: string): ScriptLine[] {
  const out: ScriptLine[] = [];
  for (const row of raw.split('\n')) {
    const m = LINE.exec(row.trim());
    if (!m) continue;
    out.push({
      t: (Number(m[1]) * 60 + Number(m[2])) * 1000,
      ...(m[3] ? { speaker: m[3].trim() } : {}),
      text: (m[4] ?? '').trim(),
    });
  }
  return out;
}

/** Sample conversations for the step-by-step simulation. Fictional people and companies. */
export const SCRIPTS: Script[] = [
  {
    id: 'ro-interview',
    title: 'Interviu pentru un rol de Product Owner (RO, 4½ min)',
    language: 'ro-RO',
    lines: parseScript(roInterview),
  },
  {
    id: 'en-steering',
    title: 'Payroll go-live steering meeting (EN, 6 min)',
    language: 'en-US',
    lines: parseScript(enSteering),
  },
  {
    id: 'ro-erp',
    title: 'Go-live facturare și e-Factura (RO, 5 min)',
    language: 'ro-RO',
    lines: parseScript(roErp),
  },
];

const WORDS_PER_SEC = 2.5;
const GAP_MS = 700;
const MAX_CHUNK_WORDS = 30;
const SPEAKER = /^([^:]{1,40}):\s+(.+)$/;

/** Splits a long turn into caption-sized pieces at sentence ends, as live captions arrive. */
function chunks(text: string): string[] {
  const sentences = text.split(/(?<=[.?!])\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    const next = cur ? `${cur} ${s}` : s;
    if (cur && next.split(/\s+/).length > MAX_CHUNK_WORDS) {
      out.push(cur);
      cur = s;
    } else {
      cur = next;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Parses a transcript the listener pastes in (ADR-22). Accepts "[mm:ss] Name: text" lines, or
 * "Name: text" lines without times (Granola, Teams, Zoom exports). Without times, each piece is
 * timed at speaking pace. A speaker label is kept only when it looks like a name (up to 4 words).
 */
export function parsePasted(raw: string): ScriptLine[] {
  const timed = parseScript(raw);
  if (timed.length > 0) return timed;
  const out: ScriptLine[] = [];
  let t = 0;
  for (const row of raw.split('\n')) {
    const line = row.trim();
    if (!line) continue;
    const m = SPEAKER.exec(line);
    const label = m?.[1]?.trim();
    const isName = !!label && label.split(/\s+/).length <= 4;
    const speaker = isName ? label : undefined;
    const text = (isName ? m?.[2] : line)?.trim() ?? '';
    if (!text) continue;
    for (const piece of chunks(text)) {
      out.push({ t, ...(speaker ? { speaker } : {}), text: piece });
      t += (piece.split(/\s+/).length / WORDS_PER_SEC) * 1000 + GAP_MS;
    }
  }
  return out;
}
