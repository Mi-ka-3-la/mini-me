/**
 * Prompt evaluation (docs/04-analysis-prompt.md §7).
 *
 * For each fixture in tests/fixtures/meetings/, feeds the transcript to the analysis in 3 chunks,
 * the way the live app does (same request builder and flag merge as the browser), then scores the
 * final watch list against expected.json:
 *   recall     planted items that were flagged
 *   precision  flags that match a planted or an acceptable item
 *   decoys     flags raised on statements that look suspicious but are fine (target 0)
 *   stability  share of chunk-2 flag ids still present after chunk 3
 * plus latency per call. Needs ANTHROPIC_API_KEY. The fixtures are synthetic, so printing them is fine.
 *
 * Usage: npm run eval -- [--fixture name] [--runs 1] [--speakers] [--model id]
 *                        [--effort low|medium|high] [--thinking adaptive|minimal]
 *                        [--json out.json] [--md out.md]
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runAnalysis } from '../api/_lib/handlers/analyze.js';
import {
  settingsFromEnv,
  type Effort,
  type ModelCall,
  type ModelSettings,
  type ThinkingMode,
} from '../api/_lib/model.js';
import { sameQuote } from '../shared/normalize.js';
import { analyzeRequestSchema } from '../shared/schema.js';
import type { FlagType, Language } from '../shared/types.js';
import { buildAnalyzeRequest } from '../src/analysis/buildRequest.js';
import { mergeFlags } from '../src/analysis/mergeFlags.js';
import type { ClientFlag, Line, Session, Speaker } from '../src/store/types.js';

type Item = { id?: string; type?: FlagType; quote: string; note?: string };
type Expected = {
  language: Language;
  title: string;
  planted: Item[];
  acceptable: Item[];
  decoys: Item[];
};

type FlagScore = { id: string; type: FlagType; title: string; quote: string; match: string };
type RunResult = {
  fixture: string;
  run: number;
  ok: boolean;
  error?: string;
  recall: number;
  precision: number;
  decoyHits: number;
  stability: number | null;
  typeAgreement: number;
  latenciesMs: number[];
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  missed: string[];
  flags: FlagScore[];
  tldr: string;
  topics: number;
};

const ROOT = join(import.meta.dirname, '..', 'tests', 'fixtures', 'meetings');

function args() {
  const a = process.argv.slice(2);
  const get = (k: string) => {
    const i = a.indexOf(`--${k}`);
    return i >= 0 ? a[i + 1] : undefined;
  };
  return {
    fixture: get('fixture'),
    runs: Number(get('runs') ?? 1),
    speakers: a.includes('--speakers'),
    model: get('model'),
    effort: get('effort') as Effort | undefined,
    thinking: get('thinking') as ThinkingMode | undefined,
    json: get('json'),
    md: get('md'),
    mock: a.includes('--mock'),
  };
}

const LINE = /^\[(\d+):(\d\d)\]\s+(?:([^:]{1,60}):\s+)?(.+)$/;

/** Parses "[mm:ss] Name (Role): text". Without --speakers the name is dropped, as with the browser engine. */
function loadSession(dir: string, exp: Expected, keepSpeakers: boolean): Session {
  const lines: Line[] = [];
  const speakers: Record<string, Speaker> = {};
  const raw = readFileSync(join(dir, 'transcript.txt'), 'utf8').split('\n');
  for (const [i, row] of raw.entries()) {
    const m = LINE.exec(row.trim());
    if (!m) continue;
    const t = (Number(m[1]) * 60 + Number(m[2])) * 1000;
    const name = m[3]?.trim();
    const line: Line = { id: `l${i}`, t, text: m[4] ?? '', final: true, origin: 'stt' };
    if (keepSpeakers && name) {
      const id = 'm-' + name.toLowerCase().replace(/\W+/g, '-');
      speakers[id] = { id, label: name, source: 'manual' };
      line.speakerId = id;
    }
    lines.push(line);
  }
  return {
    id: 'eval',
    startedAt: 0,
    language: exp.language,
    context: '',
    lines,
    speakers,
    gaps: [],
    summary: null,
    flags: [],
    analyzedUpToLineIndex: 0,
    analysisCalls: 0,
    lastAnalysisAt: null,
  };
}

function classify(quote: string, exp: Expected): string {
  const p = exp.planted.find((x) => sameQuote(x.quote, quote));
  if (p) return `planted:${p.id}`;
  if (exp.acceptable.some((x) => sameQuote(x.quote, quote))) return 'acceptable';
  if (exp.decoys.some((x) => sameQuote(x.quote, quote))) return 'DECOY';
  return 'unmatched';
}

