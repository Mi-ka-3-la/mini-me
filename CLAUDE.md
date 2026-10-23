# CLAUDE.md — Meeting Copilot

## What this project is
A browser app that listens to a meeting and shows, live, the transcript, a running summary by topic, and a watch list of traps, logic errors and questions to ask. The full plan is in `docs/`. Read `README.md`, then `docs/01` to `docs/06`, before writing code.

## Source of truth
- Requirements: `docs/01-product-spec.md`. User story IDs (US-xx) and acceptance criteria are binding.
- Design: `docs/02-architecture.md`. If you need to deviate, write a short ADR at the bottom of that file and say why in the PR.
- Order of work: `docs/03-implementation-plan.md`. Work one phase at a time. Do not build later-phase features early.
- Prompt: `docs/04-analysis-prompt.md`. Prompt changes must be followed by `npm run eval` and an entry in `docs/eval-log.md`.
- Visual reference: `docs/reference/prototype.html`. Open it in a browser. Match its layout, tokens and behaviour. Its `window.claude` sampling calls are replaced by `/api/analyze`.

## Rules
- TypeScript strict. No `any` except at I/O boundaries, validated with zod.
- API keys only in server code and env vars. Never in `src/`, never in commits, never in logs.
- Never log transcript text, summaries or flags, on the server or the client. Log timings, counts and error codes only.
- Every `/api/*` route checks `x-app-passcode` with a constant-time compare.
- Every localStorage access is wrapped in try/catch.
- UI copy in English. Analysis output in the meeting language.
- Light and dark theme via CSS tokens. Test at 400 px, 768 px and desktop.
- Before relying on any vendor API detail (AssemblyAI, Deepgram, Anthropic), check the current docs. `docs/06` lists what was verified on 23 Oct 2026 and what was not.

## Workflow
- One branch and PR per task (`phase0/T0.5-transcriber`). The PR lists the US/AC covered and how it was tested.
- Run `npm run lint && npm test` before every commit.
- When a task is ambiguous, write the question in the PR description and choose the simplest option consistent with the spec. Do not stall.
- At the end of each phase, update `README.md` with how to run and what works.

## Commands (to be created in T0.1)
- `npm run dev` — UI + functions locally (`vercel dev`)
- `npm test` — Vitest
- `npm run lint`
- `npm run eval` — prompt evaluation against `tests/fixtures/meetings/`
