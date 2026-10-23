/**
 * Prompt evaluation (docs/04-analysis-prompt.md §7).
 *
 * For each fixture in tests/fixtures/meetings/, feeds the transcript in 6 chunks of about a minute,
 * the way the live app does (same request builders and flag merge as the browser): a watch call
 * after every chunk, a summary call after chunks 3 and 6 (ADR-19). Then scores the final watch
 * list against expected.json:
 *   recall     planted items that were flagged
 *   precision  flags that match a planted or an acceptable item
 *   decoys     flags raised on statements that look suspicious but are fine (target 0)
 *   stability  share of flag ids after chunk 5 still present after chunk 6
 * plus latency per call type and an estimated cost per hour of meeting. Needs ANTHROPIC_API_KEY. The fixtures are synthetic, so printing them is fine.
 *
 * Usage: npm run eval -- [--fixture name] [--runs 1] [--speakers] [--model id]
 *                        [--effort low|medium|high] [--thinking adaptive|minimal]
 *                        [--watch-model id] [--watch-effort …] [--watch-thinking …]
 *                        [--json out.json] [--md out.md] [--mock]
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runAnalysis } from '../api/_lib/handlers/analyze.js';
import {
  settingsFromEnv,
  watchSettingsFromEnv,
  type Effort,
  type ModelCall,
  type ModelSettings,
  type ThinkingMode,
} from '../api/_lib/model.js';
import { sameQuote } from '../shared/normalize.js';
import { analyzeRequestSchema } from '../shared/schema.js';
import type { FlagType, Language } from '../shared/types.js';
import { buildSummaryRequest, buildWatchRequest } from '../src/analysis/buildRequest.js';
import { mergeFlags } from '../src/analysis/mergeFlags.js';
import { withTopics } from '../src/lib/topics.js';
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
  summaryLatenciesMs: number[];
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  watchCostUsd: number;
  summaryCostUsd: number;
  meetingMinutes: number;
  missed: string[];
  flags: FlagScore[];
  tldr: string;
  topics: number;
  importantCount?: number;
  questionsFound?: number;
  topicsUsed?: number;
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
    watchModel: get('watch-model'),
    watchEffort: get('watch-effort') as Effort | undefined,
    watchThinking: get('watch-thinking') as ThinkingMode | undefined,
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
    summaryUpToLineIndex: 0,
    lastSummaryAt: null,
    questions: [],
    topics: [],
    segments: [],
  };
}

/** USD per million tokens (platform.claude.com pricing, 23 Oct 2026; Haiku at its ≤100k tier). */
const PRICES: Record<string, { in: number; out: number }> = {
  opus: { in: 4, out: 20 },
  sonnet: { in: 2, out: 10 },
  haiku: { in: 0.1, out: 0.5 },
};
function costUsd(model: string, inTok: number, outTok: number): number {
  const key = Object.keys(PRICES).find((k) => model.includes(k)) ?? 'sonnet';
  const p = PRICES[key] ?? { in: 2, out: 10 };
  return (inTok * p.in + outTok * p.out) / 1e6;
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
    const out = (text: unknown) => ({
      text: JSON.stringify(text),
      stopReason: 'end_turn',
      inputTokens: Math.round(user.length / 4),
      outputTokens: 150,
    });
    if (!user.includes('Return only the CHANGES')) return out({ tldr: 'mock', topics: [] });
    const fresh = user.slice(user.lastIndexOf('NEW TRANSCRIPT'));
    const current = user.slice(user.indexOf('CURRENT WATCH LIST'), user.indexOf('DISMISSED BY'));
    const add = exp.planted
      .filter((p) => fresh.includes(p.quote) && !current.includes(p.quote))
      .map((p) => ({
        type: p.type ?? 'question',
        title: p.note ?? 'flag',
        quote: p.quote,
        why: p.note ?? '',
        ask: 'Who owns this?',
        who: '',
      }));
    return out({ add, update: [], drop: [], questions: [], segments: [], answered: [] });
  };
}

