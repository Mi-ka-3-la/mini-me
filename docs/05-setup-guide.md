# 05 — Setup guide (for Mihaela)

These are the steps only you can do, because they involve your accounts, payments and secret keys. Claude Code writes the code. You create the accounts and paste the keys into Vercel. **Never paste a key into a chat, a GitHub file or an issue.**

## Phase 0 — what you need

### 1. GitHub repository
1. Create a new private repository, for example `meeting-copilot`.
2. Copy this whole folder into it: `CLAUDE.md` goes in the root, and `docs/` stays as is.
3. Open Claude Code on this repository and paste the content of `KICKOFF_PROMPT.md`.
4. For the prompt evaluation: repository → **Settings → Secrets and variables → Actions → New repository secret**, name `ANTHROPIC_API_KEY`, value the key from step 2. The `Eval` workflow (tab **Actions**) uses it. GitHub never shows the value again, not even to Claude Code.

### 2. Anthropic API key (for the analysis)
1. Go to the Claude Console (console.anthropic.com) and sign in, or create an account.
2. Add billing and set a **monthly spend limit**, for example a small amount while testing.
3. Create an API key named `meeting-copilot`. Copy it once. It is shown only once.
4. Keep it somewhere safe, such as your password manager, until step 4.

The API is billed separately from a Claude.ai subscription. Check the current per-token prices on the Anthropic pricing page before testing. Each analysis call sends up to ~15 minutes of transcript plus the previous state, so expect tens of calls per hour of meeting.

### 3. Vercel account (hosting)
1. Sign up at vercel.com with your GitHub account.
2. **Add New → Project →** import the `meeting-copilot` repository. Keep the default settings, which Claude Code configured in `vercel.json` (framework Vite, build `npm run build`, output `dist`). The Node version is taken from `package.json`.

### 4. Environment variables (in Vercel)
Project → **Settings → Environment Variables**. Add:

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | the key from step 2 |
| `APP_PASSCODE` | a long phrase only you know, e.g. 4 random words |
| `ANALYSIS_MODEL` | `claude-sonnet-5-5` |
| `MAX_CALLS_PER_SESSION` | `150` |
| `ANALYSIS_EFFORT` (optional) | `medium`; `low` is faster, `high` deeper |
| `ANALYSIS_THINKING` (optional) | `adaptive`; `minimal` is faster |

Then **Deployments → Redeploy** so the new values are picked up.

### 5. First run
1. Open the production URL that Vercel shows, on your tablet.
2. Enter the passcode.
3. Allow the microphone when asked.
4. On iPad, keep using it in a Safari tab. Speech recognition is reported to fail in web apps started from the Home Screen, so do not use **Add to Home Screen** there until it is tested. Safari's speech recognition is reported to need Siri and Dictation turned on in Settings (not verified; if the app says it cannot transcribe on iPad, check these first). On Android, Chrome menu → Add to Home screen is fine.
5. Test with a video playing from the laptop before using it in a real meeting.

## Phase 1 — added steps

### 6. AssemblyAI (cloud transcription with speakers)
Only after the Phase 0 decision gate and spike T1.0 confirm it.
1. Create an account at assemblyai.com, add billing, copy the API key.
2. Add `ASSEMBLYAI_API_KEY` in Vercel and redeploy.
3. Check the current per-minute streaming price, with and without speaker labels, on their pricing page.

## Good practice

- Tell meeting participants the meeting is being transcribed.
- In Phase 0 the audio goes to the browser's speech service: Google for Chrome, Apple for Safari, Microsoft for Edge. Count that third party in the client-policy check below.
- For client meetings, check whether the client contract or Yopeso policy allows sending meeting content to third-party AI services. Some engagements forbid it.
- Rotate the API keys if you ever suspect they leaked. Create a new one, update Vercel, delete the old one.
