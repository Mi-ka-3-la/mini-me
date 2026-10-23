# 02 — Architecture

## 1. Overview

```
┌──────────────────────────── Browser (tablet / laptop) ────────────────────────────┐
│                                                                                   │
│  Audio source ──► Transcriber ──► Transcript store ──► Analysis scheduler          │
│  (mic; Phase 2:   (Phase 0: Web    (final lines,       (decides WHEN to analyze)   │
│   + tab audio)     Speech API;      interim line,              │                  │
│                    Phase 1: cloud   speakers)                  ▼                  │
│                    STT over WS)                         POST /api/analyze ───┐     │
│                                                                 ▲            │     │
│  UI: Transcript │ Summary │ Watch list  ◄── Analysis state ◄────┘            │     │
│                                                                              │     │
└──────────────────────────────────────────────────────────────────────────────┼─────┘
                                                                               │
┌──────────────────── Server (Vercel serverless functions) ────────────────────┼─────┐
│  /api/analyze    → checks passcode → calls Anthropic Messages API ◄──────────┘     │
│  /api/stt-token  → checks passcode → gets a short-lived STT token (Phase 1)        │
│  Holds: ANTHROPIC_API_KEY, STT_API_KEY, APP_PASSCODE (env vars). Stores nothing.   │
└────────────────────────────────────────────────────────────────────────────────────┘
```

The browser does the listening and the display. The server exists for one reason: API keys must not reach the browser. Anyone who opens a page can read whatever the page contains. A key in the page could be copied and used at the owner's expense.

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Vite + React 19 + TypeScript (see ADR-6) | Small, fast and well known. Claude Code works well with it. |
| Styling | Plain CSS with design tokens (CSS variables), light and dark | Matches the prototype. No UI library needed. |
| State | React state + a small store (Zustand) | Transcript, speakers, analysis state and UI flags are shared across three columns. |
| Server | Vercel serverless functions in `/api` (Node 24, TypeScript; see ADR-6) | Same repo, free tier, HTTPS by default. HTTPS is required for microphone access. |
| LLM | Anthropic Messages API via `@anthropic-ai/sdk` | Model set by env var `ANALYSIS_MODEL`. Default: `claude-sonnet-5-5`. |
| STT Phase 0 | Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) | Free, no account, no server. Quality and browser support vary (R2). |
| STT Phase 1 | AssemblyAI Streaming v3 with `speaker_labels: true` | Streaming diarization exists, and Romanian is listed for real-time on its language page. Must be verified in spike T1.0 before committing. |
| Tests | Vitest (unit), Playwright (one smoke test) | |
| Lint and format | ESLint + Prettier | |

### Decision records

- **ADR-1: Web app, not native.** One codebase runs on laptop, tablet and phone. Trade-off: a native app could not capture call audio on tablets either, so nothing is lost there. On desktop, Granola-style system-audio capture is only partly matched, through tab audio in Phase 2.
- **ADR-2: Server-side LLM calls with a passcode.** The keys stay safe, and a stranger who finds the URL cannot spend money.
- **ADR-3: Analysis returns the full state, not diffs.** Each call gets the previous state plus the transcript and returns the complete updated state. This is simpler and self-healing: a bad update is corrected by the next one. Cost is controlled by the transcript window (§5).
- **ADR-4: Stable flag ids.** The model must reuse ids for flags it keeps. The client also matches on normalized quote text as a fallback, so the UI does not flicker.
- **ADR-5: Phase 0 uses the browser speech engine.** This validates the product question ("does the watch list help in real meetings?") before paying for STT or solving speakers.

## 3. Repository structure

```
/
├─ CLAUDE.md
├─ README.md
├─ docs/                      ← this planning package
├─ api/
│  ├─ analyze.ts              ← POST: passcode check → Anthropic call → JSON
│  ├─ stt-token.ts            ← POST: passcode check → STT temp token (Phase 1)
│  └─ _lib/
│     ├─ auth.ts              ← constant-time passcode compare
│     ├─ prompt.ts            ← builds the analysis prompt (see 04)
│     └─ schema.ts            ← zod schema of AnalysisState
├─ src/
│  ├─ main.tsx, App.tsx
│  ├─ styles/tokens.css
│  ├─ audio/
│  │  ├─ transcriber.ts       ← interface Transcriber { start, stop, on(event) }
│  │  ├─ webSpeech.ts         ← Phase 0 implementation
│  │  ├─ assemblyStream.ts    ← Phase 1 implementation
│  │  ├─ pcmWorklet.ts        ← Phase 1: AudioWorklet → 16 kHz PCM16
│  │  └─ tabCapture.ts        ← Phase 2: getDisplayMedia audio
│  ├─ analysis/
│  │  ├─ scheduler.ts         ← trigger rules (§5)
│  │  ├─ client.ts            ← calls /api/analyze, abort, error mapping
│  │  └─ mergeFlags.ts        ← stable ids, pin/dismiss/asked rules
│  ├─ store/session.ts        ← Zustand store
│  ├─ components/
│  │  ├─ TopBar.tsx, StartPanel.tsx, PasscodeGate.tsx
│  │  ├─ TranscriptColumn.tsx, SummaryColumn.tsx, WatchList.tsx, FlagCard.tsx
│  │  └─ SpeakerChip.tsx, ExportDialog.tsx
│  └─ lib/export.ts, lib/time.ts, lib/storage.ts
├─ tests/
└─ vercel.json, package.json, tsconfig.json, .env.example
```

