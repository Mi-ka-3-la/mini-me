# Meeting Copilot

A browser app that listens to a meeting and, while the meeting is still running, shows three things side by side:

1. **Live transcript** of what is being said.
2. **Running summary**, grouped by topic. Each topic lists key points, decisions, actions and open items. The summary is rebuilt as the meeting moves on.
3. **Watch list** of things the listener should react to now. There are three kinds:
   - **Traps**: hidden risks or commitments, such as a dependency waved away as "a formality" or an issue to "fix after go-live".
   - **Logic errors**: reasoning that does not hold, such as reading silence as approval or treating one past success as proof.
   - **Questions to ask**: the next questions that would close a gap.

The reference point is Granola. Granola is a desktop app that listens through the computer and produces notes afterwards. Meeting Copilot differs in two ways. It works **during** the meeting rather than after it. And it runs in **any modern browser**, including a tablet placed next to the laptop running the call.

## Documents

The planning package lives in `docs/`, and the standing rules for Claude Code in `CLAUDE.md`.

| File | What it is | Main reader |
|---|---|---|
| `CLAUDE.md` | Standing rules for Claude Code in this repo | Claude Code |
| `docs/01-product-spec.md` | Problem, users, scope, user stories with acceptance criteria | Everyone |
| `docs/02-architecture.md` | Components, data flow, tech stack, security, decisions | Claude Code |
| `docs/03-implementation-plan.md` | Phases 0–3, tasks, definition of done, test plan | Claude Code |
| `docs/04-analysis-prompt.md` | The LLM prompt, output schema, tuning rules | Claude Code, Mihaela |
| `docs/05-setup-guide.md` | Accounts, API keys, deployment steps | Mihaela |
| `docs/06-risks-and-open-questions.md` | Risks, open decisions, verified facts with sources | Everyone |
| `docs/eval-log.md` | Prompt evaluation: how to run it, results | Mihaela, Claude Code |
| `docs/reference/prototype.html` | Working UI prototype. Analysis only, with pasted captions. | Claude Code (visual and behavioural reference) |

## Status: Phase 0 built, waiting for real-device tests

Phase 0 is the browser app with live listening through the browser's own speech engine (`docs/03-implementation-plan.md`). The code for tasks T0.1–T0.14 is in place, with 83 unit tests and 39 end-to-end tests passing (plus one narrow-screen test that is skipped at desktop width). What is left is what only a real device, a real meeting and a real API key can show: see "Not done yet" and the checklist below.

Owner: Mihaela Ilie (Business Analyst / Product Owner). Planning date: 23 October 2026.

### What works

- **Access.** Passcode screen at first run, checked against the server before it is saved. "Continue without analysis" keeps transcription available. Sign out from the menu. Every `/api` route checks the passcode in constant time and is rate-limited per IP.
- **Listening.** Start / Stop, a pulsing "Listening" indicator, English or Romanian (remembered on the device), the transcription reminder, and Context. The browser's speech engine restarts on its own when the browser ends a session: quickly after silence, with back-off after errors and "Reconnecting…" only when the wait is noticeable. Gaps are marked in the transcript. The screen is kept awake while listening. Refused microphone, missing microphone, unsupported language and unsupported browser each get their own explanation.
- **Transcript.** Interim text in grey, final lines with mm:ss, auto-scroll with "Jump to live", and a paste box where "Name: text" keeps the speaker (Romanian names included).
- **Analysis.** Runs on its own, one call at a time: after 60 new words, then at 150 words or 45 s. "Analyze now" runs with any new words. The server uses Anthropic structured output, validates the answer, retries once, then grounds every flag's quote in the transcript (Romanian diacritics normalised), drops dismissed and already-asked items, keeps flag ids stable and caps the list at 12. Errors never clear the screen; each has a readable message and a retry countdown. Analysis pauses offline and on a refused passcode, and the transcript keeps working. A per-meeting call counter is shown, with a cap after which only "Analyze now" works.
- **Summary.** A "So far" box, then topics with points and Decided / Action / Open items. No flicker between updates.
- **Watch list.** Trap / Logic error / Ask this cards with the exact quote, why it matters and a question to ask. Newest first, filters, Pin, Mark asked (moves to an "Asked" section), Dismiss with a short Undo. Pinned and asked flags are never removed by the model; dismissed ones never come back. New flags are highlighted, and on a tablet or phone the Watch list tab shows how many are new.
- **Export.** Copy notes as Markdown, optionally with the transcript. If the clipboard is blocked, the text is shown selected.
- **Reload.** The meeting is saved on the device every 2 s and when the page is hidden. "Resume meeting?" on reload; New meeting asks before clearing.
- **Layout.** The prototype's look in light and dark. Three columns on desktop; tabs on tablet portrait and phone, sticky, with the listening state.
- **Security and privacy.** Strict CSP with no external hosts (fonts are bundled), no content in any log (tested), the API key only on the server, nothing stored server-side.
- **Evaluation.** Four fixture meetings (2 EN, 2 RO), `npm run eval`, and a manual GitHub workflow **Eval**.

