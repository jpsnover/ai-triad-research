# Crux-grammar A/B (t/3144 step 2) — findings

**Question (from t/3097):** the model-facing crux-status grammar `addressed | partially_addressed | unaddressed` (`lib/debate/neutralEvaluator.ts`) lacks the `undecidable` option its structural twin (`CruxResolutionState.undecided`) has. Does that missing option distort the headline `crux_addressed_rate` — are genuinely undecidable cruxes forced into `partially_addressed` and inflating the rate?

**Result: no — not for the pinned evaluator.** Offered the option, the model never uses it, and the metric does not move. Adding `undecidable` to the shipped grammar (t/3097 Rec 2) is **not warranted** on artifact-correction grounds.

## Design

Isolate the *grammar* variable by holding the crux *set* fixed (avoids the crux-set drift confound, t/1670):
- **arm A (shipped)** — the existing 3-option labels on `neutral_evaluations[-1].cruxes[].status`.
- **arm A′ (control)** — re-classify the *same given* cruxes with a 3-option prompt.
- **arm B (treatment)** — re-classify the *same given* cruxes with a 4-option prompt (`+undecidable`, disclosed definition). A′ and B are byte-identical except the grammar.

Sample: 12 debates with structural `never_resolved ≥ 0.5` (terminal-`identified`, where the artifact should concentrate), 47 cruxes, 3 passes/arm, pinned `gemini-3.5-flash-lite` @ t=0.2. Cruxes given, never re-identified. Run: `python crux_grammar_ab.py` (needs `GEMINI_API_KEY`).

## Numbers

- **`undecidable` usage in B: 0 / 47 × 3 passes = 0 / 141.** Decisive.

| arm | `crux_addressed_rate` |
|---|---|
| shipped-A | 0.638 |
| A′ (3-opt) | 0.557 ± 0.028 |
| B (4-opt) | 0.497 ± 0.033 |

- **Grammar effect (A′ − B) = +0.061** — run-to-run noise (~1.4× the ~0.03 per-arm SD); B moved *zero* mass into the new option, so this is not a systematic grammar shift.
- **Reclassification confound (shipped − A′) = +0.081** — the full-eval → classification-only re-run gap is *larger* than the nominal grammar effect. (Caution for any evaluator re-labeling analysis: expect ~8-pt drift from shipped labels.)

## Interpretation

The t/3097 grammar-artifact hypothesis is **not supported** for the operative (pinned) evaluator: when `undecidable` exists, the model doesn't select it, so the metric is unchanged. Recommend **not** shipping the grammar change — no register event (no grammar change).

Step 1's real signal — structural↔model decoupling (72% structurally terminal-`identified` vs 64% model-`addressed`; Pearson r = −0.10) — is genuine but is an **instrument disagreement, not a vocabulary gap**. Adding the missing option does not close it because the model does not perceive these cruxes as undecidable. A follow-up should target the deeper question (why the model calls structurally-never-resolved cruxes "addressed", or documenting the two instruments as non-comparable), not the grammar.

## Caveats

Evaluator-model-relative (t/1835) — the pinned model is the operative one, but a different evaluator might behave differently. n = 47 cruxes / 12 debates (modest). t = 0.2. A stronger nudge or a `not_yet_decidable` phrasing was not tested; the natural extension with a reasonable definition yields zero usage.
