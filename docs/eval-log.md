# Eval log

Every prompt change is followed by `npm run eval` and an entry here (CLAUDE.md). Newest first.

How to run against the real model: GitHub → **Actions** → **Eval** → **Run workflow**. It needs the repository secret `ANTHROPIC_API_KEY` (`docs/05-setup-guide.md` §1). The summary table appears on the run page; the full result, with every flag and its match, is in the `eval-results` artifact. Locally: `ANTHROPIC_API_KEY=… npm run eval`.

Targets for Phase 0 (`docs/04` §7): recall ≥ 60%, precision ≥ 70%, decoy hits ≤ 1 across all fixtures; latency under 15 s per call (`docs/01` §7).

Reading the numbers:
- Each fixture plants 12–13 items, but the watch list holds at most 12 flags, so the best possible recall is about 92%.
- The model does not accept a fixed temperature (ADR-18), so results vary between runs. Use `runs: 3` before comparing two prompt versions.
- The fixtures and `expected.json` were written by Claude Code. Mihaela reviews them, at least the Romanian ones, before a result is treated as meaningful.

## Fixtures

| Fixture | Language | Planted (trap / logic / question) | Decoys |
|---|---|---|---|
| `en-payroll-golive` | English | 6 / 5 / 2 | 3 |
| `en-crm-vendor` | English | 6 / 5 / 2 | 3 |
| `ro-efactura-erp` | Romanian | 6 / 4 / 3 | 3 |
| `ro-portal-clinici` | Romanian | 5 / 5 / 2 | 3 |

## Runs

### 2026-10-23 — answer prompt only (ADR-24): no eval run

The change touches only the answer prompt (mode `answer`). The eval scores watch and summary calls and never runs answer mode, so a run would measure nothing about this change. It is covered by unit and end-to-end tests of the schema, clean-up and rendering. The real check is Mihaela reviewing answers on real questions.

### 2026-10-23 — after ADR-21 (topics, Important markers, answered questions): watch and summary claude-sonnet-5-5, medium, adaptive, no speaker names

GitHub Actions, Eval #6, commit c69d6e4, 1 run per fixture.

| Fixture | Run | Recall | Precision | Decoys | Stability | Flags | Slowest watch call |
|---|---|---|---|---|---|---|---|
| en-crm-vendor | 1 | 69% | 100% | 0 | 69% | 12 | 6.1 s |
| en-payroll-golive | 1 | 62% | 92% | 0 | 56% | 12 | 6.8 s |
| ro-efactura-erp | 1 | 69% | 92% | 0 | 60% | 12 | 14.9 s |
| ro-portal-clinici | 1 | 58% | 92% | 0 | 64% | 12 | 6.5 s |

Overall: recall 65% (target ≥ 60%), precision 94% (≥ 70%), decoy hits 0 (≤ 1), stability 62%, type agreement 75%. Watch latency p50 5.3 s, p95 6.8 s; summary p50 12.3 s. Cost per hour of meeting: watch $1.13 + summary $0.52. PASS.

The new rules did not cost accuracy: recall went from 59% to 65% and precision stayed in the 90s, with Important markers scored separately. One Romanian watch call took 14.9 s, close to the 15 s limit; one run only, so this may be noise.

### 2026-10-23 — after the split (ADR-19): watch Sonnet vs watch Haiku

GitHub Actions runs "Eval #4" and "Eval #5", one run per fixture, 6 one-minute chunks per fixture. Summary on Sonnet 5.5 in both. Stability is now measured between chunks 5 and 6, so it is not comparable with the earlier runs.

| Watch model | Recall | Precision | Decoys | Stability | Watch call p50 / p95 | Summary call p50 | Est. cost per meeting hour |
|---|---|---|---|---|---|---|---|
| claude-sonnet-5-5 | 59% | 96% | 0 | 73% | 5.0 s / 9.0 s | 13.0 s | $0.87 + $0.53 = **$1.40** |
| claude-haiku-5-5 | 59% | 79% | 0 | 75% | 7.8 s / 12.8 s | 14.1 s | $0.08 + $0.54 = **$0.62** |

Per fixture, Sonnet watch: en-crm-vendor 62/100/0, en-payroll-golive 54/92/0, ro-efactura-erp 69/100/0, ro-portal-clinici 50/92/0 (recall/precision/decoys).

