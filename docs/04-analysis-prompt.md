# 04 — Analysis prompt

This is the core of the product. The transcription can be swapped for another engine. The prompt decides whether the watch list is useful or noise.

## 1. Design principles

1. **Selective over complete.** A flag must matter for the outcome of the meeting. Five sharp flags beat fifteen soft ones. Hard cap: 12 active flags.
2. **Grounded.** Every flag carries a verbatim quote from the transcript. If there is no quote, there is no flag. This stops the model inventing problems and lets the user judge quickly.
3. **Actionable.** Every flag ends in a question the user can say out loud as written.
4. **Neutral.** It flags reasoning and commitments, never people. It does not judge tone or motives.
5. **Stable.** It reuses flag ids for flags it keeps, and drops a flag only when the discussion resolved it.
6. **Same language as the meeting.**
7. **Steered by the user's context.** If the user wrote what they care about, those topics get priority.

## 2. Flag taxonomy

The model receives the definitions below. Examples are given in English; the model writes in the meeting language.

**Trap** — a statement that creates hidden risk or a commitment nobody fully owns:
- dependency dismissed ("it's a formality", "basically final");
- commitment without owner or date ("we'll sort the tax rules");
- risk shifted silently ("we'll fix it after go-live");
- number or claim with no source ("it saves 30%");
- agreement assumed from silence ("so we're all aligned");
- pressure to decide now without the information ("we need a yes today");
- scope creep phrased as a detail ("and it should also handle X, small thing").

**Logic error** — reasoning that does not support its conclusion:
- hasty generalization (one or few cases → a rule);
- false cause (A then B, so A caused B);
- silence or absence as evidence ("nobody complained, so it works");
- false dilemma (only two options presented);
- circular reasoning;
- contradiction with something said earlier in the same meeting (quote the current statement, mention the earlier one in `why`);
- moving goalposts;
- appeal to authority used instead of evidence.

**Question** — the most valuable question not yet asked: a missing owner, date, number, definition, success criterion, or a decision that is implied but never stated.

## 3. Prompt template

`api/_lib/prompt.ts` builds the user message below. There is a short system prompt (§4). Values in `{{ }}` are filled by the server.

```
You are watching a live business meeting and helping one participant, the listener, react in time.
You receive your previous analysis and the most recent part of the transcript.
Return the complete, updated analysis of the whole meeting so far by calling the tool report_analysis.

LANGUAGE: Write every field in {{languageName}}, the language of the meeting.

LISTENER'S CONTEXT (what they care about; prioritize it):
{{context or "none given"}}

SPEAKERS: {{speaker map, e.g. "A = Client PM, B = Speaker B" or "unknown (single microphone)"}}

TASKS
1. tldr: 1–2 sentences on where the meeting stands now.
2. topics: group the meeting by topic, in the order topics came up. For each topic:
   - points: key facts or positions stated, short.
   - decisions: ONLY what participants clearly agreed. A proposal is not a decision.
   - actions: "Owner — action" only if an owner was named; otherwise put it in open.
   - open: unresolved items.
   Keep topics from the previous analysis unless they were merged. Update them with new information.
3. flags: the watch list. Types:
   TRAP: {{trap definition and examples from section 2}}
   LOGIC: {{logic definition and examples}}
   QUESTION: {{question definition}}
   Rules for flags:
   - Only flag what matters for the meeting's outcome. Fewer, sharper flags are better.
   - quote: copy the exact words from the transcript, at most 25 words. No quote, no flag.
   - why: 1–2 plain sentences naming what is missing or wrong. No jargon labels alone; explain.
   - ask: one concrete question the listener can say out loud as is.
   - who: the speaker label if known, else empty.
   - id: reuse the id of a previous flag you keep (even if you edit its wording). New flags: leave id empty.
   - Drop a previous flag only if later discussion clearly resolved it.
   - Never raise again anything whose quote appears in DISMISSED.
   - At most 12 flags in total.
4. Do not invent facts, owners, dates or numbers. If unsure, leave it out.

PREVIOUS ANALYSIS (JSON):
{{previous or "none yet"}}

DISMISSED BY THE LISTENER (do not raise again):
{{dismissed quotes or "none"}}

TRANSCRIPT {{"(earlier part omitted; it is reflected in the previous analysis)" if trimmed}}:
{{transcript lines "[mm:ss] Speaker: text"}}
```