## 4. Data model

```ts
type Speaker = { id: string; label: string; source: 'mic' | 'tab' | 'diarized' | 'manual' };

type Line = {
  id: string;            // ulid
  t: number;             // ms since session start
  speakerId?: string;    // undefined in Phase 0
  text: string;
  final: true;
  origin: 'stt' | 'manual';
};

type Interim = { text: string; speakerId?: string } | null;

type Topic = {
  topic: string;
  points: string[];
  decisions: string[];
  actions: string[];   // "Owner — action" only if the owner was named
  open: string[];
};

type FlagType = 'trap' | 'logic' | 'question';

type Flag = {
  id: string;          // stable; model reuses it, or the server assigns a random f-xxxxxxxx (ADR-7)
  type: FlagType;
  title: string;
  quote: string;       // verbatim, ≤ 25 words
  why: string;
  ask: string;
  who?: string;
  firstSeenAt: number;   // client-side
  status: 'active' | 'pinned' | 'dismissed' | 'asked';   // client-side only
};

type AnalysisState = { tldr: string; topics: Topic[]; flags: Flag[] };

type Session = {
  id: string;
  startedAt: number;
  language: 'en-US' | 'ro-RO';
  context: string;
  lines: Line[];
  interim: Interim;
  speakers: Record<string, Speaker>;
  analysis: AnalysisState | null;
  analyzedUpToLineIndex: number;
  analysisCalls: number;
};
```

**Persistence.** The session is saved to `localStorage` under `mc.session.current`, debounced at 2 s. It is restored on reload with a "Resume meeting?" prompt. **New meeting** clears it. Every storage access is wrapped in try/catch.

## 5. Analysis scheduling (the important part)

The scheduler decides when to call `/api/analyze`. Too often costs money and makes the flags jumpy. Too rarely and the flag arrives after the moment has passed.

**Trigger:** a call starts when **all** of these hold:
1. No analysis call is currently running.
2. At least **N_MIN_WORDS = 60** new final words since the last call.
3. And either **≥ N_WORDS = 150** new words, **or ≥ T_MAX = 45 s** since the last call, **or** the user pressed **Analyze now**.

If new words arrive while a call is running, set `pending = true`. When the call ends, re-check the trigger.

**Input window:**
- Previous `AnalysisState`, which carries the meeting so far in compressed form.
- The **last 15 minutes** of transcript, or the last ~12 000 characters if shorter. Older text is represented only by the previous state.
- User context (US-06), speaker map, the list of dismissed flag quotes, and the list of flags already asked (so neither is raised again). `previous.flags` holds active and pinned flags only (ADR-8).

**Output handling** (`mergeFlags.ts`):
- Flags with an id that already exists: update the text, keep the client `status` and `firstSeenAt`.
- New flags: append them with `firstSeenAt = now` and a brief highlight.
- Active flags missing from the output: remove them (the model judged them resolved). **Pinned and asked flags are never removed by the model.**
- A flag whose normalized quote matches a dismissed flag: drop it.

**Cost controls:** count calls per session and show the count. Cap per session through `MAX_CALLS_PER_SESSION` (default 150), after which only manual **Analyze now** works. The cap is enforced in the browser, which is the only place that knows the session; the value comes from `GET /api/config` (ADR-9). Model is configurable.

## 6. `/api/analyze` contract

Request:
```json
{
  "language": "ro-RO",
  "context": "string, ≤ 2000 chars",
  "speakers": {"A": "Client PM", "B": "Speaker B"},
  "previous": { "tldr": "...", "topics": [], "flags": [{"id":"f-3","type":"trap","title":"...","quote":"...","why":"...","ask":"...","who":"..."}] },
  "dismissedQuotes": ["..."],
  "askedFlags": [{"title":"...","quote":"..."}],
  "transcript": "[12:03] Client PM: ...\n[12:10] Speaker B: ...",
  "transcriptTrimmed": true
}
```
Header: `x-app-passcode: <passcode>`.

