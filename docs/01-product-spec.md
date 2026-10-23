# 01 — Product specification

## 1. Problem

In a live meeting, the person who needs to react — a BA, a PO, a consultant — is listening, talking and taking notes at the same time. The costly moments slip past:

- someone commits to a date that depends on something nobody owns;
- a risk is dismissed as "a formality";
- a conclusion is drawn from evidence that does not support it;
- a decision is assumed because nobody objected.

Today's AI note-takers (Granola, Otter, Teams Copilot) produce good notes **after** the meeting. By then the moment to ask the question has passed.

## 2. Product goal

While the meeting is running, show the listener **what is being said, what it adds up to, and what to challenge**, early enough that they can still say it out loud.

Success test: in a real meeting, the user asks at least one question they would not have asked otherwise, and that question came from the watch list.

## 3. Users

**Primary user: the active participant.** A BA, PO or consultant who runs or attends requirement, scoping, steering or vendor meetings. They have a laptop with the meeting open and often a tablet nearby. Meetings are held in English and Romanian.

**Not a target (for now):** teams sharing notes, admins, people who want an archive of all meetings.

## 4. Usage setups

| Setup | Where the meeting runs | Where Meeting Copilot runs | What it hears | Who-spoke information |
|---|---|---|---|---|
| A. Second screen (main) | Laptop, on speaker | Tablet or phone browser, next to the laptop | Room audio through the tablet mic | Phase 0: none. Phase 1: Speaker A/B/C by voice, renamable |
| B. Same laptop | Laptop browser (Teams / Meet / Zoom web) | Another tab or window on the same laptop | Phase 0: mic only. Phase 2: mic plus the meeting tab's audio | Phase 2: "Me" vs "Others", plus Speaker A/B/C among the others |
| C. In person | Meeting room | Tablet or phone on the table | Room audio | Same as A |

Why not the same tablet for the meeting and Copilot: iPadOS and Android do not let one app record the call audio of another app. The browser on a tablet cannot capture tab audio either. See `06-risks-and-open-questions.md`, R1.

## 5. Scope by phase

| Capability | Phase 0 | Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|---|
| Live listening from the mic | ✅ browser speech recognition | ✅ cloud streaming STT | ✅ | ✅ |
| Language: English, Romanian | ✅ one chosen per session | ✅ | ✅ | ✅ |
| Speaker separation | ❌ | ✅ by voice (A/B/C) | ✅ plus "Me" vs "Others" | ✅ |
| Rename speakers | ❌ | ✅ | ✅ | ✅ |
| Running summary by topic | ✅ | ✅ | ✅ | ✅ |
| Watch list (traps, logic, questions) | ✅ | ✅ | ✅ | ✅ |
| Paste or type text manually | ✅ | ✅ | ✅ | ✅ |
| Pin, dismiss, mark-asked on flags | ✅ | ✅ | ✅ | ✅ |
| Export notes (Markdown copy) | ✅ | ✅ | ✅ | ✅ |
| Capture the meeting tab's audio (desktop) | ❌ | ❌ | ✅ | ✅ |
| Meeting context (agenda, goal, "what I care about") | ✅ simple text box | ✅ | ✅ | ✅ |
| Names from Teams/Meet captions (Chrome extension) | ❌ | ❌ | ❌ | ✅ |
| History of past meetings | ❌ | ❌ | ❌ | optional |

## 6. User stories and acceptance criteria

IDs are stable. Reference them in commits and pull requests.

### US-01 Start a session
As a user, I open the app, choose the meeting language, optionally type the meeting goal, and press **Start listening**.
- AC1: The browser asks for microphone permission the first time. If permission is refused, the app shows how to allow it and keeps the manual-text option working.
- AC2: A clear recording indicator stays visible while listening. It is a pulsing dot with the text "Listening".
- AC3: Language choices are English (`en-US`) and Romanian (`ro-RO`). The default is the last one used, remembered on the device.
- AC4: **Stop** ends listening. The transcript, summary and watch list stay on screen.

