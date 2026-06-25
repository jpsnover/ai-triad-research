# Embedding Experiment Design: DOLCE Phrasing & Claim Attribution

**Ticket:** t/507  
**Status:** Phase 1 complete (golden test set built), Phase 2 design in review

## Motivation

The claim-to-POV-node attribution pipeline maps debate claims to taxonomy nodes via cosine similarity of all-MiniLM-L6-v2 embeddings (384-dim). Phase 1 analysis revealed:

- **Average similarity: 0.497** — weak, barely above the 0.35 attribution threshold
- **54.8% of claims** score in [0.35, 0.50) — the system is guessing more than matching
- **Only 1.6%** score above 0.70 — strong matches are rare

This suggests a register mismatch: formal DOLCE descriptions ("A Belief within accelerationist discourse that advocates for...") vs informal debate claims ("Companies need to move fast or competitors will eat them alive").

## Current Pipeline

**POV node embedding input** (`taxonomyDataSlice.ts:407`):
```
stripExcludes(node.description)
```
Example: "A Desire within accelerationist discourse that advocates for deploying advanced artificial intelligence to eradicate material scarcity. Encompasses: resource abundance, climate stabilization, universal healthcare."

**Claim embedding input**: Raw extracted claim text, no preprocessing.

**Attribution** (`argumentNetwork.ts:1460`): Cosine similarity against same-POV Belief nodes only. Primary threshold: 0.35. Top-1 match = primary_ref.

**Available but unused node fields:** `label`, `graph_attributes`, `parent_id`, `situation_refs`, `children`, edges (CONTRADICTS, WEAKENS, etc.)

## Experiment Design

### Independent Variables

#### A. POV Node Embedding Variants

| ID | Name | Embedding Input | What It Tests |
|----|------|----------------|---------------|
| **A** | Current baseline | DOLCE description minus Excludes | Baseline — formal genus-differentia |
| **B** | Full description (with Excludes) | DOLCE description INCLUDING Excludes clause | Whether Excludes helps discriminability (removed per t/447 on intuition, not data) |
| **C** | Plain differentia | Strip DOLCE prefix ("A [BDI] within [POV] discourse that") and Encompasses/Excludes, keep only the core differentia | Whether DOLCE framing is noise for similarity matching |
| **D** | Label + differentia | `{node.label}. {core differentia}` | Whether the concise label anchors the embedding better than DOLCE framing |
| **E** | Claim-style rephrase | Rephrase each description as a natural-language claim: "I believe that...", "We should...", "The evidence suggests..." (based on BDI category) | Whether register-matching the claim format improves similarity |
| **F** | Description + assumptions | `{description minus Excludes}. Key assumptions: {assumptions if available}` | Whether assumptions (currently unused) capture implicit reasoning that claims echo |
| **G** | Enriched with adversarial edges | `{label}. {differentia}. This position is opposed by: {CONTRADICTS/WEAKENS target labels}` | Whether adversarial context improves discriminability between sibling nodes |
| **H** | Full description + adversarial edges | `{full DOLCE description with Excludes}. Opposed by: {CONTRADICTS/WEAKENS target labels}` | Combined effect: Excludes for self-boundary + edges for relational positioning |
| **I** | Keywords only | Extract key concepts from description, embed as keyword/phrase list | Whether semantic density beats sentence structure |

#### B. Claim Embedding Variants

| ID | Name | Claim Processing | What It Tests |
|----|------|-----------------|---------------|
| **i** | Current baseline | Raw extracted claim text | Baseline |
| **ii** | Decontextualized | Strip debate-specific references, hedging language, filler | Whether cleaner text improves signal |
| **iii** | BDI-tagged | Prepend "Belief: " / "Desire: " / "Intention: " based on claim classification | Whether matching DOLCE's BDI prefix improves category-level alignment |
| **iv** | POV-prefixed | Prepend "{speaker_pov} argument: " | Whether POV anchoring helps same-POV matching |

### Evaluation Protocol

For each combination (POV variant × claim variant):

1. Generate embeddings for **all** POV nodes (acc: 185, saf: 269, skp: 259 = 713 total) using the variant's text construction. Must include all nodes, not just the 175 referenced in the golden set — production attribution runs against the full candidate set, and discriminability depends on the number of competitors (76–165 same-POV Belief nodes per speaker).
2. For each of the 515 golden-set claims, compute cosine similarity against all same-POV Belief candidate nodes (matching production behavior)
3. Compute metrics:

