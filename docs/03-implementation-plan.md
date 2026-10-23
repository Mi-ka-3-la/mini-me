# 03 — Implementation plan

Work in phases. Each phase ends with something usable in a real meeting. Do not start a phase until the previous one is merged and Mihaela has tried it. Each task lists the user stories it serves (`US-xx`, from `01-product-spec.md`).

Conventions:
- One branch and one pull request per task group. Branch name: `phase0/T0.3-transcriber`.
- PR description: what changed, which US/AC it covers, how it was tested, screenshots for UI.
- Keep `main` deployable. Vercel deploys previews for every PR.

---

## Phase 0 — Live listening with the browser engine (validate the idea)

**Goal:** Mihaela opens the app on a tablet next to her laptop, presses Start, and during a real meeting sees the transcript, the summary and the watch list fill in.

**Out of Phase 0:** speaker separation, tab audio, extension.

| Task | What | Serves | Done when |
|---|---|---|---|
| T0.1 Scaffold | Vite + React + TS. ESLint, Prettier, Vitest. Vercel config with `/api` functions. `.env.example`. Root README with run instructions. | — | `npm run dev` runs the UI and functions locally (`vercel dev`). CI runs lint + tests on PR. |
| T0.2 Design system | Port the prototype's tokens, fonts, light and dark themes and the three-column layout into `tokens.css` and the column components. Tablet/phone: columns become tabs (Transcript / Summary / Watch list), with a badge for new flags on the Watch list tab. | NFR layout | Matches `docs/reference/prototype.html` at desktop width. Usable at 768 px and 400 px. Both themes readable. |
| T0.3 Passcode gate | `PasscodeGate` screen. `api/_lib/auth.ts`. Passcode stored locally, sent as a header. Sign out. | US-09 | API returns 401 without the passcode. UI shows a clear error on a wrong code. |
| T0.4 Session store | Zustand store per the data model. localStorage persistence plus the "Resume meeting?" prompt. New meeting. | US-01 | Reload mid-meeting restores everything. |
| T0.5 Transcriber (Web Speech) | `transcriber.ts` interface plus `webSpeech.ts`, with auto-restart, error mapping and feature detection. | US-01, US-02 | 30-minute run on Chrome desktop with no manual restart. Interim text visible. Unsupported browser shows the fallback message. |
| T0.6 Start panel and controls | Language picker (EN/RO), Context field, Start/Stop, listening indicator, GDPR reminder line, "Analyze now", call counter. | US-01, US-06 | All AC of US-01 and US-06. |
| T0.7 Transcript column | Lines with timestamps, interim style, auto-scroll with "Jump to live", manual input box with "Name: text" parsing. | US-02, US-05 | AC of US-02 (AC1–AC4, no speakers) and US-05. |
| T0.8 `/api/analyze` | Prompt builder (from `04-analysis-prompt.md`), forced tool call, zod validation and one retry, error contract, no content logging. | US-03, US-04 | Unit tests for prompt building and schema validation. A fixture transcript returns a valid state. |
| T0.9 Scheduler and merge | `scheduler.ts` (§5 of architecture), `client.ts` with abort, `mergeFlags.ts` with stable ids and pin/dismiss/asked. | US-03, US-04 | Unit tests: trigger thresholds, pending re-run, pinned flags survive, dismissed flags never return. |
| T0.10 Summary column | "So far" line plus topics with tagged items. No flicker between updates. | US-03 | AC of US-03. |
| T0.11 Watch list | Flag cards, filters, Pin/Dismiss/Mark asked, "Asked" section collapsed at the bottom, new-flag highlight. | US-04 | AC of US-04. |
| T0.12 Export | Copy notes as Markdown, optional transcript, fallback dialog. | US-07 | AC of US-07. |
| T0.13 Hardening | Rate limit, CSP headers, error states for every API code, offline banner. | NFR | Manual checklist below passes. |
| T0.14 Deploy | Production deploy on Vercel with env vars. Short "How to use" section on the start panel. | — | Mihaela runs one real meeting. |

