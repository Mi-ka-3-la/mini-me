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

function header(req: AnalyzeRequest): string {
  const lang = languageName(req.language);
  const diacritics =
    req.language === 'ro-RO' ? ' For Romanian, use correct diacritics (ă, â, î, ș, ț).' : '';
  return `LANGUAGE: Write every field in ${lang}, the language of the meeting.${diacritics}

LISTENER'S CONTEXT (what they care about; prioritize it):
${req.context.trim() || 'none given'}

SPEAKERS: ${speakerLine(req)}`;
}

function transcriptBlocks(req: AnalyzeRequest, newLabel: string): string {
  const trimmed = req.transcriptTrimmed
    ? ' (the start of the meeting is omitted; it is reflected in the current state)'
    : '';
  return `EARLIER TRANSCRIPT${trimmed}, for context:
${req.transcript.trim() || '(none)'}

${newLabel}:
${req.newTranscript.trim() || '(none)'}`;
}

/** Watch call (ADR-19, docs/04 §3a): only changes to the watch list, so the answer is short and fast. */
export function buildWatchPrompt(req: AnalyzeRequest): string {
  const pinned = new Set(req.pinnedIds);
  const current = (req.previous?.flags ?? []).map((f) => ({
    id: f.id,
    pinned: pinned.has(f.id),
    type: f.type,
    title: f.title,
    quote: f.quote,
  }));
  const dismissed = req.dismissedQuotes.length
    ? req.dismissedQuotes.map((q) => `- "${q}"`).join('\n')
    : 'none';
  const asked = req.askedFlags.length
    ? req.askedFlags.map((f) => `- ${f.title} — "${f.quote}"`).join('\n')
    : 'none';

  return `You are watching a live business meeting and helping one participant, the listener, react in time. They read your watch list while the meeting runs, so every flag must be worth interrupting them for.
You are called about once a minute with the newest part of the transcript. Return only the CHANGES to the watch list, as JSON that matches the provided schema.

${header(req)}

FLAG TYPES
TRAP: ${TRAP}
LOGIC: ${LOGIC}
QUESTION: ${QUESTION}

RULES
1. Look for new flags only in NEW TRANSCRIPT. Use the earlier transcript and the current watch list as context (for example, to spot a contradiction with something said earlier).
2. add: new flags. quote = the exact words from NEW TRANSCRIPT, at most 25 words; no quote, no flag. why = 1–2 plain sentences naming what is missing or wrong. ask = one concrete question the listener can say out loud as is. who = the speaker label if known, else empty.
3. Only flag what matters for the meeting's outcome. Most minutes deserve zero, one or two new flags. Return empty lists when nothing new matters.
4. A statement that already names its owner, its date, the source of its number, or its evidence (for example "the CFO signed it last Thursday", "confirmed in writing", "the test report is in the folder") is NOT a flag. Do not ask for proof that was just given.
5. Do not add anything already on the current watch list, in DISMISSED or in ALREADY ASKED, even reworded. If the new talk changes an existing flag, put it in update with the same id and quote.
6. drop: ids of flags that the new talk clearly resolved.
7. The watch list holds at most 12 flags. If your additions would make it longer, also drop the weakest flags that are not pinned (minor stakes, or a near-repeat of another flag), so the strongest 12 remain. Never drop a pinned flag.
8. Do not invent facts, owners, dates or numbers.

CURRENT WATCH LIST (JSON):
${current.length ? JSON.stringify(current) : 'empty'}

DISMISSED BY THE LISTENER (do not raise again):
${dismissed}

ALREADY ASKED BY THE LISTENER (do not raise again):
${asked}

${transcriptBlocks(req, 'NEW TRANSCRIPT (look for flags here)')}`;
}

/** Summary call (ADR-19, docs/04 §3b): the running summary only, every few minutes. */
export function buildSummaryPrompt(req: AnalyzeRequest): string {
  const previous = req.previous
    ? JSON.stringify({ tldr: req.previous.tldr, topics: req.previous.topics })
    : 'none yet';
  return `You are keeping the running summary of a live business meeting for one participant, the listener.
Return the complete, updated summary of the whole meeting so far, as JSON that matches the provided schema.

${header(req)}

TASKS
1. tldr: 1–2 sentences on where the meeting stands now.
2. topics: group the meeting by topic, in the order topics came up. For each topic:
   - points: key facts or positions stated, short.
   - decisions: ONLY what participants clearly agreed. A proposal is not a decision.
   - actions: "Owner — action" only if an owner was named; otherwise put it in open.
   - open: unresolved items.
   Keep topics from the previous summary unless they were merged. Update them with the new information. Keep each item short.
3. Do not invent facts, owners, dates or numbers. If unsure, leave it out.

PREVIOUS SUMMARY (JSON):
${previous}

${transcriptBlocks(req, 'NEW TRANSCRIPT (since the previous summary)')}`;
}

/** Appended on the single retry after invalid output. Carries the error shape, never content. */
export function retrySuffix(problem: string): string {
  return `\n\nYOUR PREVIOUS ANSWER COULD NOT BE USED: ${problem}. Return the complete analysis again as valid JSON matching the schema.`;
}
