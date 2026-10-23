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
