# Stage-0 results: embedding composition MRR (t/2440, option B)

**Last updated:** 2026-08-10 · **Pre-registration:** t/2440#4 · **Full results comment:** t/2440#5

PI approved a Stage-0 measurement (no corpus changes) to decide t/2425 option B: regenerate the corpus at a weighted composition (the register's 0.611/0.389, or the golden-set-validated 0.8/0.2) instead of the live description-only. Verdict: **NO-GO**.

## Method

Encoder all-MiniLM-L6-v2 / sentence-transformers 4.1.0. Node vectors composed via `embed_taxonomy._compose_field_texts` (raw per-field encode, weighted sum, single L2). Claim vector = `claim_text` normalized. Rank the gold node among the candidate pool. Run: `AI_TRIAD_DATA_ROOT=<data-repo> python stage0_mrr.py`.

- **PRIMARY (decision basis), human-labeled n=25:** `_golden_validation_results.json`, gold node = `corrected_node` (verdict `incorrect`) or `original_node` (`correct`); `uncertain`/`novel` excluded.
- **SECONDARY, pipeline-attributed n=664 (CONFOUNDED):** `_golden_test_set.json` `attributed_node`, biased toward its build composition. Direction only, never the decision basis.

## Results

### PRIMARY, same-POV pool (registered)

| composition | MRR | ΔMRR% | Top-1 | R@3 |
|---|---|---|---|---|
| description-only (baseline) | 0.4538 | +0.0 | 0.280 | 0.600 |
| 0.8/0.2 | 0.4548 | +0.2 | 0.280 | 0.560 |
| 0.611/0.389 | 0.4051 | −10.7 | 0.200 | 0.520 |
| 0.55/0.35/0.10 (lineage) | 0.4291 | −5.4 | 0.240 | 0.560 |

### PRIMARY, all-node pool (sensitivity; 16/25 human-gold nodes are cross-POV)

| composition | MRR | ΔMRR% | Top-1 |
|---|---|---|---|
| description-only (baseline) | 0.2691 | +0.0 | 0.200 |
| 0.8/0.2 | 0.2494 | −7.3 | 0.160 |
| 0.611/0.389 | 0.2291 | −14.9 | 0.120 |
| 0.55/0.35/0.10 (lineage) | 0.2479 | −7.9 | 0.160 |

### SECONDARY, pipeline-attributed (confounded)

| composition | MRR | ΔMRR% | Top-1 |
|---|---|---|---|
| description-only (baseline) | 0.6284 | +0.0 | 0.465 |
| 0.8/0.2 | 0.7034 | +11.9 | 0.568 |
| 0.611/0.389 | 0.6310 | +0.4 | 0.470 |
| 0.55/0.35/0.10 (lineage) | 0.6268 | −0.3 | 0.468 |

## Verdict (registered rule applied; bar not moved)

**NO-GO.** No composition clears the +5% MRR bar on the primary human-labeled set. 0.8/0.2 is a flat tie (+0.2%); **0.611/0.389 is worse** (−10.7% same-POV, −14.9% all-node). The register's "0.611/0.389 +14% MRR" is **refuted**: it is negative-to-flat on every sound view. The only positive weighted signal (0.8/0.2 +11.9%) appears solely on the confounded secondary set, does not replicate on human labels, and is the circular-reference artifact the pre-registration flagged.

The worry that going description-only (option A) "silently regressed ~12%" is **not supported**: description-only is at least as good as every weighted blend on human labels. Option A cost no retrieval quality.

## Caveat

The primary human-labeled set is small (n=25) and enriched for hard cases (15/25 were originally mis-attributed). It cannot power a fine-grained weighting decision. It is, however, consistent across scopings, and it decisively refutes the specific +14% claim for 0.611/0.389. If retrieval quality is revisited, the prerequisite is a larger human-labeled golden set, and the candidate would be 0.8/0.2, not 0.611/0.389, plus the editor-path composition fix (proposal §6).
