# 06 — Risks, open questions and verified facts

## 1. Risks

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Tablets and phones cannot capture another app's call audio, so the app hears only the room mic. | Certain (OS restriction) | Medium | Second-screen setup: meeting on the laptop speaker, tablet listening. Desktop tab capture in Phase 2. |
| R2 | Browser speech recognition (Phase 0) varies by browser. It may not support Romanian everywhere, stops on its own, and in Chromium sends audio to the browser vendor's cloud. | High | Medium | Auto-restart. Feature detection with a clear fallback. Phase 1 replaces it. Test matrix in the Phase 0 checklist. |
| R3 | Speaker separation through one mic in a room is imperfect: similar voices merge, overlapping speech is lost. | High | Medium | Rename UI. `max_speakers` set by the user. Phase 2 "Me" stream. Phase 3 caption names. |
| R4 | The watch list is noisy or misses the point, and the user stops looking at it. | Medium | High | Grounding check. Cap. Evaluation set. Dismiss feedback loop. Phase 0 decision gate. |
| R5 | Cost grows with long meetings. | Medium | Low–Medium | Trigger thresholds. Transcript window. Call cap. Visible counters. Model switch. |
| R6 | Mixed Romanian/English speech in one meeting is transcribed poorly. | Medium | Medium | One language per session in Phase 0. Test multilingual models in the T1.0 spike. |
| R7 | Laptop speaker echo cancellation: if the tablet mic applies echo cancellation, it may suppress what it should hear. | Low–Medium | Medium | `echoCancellation: false` in Phase 1. Test on device in T1.0. |
| R8 | Confidentiality: client meeting content goes to third-party APIs. | Depends on engagement | High | Policy check (setup guide). No storage server-side. No content logging. |
| R9 | Teams/Meet caption DOM changes break the Phase 3 extension. | High over time | Low (optional feature) | Keep it optional. Isolate selectors in one file. Add a health check. |

## 2. Open questions (for Mihaela)

| ID | Question | Needed by |
|---|---|---|
| Q1 | Are most meetings in English, Romanian, or mixed within the same meeting? | Phase 0 language UI; Phase 1 model choice |
| Q2 | Will client meetings (e.g. for Permira or PwC work) be used with this? If so, is sending content to Anthropic/AssemblyAI allowed? | Before first client use |
| Q3 | Monthly budget ceiling for API costs. | Phase 0 deploy |
| Q4 | Is a short history of past meetings wanted (local only)? | After Phase 1 |
| Q5 | Should notes export straight to Notion or ClickUp later? | After Phase 1 |

## 3. Facts verified during planning (23 Oct 2026)

These were checked against vendor documentation on the planning date. Re-check them in spike T1.0. Vendors change things.

| Fact | Source |
|---|---|
| Granola runs locally with no meeting bot. It captures the microphone plus system audio, and cannot isolate one app. Without speaker tags it labels "Me" (mic) and "Them" (system audio). It shows participant names on Meet, Zoom and Teams. It does not store audio. Capture requires the desktop or mobile app; the web app is view-only. | docs.granola.ai/help-center/taking-notes/transcription |
| Granola is a commercial, closed-source product. Open-source alternatives include Meetily (MIT, Mac/Windows, local Whisper), Hyprnote (open source, Tauri, local transcription and summary), Minutes (MIT, whisper.cpp/Parakeet, pyannote diarization) and Prismical (MIT). None does live reasoning-error detection. | openalternative.co/alternatives/granola; char.com/docs/about/what-is-hyprnote |
| AssemblyAI Streaming supports diarization with `speaker_labels: true`. Turns carry `speaker_label` (A, B, …, or `PENDING`). `SpeakerRevision` messages correct labels. `max_speakers` 1–10. Available on `universal-3-6-pro`, `universal-streaming-english` and `universal-streaming-multilingual`. | assemblyai.com/docs/streaming/streaming-diarization |
| AssemblyAI lists Romanian as supported for real-time with the U-3.6 Pro Realtime model. The multilingual streaming model is not marked for Romanian. | assemblyai.com/languages/romanian |
| AssemblyAI temporary token: `https://streaming.assemblyai.com/v3/token`, `expires_in_seconds` 1–600, `max_session_duration_seconds` 60–10800 (default 3 h). The token is passed as the `token` query param on the WebSocket. Docs prose says POST, examples use GET, so verify. SDK examples use 16 kHz. | assemblyai.com/docs/streaming/authenticate-with-a-temporary-token |
| Deepgram supports diarization in streaming, with numeric speaker ids per word and no names. A July 2026 changelog improved Romanian Nova-3 for batch only. Streaming Romanian is not confirmed. | developers.deepgram.com/docs/diarization; developers.deepgram.com/changelog/2026/7/16 |
| Current Anthropic API model ids: `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`. | platform.claude.com/docs/en/models/overview |
| Web Speech API `SpeechRecognition` has limited browser availability (MDN). Chrome exposes it as `webkitSpeechRecognition`. | developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/continuous |

### Added at the Phase 0 plan check (23 Oct 2026)

| Fact | Source |
|---|---|
| Vercel Functions offer Node 24.x (default) and 22.x. Node 20 was deprecated on 1 Oct 2026. | vercel.com/docs/functions/runtimes/node-js/node-js-versions |
| With Fluid compute, Hobby functions run up to 300 s (default and maximum). Request and response bodies are limited to 4.5 MB. | vercel.com/docs/functions/limitations |
| Anthropic JSON outputs: `output_config.format` with `type: "json_schema"`, GA, supported on `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`. Objects need `additionalProperties: false`. `maxItems` and string length limits are not supported; `minItems` only 0 or 1. `stop_reason` `max_tokens` or `refusal` can return output that does not match the schema. The TypeScript SDK has a `zodOutputFormat` helper. | platform.claude.com/docs/en/build-with-claude/structured-outputs |
| Web Speech `SpeechRecognition` now has `processLocally`, `available()` and `install()` for on-device recognition, and `start()` can take an audio track. Chrome uses a server-based engine by default, so recognition does not work offline. | developer.mozilla.org/docs/Web/API/SpeechRecognition |
| On iOS Safari, `continuous` recognition is unreliable: it stops on its own and the first attempt often fails; recognition dies when the page goes to the background. A developer report says it stops working after "Add to Home Screen" (no official answer). | lilting.ch/en/articles/ios-webspeech-api-tips; developer.apple.com/forums/thread/748048 |

**Still not verified:** Edge's behaviour with `webkitSpeechRecognition`, Romanian availability per browser, whether Android Chrome plays a system sound on each restart. These are covered by the Phase 0 device checklist.

**Not verified, from general knowledge:**
- Android's audio playback capture excludes voice-communication audio, so call audio cannot be captured.
- iPadOS gives no app access to another app's call audio.

Confirm these in T1.0 if a decision depends on them.