Response 200: `AnalysisState` without the client-only fields.
Errors: `400 bad_request` invalid body, `401 unauthorized` wrong passcode, `413 too_large` input too large, `429 rate_limited` (pass through `retry-after`), `500 server_misconfigured` env var missing, `502 upstream_error` / `upstream_overloaded` / `invalid_output`, `504 upstream_timeout`. The body is always `{ "error": "<code>", "message": "<human text>" }`.

Server rules:
- Validate the request body with zod, and reject anything over 200 KB.
- Get structured output with the native **JSON outputs** feature: `output_config.format = {type: "json_schema", schema}` (GA, verified 23 Oct 2026, ADR-10). The schema cannot carry `maxItems`, so the 12-flag cap is enforced on the server.
- Validate the model output with zod. On failure, retry once with the validation error appended. If it fails again, return 502.
- `max_tokens`: 8000, because thinking tokens count toward it (ADR-18). Time budget: 50 s for the first attempt; the retry runs only if at least 20 s of a 75 s total budget remain. `maxDuration` of the function: 90 s. SDK automatic retries are off, so the budget is ours.
- Log only timing, token counts and error codes. **Never log transcript content.**

## 7. Transcriber interface

```ts
interface Transcriber {
  start(opts: { language: 'en-US' | 'ro-RO'; deviceId?: string }): Promise<void>;
  stop(): Promise<void>;
  on(ev: 'interim', cb: (i: { text: string; speakerId?: string }) => void): void;
  on(ev: 'final', cb: (l: { text: string; speakerId?: string; t: number }) => void): void;
  on(ev: 'status', cb: (s: 'listening' | 'reconnecting' | 'stopped' | 'error', detail?: string) => void): void;
}
```

### Phase 0: `webSpeech.ts`
- `continuous = true`, `interimResults = true`, `lang` from the session.
- Browsers end recognition sessions on their own after silence or a time limit. On `onend` while the user has not pressed Stop, restart after 250 ms. Back off up to 5 s on repeated errors.
- `onerror` `not-allowed` / `service-not-allowed`: stop and show the permission help. `network`: reconnecting status. `no-speech`: ignore and restart.
- Web Speech always uses the default microphone, so `deviceId` is ignored in Phase 0.
- Hold a Screen Wake Lock while listening (ADR-16). On iOS, recognition dies when the page goes to the background; on `visibilitychange` back to visible, restart.
- Feature-detect `window.SpeechRecognition || window.webkitSpeechRecognition`. If absent, show "This browser cannot transcribe. Use Chrome or Edge, or paste captions." and keep manual input.
- One language per session. Mixed RO/EN speech will be transcribed poorly. This is a known limit, and the UI says so near the language picker.

### Phase 1: `assemblyStream.ts`
- `getUserMedia({audio: {echoCancellation: false, noiseSuppression: true, autoGainControl: true}})`. Echo cancellation is off because the tablet must hear the laptop speaker, not cancel it. Verify on device in T1.0.
- AudioWorklet downsamples to 16 kHz mono PCM16 and sends ~50 ms frames over WebSocket.
- Token flow: `POST /api/stt-token` → server calls the AssemblyAI token endpoint (`https://streaming.assemblyai.com/v3/token`, `expires_in_seconds` ≤ 600) → browser opens the v3 WebSocket with `token`, `speech_model`, `sample_rate=16000`, `speaker_labels=true`, `max_speakers` (user-set, default 6).
- Map `Turn` events to lines, using `speaker_label` (A, B, …; `PENDING` → keep as interim). Apply `SpeakerRevision` messages to past lines.
- Client timer ends the session before `max_session_duration_seconds`, then opens a new one seamlessly.
- Check the exact parameter names, the token endpoint method (docs show both GET and POST) and the model id for Romanian against current AssemblyAI docs in spike T1.0.

### Phase 2: `tabCapture.ts` (desktop Chrome/Edge only)
- `getDisplayMedia({video: true, audio: true})`. The user picks the meeting tab and ticks "Share tab audio". Discard the video track.
- Run **two** transcription streams: mic → speaker "Me" (no diarization), tab → diarized "Others A/B/C". Merge by timestamp.
- Hide this option on devices where `getDisplayMedia` is missing (all tablets and phones).

## 8. Security