async function runFixture(
  name: string,
  run: number,
  settings: ModelSettings,
  watchSettings: ModelSettings,
  keepSpeakers: boolean,
  mock = false,
): Promise<RunResult> {
  const dir = join(ROOT, name);
  const exp = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8')) as Expected;
  const full = loadSession(dir, exp, keepSpeakers);
  const n = full.lines.length;
  const CHUNKS = 6;
  const cuts = Array.from({ length: CHUNKS }, (_, k) => Math.ceil(((k + 1) * n) / CHUNKS));
  let session: Session = { ...full, lines: [] };
  const latencies: number[] = [];
  const summaryLatencies: number[] = [];
  let attempts = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let watchCost = 0;
  let summaryCost = 0;
  let idsBeforeLast: string[] = [];
  const deps = { settings, watchSettings, ...(mock ? { call: mockCall(exp) } : {}) };
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
    summaryLatenciesMs: summaryLatencies,
    attempts: 0,
    inputTokens: 0,
    outputTokens: 0,
    watchCostUsd: 0,
    summaryCostUsd: 0,
    meetingMinutes: (full.lines.at(-1)?.t ?? 60_000) / 60_000,
    missed: [],
    flags: [],
    tldr: '',
    topics: 0,
  };

  for (const [k, cut] of cuts.entries()) {
    session = { ...session, lines: full.lines.slice(0, cut) };
    const calls: ('watch' | 'summary')[] =
      k === 2 || k === CHUNKS - 1 ? ['watch', 'summary'] : ['watch'];
    for (const mode of calls) {
      const body = mode === 'watch' ? buildWatchRequest(session) : buildSummaryRequest(session);
      const req = analyzeRequestSchema.parse(body);
      const started = Date.now();
      const out = await runAnalysis(req, deps);
      (mode === 'watch' ? latencies : summaryLatencies).push(Date.now() - started);
      attempts += out.attempts;
      inputTokens += out.inputTokens;
      outputTokens += out.outputTokens;
      const c = costUsd(
        mode === 'watch' ? watchSettings.model : settings.model,
        out.inputTokens,
        out.outputTokens,
      );
      if (mode === 'watch') watchCost += c;
      else summaryCost += c;
      if (!out.ok) {
        return {
          ...base,
          attempts,
          inputTokens,
          outputTokens,
          error: `chunk ${k + 1} ${mode}: ${out.code}`,
        };
      }
      if ('flags' in out.result) {
        const merged = mergeFlags(session.flags, out.result.flags, Date.now());
        session = {
          ...session,
          flags: merged.flags,
          analyzedUpToLineIndex: cut,
          questions: [
            ...session.questions,
            ...out.result.questions.map((q) => ({ ...q, t: full.lines[cut - 1]?.t ?? 0 })),
          ],
          topics: withTopics(session.topics, [
            ...merged.flags.map((f) => f.topic),
            ...out.result.questions.map((q) => q.topic),
            ...out.result.segments.map((g) => g.topic),
          ]),
          segments: [...session.segments, ...out.result.segments],
        };
      } else if ('tldr' in out.result) {
        session = {
          ...session,
          summary: { tldr: out.result.tldr, topics: out.result.topics },
          summaryUpToLineIndex: cut,
          topics: withTopics(
            session.topics,
            out.result.topics.map((t) => t.topic),
          ),
        };
      }
    }
    if (k === CHUNKS - 2) idsBeforeLast = session.flags.map((f) => f.id);
  }

  // Important markers (ADR-21) are not problems, so they are not scored against planted items.
  const flags: ClientFlag[] = session.flags.filter(
    (f) => f.status === 'active' && f.type !== 'important',
  );
  const importantCount = session.flags.filter((f) => f.type === 'important').length;
  const questionsFound = session.questions.length;
  const topicsUsed = session.topics.length;
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
  const idsAfterLast = new Set(flags.map((f) => f.id));
  return {
    ...base,
    ok: true,
    recall: hit.size / exp.planted.length,
    precision: flags.length ? good / flags.length : 0,
    decoyHits: scored.filter((s) => s.match === 'DECOY').length,
    stability: idsBeforeLast.length
      ? idsBeforeLast.filter((id) => idsAfterLast.has(id)).length / idsBeforeLast.length
      : null,
    typeAgreement: typed.length ? typeOk / typed.length : 0,
    attempts,
    inputTokens,
    outputTokens,
    watchCostUsd: watchCost,
    summaryCostUsd: summaryCost,
    missed: exp.planted.filter((p) => !hit.has(p.id ?? '')).map((p) => `${p.id} (${p.type})`),
    flags: scored,
    tldr: session.summary?.tldr ?? '',
    importantCount,
    questionsFound,
    topicsUsed,
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
  const wenv = watchSettingsFromEnv();
  const watchSettings: ModelSettings = {
    ...wenv,
    model: a.watchModel ?? a.model ?? wenv.model,
    effort: a.watchEffort ?? a.effort ?? wenv.effort,
    thinking: a.watchThinking ?? a.thinking ?? wenv.thinking,
  };
  const fixtures = readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && (!a.fixture || d.name === a.fixture))
    .map((d) => d.name)
    .sort();

  const results: RunResult[] = [];
  for (const f of fixtures) {
    for (let r = 1; r <= a.runs; r++) {
      process.stdout.write(`${f} run ${r}… `);
      const res = await runFixture(f, r, settings, watchSettings, a.speakers, a.mock);
      results.push(res);
      console.info(
        res.ok
          ? `recall ${pct(res.recall)} precision ${pct(res.precision)} decoys ${res.decoyHits}`
          : `FAILED ${res.error}`,
      );
      for (const fl of res.flags)
        console.info(`   [${fl.match}] ${fl.type}: ${fl.title} — "${fl.quote}"`);
      if (res.missed.length) console.info(`   missed: ${res.missed.join(', ')}`);
      if (res.ok)
        console.info(
          `   also: ${res.importantCount} important markers, ${res.questionsFound} questions, ${res.topicsUsed} topics`,
        );
    }
  }

  const ok = results.filter((r) => r.ok);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  const lat = results.flatMap((r) => r.latenciesMs);
  const slat = results.flatMap((r) => r.summaryLatenciesMs);
  const minutes = ok.reduce((s, r) => s + r.meetingMinutes, 0) || 1;
  // A live hour has ~10 times the calls of one fixture-minute set; scale cost by meeting length.
  const perHour = (usd: number) => (usd / minutes) * 60;
  const stab = ok.map((r) => r.stability).filter((x): x is number => x !== null);
  const summary = {
    date: new Date().toISOString(),
    settings,
    watchSettings,
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
    summaryLatencyP50Ms: quantile(slat, 0.5),
    summaryLatencyP95Ms: quantile(slat, 0.95),
    watchCostPerHourUsd: perHour(ok.reduce((s, r) => s + r.watchCostUsd, 0)),
    summaryCostPerHourUsd: perHour(ok.reduce((s, r) => s + r.summaryCostUsd, 0)),
    inputTokens: results.reduce((s, r) => s + r.inputTokens, 0),
    outputTokens: results.reduce((s, r) => s + r.outputTokens, 0),
    retries: results.reduce((s, r) => s + Math.max(0, r.attempts - 8), 0),
  };
  const pass =
    summary.recall >= 0.6 &&
    summary.precision >= 0.7 &&
    summary.decoyHits <= 1 &&
    summary.latencyP95Ms < 15_000 &&
    summary.failed === 0;

  const rows = results
    .map((r) =>
      r.ok
        ? `| ${r.fixture} | ${r.run} | ${pct(r.recall)} | ${pct(r.precision)} | ${r.decoyHits} | ${r.stability === null ? '–' : pct(r.stability)} | ${r.flags.length} | ${(Math.max(...r.latenciesMs) / 1000).toFixed(1)} s |`
        : `| ${r.fixture} | ${r.run} | failed: ${r.error} | | | | | |`,
    )
    .join('\n');
  const md = `### ${summary.date.slice(0, 10)} — ${a.mock ? 'MOCK MODEL (plumbing check)' : `watch ${watchSettings.model} (${watchSettings.effort}, ${watchSettings.thinking}), summary ${settings.model} (${settings.effort}, ${settings.thinking})`}${a.speakers ? ', with speaker names' : ', no speaker names'}

| Fixture | Run | Recall | Precision | Decoys | Stability | Flags | Slowest watch call |
|---|---|---|---|---|---|---|---|
${rows}

**Overall:** recall ${pct(summary.recall)} (target ≥ 60%), precision ${pct(summary.precision)} (≥ 70%), decoy hits ${summary.decoyHits} (≤ 1), stability ${pct(summary.stability)}, type agreement ${pct(summary.typeAgreement)}. Watch call latency p50 ${(summary.latencyP50Ms / 1000).toFixed(1)} s, p95 ${(summary.latencyP95Ms / 1000).toFixed(1)} s (target < 15 s); summary call p50 ${(summary.summaryLatencyP50Ms / 1000).toFixed(1)} s. Estimated cost per hour of meeting: watch $${summary.watchCostPerHourUsd.toFixed(2)} + summary $${summary.summaryCostPerHourUsd.toFixed(2)}. Tokens in ${summary.inputTokens}, out ${summary.outputTokens}. Retries ${summary.retries}. **${pass ? 'PASS' : 'BELOW TARGET'}**.
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
