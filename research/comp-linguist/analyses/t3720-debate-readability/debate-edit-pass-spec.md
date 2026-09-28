# Debate readability phase-2 spec: edit pass + brief/plan target injection (t/3720)

**Author:** Computational Linguist. **Implementer:** DebateTool (`lib/debate/`, turn pipeline + prompts). **Status:** spec for review + build, warranted by the phase-1 negative result.

**All outputs stay style-only, this gates nothing and changes no calibration metric.** CL owns the edit-pass prompt content + the audience→grade map + validation; DebateTool owns the pipeline wiring.

## Why (phase-1 failed, measured, t/3720#2)

The prompt-only grade preamble (t/3721) did NOT reach target: debate openings stayed at FK median 17.1 (policymakers, target 12) / 19.1 (general_public, target 10); 0/10 hit grade. Two causes the A/B exposed, and this spec addresses both:

1. **Multi-stage dilution**, the preamble is injected only at the DRAFT stage, but the draft is conditioned by the brief + plan, which committed to dense argumentation first.
2. **Vocabulary-driven density**, debate sentences are already ~17w; the excess grade comes from polysyllabic/abstract/jargon vocabulary, which a passive prompt instruction does not self-enforce.

## Part A, inject the grade target UPSTREAM (brief + plan stages) [cheap, do first]

The draft can't undo a dense plan. Add the same `gradeTargetPreamble(audience)` (already built, t/3721) to `briefOpeningStagePrompt` and `planOpeningStagePrompt` (and the mid-debate turn brief/plan in `turn.ts` / `turn-pipeline.ts`), so the plan itself is shaped for the target reader, not just the final render. Cheap (reuse the existing helper); may materially help on its own. Measure after A before deciding B is still needed (measure-first).

## Part B, the readability edit pass (the guaranteed backstop, mirrors the op-ed edit pass)

A conditional, focused post-draft LLM call, the mechanism that reliably took op-eds to grade-10. **Vocabulary-weighted**, because that is the debate failure mode.

### Wiring (`lib/debate/`)
Runs on each debater turn's DRAFT (opening draft + mid-debate turn draft) AFTER the draft is produced and BEFORE the turn is finalized/persisted and before the reflection/claim-extraction pass (so extraction maps to the final text). The existing turn pipeline (`turnPipeline/repair.ts`) is the natural host, add a readability stage alongside the repair pass, or a standalone post-draft stage.

### Trigger (deterministic, per audience)
Reuse `measureReadability` from the op-ed work (`lib/oped/readabilityMeasure.ts`, port/share it to lib/debate). Edit if, against the turn's audience target (`AUDIENCE_GRADE_TARGET`, policymakers 12 / others 10):
`fkGrade > target+1  ||  maxSentenceWords > 30  ||  maxParagraphWords > 120`
(paragraph cap looser than op-eds, debate turns are longer; tune in validation). Skip the call entirely when the draft already lands.

### The edit-pass prompt (CL-authored; new `lib/debate/prompts/*.ts` string)
```
You are a copy editor preparing an AI-debate turn for a {{AUDIENCE}} reader. The argument, the debater's position, every concession/rebuttal move, and every fact are FINAL and correct. Your ONLY job is to make it readable at the target level WITHOUT changing what it argues, its debate moves, or its voice.

THE TURN:
{{DRAFT}}

MEASURED PROBLEMS:
{{VIOLATIONS}}

RULES:
- Reading level: target Flesch-Kincaid grade ~{{TARGET}} (ceiling {{CEILING}}).
- VOCABULARY IS THE MAIN FIX: replace polysyllabic/abstract/jargon words with plain equivalents; de-nominalize ("regulators decided", not "the regulatory decision"); a technical term only when load-bearing, defined in the same sentence on first use.
- Sentences: no sentence over 30 words; one idea per sentence; split multi-claim sentences.
- Paragraphs: no wall of text; one point per paragraph.

HARD CONSTRAINTS (violating any is worse than leaving the draft):
- Do NOT change the position, the argument, any claim, number, name, or quote.
- Do NOT remove or alter debate MOVES: concessions, steelmans, rebuttals, crux engagement, the disagreement register. These drive the calibration signals, preserve them exactly.
- Do NOT introduce "Furthermore," "Moreover," "In conclusion," "Ultimately," "It is important to note."
- Keep length within ~10% (do not cut content); if the draft is pathologically long (>2x the turn's word budget), that is a separate generation fault, flag via editing_meta, do not silently truncate.

Return ONLY JSON: { "statement": "<edited turn>", "changed": <bool>, "edit_notes": "<one sentence>" }.
```

### Re-verify + fallback (same discipline as the op-ed edit pass)
- Re-measure after; at most one edit, optional one retry if FK got strictly worse (keep the better). If still over, keep the edit + WARN.
- **Non-fatal:** any error / word-count collapse / JSON-parse failure → degrade to the ORIGINAL draft + WARN (mirror `runReflection`). Must never block turn generation.
- **Voice + move preservation:** recheck banned tells (introduced-not-original → revert), and (debate-specific) confirm the edit did not drop the turn's move markers. Persist `editing_meta` (edited, fk_before/after, checks_failed_after).

### The runaway-length finding (from the A/B)
One opening generated at 2276 words / FK 33. That is a generation fault distinct from readability. The edit pass flags it (editing_meta) but should not be the only guard, recommend a separate turn-length cap check in the pipeline (DebateTool call).

## Validation (measure-first, before default-on)
CL re-runs `measure_debate_readability.py` on generate-then-edit output vs the generate-only baseline, per audience, and confirms: (a) FK reaches ~target, (b) debate moves preserved (spot-check concession/rebuttal survive), (c) voice intact. Only then does the edit pass default on. If Part A alone reaches target, Part B may not be needed, measure first.

## Provenance
Stipulated style target (PI decision, t/3720); gates nothing; no calibration-metric change. Register: the audience→grade map is already recorded (t/3720 findings); the edit pass is a style transform, not a new metric.
