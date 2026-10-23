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

const IMPORTANT = `not a problem, a marker: something the listener will want to find again — a decision actually agreed, a date or deadline, a number, a commitment with a named owner, a key fact or a change of direction. ask may be empty for these.`;

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
IMPORTANT: ${IMPORTANT}

RULES
1. Look for new flags only in NEW TRANSCRIPT. Use the earlier transcript and the current watch list as context (for example, to spot a contradiction with something said earlier).
2. add: new flags. quote = the exact words from NEW TRANSCRIPT, at most 25 words; no quote, no flag. why = 1–2 plain sentences naming what is missing or wrong. ask = one concrete question the listener can say out loud as is. who = the speaker label if known, else empty.
3. Only flag what matters for the meeting's outcome. Most minutes deserve zero, one or two new flags. Return empty lists when nothing new matters.
4. A statement that already names its owner, its date, the source of its number, or its evidence (for example "the CFO signed it last Thursday", "confirmed in writing", "the test report is in the folder") is NOT a flag. Do not ask for proof that was just given.
5. Do not add anything already on the current watch list, in DISMISSED or in ALREADY ASKED, even reworded. If the new talk changes an existing flag, put it in update with the same id and quote.
6. drop: ids of flags that the new talk clearly resolved.
7. The watch list holds at most 12 trap, logic and question flags, plus at most 8 important markers. If your additions would exceed a limit, also drop the weakest flags of that kind that are not pinned (minor stakes, or a near-repeat of another flag). Never drop a pinned flag.
8. Do not invent facts, owners, dates or numbers.
9. topic: every flag and question gets the topic it belongs to. Reuse a name from KNOWN TOPICS exactly when it fits; otherwise make a new short name (2–4 words) in the meeting language. Keep topics broad: a meeting usually has 3–6.
10. segments: where the conversation in NEW TRANSCRIPT moves to a topic, give the time of the first line about it ("mm:ss", copied from the transcript) and the topic name. Give at least one segment when NEW TRANSCRIPT is not empty.
11. answered: for each question in OPEN QUESTIONS that NEW TRANSCRIPT clearly answers, its id and the exact words of the answer (at most 25 words).
12. questions: every real question asked in NEW TRANSCRIPT that expects an answer from someone in the meeting (not rhetorical, not small talk, not a request to repeat, and not already in KNOWN QUESTIONS). quote = the exact words of the question, at most 30 words. question = the same question rewritten as one short, clear sentence, in the meeting language. Questions are separate from flags; a question can be both.

CURRENT WATCH LIST (JSON):
${current.length ? JSON.stringify(current) : 'empty'}

DISMISSED BY THE LISTENER (do not raise again):
${dismissed}

ALREADY ASKED BY THE LISTENER (do not raise again):
${asked}

KNOWN TOPICS:
${req.knownTopics.length ? req.knownTopics.map((t) => `- ${t}`).join('\n') : 'none yet'}

OPEN QUESTIONS (not answered yet):
${req.openQuestions.length ? JSON.stringify(req.openQuestions) : 'none'}

KNOWN QUESTIONS (already reported):
${req.knownQuestions.length ? req.knownQuestions.map((q) => `- "${q}"`).join('\n') : 'none'}

${transcriptBlocks(req, 'NEW TRANSCRIPT (look for flags and questions here)')}`;
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
   Use the names in KNOWN TOPICS exactly for topics that match, so the listener can follow each topic across the screen.
3. Do not invent facts, owners, dates or numbers. If unsure, leave it out.

KNOWN TOPICS:
${req.knownTopics.length ? req.knownTopics.map((t) => `- ${t}`).join('\n') : 'none yet'}

PREVIOUS SUMMARY (JSON):
${previous}

${transcriptBlocks(req, 'NEW TRANSCRIPT (since the previous summary)')}`;
}

/**
 * Answer call (ADR-20): helps the listener answer a question that was just asked, as a short
 * schematic plan they can read at a glance while speaking.
 */
export function buildAnswerPrompt(req: AnalyzeRequest): string {
  const q = req.question ?? { quote: '', question: '' };
  return `Someone in a live conversation has just asked a question that the listener may need to answer now. Help the listener answer it. The answer has two layers. The first (question, trap, headline, steps) is glanced at while they speak, so it must be readable in a few seconds: short labels, no paragraphs. The second (explain) is read when they have a moment, to understand what the question is really about.
Return JSON that matches the provided schema.

${header(req)}

THE QUESTION, AS ASKED:
"${q.quote}"
(clearer: ${q.question || 'n/a'})

THE LISTENER'S BACKGROUND (answer as this person; use only what is written here, never invent experience, employers, numbers or results):
${req.background.trim() || 'not given — give a strong general answer'}

FIELDS
- question: the question restated as one short, clear sentence. If it was asked in a confusing way, say what is really being asked.
- trap: if the question hides a trap (a false choice, a loaded or wrong assumption, a "there is no right answer" setup, a test of honesty, judgment or priorities, a request to criticise someone), name it in one short sentence and say how to step around it. Otherwise an empty string.
- headline: the core of the answer, at most 12 words.
- steps: 3 to 5 steps that build the answer or the action plan, in the order to say them. label = 2 to 5 words. detail = at most 15 words, concrete, and drawn from the listener's background where it fits. why = one short sentence: why this step belongs in the answer (what it proves to the asker, or what goes wrong without it).

- explain: the listener reads this part to understand the question, not to say it. 3 or 4 short sections, in this order, skipping one that does not apply:
  1. what it is: the concept the question turns on. Start from something the listener already knows, then name the one difference. Define every technical term the first time it appears. If the concept has an edge (X is Y, X is not Z), state it.
  2. what they are testing: why someone asks this question, and what a strong answer shows.
  3. common confusion: the confusion a smart person would likely have here, in plain words, then say it is not so, and give the real reason in the next sentence.
  4. where you fit: map the concept onto the listener's background, concretely. Use only what the background or the conversation says. If the background is empty, say what kind of experience would fit.
  For each section: label = the section name above, in the meeting language, uppercase. title = the section's claim as a full statement, 3 to 8 words. body = 2 to 4 short sentences, one idea only. Every "because" has its cause in the next sentence. If something is a convention with no internal logic, say so. If it is a simplification, say where it breaks. No filler, no praise, no announcing what comes next.

RECENT CONVERSATION, for context:
${[req.transcript, req.newTranscript].filter((x) => x.trim()).join('\n') || '(none)'}`;
}

/** Appended on the single retry after invalid output. Carries the error shape, never content. */
export function retrySuffix(problem: string): string {
  return `\n\nYOUR PREVIOUS ANSWER COULD NOT BE USED: ${problem}. Return the complete analysis again as valid JSON matching the schema.`;
}