### US-02 See the live transcript
- AC1: Words appear within about 2 seconds of being spoken. Interim (not-yet-final) text is shown in a muted style and replaced when final.
- AC2: Each final line has a meeting-relative timestamp (mm:ss) and, from Phase 1, a speaker label.
- AC3: The view auto-scrolls to the newest line unless the user has scrolled up to read. Then a "Jump to live" button appears.
- AC4: If recognition stops on its own (silence timeout, network), the app restarts it without user action and logs the gap. The user sees "Reconnecting…" for at most a few seconds.

### US-03 Running summary
- AC1: The summary updates automatically during the meeting. Cadence and trigger rules are in `02-architecture.md` §5.
- AC2: It shows a 1–2 sentence "So far" line, then topics. Each topic has points, decisions, actions (with owner only if named), and open items.
- AC3: It never states a decision that no participant agreed to. A proposal stays a proposal.
- AC4: It is written in the meeting's language.
- AC5: Between updates, the previous summary stays visible. There is no flicker and no empty state.

### US-04 Watch list
- AC1: Each flag shows: type (Trap / Logic error / Ask this), short title, the exact quote that triggered it, why it matters (1–2 sentences), one concrete question to say out loud, and the speaker if known.
- AC2: Flags keep a stable id across updates. A flag already on screen does not jump around or change wording unless its content really changed.
- AC3: New flags are highlighted briefly. Newest appears on top.
- AC4: The user can **Pin** (keep, never auto-removed), **Dismiss** (hide, and tell the model not to raise it again), and **Mark asked** (moves it to a done section).
- AC5: Filter chips: All / Traps / Logic errors / Questions.
- AC6: At most 12 active flags. The model drops flags that later discussion resolved, unless they are pinned.

### US-05 Manual input
- AC1: A text box accepts pasted captions or typed notes. Lines in the form "Name: text" keep the speaker name.
- AC2: Manual lines merge into the same transcript with the current timestamp.

### US-06 Meeting context
- AC1: An optional "Context" field holds the meeting goal, agenda, and what the user cares about. Example: "I need a firm go-live date and owner for tax rules".
- AC2: The context is sent with every analysis call and steers what gets flagged.

### US-07 Export
- AC1: **Copy notes** puts Markdown on the clipboard: summary by topic, then the watch list including pinned and asked items. The transcript is optional and controlled by a checkbox.
- AC2: If clipboard access is refused, the text is shown selected in a dialog.

### US-08 Speaker labels (Phase 1+)
- AC1: Speakers appear as "Speaker A", "Speaker B" and so on.
- AC2: Clicking a label lets the user rename it, for example "Client PM". The rename applies to all past and future lines and is used in the analysis.
- AC3: In Phase 2 desktop mode, mic audio is labelled "Me" and never mixed with others.

### US-09 Access protection
- AC1: The deployed app asks for a passcode before it can call any paid API. Without the right passcode, the server refuses the call.
- AC2: The passcode is remembered on the device after first entry, until the user signs out.

## 7. Non-functional requirements

| Area | Requirement |
|---|---|
| Latency | Transcript: under 2 s. Summary and flag refresh: under 15 s after a trigger on the default model. |
| Devices | Latest Chrome or Edge on Windows and macOS. Chrome on Android tablets. Safari on iPadOS. Phase 0 browser support depends on the browser speech engine, see R2. |
| Layout | Usable at tablet portrait width (768 px) and phone width (400 px), with columns stacked as tabs. Light and dark theme. |
| Privacy | No audio is stored anywhere. Transcript and analysis live in the browser tab. A local draft is kept in browser storage to survive a reload. Nothing is kept server-side. |
| Cost | Analysis calls are throttled (§5 of architecture). There is a visible per-session counter of analysis calls. |
| Reliability | A failed analysis never clears what is on screen. The transcript keeps running when analysis fails. |
| Language | UI in English. Analysis output in the meeting's language. |

## 8. Out of scope

- Joining meetings as a bot.
- Storing audio or video.
- Multi-user sharing, accounts, teams.
- Calendar integration.
- Native mobile apps.
- Automatic sending of notes anywhere.

## 9. Legal and ethical note

The app turns other people's speech into text and sends it to third-party services: speech-to-text and the LLM. Under GDPR, participants should be told that the meeting is being transcribed. The app shows a reminder at session start: "Let participants know this meeting is being transcribed." This needs no checkbox, but the reminder must be visible.