- `APP_PASSCODE` is checked with a constant-time compare on every API call. The browser keeps it in `localStorage` and sends it as a header.
- Rate limit per IP on `/api/*`: 30 req/min, in memory, best effort. Each serverless instance has its own memory, so this only slows a single burst; the real protections are the passcode and the spend limit in the Claude Console (ADR-11).
- CORS: same origin only.
- CSP: default-src 'self'. connect-src 'self' plus the STT WebSocket host (Phase 1). Fonts are bundled with the app (`@fontsource`), so no font host is needed (ADR-12).
- No transcript in server logs, no analytics SDKs.
- `.env` is never committed. `.env.example` lists the variable names only.

## 9. Environment variables

| Name | Phase | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | 0 | LLM calls |
| `APP_PASSCODE` | 0 | Gate for all API routes |
| `ANALYSIS_MODEL` | 0 | Default `claude-sonnet-5-5`. Can be switched to `claude-haiku-5-5` (faster, cheaper) or `claude-opus-5-5` (deeper). |
| `MAX_CALLS_PER_SESSION` | 0 | Default 150. Read by `/api/config` and enforced in the browser. |
| `ANALYSIS_EFFORT` | 0 | `low`, `medium` (default) or `high`. Lower is faster (ADR-18). |
| `WATCH_MODEL`, `WATCH_EFFORT`, `WATCH_THINKING` | 0 | Optional settings for the watch call (ADR-19). Default: the `ANALYSIS_*` values. |
| `ANALYSIS_THINKING` | 0 | `adaptive` (default) or `minimal`. `minimal` turns up-front thinking off where the model allows it (ADR-18). |
| `RATE_LIMIT_PER_MIN` | 0 | Optional. Overrides the 30 requests/min per IP. Only the end-to-end tests set it. |
| `ASSEMBLYAI_API_KEY` | 1 | STT token minting |

## 10. Decision records added at the Phase 0 plan check (23 Oct 2026)

- **ADR-6: React 19 and Node 24.** Vercel deprecated Node 20 on 1 Oct 2026 and offers 24.x (default) and 22.x (vercel.com/docs/functions/runtimes/node-js/node-js-versions). React 19 is the current major. Nothing in the spec depends on React 18.
- **ADR-7: Random flag ids on the server.** The server is stateless, so a counter `f-<n>` can only be derived from `previous`. Dismissed flags are not in `previous`, so a counter could reissue a dismissed id, and the client would then hide a new flag. Ids are `f-` plus 8 random characters. On merge, a known id that arrives with a quote that does not match its old quote is treated as a new flag.
- **ADR-8: Asked flags go in their own list.** `previous.flags` holds active and pinned flags. Asked flags are sent as `askedFlags` (title and quote) with the rule "do not raise again". The 12-flag cap applies to what the model returns; pinned flags the model drops stay on screen.
- **ADR-9: The call cap lives in the browser.** The server stores nothing, so it cannot count calls per session, and Vite exposes only `VITE_` variables to the browser. `GET /api/config` (passcode-protected) returns `maxCallsPerSession`. This is a cost guard, not a security control.
- **ADR-10: JSON outputs instead of a forced tool call.** Anthropic offers native structured output, `output_config.format` with `type: "json_schema"`, GA on the 5.5 models. Constraints: `additionalProperties: false` on every object, no `maxItems`, `minItems` only 0 or 1. Output is still validated with zod; `stop_reason` `max_tokens` or `refusal` counts as invalid output and gets the one retry.
- **ADR-11: Best-effort rate limit.** Kept as specified, with the limitation stated in §8.
- **ADR-12: Bundled fonts.** The prototype loads Google Fonts; a strict CSP blocks them. Bricolage Grotesque, IBM Plex Sans and IBM Plex Mono are bundled via `@fontsource`.
- **ADR-13: Local dev without a Vercel account.** `npm run dev` runs Vite with the `/api` handlers mounted as middleware, so it works without logging in to Vercel and in CI. `npm run dev:vercel` runs `vercel dev` for a faithful check.
- **ADR-14: Handlers are plain functions.** Each route is a function `(request) -> response` in `api/_lib/`, wrapped by a thin Vercel adapter in `api/*.ts` and by the dev middleware. This keeps them unit-testable and lets `npm run eval` call the analysis directly, without a server.
- **ADR-15: Passcode check endpoint.** `GET /api/ping` validates the passcode at entry. The passcode screen offers "Continue without analysis", so transcription works without a valid code (checklist item 8). A later 401 shows a banner; transcription continues.
- **ADR-16: Screen wake lock.** While listening, the app holds a Screen Wake Lock so the tablet does not lock and stop recognition. If the browser does not support it, the start panel says so.
- **ADR-17: Romanian-aware quote normalization.** Before any quote comparison: Unicode NFD, remove combining marks, map ş/ș to s and ţ/ț to t, lowercase, strip punctuation, collapse whitespace. "Token overlap ≥ 0.85" means: the share of the quote's tokens found, in order-insensitive form, inside some window of the transcript of the same length (±2 tokens).
- **ADR-18: Thinking, effort and no forced tool call (added in T0.8).** On the 5.5 models thinking is on by default (adaptive) and its tokens count toward `max_tokens`, so `max_tokens` is 8000 instead of 4000. Sonnet 5.5 rejects forced tool use (`tool_choice` `tool` or `any`), which confirms ADR-10. Non-default `temperature` is rejected, so the eval cannot pin it and results vary from run to run. Effort defaults to `high` on Sonnet 5.5; the app sends `medium` by default (`ANALYSIS_EFFORT`), the level the docs suggest for latency-sensitive work. `ANALYSIS_THINKING=minimal` sends `between_tools` on Sonnet and `disabled` on Haiku. The eval compares these settings before the defaults are fixed.
- **ADR-19: Two calls instead of one (added after the first real eval).** The first eval measured 20–35 s per call against a 15 s target, and lowering thinking did not help: each call wrote the whole state, about 3 000 output tokens, and output length is what takes the time and most of the cost. The analysis is now split by how fast each part is read:
  - **watch** (about once a minute, same trigger as §5): the model returns only changes to the watch list (`add`, `update`, `drop`). The server applies them to the current list, checks every new quote, and returns the full updated list, so the browser merge is unchanged. The prompt gets the lines since the last watch call as NEW TRANSCRIPT and up to 6 000 characters of earlier context.
  - **summary** (first at 150 words, then every 3 minutes with at least 60 new words, or on Analyze now): returns `tldr` and `topics` only.
  The two run independently, one of each at a time. `WATCH_MODEL`, `WATCH_EFFORT` and `WATCH_THINKING` can differ from the summary settings (default: the same). Over the cap, the oldest unpinned flag is removed first. Two prompt rules were added from the eval: replace the weakest flag when the list is full, and a statement that already names its owner, date, source or evidence is not a flag. The newest flag shows as an "Ask now" card; other cards show the title and the question, with "why" one tap away. The request gains `mode`, `newTranscript` and `pinnedIds`; a watch response is `{ flags }`, a summary response is `{ tldr, topics }`.