**Phase 0 manual test checklist** (run on Chrome desktop, Chrome Android tablet and Safari iPad):
1. First run asks for the mic. A refusal shows the help text, and manual input still works.
2. 20 minutes of a YouTube panel discussion played from a laptop speaker, with the tablet 50 cm away: the transcript is readable, and at least 3 analysis updates arrive.
3. Switch the language to Romanian and repeat with a Romanian video.
4. Airplane mode for 30 s mid-session: the reconnecting state shows and listening resumes after.
5. Reload mid-session: the resume prompt appears and the content is intact.
6. Pin a flag, then talk about resolving it: it stays. Dismiss a flag: it never returns.
7. Copy notes and paste them into a doc: structure intact.
8. Wrong passcode: the analysis is refused, and the transcript still works.

**Decision gate after Phase 0** (Mihaela):
- Did the watch list produce at least one useful question per meeting across 3 meetings? If not, tune the prompt (`04`) before building Phase 1.
- Is "who said it" missing badly enough to pay for STT? This decides Phase 1.

---

## Phase 1 — Cloud transcription with speakers

**Goal:** better accuracy, and lines labelled Speaker A/B/C that can be renamed.

| Task | What | Serves | Done when |
|---|---|---|---|
| T1.0 Spike (time-box: 1 day) | Verify against current AssemblyAI docs and a real test: Romanian real-time model id, `speaker_labels` on that model, token endpoint method, audio format, latency from a tablet, and the effect of echoCancellation=false. Write findings to `docs/spikes/T1.0-stt.md`. If AssemblyAI fails on Romanian or speakers, evaluate Deepgram (streaming diarization returns numeric speaker ids) the same way. | — | Written recommendation with measured latency and a sample transcript in EN and RO. |
| T1.1 `/api/stt-token` | Passcode check, then mint a short-lived token. | US-09 | Token works once and expires. The key never reaches the browser. |
| T1.2 PCM worklet | AudioWorklet resample to 16 kHz PCM16, frame batching. | — | Unit test on a synthetic sine wave. Manual listen-back in dev. |
| T1.3 `assemblyStream.ts` | WebSocket client implementing `Transcriber`, turn → line mapping, speaker revisions, session rollover before the max duration. | US-02, US-08 | 60-minute run without gaps over 3 s. |
| T1.4 Engine switch | Setting: "Transcription: Browser (free) / Cloud (speakers)". Default Cloud when configured. | — | Both engines work behind one interface. |
| T1.5 Speakers UI | Speaker chips, rename dialog, colors per speaker, renames applied retroactively and sent to analysis. | US-08 | AC of US-08 (AC1–AC2). |
| T1.6 Cost visibility | Show minutes transcribed this session. | NFR cost | Counter matches the provider dashboard within 5%. |

---

## Phase 2 — Same-laptop mode with "Me" vs "Others" (desktop)

| Task | What | Serves | Done when |
|---|---|---|---|
| T2.1 Tab capture | `getDisplayMedia` audio-only flow with clear instructions ("pick the Teams tab, tick Share tab audio"). | US-08 AC3 | Works in Chrome and Edge with Teams web and Google Meet. |
| T2.2 Dual stream | Mic stream → "Me", tab stream → diarized others. Merged timeline. | US-08 AC3 | Own speech never appears as "Others". |
| T2.3 Echo handling | When the user is not wearing headphones, the mic also hears the others. Detect near-duplicate text across streams within 2 s and keep the tab version. | — | No duplicated lines in a 15-minute test without headphones. |

---

## Phase 3 — Names from meeting captions (optional)

| Task | What | Done when |
|---|---|---|
| T3.0 Spike | Check whether Teams web and Google Meet live captions expose speaker name plus text in the page DOM in a stable way. Record selectors and how often they change. | Go / no-go written. |
| T3.1 Chrome extension | Content script reads captions in the meeting tab and posts `{name, text, t}` to the Copilot tab (via `chrome.runtime` messaging, or a localhost/broadcast channel if same origin is not possible). | Names appear on lines in Copilot. |
| T3.2 Fusion | Use caption names to auto-rename diarized speakers when text overlaps. | Rename happens without user action in a 3-person test. |

---

## Definition of done (every task)

- Code typed (no `any` except at boundaries), linted, formatted.
- Unit tests for logic modules (scheduler, merge, prompt, schema, parsing).
- Works in light and dark theme, at 400 px, 768 px and desktop.
- No transcript text in logs, errors or analytics.
- PR describes the AC covered and how it was tested.
- `docs/` updated if behaviour or a decision changed.
