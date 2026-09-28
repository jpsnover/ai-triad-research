# Debate readability: baseline + audience-keyed fix spec (t/3720)

**Author:** Computational Linguist. **Status:** baseline measured; the fix (one helper edit) routes to DebateTool; validation A/B by CL after.

Extends the op-ed readability work (t/3696) to debates, per Jeffrey's ask. Same instrument (`measure_body`, reused from `analyses/t3696-oped-readability/`), so debate and op-ed numbers are directly comparable.

## Baseline (40 most recent debates, 425 substantive turns, dominant model gemini-3.5-flash-lite)

| audience | target grade | FK median | FK mean | max |
|---|---|---|---|---|
| policymakers (401 turns) | **12** | **16.1** | 16.4 | 24.3 |
| general_public (24 turns) | **10** | **15.0** | 14.9 | 17.8 |
| **all** | | 16.0 | 16.4 | 24.3 | **92% of turns over their audience target** (even with a +1 tolerance band) |

Debates read *harder* than the op-eds did pre-fix (FK 16 vs 14.2, same dominant model). Both audiences run ~4-5 grades over target.

**Cause differs from op-eds (changes the lever):** debate avg sentence length is 17.2w, *lower* than the op-eds' 22.7w, yet the reading grade is *higher*. So debate density is driven by **vocabulary complexity** (polysyllabic, abstract, jargon), not sentence length. The fix must emphasize the **plain-language / de-jargon lever**, not just sentence-splitting.

## Root cause (same class as op-eds)

`getReadingLevel(audience)` (`lib/debate/prompts/shared-helpers.ts`, `AUDIENCE_DIRECTIVES[*].readingLevel`) is **already injected at every debater surface** (turn.ts, opening.ts, synthesis.ts, reflection.ts, turn-pipeline.ts). But each `readingLevel` string is **qualitative persona guidance with no measurable grade target**, the same failure the op-ed prompt had. The model doesn't self-enforce an unmeasured "write clearly."

## Fix (DebateTool, `shared-helpers.ts`), PREPEND a measurable target to each readingLevel string

PI-set targets: **policymakers → FK grade ~12 (ceiling 13); all other audiences → FK grade ~10 (ceiling 11).** Keep the existing rich persona text; prepend the measurable line. Because `getReadingLevel` is already wired everywhere, this ONE helper change propagates to all debater surfaces.

**policymakers**, prepend:
> READING LEVEL (measurable): target Flesch-Kincaid grade ~12, no higher than 13, a senior congressional staffer reads it once and can quote it. The density comes from SUBSTANCE, not vocabulary: prefer plain words; use a technical term only when it is load-bearing, and define it in the same sentence on first use. One idea per sentence; no sentence over 30 words.

**all other audiences** (technical_researchers, industry_leaders, academic_community, general_public), prepend:
> READING LEVEL (measurable): target Flesch-Kincaid grade ~10, no higher than 11, an informed general reader follows it without rereading. No jargon without a plain-English equivalent in the same sentence. Prefer short, plain words over abstract/polysyllabic ones. One idea per sentence; no sentence over 30 words.

(Implementation note: cleanest as a small `gradeTargetPreamble(audience)` helper that `getReadingLevel` prepends, so the grade→audience map lives in one place; `technical_researchers`/`academic_community` keep their precise-vocabulary persona text after the preamble, the grade-10 target trims density without banning the field's load-bearing terms.)

## Validation (measure-first, per the op-ed method)

After the helper lands, CL re-runs `measure_debate_readability.py` on a fresh sample and compares FK per audience against the baseline here. Expect the largest movement from the plain-language lever (vocab), not sentence length. **Only if the prompt alone doesn't reach target** do we consider a debate readability edit pass (mirroring the op-ed one, lib/debate), do NOT build it speculatively.

## Provenance

The grade targets are a **stipulated** style target (PI decision), not a gate, `derived` readability *measurement*, no pass/fail threshold on the metric. The audience→grade map (policymakers 12 / others 10) is recorded here and in the tool's `AUDIENCE_GRADE_TARGET`. Gates nothing.
