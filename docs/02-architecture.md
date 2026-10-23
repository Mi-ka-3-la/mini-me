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
| Frontend | Vite + React 18 + TypeScript | Small, fast and well known. Claude Code works well with it. |
| Styling | Plain CSS with design tokens (CSS variables), light and dark | Matches the prototype. No UI library needed. |
| State | React state + a small store (Zustand) | Transcript, speakers, analysis state and UI flags are shared across three columns. |
| Server | Vercel serverless functions in `/api` (Node 20, TypeScript) | Same repo, free tier, HTTPS by default. HTTPS is required for microphone access. |
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
  id: string;          // stable; model reuses it, or the client assigns f-<n>
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
- User context (US-06), speaker map, and the list of dismissed flag quotes (so they are not raised again).

**Output handling** (`mergeFlags.ts`):
- Flags with an id that already exists: update the text, keep the client `status` and `firstSeenAt`.
- New flags: append them with `firstSeenAt = now` and a brief highlight.
- Active flags missing from the output: remove them (the model judged them resolved). **Pinned and asked flags are never removed by the model.**
- A flag whose normalized quote matches a dismissed flag: drop it.

**Cost controls:** count calls per session and show the count. Hard cap per session through `MAX_CALLS_PER_SESSION` (default 150), after which only manual **Analyze now** works. Model is configurable.

## 6. `/api/analyze` contract

Request:
```json
{
  "language": "ro-RO",
  "context": "string, ≤ 2000 chars",
  "speakers": {"A": "Client PM", "B": "Speaker B"},
  "previous": { "tldr": "...", "topics": [], "flags": [{"id":"f-3","type":"trap","title":"...","quote":"...","why":"...","ask":"...","who":"..."}] },
  "dismissedQuotes": ["..."],
  "transcript": "[12:03] Client PM: ...\n[12:10] Speaker B: ...",
  "transcriptTrimmed": true
}
```
Header: `x-app-passcode: <passcode>`.

Response 200: `AnalysisState` without the client-only fields.
Errors: `401` wrong passcode, `413` input too large, `429` rate limited (pass through `retry-after`), `502` upstream or invalid output. The body is always `{ "error": "<code>", "message": "<human text>" }`.

Server rules:
- Validate the request body with zod, and reject anything over 200 KB.
- Get structured output by **forcing a tool call**. Define one tool `report_analysis` whose `input_schema` is the AnalysisState JSON schema, and set `tool_choice: {type: "tool", name: "report_analysis"}`. Read `tool_use.input`. This is more reliable than parsing free text. Claude Code should check the current Anthropic docs for a native structured-output option and use it if available.
- Validate the model output with zod. On failure, retry once with the validation error appended. If it fails again, return 502.
- `max_tokens`: 4000. Timeout: 60 s.
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
- Rate limit per IP on `/api/*`: 30 req/min, in memory, best effort.
- CORS: same origin only.
- CSP: default-src 'self'. connect-src 'self' plus the STT WebSocket host.
- No transcript in server logs, no analytics SDKs.
- `.env` is never committed. `.env.example` lists the variable names only.

## 9. Environment variables

| Name | Phase | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | 0 | LLM calls |
| `APP_PASSCODE` | 0 | Gate for all API routes |
| `ANALYSIS_MODEL` | 0 | Default `claude-sonnet-5-5`. Can be switched to `claude-haiku-5-5` (faster, cheaper) or `claude-opus-5-5` (deeper). |
| `MAX_CALLS_PER_SESSION` | 0 | Default 150 |
| `ASSEMBLYAI_API_KEY` | 1 | STT token minting |