/**
 * --mock: a stand-in model that flags exactly the planted items visible so far and reuses ids.
 * It checks the eval's own plumbing and scoring without an API key (used in CI).
 */
function mockCall(exp: Expected): ModelCall {
  return async ({ user }) => {
    const transcript = user.slice(user.lastIndexOf('TRANSCRIPT'));
    const prevJson = /PREVIOUS ANALYSIS \(JSON\):\n(.*)\n/.exec(user)?.[1] ?? 'none yet';
    const prev =
      prevJson === 'none yet'
        ? []
        : (JSON.parse(prevJson) as { flags: { id: string; quote: string }[] }).flags;
    const flags = exp.planted
      .filter((p) => transcript.includes(p.quote))
      .slice(0, 12)
      .map((p) => ({
        id: prev.find((f) => f.quote === p.quote)?.id ?? '',
        type: p.type ?? 'question',
        title: p.note ?? 'flag',
        quote: p.quote,
        why: p.note ?? '',
        ask: 'Who owns this?',
        who: '',
      }));
    return {
      text: JSON.stringify({ tldr: 'mock', topics: [], flags }),
      stopReason: 'end_turn',
      inputTokens: Math.round(user.length / 4),
      outputTokens: 200,
    };
  };
}

async function runFixture(
  name: string,
  run: number,
  settings: ModelSettings,
  keepSpeakers: boolean,
  mock = false,
): Promise<RunResult> {
  const dir = join(ROOT, name);
  const exp = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8')) as Expected;
  const full = loadSession(dir, exp, keepSpeakers);
  const n = full.lines.length;
  const cuts = [Math.ceil(n / 3), Math.ceil((2 * n) / 3), n];
  let session: Session = { ...full, lines: [] };
  const latencies: number[] = [];
  let attempts = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let idsAfter2: string[] = [];
  const base: RunResult = {
    fixture: name,
    run,
    ok: false,
    recall: 0,
    precision: 0,
    decoyHits: 0,
    stability: null,
    typeAgreement: 0,
    latenciesMs: latencies,
    attempts: 0,
    inputTokens: 0,
    outputTokens: 0,
    missed: [],
    flags: [],
    tldr: '',
    topics: 0,
  };

  for (const [k, cut] of cuts.entries()) {
    session = { ...session, lines: full.lines.slice(0, cut) };
    const req = analyzeRequestSchema.parse(buildAnalyzeRequest(session));
    const started = Date.now();
    const out = await runAnalysis(req, { settings, ...(mock ? { call: mockCall(exp) } : {}) });
    latencies.push(Date.now() - started);
    attempts += out.attempts;
    inputTokens += out.inputTokens;
    outputTokens += out.outputTokens;
    if (!out.ok) {
      return { ...base, attempts, inputTokens, outputTokens, error: `chunk ${k + 1}: ${out.code}` };
    }
    const merged = mergeFlags(session.flags, out.result.flags, Date.now());
    session = {
      ...session,
      summary: { tldr: out.result.tldr, topics: out.result.topics },
      flags: merged.flags,
      analyzedUpToLineIndex: cut,
    };
    if (k === 1) idsAfter2 = session.flags.map((f) => f.id);
  }

  const flags: ClientFlag[] = session.flags.filter((f) => f.status === 'active');
  const scored: FlagScore[] = flags.map((f) => ({
    id: f.id,
    type: f.type,
    title: f.title,
    quote: f.quote,
    match: classify(f.quote, exp),
  }));
  const hit = new Set(
    scored.filter((s) => s.match.startsWith('planted:')).map((s) => s.match.slice(8)),
  );
  const good = scored.filter(
    (s) => s.match.startsWith('planted:') || s.match === 'acceptable',
  ).length;
  const typed = scored.filter((s) => s.match.startsWith('planted:'));
  const typeOk = typed.filter(
    (s) => exp.planted.find((p) => p.id === s.match.slice(8))?.type === s.type,
  ).length;
  const idsAfter3 = new Set(flags.map((f) => f.id));
  return {
    ...base,
    ok: true,
    recall: hit.size / exp.planted.length,
    precision: flags.length ? good / flags.length : 0,
    decoyHits: scored.filter((s) => s.match === 'DECOY').length,
    stability: idsAfter2.length
      ? idsAfter2.filter((id) => idsAfter3.has(id)).length / idsAfter2.length
      : null,
    typeAgreement: typed.length ? typeOk / typed.length : 0,
    attempts,
    inputTokens,
    outputTokens,
    missed: exp.planted.filter((p) => !hit.has(p.id ?? '')).map((p) => `${p.id} (${p.type})`),
    flags: scored,
    tldr: session.summary?.tldr ?? '',
    topics: session.summary?.topics.length ?? 0,
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
};

async function main() {
  const a = args();
  if (!process.env.ANTHROPIC_API_KEY && !a.mock) {
    console.error(
      'ANTHROPIC_API_KEY is not set. Run in the GitHub "Eval" workflow or export it locally.',
    );
    process.exit(2);
  }
  const env = settingsFromEnv();
  const settings: ModelSettings = {
    ...env,
    ...(a.model ? { model: a.model } : {}),
    ...(a.effort ? { effort: a.effort } : {}),
    ...(a.thinking ? { thinking: a.thinking } : {}),
  };
  const fixtures = readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && (!a.fixture || d.name === a.fixture))
    .map((d) => d.name)
    .sort();

  const results: RunResult[] = [];
  for (const f of fixtures) {
    for (let r = 1; r <= a.runs; r++) {
      process.stdout.write(`${f} run ${r}… `);
      const res = await runFixture(f, r, settings, a.speakers, a.mock);
      results.push(res);
      console.info(
        res.ok
          ? `recall ${pct(res.recall)} precision ${pct(res.precision)} decoys ${res.decoyHits}`
          : `FAILED ${res.error}`,
      );
      for (const fl of res.flags)
        console.info(`   [${fl.match}] ${fl.type}: ${fl.title} — "${fl.quote}"`);
      if (res.missed.length) console.info(`   missed: ${res.missed.join(', ')}`);
    }
  }

  const ok = results.filter((r) => r.ok);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  const lat = results.flatMap((r) => r.latenciesMs);
  const stab = ok.map((r) => r.stability).filter((x): x is number => x !== null);
  const summary = {
    date: new Date().toISOString(),
    settings,
    speakers: a.speakers,
    runs: results.length,
    failed: results.length - ok.length,
    recall: mean(ok.map((r) => r.recall)),
    precision: mean(ok.map((r) => r.precision)),
    decoyHits: ok.reduce((s, r) => s + r.decoyHits, 0),
    stability: mean(stab),
    typeAgreement: mean(ok.map((r) => r.typeAgreement)),
    latencyP50Ms: quantile(lat, 0.5),
    latencyP95Ms: quantile(lat, 0.95),
    inputTokens: results.reduce((s, r) => s + r.inputTokens, 0),
    outputTokens: results.reduce((s, r) => s + r.outputTokens, 0),
    retries: results.reduce((s, r) => s + Math.max(0, r.attempts - 3), 0),
  };
  const pass =
    summary.recall >= 0.6 &&
    summary.precision >= 0.7 &&
    summary.decoyHits <= 1 &&
    summary.failed === 0;

  const rows = results
    .map((r) =>
      r.ok
        ? `| ${r.fixture} | ${r.run} | ${pct(r.recall)} | ${pct(r.precision)} | ${r.decoyHits} | ${r.stability === null ? '–' : pct(r.stability)} | ${r.flags.length} | ${(Math.max(...r.latenciesMs) / 1000).toFixed(1)} s |`
        : `| ${r.fixture} | ${r.run} | failed: ${r.error} | | | | | |`,
    )
    .join('\n');
  const md = `### ${summary.date.slice(0, 10)} — ${a.mock ? 'MOCK MODEL (plumbing check)' : settings.model}, effort ${settings.effort}, thinking ${settings.thinking}${a.speakers ? ', with speaker names' : ', no speaker names'}

| Fixture | Run | Recall | Precision | Decoys | Stability | Flags | Slowest call |
|---|---|---|---|---|---|---|---|
${rows}

**Overall:** recall ${pct(summary.recall)} (target ≥ 60%), precision ${pct(summary.precision)} (≥ 70%), decoy hits ${summary.decoyHits} (≤ 1), stability ${pct(summary.stability)}, type agreement ${pct(summary.typeAgreement)}. Latency p50 ${(summary.latencyP50Ms / 1000).toFixed(1)} s, p95 ${(summary.latencyP95Ms / 1000).toFixed(1)} s (target < 15 s). Tokens in ${summary.inputTokens}, out ${summary.outputTokens}. Retries ${summary.retries}. **${pass ? 'PASS' : 'BELOW TARGET'}**.
`;
  console.info('\n' + md);
  mkdirSync('eval-results', { recursive: true });
  const jsonPath =
    a.json ?? join('eval-results', `eval-${summary.date.replace(/[:.]/g, '-')}.json`);
  writeFileSync(jsonPath, JSON.stringify({ summary, results }, null, 2));
  if (a.md) writeFileSync(a.md, md);
  if (process.env.GITHUB_STEP_SUMMARY)
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, md, { flag: 'a' });
}

void main();