## 4. System prompt

```
You are a precise, neutral meeting analyst. You point out reasoning gaps and hidden commitments so that one participant can ask better questions in the moment. You never judge people, only statements. You prefer saying less over saying something unsupported. Always answer by calling the provided tool.
```

## 5. Tool definition (structured output)

```json
{
  "name": "report_analysis",
  "description": "Report the full updated meeting analysis.",
  "input_schema": {
    "type": "object",
    "required": ["tldr", "topics", "flags"],
    "properties": {
      "tldr": {"type": "string"},
      "topics": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["topic", "points", "decisions", "actions", "open"],
          "properties": {
            "topic": {"type": "string"},
            "points": {"type": "array", "items": {"type": "string"}},
            "decisions": {"type": "array", "items": {"type": "string"}},
            "actions": {"type": "array", "items": {"type": "string"}},
            "open": {"type": "array", "items": {"type": "string"}}
          }
        }
      },
      "flags": {
        "type": "array",
        "maxItems": 12,
        "items": {
          "type": "object",
          "required": ["id", "type", "title", "quote", "why", "ask", "who"],
          "properties": {
            "id": {"type": "string"},
            "type": {"type": "string", "enum": ["trap", "logic", "question"]},
            "title": {"type": "string"},
            "quote": {"type": "string"},
            "why": {"type": "string"},
            "ask": {"type": "string"},
            "who": {"type": "string"}
          }
        }
      }
    }
  }
}
```

The server assigns ids `f-<n>` to flags returned with an empty id.

## 6. Server-side post-checks

Apply these after the model answers, before returning to the client:
- **Quote grounding.** Normalize the text (lowercase, collapse whitespace, strip punctuation) and check that each flag's quote appears in the transcript window or in the previous flags. Drop flags that fail. This is the main defence against invented flags. Fuzzy matching with a token overlap of 0.85 or more is acceptable, since STT and model punctuation differ.
- **Cap.** Keep at most 12 flags.
- **Dismissed filter.** Drop flags whose normalized quote matches a dismissed one.

## 7. Evaluation set (build in Phase 0)

Create `tests/fixtures/meetings/` with 4 short transcripts (5–8 minutes each), 2 in English and 2 in Romanian. Each has a hand-written `expected.json` listing the flags a good analyst would raise. Plant at least 3 traps, 3 logic errors and 2 open questions per transcript, plus 2 "decoy" statements that look suspicious but are fine.

`npm run eval` calls `/api/analyze` on each fixture, in 3 chunks to simulate the live flow, and reports:
- **recall**: how many planted items were flagged (match by quote overlap);
- **precision**: how many flags match a planted item;
- **decoy hits**: how many decoys were flagged (should be 0);
- **stability**: share of flag ids kept between chunk 2 and chunk 3.

Run it before and after every prompt change. Record the results in `docs/eval-log.md`.

Targets for Phase 0: recall ≥ 0.6, precision ≥ 0.7, decoy hits ≤ 1 across all fixtures.

## 8. Tuning knobs

| Symptom | Change |
|---|---|
| Too many weak flags | Lower the cap to 8. Add "only flag if the listener would lose something by not asking". |
| Misses obvious traps | Add the missed pattern to the taxonomy with an example. |
| Flags flicker or reword each update | Stress id reuse. Include the previous flags' full text. Make the client keep the old wording when the change is minor. |
| Wrong language | Move the LANGUAGE line to the top and repeat it at the end. |
| Too slow | Switch `ANALYSIS_MODEL` to Haiku for updates, and run Sonnet every third update. |