- **ADR-20: Questions and tap-to-answer (requested by Mihaela after the first eval).** The watch call also lists real questions asked in the new transcript (quote plus a clear rewrite), checked against the transcript and against questions already reported. They appear in the third column under **Questions**. Nothing is answered automatically: when the listener taps **Answer**, an `answer` call (fast watch settings) returns the question restated, any trap in it named, a headline, and 3–5 short steps, shown as a numbered chain that can be read at a glance. The call uses an optional **My background** text, stored only on the device, so answers draw on the listener's real experience and never invent it. Each answer counts toward the per-meeting call counter. Questions and answers are included in the exported notes.
- **ADR-21: Topic threads, Important markers, open and answered questions, and a simulation (requested by Mihaela).** Columns read well but break the links a listener makes between them. Colour is processed before reading, so the link is a colour per topic: the watch call tags each flag and question with a topic (reusing names from `knownTopics`) and returns `segments` ("from mm:ss, the talk is about X"). The summary reuses the same names. The browser keeps the topics in first-appearance order and gives each one of six colours. That colour appears as a bar on transcript lines, on the summary topic, and as a dot on flags and questions. A new neutral flag type **important** marks decisions, dates, numbers and commitments; it has its own cap of 8, so markers never push problems off the list, and the eval does not score it. Questions are **open** until the watch call reports an answer from `openQuestions`, grounded in the transcript; then they show **answered**, with the time and the words. **Menu → Simulate a meeting** plays a sample conversation into the transcript word by word at 1×, 2× or 4×, through the real analysis, so the whole flow can be watched without a microphone. Lines with tap-to-follow across columns are the planned next step.
- **ADR-22: Simulate with your own transcript (requested by Mihaela).** The sample conversations are fictional, so they cannot show how the app would have helped in a meeting that really happened. The simulation dialog gains **My own transcript**: paste text or load a .txt file, choose the language, and it plays like the samples. It accepts "[mm:ss] Name: text" lines or plain "Name: text" lines (Granola, Teams and Zoom exports). Without times, long turns are split at sentence ends into pieces of up to 30 words and timed at 2.5 words per second, so captions arrive as they would live. A label counts as a speaker only if it has up to four words. The text is never bundled or committed; it lives only in the browser session, like a live meeting, and goes to the analysis the same way.
