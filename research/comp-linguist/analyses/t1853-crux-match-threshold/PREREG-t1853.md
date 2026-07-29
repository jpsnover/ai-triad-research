# Preregistration — CRUX_MATCH_SIMILARITY_THRESHOLD golden-set validation (t/1853)

**Author:** Computational Linguist
**Last updated:** 2026-07-29
**Status:** registered BEFORE any similarity was computed. Gold labels (`gold.json`) were
authored by reading crux descriptions only — the labeler saw no embedding or cosine value.

## Question

Does the stipulated `CRUX_MATCH_SIMILARITY_THRESHOLD = 0.5` (greedy 1:1 cosine matching,
`calibrationLogger/extract-metrics.ts::computeCruxSemanticDivergence`) recover the
hand-matched engine↔evaluator crux pairs on archived sessions?

## Materials

- `candidates.json`: first 12 archived sessions (deterministic filename order, no cherry-picking)
  from `ai-triad-data/debates/` with a non-empty `crux_tracker`, a valid final neutral
  evaluation with cruxes, and AN nodes for the engine cruxes. 146 engine × 50 evaluator cruxes.
- `gold.json`: CL hand labels. For each evaluator crux judged, the SET of engine cruxes whose
  claim describes the same disagreement (sets may overlap across evaluator cruxes — several
  engine claims can be facets of one crux). `confidence: high|medium`. Evaluator cruxes with
  no entry are NOT judged "no match" — they are excluded from scoring (uncertain).
  36 evaluator cruxes labeled (23 high-confidence) → meets the ~30-pair AC (t/1853#1).
- Embeddings: computed offline with the production path's model (all-MiniLM-L6-v2 via ONNX,
  same as `adapter.computeQueryEmbedding`), engine side over `node.text.slice(0,300)` and
  evaluator side over `description.slice(0,300)` — byte-identical inputs to the production
  instrument. Stored session embeddings are not used, so all 12 sessions score uniformly.

## Scoring (fixed before running)

Run the shipped matcher (`computeCruxSemanticDivergence` logic: all pairs ≥ θ, sort by
similarity desc, greedy 1:1) per session at each θ.

- **Precision(θ)** = among predicted pairs whose evaluator crux is labeled, fraction with
  engine crux ∈ gold set.
- **Recall(θ)** = fraction of labeled evaluator cruxes matched to some engine crux in their
  gold set.
- Computed on the high-confidence subset (primary) and all-labeled (secondary).

## Bar (pass/fail, fixed before running)

At θ = 0.5 on the **high-confidence subset**: **precision ≥ 0.80 AND recall ≥ 0.70.**

- Pass → threshold stays 0.5; provenance promotes stipulated → **derived** (this analysis);
  matched-divergence readings may be read directionally (t/1853#1 activation condition (a)
  still governs when anyone *needs* to).
- Fail at 0.5 but some θ in the sweep (0.30–0.70, step 0.05) passes → recommend that θ,
  provenance derived, note the stipulated value was wrong.
- No θ passes → the embedding-coreference approach itself is in question for this data;
  matcher stays shipped but readings stay untrusted; escalate on the ticket. Do NOT tune
  past the sweep grid to force a pass.

## Known limits (declared up front)

- Labels are CL (agent) judgments, not third-party human judgments — the register class this
  can support is `derived`, never `human-validated`. Owner spot-check invited.
- 12 sessions, one topic universe (AI policy) — no claim of transfer beyond this corpus.
- Greedy 1:1 is scored as shipped; no alternative assignment algorithms are evaluated here.
