# Meeting Copilot

A browser app that listens to a meeting and, while the meeting is still running, shows three things side by side:

1. **Live transcript** of what is being said.
2. **Running summary**, grouped by topic. Each topic lists key points, decisions, actions and open items. The summary is rebuilt as the meeting moves on.
3. **Watch list** of things the listener should react to now. There are three kinds:
   - **Traps**: hidden risks or commitments, such as a dependency waved away as "a formality" or an issue to "fix after go-live".
   - **Logic errors**: reasoning that does not hold, such as reading silence as approval or treating one past success as proof.
   - **Questions to ask**: the next questions that would close a gap.

The reference point is Granola. Granola is a desktop app that listens through the computer and produces notes afterwards. Meeting Copilot differs in two ways. It works **during** the meeting rather than after it. And it runs in **any modern browser**, including a tablet placed next to the laptop running the call.

## How to use this folder

This folder is the complete planning package. Hand it to Claude Code in the GitHub repository together with the prompt in `KICKOFF_PROMPT.md`.

| File | What it is | Main reader |
|---|---|---|
| `KICKOFF_PROMPT.md` | Prompt to paste into Claude Code to start the build | Mihaela → Claude Code |
| `CLAUDE.md` | Standing rules for Claude Code in this repo. Copy it to the repo root. | Claude Code |
| `docs/01-product-spec.md` | Problem, users, scope, user stories with acceptance criteria | Everyone |
| `docs/02-architecture.md` | Components, data flow, tech stack, security, decisions | Claude Code |
| `docs/03-implementation-plan.md` | Phases 0–3, tasks, definition of done, test plan | Claude Code |
| `docs/04-analysis-prompt.md` | The LLM prompt, output schema, tuning rules | Claude Code, Mihaela |
| `docs/05-setup-guide.md` | Accounts, API keys, deployment steps | Mihaela |
| `docs/06-risks-and-open-questions.md` | Risks, open decisions, verified facts with sources | Everyone |
| `docs/reference/prototype.html` | Working UI prototype. Analysis only, with pasted captions. | Claude Code (visual and behavioural reference) |

## Status

- **Prototype exists**: a claude.ai artifact where captions are pasted by hand and Claude analyzes them. It proves the three-column layout and the analysis prompt. A copy is at `docs/reference/prototype.html`.
- **Next**: Phase 0, a browser app with live listening through the browser's built-in speech recognition. See `docs/03-implementation-plan.md`.

Owner: Mihaela Ilie (Business Analyst / Product Owner).
Planning date: 23 October 2026.