| Metric | Definition | Why It Matters |
|--------|-----------|----------------|
| **Top-1 accuracy** | Does the highest-scoring node match the current attribution? | Direct replacement accuracy |
| **Top-3 accuracy** | Is the current attribution in the top 3? | Tolerance for close calls |
| **Mean Reciprocal Rank (MRR)** | Average of 1/rank of the correct node | Combines rank quality across all claims |
| **Mean similarity** | Average cosine similarity of the top match | Absolute confidence level |
| **Discriminability gap** | Average (top-1 score − top-2 score) | How clearly the best match beats the runner-up |
| **Novel argument rate** | % claims scoring below 0.35 on all nodes | Whether variant pushes valid claims below threshold |

### Key Comparisons

These pairwise comparisons isolate specific hypotheses:

| Comparison | Hypothesis |
|------------|------------|
| A vs B | Does removing Excludes help or hurt? (validates t/447 decision) |
| A vs C | Is DOLCE framing noise or signal? |
| C vs D | Does adding the label improve over bare differentia? |
| A vs E | Does register-matching (claim-style rephrase) close the similarity gap? |
| A vs F | Do assumptions add discriminative signal? |
| D vs G | Do adversarial edges improve discriminability beyond label+differentia? |
| B vs H | Combined: Excludes + edges vs Excludes alone |
| i vs iii | Does BDI-tagging claims help when nodes have BDI prefixes? |
| i vs iv | Does POV-prefixing claims help same-POV matching? |
| C × iii vs A × i | If we strip DOLCE from nodes AND add BDI to claims, is that better than current? |

### Prioritized Execution Order

Not all 36 combinations (9 × 4) need to run. Prioritize:

**Round 1 — Core hypotheses (6 runs):**
1. A × i — baseline
2. B × i — does Excludes help? (challenges t/447)
3. C × i — is DOLCE framing noise?
4. D × i — label + differentia
5. E × i — claim-style rephrase
6. G × i — adversarial edge enrichment

**Round 2 — Claim-side (3 runs, using best POV variant from Round 1):**
7. Best × iii — BDI-tagged claims
8. Best × iv — POV-prefixed claims
9. Best × ii — decontextualized claims

**Round 3 — Combinations (only if Round 1-2 show signal):**
10. Top POV × top claim variant
11. H × i — full enrichment (Excludes + edges)
12. F × i — assumptions (if assumption data exists on nodes)

### Ground Truth Validation

The golden test set uses the current system's attributions as "ground truth." But if the current system has low confidence (avg 0.497), some attributions may be wrong. To address this:

1. **Manual review of 50 claims**: Sample stratified by similarity score:
   - 15 from [0.35, 0.40) — weakest attributions, most likely wrong
   - 20 from [0.40, 0.55) — mid-range
   - 15 from [0.55, 0.82] — strongest attributions
2. For each, a human reviewer assesses: is the attributed node actually the best match?
3. Corrections create a **validated subset** for more trustworthy accuracy measurement
4. If >20% of current attributions are wrong, the experiment benchmarks against the corrected set

### Implementation Notes

**Embedding generation:** Use the ONNX runtime (`lib/embeddings/onnxEmbedding.ts`) directly via a Python script calling the same all-MiniLM-L6-v2 model. Must match the exact model and tokenization used in production.

**Claim-style rephrase (Variant E):** Requires an LLM call to rephrase each of the 175 node descriptions as natural-language claims. Use a deterministic prompt with temperature=0. Cache results — this is a one-time cost.

**Adversarial edge enrichment (Variants G, H):** Use the edge graph from `edges.json` — filter to CONTRADICTS/WEAKENS/TENSION_WITH, take top-3 targets by edge count, use their `label` field.

**Decontextualization (Variant ii):** Strip patterns like "as I mentioned", "in this debate", "the previous speaker", hedging ("perhaps", "it could be argued"), and debate-specific proper nouns.

### Success Criteria

| Outcome | Action |
|---------|--------|
| A variant beats baseline by >5% on MRR | Adopt that variant; create migration ticket |
| B (with Excludes) beats A (without) | Revert t/447 decision; re-embed all nodes with Excludes |
| No variant meaningfully beats baseline | Confirm current approach; document that DOLCE is not the bottleneck |
| Multiple variants tie | Prefer the simpler one (fewer fields, less computation) |

### Deliverables

1. `_golden_test_set.json` — 515 claims with attributions (done)
2. `_golden_validated_subset.json` — 50 manually reviewed claims with corrected ground truth
3. `_embedding_experiment_results.json` — full metrics matrix
4. This document updated with results and recommendation
5. Follow-up ticket if adopting a new embedding strategy
