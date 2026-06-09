# Extraction Pipeline Quality Experiment Protocol

**Ticket:** t/534
**Author:** Computational Linguist
**Date:** 2026-06-09
**Status:** Protocol design (pre-execution)

## Purpose

Measure whether the prompt improvements from t/529 (REC-1 through REC-5) collectively improve document extraction quality. The changes under evaluation:

| Ticket | RECs | Change |
|--------|------|--------|
| t/530 | REC-1 + REC-2 | Effort floors + `canonical_proposition` field |
| t/531 | REC-3 + REC-5 | Salience tiers + HOW-dominates precedence |
| t/532 | REC-4 | Non-contiguous verbatim spans |

## Design

**A/B comparison** on a fixed test set. Condition A uses the pre-change prompt (existing summaries serve as baseline). Condition B uses the post-change prompt (all RECs applied). Three runs per document in Condition B to measure inter-run variance.

## Test Set Selection

**Size:** 15 documents from the 586 existing summaries.

**Stratification criteria:**

| Stratum | Count | Selection rule |
|---------|-------|----------------|
| Short documents (<3K words) | 5 | Sample from shortest quartile of summaries |
| Medium documents (3–8K words) | 5 | Sample from middle two quartiles |
| Long documents (>8K words) | 5 | Sample from longest quartile |

**Within each length stratum, ensure:**
- At least 2 documents per POV focus: accelerationist-dominant, safetyist-dominant, skeptic-dominant, and balanced
- At least 2 documents where existing extraction produced ≤4 key_points per camp (sparse extraction — potential REC-1 improvement target)
- At least 2 documents with known BDI edge cases (mechanism-bearing normative claims — REC-5 target)
- At least 2 documents with distributed arguments across sections (REC-4 target)
- All must have `snapshot.md` source text available in `ai-triad-sources`

**Selection procedure:**
1. Query all summaries for word count, key_point counts per camp, and BDI distribution
2. Rank by representativeness within each stratum
3. Verify source snapshot availability
4. Final selection reviewed before execution

## Metrics

### Tier 1 — Automated (all 15 documents, all runs)

These metrics can be computed programmatically from extraction output JSON.

| ID | Metric | What it measures | Target REC | Computation |
|----|--------|-----------------|------------|-------------|
| A1 | Extraction density | Total key_points across all camps | REC-1 | Count `pov_summaries.*.key_points` |
| A2 | Empty cell usage | Frequency and distribution of `empty_cells` | REC-1 | Count declarations, check camp×category coverage |
| A3 | Canonical proposition completeness | % of key_points with `canonical_proposition` | REC-2 | Non-null, non-empty field presence |
| A4 | Canonical proposition length | % within ≤30-word limit | REC-2 | Word count per `canonical_proposition` |
| A5 | Canonical proposition register | Modal register correctness (heuristic) | REC-2 | Pattern match: Beliefs→indicative markers, Desires→deontic markers, Intentions→mechanism markers |
| A6 | BDI distribution shift | Category balance change | REC-5 | Compare Desires/Intentions ratio pre vs post |
| A7 | Inter-run variance | Consistency across repeated runs | REC-3 | Jaccard similarity of taxonomy_node_id sets across 3 runs |
| A8 | Multi-span usage | % of verbatim fields using array format | REC-4 | Type check on verbatim field |
| A9 | Taxonomy attribution rate | % of key_points with non-null `taxonomy_node_id` | General | Null check |

**A5 register heuristic detail:**

The heuristic checks surface markers, not deep semantics. It will produce false positives/negatives — treat as a signal for human review, not a definitive measure.

- **Beliefs (indicative):** Contains "is/are/was/were/causes/produces/leads to/results in" without "ought/should/must"
- **Desires (deontic):** Contains "ought/should/must/necessary/imperative" without mechanism language
- **Intentions (instrumental):** Contains "by means of/through/via/by [gerund]/achieve...by/implement/deploy/establish" or specifies a mechanism/method

### Tier 2 — Human-Evaluated (5-document deep dive)

Select the 5 documents with the largest aggregate Tier 1 metric deltas for deep evaluation.

| ID | Metric | Scoring rubric | Target REC |
|----|--------|---------------|------------|
| H1 | Extraction recall | Binary per identifiable claim: **found** / **missed** | REC-1, REC-3 |
| H2 | Extraction precision | 3-point: **genuine** (distinct real claim) / **marginal** (real but near-duplicate or too granular) / **noise** (fabricated, restatement, or non-claim) | REC-1 |
| H3 | BDI classification accuracy | Binary: **correct** / **incorrect** category. Focus on mechanism-bearing claims where REC-5 applies. | REC-5 |
| H4 | Canonical proposition quality | 4-point: **excellent** (correct register + content preserved + no POV contamination) / **good** (minor register deviation) / **fair** (content OK but wrong register) / **poor** (content lost or POV-contaminated) | REC-2 |
| H5 | Verbatim fidelity | 3-point: **exact** (word-for-word match to source) / **minor deviation** (minor formatting/punctuation difference) / **misleading** (altered meaning or wrong passage) | REC-4 |
| H6 | Empty cell accuracy | Binary: **justified** (cell is truly empty in source) / **unjustified** (claims exist but were missed) | REC-1 |

