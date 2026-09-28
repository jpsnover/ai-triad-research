# Op-ed readability + coherence edit-pass spec (t/3696, step 3)

**Author:** Computational Linguist. **Implementer:** Shared Lib (`lib/oped/generate.ts` is their scope). **Status:** spec for review + build.

CL owns the mechanism design and the edit-pass prompt content (prompt = CL artifact class). Shared Lib owns the `generate.ts` wiring. This doc is the handoff.

## Why (evidence, not assertion)

The measurable grade-10 prompt rewrite (PR #2471) cut FK grade ~3 grades and nearly halved sentence length, but the A/B (t/3696#3, same model gemini-3.5-flash-lite, only the prompt differs) showed it does **not** reach grade-10 alone:

| metric | old prompt (n=9) | new prompt (n=6) |
|---|---|---|
| FK grade median | 14.2 | 11.4 |
| over grade-11 | 9/9 | 3/6 |
| max paragraph words (median) | 128 | 90 |

Two residual failures the generation call will not self-fix: (a) FK still ~1-1.5 grades over target; (b) **paragraph cramming** persists (2/6 produced a single 337w / 387w paragraph despite the <=90w rule). One piece hit FK 9.6 yet carried a 387w paragraph, confirming readability and flow are separate axes. The edit pass targets exactly this residual; it is scoped, not speculative.

## Architecture: measure -> conditional targeted edit -> re-verify

A second, focused LLM call that runs ONLY when the draft misses target. It does one job (fix readability + flow), which a single-objective call does far better than folding it into generation. Mirrors the existing grounding-reflection second pass, but rewrites rather than observes.

### Where it wires in (`generate.ts`)

Inside `runVoiceGeneration`, **after** the body is produced (~line 287, `const body = parsed.body_markdown`) and **BEFORE** the grounding-reflection pass (~line 312). Order is load-bearing: reflection maps grounding-node usage to positions in the body, so it must run on the FINAL (edited) body, not the pre-edit draft. Sequence per voice:

1. generate body (existing)
2. **edit pass (new)** -> possibly-rewritten body
3. reflection on the edited body (existing)
4. finalize member (existing)

### Trigger predicate (deterministic, cheap, no LLM)

Compute on the draft body (reuse the measurement logic in `analyses/t3696-oped-readability/measure_oped_quality.py`, port the three checks to TS, they are simple):

```
needsEdit = fkGrade(body) > 11
         || anyParagraph(body, words > 90)
         || anySentence(body, words > 30)
```

If false, skip the edit call entirely (no cost). Thresholds come from the baseline distribution + the grade-10 target (goal 10, ceiling 11), not guesses.

### Re-verify + stop condition

After the edit, re-measure. Run **at most one** edit pass (optionally one retry if the first made it strictly worse, then keep the better of the two by FK grade). Never loop to convergence (cost + no guarantee). If it still misses target after the pass, **keep the edited body and emit a WARN** recording before/after FK + which checks still fail, do not discard the improvement, and do not block generation.

### Fallback / error handling (non-negotiable, mirrors reflection)

The edit pass MUST NOT be able to block or fail generation. On any error (API failure, JSON parse failure, empty/`body_markdown` missing, word count collapses >40% suggesting truncation), **degrade to the ORIGINAL unedited body and emit a WARN** via the host recorder (fallback-path logging convention, `docs/error-handling.md`). Pattern already used by `runReflection` (try/catch, recorded, never rethrown).

### Voice preservation (the real risk)

The camp voice + rhetorical signature is the product; a naive "make it readable" edit flattens every camp to the same register. Guardrails:
1. The edit prompt hard-constrains: change ONLY sentence/paragraph structure, jargon, and logical connection, preserve the argument, the camp's voice/disposition/signature move, every fact, and every grounding reference.
2. After the edit, re-check the camp's banned AI-tells ("Furthermore," "Moreover," "In conclusion," "Ultimately," "It is important to note," and the flattening verbs, same list the generation prompt bans). If the edit INTRODUCED a banned tell that was not in the original, prefer the original body and WARN. (Cheap string check; no judge needed for v1.)
3. Persist `editing_meta` on the member for observability: `{ edited: bool, fk_before, fk_after, checks_failed_after: [...], reverted_reason?: string }`.

## The edit-pass prompt (CL-authored; Shared Lib creates the file `lib/oped/prompts/op-ed-readability-edit.prompt`)

Assemble via a new `assembleReadabilityEditPrompt(promptsDir, body, violations)` mirroring `assembleReflectionPrompt`. `{{VIOLATIONS}}` is a rendered list of the specific measured failures (e.g. "3 sentences over 30 words; paragraph 2 is 337 words; FK grade 13.9"). Proposed content:

```
You are a newspaper copy editor preparing a guest op-ed for publication. The argument, the author's voice, and every fact are FINAL and correct. Your ONLY job is to make the piece easy to read and easy to follow, at roughly a 10th-grade reading level, WITHOUT changing what it argues or how it sounds.

THE DRAFT:
{{BODY}}

MEASURED PROBLEMS TO FIX (these are the specific reasons it reads as too dense):
{{VIOLATIONS}}

RULES FOR YOUR EDIT:
- Reading level: aim for Flesch-Kincaid grade ~10, no higher than 11.
- Sentences: no sentence over 30 words; average under 18. When a sentence carries two or three claims, split it into separate sentences. This is the main fix.
- Paragraphs: no paragraph over ~90 words or four sentences. Split long paragraphs at a natural break; give each resulting paragraph one point.
- Coherence: each paragraph makes ONE point. Every back-reference ("that number," "this shift," "such measures") must point to something already stated earlier; if it dangles, name the thing.
- Plain words over jargon and abstract-noun pileups.

HARD CONSTRAINTS (violating any of these is worse than leaving the draft as-is):
- Do NOT change the argument, the thesis, the stance, or any claim.
- Do NOT change any fact, number, name, quote, or the piece's point of view / voice. Keep the author's distinctive phrasing and rhetorical moves.
- Do NOT add or remove evidence. Do NOT introduce transitions like "Furthermore," "Moreover," "In conclusion," "Ultimately," or "It is important to note."
- Preserve every reference to a source or a named entity exactly.
- Keep the length within about 10% of the original word count. Splitting sentences and paragraphs does not mean cutting content.

Return ONLY a JSON object: { "body_markdown": "<the edited essay>", "changed": <true|false>, "edit_notes": "<one sentence on what you changed>" }. If the draft already meets the rules, return it unchanged with "changed": false.
```

## Validation before default (measure-first, again)

Ship the edit pass behind the same discipline that gated the prompt rewrite: re-run `measure_oped_quality.py` on generate-then-edit output vs the generate-only A/B arm, and confirm (a) FK reaches ~grade-10 with paragraph violations cleared, AND (b) voice is preserved (banned-tell check clean; spot-read that the camp register survived). Only make the edit pass the default once that evidence holds. Report every statistic with its N.

## Cost

One extra LLM call per op-ed ONLY when triggered. On the A/B, 3/6 would have triggered on FK alone; more on the paragraph check. Roughly one extra short call per dense op-ed, negligible at the current cadence, and skipped entirely for drafts that already land.

## Handoff

Implementation ticket routes to Shared Lib, linked to t/3696, referencing this spec. CL reviews the implementation against this spec + runs the validation A/B before it defaults on.
