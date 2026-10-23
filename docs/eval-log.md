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

### 2026-10-23 — first real run: not done yet

The sandbox where Phase 0 was built cannot reach the Anthropic API and has no key, by design. The first real result needs one manual run of the **Eval** workflow after the `ANTHROPIC_API_KEY` secret is added. Suggested first runs, in this order: default settings (`medium`, `adaptive`), then `thinking: minimal`, then `effort: low`, to see which meets the 15 s latency target without losing recall.

### 2026-10-23 — MOCK MODEL (plumbing check), no speaker names

The mock stands in for the model and flags exactly the planted items visible in each chunk. This checks the eval's chunking, request building, server post-checks (Romanian quote grounding included), flag merge and scoring. It says nothing about the prompt.

| Fixture | Run | Recall | Precision | Decoys | Stability | Flags |
|---|---|---|---|---|---|---|
| en-crm-vendor | 1 | 92% | 100% | 0 | 100% | 12 |
| en-payroll-golive | 1 | 92% | 100% | 0 | 100% | 12 |
| ro-efactura-erp | 1 | 92% | 100% | 0 | 100% | 12 |
| ro-portal-clinici | 1 | 100% | 100% | 0 | 100% | 12 |

Recall stops at 92% on the 13-item fixtures because of the 12-flag cap, as expected. CI runs this check on every pull request.
