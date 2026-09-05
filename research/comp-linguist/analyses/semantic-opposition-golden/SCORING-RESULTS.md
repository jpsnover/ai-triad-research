# Fork-B classifier scoring — both-arms GV results (t/3302)

Independent grading of contradiction classifiers against the frozen blind golden
(`semantic-opposition-golden.json`). Graded by joining predictions to the golden on `pair_id` and
consuming only the classifier's `predicted` + `confidence` — the golden's `label`/`split`/`pool` are the
sole ground truth (echoed gold fields in the predictions are ignored, keeping the grader independent).

**Split protocol** (TL t/3302#7): threshold derived on TUNE; **precision on REP `held_out`** (n=37, the true
~6% contradiction base rate); **recall on all `held_out` contradicts** (n=10). Wilson 95% CIs.
**Bar** (TL p/349#167): precision *lower bound* ≥ 0.85, recall ≥ 0.50.

## Arm 1 — NLI opposition detector (`scripts/nli_classify.py`, deberta): FAIL both axes

- recall ceiling **0.29** [0.15, 0.49] — 71% of true contradicts read as `entailment`, unreachable at any τ.
- precision **0.00** [0.00, 0.18] on REP held-out (contradiction predictions dominated by false positives).
- constructed numeric/temporal: **0/6** caught; false-fires on coincidental numbers.
- Robust to `--no-framing`. Decisive fail — the detector doesn't transfer from claim-vs-rich-node to
  assertion-vs-assertion. (Details: t/3302#11, #14.)

## Arm 2 — LLM contradiction classifier (gemini; `semantic-golden-predictions.json`)

Confusion (observed 113):

| CL gold ↓ / predicted → | contradict | entail | neutral | unresolved |
|---|---|---|---|---|
| contradict (24) | **22** | 0 | 1 | 1 |
| entail (60) | 1 | 54 | 5 | 0 |
| neutral (29) | 0 | 1 | 28 | 0 |

- **Recall: PASS (formal).** held-out **0.90 [0.60, 0.98]** — LB 0.60 ≥ 0.50. Ceiling 22/24 = 0.92 [0.74, 0.98].
- **Precision: strong classifier; the held-out LB is underpowered.** The **only** false positive across all 113
  pairs is **P016** (entail→contradict, conf 0.85), and it is in the **tune** split → REP held-out has **zero**
  false positives (precision 1.00 but n_pred=1 → Wilson LB **0.21**). Whole-observed precision 22/23 = **0.957
  [0.79, 0.99]**. Base-rate-corrected at ~6%: ≈ **0.84** at τ=0 (FPR 1/89 = 0.011).
- **Separability:** the lone FP has conf 0.85; at **τ ≥ 0.90** it drops → **FPR 0 → precision ≈ 1.0**, held recall
  still **0.90**. Recommended corpus operating point: **`--semantic-min-confidence 0.90`**.
- **Constructed numeric/temporal: 6/6 caught, 0 false-fires** (NLI 0/6) — the LLM subsumes the
  deterministic-complement cases.

## Gate read + recommendation

- **Literal precision-LB ≥ 0.85 on REP held-out: NOT certifiable** — REP held-out yields only 1
  contradict-prediction → LB 0.21 structurally, whatever the classifier. This is the thin-6%-base-rate
  **power** limit (TL p/349#167), not a quality failure. Recall passes formally.
- **CL independent read: GO** for Fork-B with the LLM at **τ ≈ 0.90** — recall 0.92, precision → ~1.0 at that
  threshold, single separable FP, 6/6 numeric; a decisive improvement over NLI.
- **To formally certify precision-LB ≥ 0.85:** expand the golden's REP contradict positives + boundary
  negatives for statistical power, OR accept whole-observed precision (0.957) + the τ=0.90 FPR-0 operating
  point given the strong recall and the config-tunable threshold.
- Deterministic numeric complement stays worthwhile (guaranteed numeric precision) but is lower-urgency
  given the LLM's 6/6.

**Status:** returned to TL for the final scoring GV (t/3302#23). `#1962` (classifier→pipeline) is green + draft;
un-drafts + self-merges at `--semantic-min-confidence 0.90` on TL GV pass.

## Reproduce

```
python score_llm_arm.py     # grades semantic-golden-predictions.json vs semantic-opposition-golden.json
```
Both files co-located here; the grader defaults to them. Sweeps `confidence` over `predicted=='contradict'`
rows, precision on REP held-out, recall on all held-out contradicts, Wilson CIs.
