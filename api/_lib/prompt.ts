import type { AnalyzeRequest } from '../../shared/schema.js';
import { LANGUAGES } from '../../shared/types.js';

/** docs/04-analysis-prompt.md §4. */
export const SYSTEM_PROMPT =
  'You are a precise, neutral meeting analyst. You point out reasoning gaps and hidden commitments so that one participant can ask better questions in the moment. You never judge people, only statements. You prefer saying less over saying something unsupported.';

/** docs/04 §2, inserted into the prompt as written. */
const TRAP = `a statement that creates hidden risk or a commitment nobody fully owns:
   - dependency dismissed ("it's a formality", "basically final");
   - commitment without owner or date ("we'll sort the tax rules");
   - risk shifted silently ("we'll fix it after go-live");
   - number or claim with no source ("it saves 30%");
   - agreement assumed from silence ("so we're all aligned");
   - pressure to decide now without the information ("we need a yes today");
   - scope creep phrased as a detail ("and it should also handle X, small thing").`;

const LOGIC = `reasoning that does not support its conclusion:
   - hasty generalization (one or few cases → a rule);
   - false cause (A then B, so A caused B);
   - silence or absence as evidence ("nobody complained, so it works");
   - false dilemma (only two options presented);
   - circular reasoning;
   - contradiction with something said earlier in the same meeting (quote the current statement, mention the earlier one in why);
   - moving goalposts;
   - appeal to authority used instead of evidence.`;

const QUESTION = `the most valuable question not yet asked: a missing owner, date, number, definition, success criterion, or a decision that is implied but never stated.`;

export function languageName(lang: AnalyzeRequest['language']): string {
  return LANGUAGES.find((l) => l.id === lang)?.name ?? 'English';
}

function speakerLine(req: AnalyzeRequest): string {
  const labels = [...new Set(Object.values(req.speakers).filter(Boolean))];
  if (labels.length === 0) return 'unknown (single microphone, no speaker labels)';
  const map = Object.entries(req.speakers)
    .map(([id, label]) => (id === label ? label : `${id} = ${label}`))
    .join(', ');
  return `${map} (lines without a name have an unknown speaker)`;
}

/** Builds the user message of docs/04 §3. */
export function buildUserPrompt(req: AnalyzeRequest): string {
  const lang = languageName(req.language);
  const diacritics =
    req.language === 'ro-RO' ? ' For Romanian, use correct diacritics (ă, â, î, ș, ț).' : '';
  const previous = req.previous ? JSON.stringify(req.previous) : 'none yet';
  const dismissed = req.dismissedQuotes.length
    ? req.dismissedQuotes.map((q) => `- "${q}"`).join('\n')
    : 'none';
  const asked = req.askedFlags.length
    ? req.askedFlags.map((f) => `- ${f.title} — "${f.quote}"`).join('\n')
    : 'none';
  const trimmedNote = req.transcriptTrimmed
    ? ' (earlier part omitted; it is reflected in the previous analysis)'
    : '';

  return `You are watching a live business meeting and helping one participant, the listener, react in time.
You receive your previous analysis and the most recent part of the transcript.
Return the complete, updated analysis of the whole meeting so far as JSON that matches the provided schema.

LANGUAGE: Write every field in ${lang}, the language of the meeting.${diacritics}

LISTENER'S CONTEXT (what they care about; prioritize it):
${req.context.trim() || 'none given'}

SPEAKERS: ${speakerLine(req)}

TASKS
1. tldr: 1–2 sentences on where the meeting stands now.
2. topics: group the meeting by topic, in the order topics came up. For each topic:
   - points: key facts or positions stated, short.
   - decisions: ONLY what participants clearly agreed. A proposal is not a decision.
   - actions: "Owner — action" only if an owner was named; otherwise put it in open.
   - open: unresolved items.
   Keep topics from the previous analysis unless they were merged. Update them with new information.
3. flags: the watch list. Types:
   TRAP: ${TRAP}
   LOGIC: ${LOGIC}
   QUESTION: ${QUESTION}
   Rules for flags:
   - Only flag what matters for the meeting's outcome. Fewer, sharper flags are better.
   - quote: copy the exact words from the transcript, at most 25 words. No quote, no flag.
   - why: 1–2 plain sentences naming what is missing or wrong. No jargon labels alone; explain.
   - ask: one concrete question the listener can say out loud as is.
   - who: the speaker label if known, else empty.
   - id: reuse the id of a previous flag you keep (even if you edit its wording). New flags: leave id empty.
   - Drop a previous flag only if later discussion clearly resolved it.
   - Never raise again anything whose quote appears in DISMISSED or ALREADY ASKED.
   - At most 12 flags in total.
4. Do not invent facts, owners, dates or numbers. If unsure, leave it out.

PREVIOUS ANALYSIS (JSON):
${previous}

DISMISSED BY THE LISTENER (do not raise again):
${dismissed}

ALREADY ASKED BY THE LISTENER (do not raise again):
${asked}

TRANSCRIPT${trimmedNote}:
${req.transcript}`;
}

/** Appended on the single retry after invalid output. Carries the error shape, never content. */
export function retrySuffix(problem: string): string {
  return `\n\nYOUR PREVIOUS ANSWER COULD NOT BE USED: ${problem}. Return the complete analysis again as valid JSON matching the schema.`;
}
