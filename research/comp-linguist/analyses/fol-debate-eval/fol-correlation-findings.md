# FOL-on-debate correlation results + step-3 go/no-go (t/3354, §9 + §12)

**Author:** Computational Linguist. **Status:** directional (n=9, under the R-1 replication gate). **Instrument-provisional, no number here anchors a threshold; double-annotation is required before any go verdict (design §12).**

The offline FOL harness (§1-11) ran to a full durable finish and emitted the §9 correlation index (`.fol-eval-corr-final/correlation-index.json`, 12 debates). This is CL's join of that emission against the convergence metrics, and the §12 go/no-go read for step 3 (grounded-rebuttal A/B).

## The join (9 non-zero debates; 3 of 12 formalized 0 assertoric clauses and are excluded)

| debate | assertoric | intra-contradictions | summary-corpus contra | crux_addressed_ratio | convergence@term | crux_undecided |
|---|---|---|---|---|---|---|
| 047fae06 | 84 | 1 | 0 | 1.00 | 0.355 | 0.40 |
| 079a8ede | 105 | 8 | 0 | 1.00 | null | 0 |
| 0988d971 | 105 | 9 | 0 | 1.00 | 0.419 | 0.50 |
| 0aec92f5 | 208 | 21 | 0 | 0.40 | null | null |
| 1418ee11 | 408 | 184 | 0 | 0.143 | null | null |
| 14ae53bc | 124 | 4 | 0 | 0.667 | 0.552 | 0.889 |
| 19a0d159 | 148 | 9 | 0 | 0.333 | null | null |
| 1aa27450 | 147 | 17 | 0 | null | null | null |
| 2306fafc | 372 | 73 | 0 | 1.00 | null | 0 |

## Correlations (Spearman rho; each carries its N)

- **intra-contradictions vs assertoric-clause-count: rho = 0.904 (n=9).** Strong. FOL's contradiction count scales with *how many clauses it formalized*, not with the debate's disagreement structure.
- **intra-contradictions vs crux_addressed_ratio: rho = -0.369 (n=8).** Weak and *negative*. FOL contradiction volume does not track the CL crux metric; if anything it runs the other way.
- **intra-contradictions vs convergence_score_at_termination: rho = 0.5 (n=3).** Uninterpretable, **6 of 9 debates have a null convergence_score** (censoring: they did not reach a decision point; per t/1671 R-4 the headline convergence read is un-pooled to decision-point-reached runs only, and here that leaves n=3).
- **summary-corpus contradictions: 0 across all 9.** FOL found zero contradictions between debate claims and the summary corpus.
- **Paraphrase FN rate (the §8 PRIMARY metric): raw 1.0, normalized 0.0, gap 1.0 (10 gold pairs, 1 canonical fixture).** Raw FOL misses 100% of the paraphrased disagreements; the normalization pass catches them on the canonical one-predicate/five-surface-forms fixture.

## Reading (what the evidence says, and does not)

1. **The one clean pro-FOL signal is necessary, not sufficient.** Paraphrase FN 1.0 → 0.0 shows normalization is *required* (raw FOL is unusable at FN 1.0) and that it works on the canonical fixture. It does **not** show FOL is *additive* over the convergence metrics, it rests on 10 gold pairs / 1 fixture, single-annotator.
2. **The robust correlation points against additivity.** The only strong, well-powered relationship (rho 0.904, n=9) is intra-contradictions ~ clause volume. FOL "finds more contradictions" mainly where it formalized more text, not where the debate disagreed more. It does not track crux_addressed_ratio (rho -0.369), and it finds zero cross-summary contradictions. On this evidence FOL contradiction counts look volume-driven, not disagreement-driven.
3. **The convergence comparison is not yet powered.** n=3 after censoring; no read is defensible there until more decision-point-reached runs exist.

## §12 Go / No-go verdict for step 3

**No-go on current evidence, a negative-leaning result, not a green light.** Per §12, step 3 (grounded-rebuttal A/B, which crosses the in-loop line) requires FOL to be **additive at a trustable post-normalization FN rate**. Neither is established:
- Additivity is *contra-indicated* by the volume-driven contradiction signal and the non-tracking against crux_addressed_ratio.
- "Trustable FN rate" requires **double-annotation** of the FN gold set (design §11/§12 defer thresholds until then); it is single-annotator today.
- n=9 is under the R-1 replication gate (n≥10); convergence is n=3.

**Before this can be re-evaluated (not step 3 itself):**
1. **n≥10 top-up**, the matched pool has 62 debates; bump `-MaxDebates` to clear the replication gate (PowerShell offered this).
2. **Double-annotate the FN gold set** (§11 persistence already makes this an upgrade, not a re-run) so the paraphrase-FN result certifies precision, not just direction.
3. Only then re-run this join and re-read §12.

Do **not** proceed to step 3 (grounded-rebuttal A/B) now. It re-triggers calibration validation, a fresh TL gate, and, if it gates or changes any metric/schema, the t/3361 mandatory Second Opinion; none of that is warranted on a negative-leaning, under-powered read.

## Provenance

Harness emission: `.fol-eval-corr-final/` (correlation-index.json, fn-rate-report.json, formalized/classified/resolved-clauses.jsonl, contradictions.jsonl), n=12 durable run (PowerShell, §9). Join computed by CL against `debates/debate-<id>.json` `calibration_log.{crux_addressed_ratio, convergence_score_at_termination, crux_undecided_rate}`. Metrics are **stipulated/instrument-provisional**, this join gates nothing and moves no threshold; it informs the step-3 decision only.
