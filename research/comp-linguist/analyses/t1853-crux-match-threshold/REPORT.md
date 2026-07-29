# CRUX_MATCH_SIMILARITY_THRESHOLD golden-set validation — result (t/1853)

**Author:** Computational Linguist
**Last updated:** 2026-07-29
**Prereg:** `PREREG-t1853.md` (registered before any similarity was computed; labels in `gold.json` were authored blind to embeddings)
**Verdict: FAIL branch of the prereg — no threshold on the grid passes the recall bar. Threshold stays 0.5 and stays `stipulated`; matched-divergence readings stay untrusted for directional use. Follow-up: t/1920.**

## Numbers (high-confidence subset, n=23 labeled evaluator cruxes)

| θ | precision | recall | predicted pairs |
|---|---|---|---|
| 0.30 | 0.652 | 0.652 | 23 |
| 0.35 | 0.636 | 0.609 | 22 |
| 0.40 | 0.650 | 0.565 | 20 |
| 0.45 | 0.647 | 0.478 | 17 |
| **0.50** | **0.833** | **0.435** | 12 |
| 0.55 | 0.889 | 0.348 | 9 |
| 0.60 | 1.000 | 0.261 | 6 |
| 0.65 | 1.000 | 0.174 | 4 |
| 0.70 | 1.000 | 0.087 | 2 |

Bar was precision ≥ 0.80 AND recall ≥ 0.70 at θ=0.5. Precision passes; recall fails, everywhere on the grid. All-labeled subset (n=36) tells the same story (`results.json`).

## The distribution TL asked for (e/47#2 note 1)

0.5 does **not** sit in a clean gap — it sits on a slope. Gold pairs: n=65, mean 0.463, min 0.148, max 0.743. Non-gold pairs: n=405, mean 0.294, p95 0.510. The two distributions overlap through the entire 0.30–0.55 band; roughly half the true pairs lie *below* 0.5, and the non-gold 95th percentile lies *above* it. No cosine threshold on this basis separates them.

## Interpretation

1. **What survives:** matches the shipped instrument makes at 0.5 are trustworthy (precision 0.83, → 1.0 by 0.60). A matched pair's status comparison is about a genuinely shared crux. The t/1853#1 reasoning that same-proposition coreference is embedding-friendly was directionally right — but only for the upper half of the similarity range.
2. **What fails:** coverage. ~57% of true engine↔evaluator pairs fall below 0.5, so `crux_match_stats.engine_unmatched` / `evaluator_unmatched` **overstate coverage asymmetry** — most "unmatched" cruxes in current data are low-similarity true pairs, not instrument disagreements. Consumers must not read unmatched counts as "the other instrument missed this crux."
3. **Why (evidenced):** register/basis mismatch. Engine side embeds a one-sided *claim* ("Joint-and-several upstream liability answers the severed-causation point…"); the evaluator writes a neutral *disagreement statement* ("Whether a cross-domain criterion can float above sectors, or…"). Same crux, different speech act, systematically depressed cosine. Exploratory check (`results-exploratory-desc.json`, outside prereg): using engine `TrackedCrux.description` instead of node text is a **no-op** — description is byte-identical to node text in 146/146 sampled cruxes, so there is no existing engine-side text that closes the gap. Fix mechanisms are catalogued in t/1920.

## Disposition (per prereg, no discretion exercised)

- Threshold **stays 0.5** — the precision-favoring choice; per prereg we do not tune past the grid, and no grid value passes anyway.
- Register class **stays `stipulated`** (a failed validation is not `derived`); register row updated with this result and evidence pointer.
- Matched-divergence readings **stay untrusted** for directional interpretation; the t/1853#1 activation triggers still govern.
- Follow-up mechanism work: **t/1920** (evidence-gated, same triggers as parent).

## Reproduction

`npx tsx research/comp-linguist/analyses/t1853-crux-match-threshold/sweep_threshold.mts` from the repo root (ONNX all-MiniLM, provider recorded in results.json; engine side `node_text.slice(0,300)`, evaluator side `description.slice(0,300)` — byte-identical inputs to the production instrument). `T1853_ENGINE_SIDE=description` runs the exploratory variant.

## Limits

- Labels are CL agent judgments (blind to similarities but not third-party human) — ceiling is `derived`, never `human-validated`; owner spot-check invited, labels are in `gold.json`.
- 12 sessions, one topic universe, one embedding model. Greedy 1:1 scored as shipped.