### Not done yet, and why

- **No real-model eval result yet.** The build sandbox cannot reach the Anthropic API and has no key, by design. Run the **Eval** workflow once the `ANTHROPIC_API_KEY` repository secret is set (`docs/eval-log.md` explains how and what to compare first). Until then, nobody knows whether the prompt meets the targets or the 15 s latency.
- **No test on a real speech engine or device.** Headless Chromium has no speech service, and the build sandbox has no tablet. All listening behaviour is tested against a scripted fake engine. The checklist items that need a microphone, a tablet or a phone are open.
- **Not deployed.** Deployment needs your Vercel account (below). A local Vercel build of this repository succeeded, and its three functions answered correctly (401 / 200 / config / 400 / 500 without a key) when called directly.
- **Fixtures need your review.** The same model family wrote the fixtures and takes the test. Please check at least the Romanian ones.
- **Deliberately left for later phases:** speaker labels, cloud transcription, tab audio, the caption extension (Phases 1–3).

### Phase 0 manual test checklist

| # | Check | Result |
|---|---|---|
| 1 | First run asks for the mic; a refusal shows help; manual input still works | **Simulated: passes.** Refusal from a fake engine shows the help and the paste box works. Real permission prompt: to do on each device. |
| 2 | 20 min of a YouTube panel from a laptop speaker, tablet 50 cm away: readable transcript, ≥ 3 analysis updates | **Not run.** Needs a real device and the API key. |
| 3 | Same in Romanian | **Not run.** As above. Romanian support per browser is unverified. |
| 4 | Airplane mode 30 s mid-session: reconnecting shows, listening resumes | **Partly simulated: passes.** Offline banner, analysis pause and resume tested in Chromium; the engine's back-off and gap marking are unit-tested. Real engine: to do. |
| 5 | Reload mid-session: resume prompt, content intact | **Passes** (end-to-end test). |
| 6 | Pin survives resolution; dismissed never returns | **Passes** (end-to-end, with a mocked model that drops the pinned flag and re-raises the dismissed one under a new id). |
| 7 | Copy notes, paste into a doc, structure intact | **Passes up to the clipboard** (content checked). Pasting into a real document: to do. |
| 8 | Wrong passcode: analysis refused, transcript still works | **Passes** (end-to-end). |

Run 1–4 on Chrome desktop, Chrome on an Android tablet and Safari on iPad. On iPad, use a Safari tab, not a Home Screen icon (`docs/05-setup-guide.md`).

### What to configure in Vercel

Step by step in `docs/05-setup-guide.md`. In short:

1. Vercel → **Add New → Project** → import the repository. Keep the detected settings (framework Vite, build `npm run build`, output `dist`). The Node version comes from `package.json` (24.x).
2. **Settings → Environment Variables:**

   | Name | Value | Required |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | your key from the Claude Console | yes |
   | `APP_PASSCODE` | a long phrase only you know | yes |
   | `ANALYSIS_MODEL` | `claude-sonnet-5-5` | no (this is the default) |
   | `MAX_CALLS_PER_SESSION` | `150` | no (default 150) |
   | `ANALYSIS_EFFORT` | `medium` | no; `low` is faster |
   | `ANALYSIS_THINKING` | `adaptive` | no; `minimal` is faster |

3. **Deployments → Redeploy** so the values are picked up.
4. In GitHub: **Settings → Secrets and variables → Actions** → secret `ANTHROPIC_API_KEY`, for the **Eval** workflow.
5. Set a monthly spend limit in the Claude Console. It is the real cost guard; the in-app cap is per meeting and per device.

## Development

Requirements: Node 22 or 24, npm.

```bash
npm install
cp .env.example .env      # fill in APP_PASSCODE, and ANTHROPIC_API_KEY for analysis
npm run dev               # http://localhost:5173, UI and /api together, no Vercel login needed
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with the `/api` routes mounted (ADR-13) |
| `npm run dev:vercel` | The same through `vercel dev` (needs the Vercel CLI and a linked project) |
| `npm run lint` | ESLint and Prettier check |
| `npm run typecheck` | TypeScript, strict |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Playwright end-to-end tests (fake speech engine, mocked analysis) at 1280 and 768 px, layout at 400 px, and the production build under the production CSP |
| `npm run eval` | Prompt evaluation, needs `ANTHROPIC_API_KEY` (see `docs/eval-log.md`); `npm run eval -- --mock` checks the plumbing without a key |

CI runs lint, typecheck, unit tests, the mock eval, the build and the end-to-end tests on every pull request.