**H1 recall procedure:**
1. Human reads the source `snapshot.md` and independently identifies all key claims (target: exhaustive)
2. Each identified claim is checked against the extraction output
3. Recall = matched claims / total identified claims

## Existing Baselines (Reuse)

These prior validations were run with the pre-change prompt and serve as Phase A reference points:

| Validation | Ticket | Result | Applicable to |
|-----------|--------|--------|---------------|
| Extraction coverage | t/373 | 39.1% on 133 verifiable elements | H1 (recall) baseline |
| Sentence 1 fidelity | t/381 | 12.0% distortion rate (200 key points) | H5 (verbatim fidelity) baseline |
| De-artifacting | t/330 | Formulaic transitions eliminated (Opus 4.6) | Qualitative reference |

## Procedure

### Phase 0: Baseline capture
1. For each test set document, record the existing summary as Condition A
2. Compute all Tier 1 automated metrics on Condition A (note: A2, A3, A4, A5, A8 will be zero/null since these features don't exist in old extractions — this is expected)
3. For Tier 1 metrics that are meaningful on Condition A (A1, A6, A7, A9): record values

### Phase 1: Post-change extraction
1. Ensure all three prompt change tickets (t/530, t/531, t/532) are merged
2. Run extraction on all 15 test documents using `Invoke-POVSummary` with post-change prompt
3. Run each document 3× (separate invocations) for inter-run variance measurement (A7)
4. Store all 45 output files (15 docs × 3 runs) in `research/comp-linguist/t534-experiment/`

### Phase 2: Automated evaluation
1. Run Tier 1 metric computation script on all Phase 0 and Phase 1 outputs
2. Compute deltas and 95% confidence intervals where sample size allows
3. Identify the 5 documents with largest aggregate Tier 1 deltas for Tier 2

### Phase 3: Human evaluation
1. For each of the 5 selected documents:
   a. Read source `snapshot.md` and independently identify all key claims (H1 ground truth)
   b. Score each extracted key_point on H2 through H6
   c. Score each `empty_cells` declaration on H6
2. Compute aggregate human evaluation metrics

### Phase 4: Report
1. Produce summary report with:
   - Tier 1 metric deltas (table with pre/post/delta/significance)
   - Tier 2 metric scores (table with per-document and aggregate)
   - Qualitative observations
   - Recommendations for further improvements
2. Post report as t/534 comment and as standalone document

## Success Criteria

| Metric | Threshold | Rationale |
|--------|-----------|-----------|
| A3 (canonical prop completeness) | ≥95% | New required field — should be near-universal |
| A4 (canonical prop length) | ≥90% within 30 words | Hard constraint in prompt |
| A7 (inter-run Jaccard) | >0.60 | REC-3 salience tiers should reduce variance |
| H3 (BDI accuracy) | ≥85% | REC-5 precedence rule targets the primary confusion source |
| H4 (canonical prop quality) | ≥70% "excellent" or "good" | Register match is the core REC-2 deliverable |
| A1 (extraction density) | No regression | Effort floors should not reduce genuine extraction |
| A9 (attribution rate) | No regression | Prompt changes should not degrade taxonomy matching |

## Dependencies

- **t/530, t/531, t/532** must be merged before Phase 1
- **Model consistency:** Use the same model and temperature for all Phase 1 runs. Record model version.
- **Taxonomy version:** Record taxonomy node count at time of extraction. Node additions between Phase 0 and Phase 1 would confound A9.

## Cost Estimate

- Phase 1: 15 docs × 3 runs × ~5K-20K tokens per extraction = ~225K-900K tokens (depends on document length)
- At Gemini 2.5 Flash pricing: estimated $0.50-2.00 total
- Human evaluation time: ~2-3 hours for 5-document deep dive

## Deliverables

1. This protocol document (done)
2. Test set selection script + selected document list
3. Tier 1 automated evaluation script
4. Phase 1 extraction outputs (45 files)
5. Summary report with quantitative comparison and recommendations

## Cross-References

- **t/529** — Source review document with all 8 recommendations
- **t/530** — REC-1 + REC-2 implementation (CL approved)
- **t/531** — REC-3 + REC-5 implementation (CL approved)
- **t/532** — REC-4 implementation (CL approved)
- **t/507** — Claim matching improvement (debate-side evaluation, separate from this experiment)
- **t/373** — Extraction coverage validation (baseline)
- **t/381** — Sentence 1 fidelity validation (baseline)
