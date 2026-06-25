# Debate Extraction Quality Experiment Protocol

**Ticket:** t/536
**Author:** Computational Linguist
**Date:** 2026-06-09
**Status:** Protocol design — Phase 1 executable now

## Purpose

Measure whether canonical_proposition (REC-2) and HOW-dominates precedence (REC-5) from t/535 improve debate claim-to-taxonomy attribution quality. Baseline MRR: 0.3128 (optimal weights d=0.67, a=0.33) on 515 golden set claims.

## Design

Three phases, ordered by dependency:

### Phase 1: Offline canonical proposition evaluation (NO MERGE DEPENDENCY)

Generate `canonical_proposition` for the existing 515 golden set claims via a separate LLM call, then re-compute MRR using the canonical propositions for embedding similarity.

**Why this works:** The core hypothesis is that register-normalized claims match taxonomy nodes better than raw debate-register claims. We can test this by normalizing the existing claims without re-running debates.

**Procedure:**
1. Read `_golden_test_set.json` (515 claims)
2. For each claim, call LLM with the canonical_proposition rules:
   - One sentence, ≤30 words
   - Modal register: Beliefs=indicative, Desires=deontic, Intentions=instrumental
   - Strip debate rhetoric, hedging, informal language
   - BDI category inferred from attributed node ID (acc/saf/skp-beliefs/desires/intentions)
3. Embed each canonical_proposition with all-MiniLM-L6-v2
4. Compute cosine similarity against taxonomy node description embeddings
5. Compute MRR, Top-1, Top-5 accuracy
6. Compare against baseline (MRR 0.3128 on raw claim_text)

**Variant:** Also test a blended approach — weighted average of claim_text embedding and canonical_proposition embedding — to see if combining signals outperforms either alone.

### Phase 2: BDI distribution analysis (NO MERGE DEPENDENCY)

**Procedure:**
1. Read 515 golden claims with their current BDI categories (inferred from attributed node IDs)
2. Apply HOW-dominates precedence rule to each claim_text:
   - If claim specifies method/mechanism → Intention
   - If claim states desired end-state without mechanism → Desire
   - If empirical/testable → Belief
3. Compare original vs reclassified BDI distribution against taxonomy ground truth (370 beliefs, 81 desires, 269 intentions)

### Phase 3: Full debate evaluation (BLOCKED ON t/535 MERGE)

**Procedure:**
1. Run 5 new debates on topics matching golden set debates
2. Extract claims with canonical_proposition + HOW-dominates (new pipeline)
3. Build new golden set from these debates
4. Compute MRR with canonical_proposition embeddings
5. Compare calibration metrics (crux_addressed_rate, repetition_rate, claims_forgotten, convergence_score) against historical baselines
6. Sample 50 claims pre/post for qualitative granularity assessment

## Metrics

| Metric | Baseline | Target | Phase |
|--------|----------|--------|-------|
| MRR (canonical_proposition) | 0.3128 (raw text) | >0.35 | 1 |
| Top-1 accuracy | 0.165 | >0.20 | 1 |
| Top-5 accuracy | 0.4835 | >0.55 | 1 |
| BDI distribution KL-divergence from taxonomy | TBD | Lower | 2 |
| Calibration metric stability | Historical | No regression | 3 |

## Dependencies

- Phase 1 + 2: None — uses existing golden set data
- Phase 3: t/535 must be merged
- Embedding model: all-MiniLM-L6-v2 (same as production)
- LLM for canonical proposition generation: gemini-2.5-flash (same model as debate extraction)

## Cross-References

- t/507 — Claim-to-POV attribution gap (parent issue)
- t/533 — Debate claim extraction review (analysis document)
- t/535 — Implementation ticket (canonical_proposition + HOW-dominates for debate pipeline)
- t/534 — Document extraction quality experiment (parallel evaluation)
- `_golden_test_set.json` — 515 claims from 18 debates
- `weight_grid_results.json` — Current embedding weight optimization results