Observations: the split brought the watch call well under the 15 s target, and the two prompt rules removed every decoy hit. Recall is unchanged at 59%, one point under target. Haiku was not faster here: it wrote twice as many output tokens (52 k vs 25 k) and was less precise.
Interpretation: keep Sonnet for the watch call (the default). The remaining recall gap is the 12-flag cap against 12–13 planted items per short fixture, plus a few planted items the model judges minor; a fixture review by Mihaela may move some of those to `acceptable`. One run each, so a few points either way are noise.

### 2026-10-23 — claude-sonnet-5-5, effort medium, thinking minimal, no speaker names

GitHub Actions run "Eval #3", one run per fixture.

| Fixture | Recall | Precision | Decoys | Stability | Flags | Slowest call |
|---|---|---|---|---|---|---|
| en-crm-vendor | 62% | 83% | 0 | 100% | 12 | 23.8 s |
| en-payroll-golive | 62% | 100% | 0 | 75% | 12 | 30.1 s |
| ro-efactura-erp | 54% | 100% | 0 | 100% | 12 | 35.3 s |
| ro-portal-clinici | 58% | 92% | 1 | 55% | 12 | 35.3 s |

**Overall:** recall 59%, precision 94%, decoy hits 1 (target met), stability 82%, type agreement 80%. Latency p50 21.3 s, p95 35.3 s. Tokens in 57 062, out 37 348.

Comparison with the adaptive run (observation; one run each, so differences of a few points are within noise): quality is about the same, and turning thinking down did **not** make calls faster. Output stayed at about 3 100 tokens per call in both runs. Interpretation: the time goes into writing the full state on every call (ADR-3), not into thinking. Reaching the 15 s target needs a smaller answer per call, for example flags on every call and the summary less often, or a faster model; a thinking setting alone will not do it. This is a design decision for Mihaela before the prompt is tuned.

### 2026-10-23 — claude-sonnet-5-5, effort medium, thinking adaptive, no speaker names (first real run)

GitHub Actions run "Eval #2", one run per fixture.

| Fixture | Recall | Precision | Decoys | Stability | Flags | Slowest call |
|---|---|---|---|---|---|---|
| en-crm-vendor | 62% | 92% | 0 | 91% | 12 | 25.0 s |
| en-payroll-golive | 54% | 92% | 1 | 82% | 12 | 26.8 s |
| ro-efactura-erp | 62% | 92% | 1 | 82% | 12 | 25.0 s |
| ro-portal-clinici | 58% | 92% | 1 | 64% | 12 | 26.7 s |

**Overall:** recall 59% (target ≥ 60%), precision 92% (≥ 70%), decoy hits 3 (≤ 1), stability 80%, type agreement 87%. Latency p50 20.3 s, p95 26.8 s (target < 15 s). Tokens in 56 407, out 36 212. Retries 0. **Below target on recall (just), decoys and latency.**

What the flags show (observation, from the run log):
- Every fixture ended with exactly 12 flags, the cap. Most missed planted items come late in the meeting (p10–p13). Interpretation: the list fills up early, partly with sound but minor flags, and later, sharper items have no room.
- All 3 decoy hits are of type "question" and ask for evidence of something that was already evidenced (a CFO signature, an on-call confirmation, a CEO approval). Interpretation: the model treats "question" as a catch-all.
- Precision is high: almost every flag is either planted or acceptable.
- Romanian output is in Romanian with correct diacritics, and Romanian quotes passed the grounding check.

Candidate changes, not yet made (each needs an eval run before and after): ask the model to replace the weakest flag when the list is full rather than keep the oldest; say that a statement that already names its evidence, owner or date is not a question to raise; try `thinking: minimal` and `effort: low` for latency.

### 2026-10-23 — MOCK MODEL (plumbing check), no speaker names

The mock stands in for the model and flags exactly the planted items visible in each chunk. This checks the eval's chunking, request building, server post-checks (Romanian quote grounding included), flag merge and scoring. It says nothing about the prompt.

| Fixture | Run | Recall | Precision | Decoys | Stability | Flags |
|---|---|---|---|---|---|---|
| en-crm-vendor | 1 | 92% | 100% | 0 | 100% | 12 |
| en-payroll-golive | 1 | 92% | 100% | 0 | 100% | 12 |
| ro-efactura-erp | 1 | 92% | 100% | 0 | 100% | 12 |
| ro-portal-clinici | 1 | 100% | 100% | 0 | 100% | 12 |

Recall stops at 92% on the 13-item fixtures because of the 12-flag cap, as expected. CI runs this check on every pull request.
