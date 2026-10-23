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
