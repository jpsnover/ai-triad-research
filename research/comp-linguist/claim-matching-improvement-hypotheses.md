# Claim-to-POV Matching: Improvement Hypotheses & Experiments

**Parent ticket:** t/507  
**Status:** Experiments H1, H2, H5, H6 complete; H4 designed; H9 (MRL) tested  
**Date:** 2026-06-08

## Current Production Performance (after Rounds 1-3 optimizations)

| State | Top-1 | MRR | Change |
|-------|-------|-----|--------|
| Original production | 7.4% | 0.1558 | — |
| + Excludes restored (t/513) | 7.4% | 0.1558 | — |
| + Label removed (t/516) | 7.4% | 0.1631 | +0.007 |
| **+ Weights 0.8/0.2 (t/519)** | **10.5%** | **0.1834** | **+0.028 total** |

Total improvement: **+0.028 MRR (+18%), +3.1% Top-1 (+42%)**. Production now matches experiment predictions.

Candidate pool: 76-165 same-POV Belief nodes per speaker. Model: all-MiniLM-L6-v2 (384-dim, 128-token max sequence, 22M parameters).

## Empirical Findings from Specificity Analysis

Before designing experiments, we ran a specificity analysis (`_specificity_analysis.py`) on the 515 golden set claims and 366 Belief node descriptions:

| Metric | POV Nodes | Claims |
|--------|-----------|--------|
| Mean token length | 75.3 | 33.3 |
| >128 tokens (truncated) | 1.4% | 0.8% |
| Mean specifics (entities+numbers+instances) | 0.67 | 0.35 |
| Zero specifics | 65.3% | 85.0% |

**Key finding:** The specificity gap is inverted — POV nodes are MORE specific than claims. 85% of claims contain no named entities, numbers, or instance references. Token truncation affects only 1.4% of POV nodes. These are NOT the primary bottleneck.

The real gap is **register and abstraction level**: POV nodes use formal DOLCE ontological language ("A Belief within accelerationist discourse that posits strict liability frameworks...") while claims use natural debate rhetoric ("Under-investment in safety is a false economy"). The embedding model must bridge this register gap with only 384 dimensions and 22M parameters.

## Hypotheses (ordered by expected impact)

### H1: Cross-Encoder Re-ranking (HIGH expected impact)

**Hypothesis:** Bi-encoder cosine similarity is fundamentally limited for asymmetric matching (specific claim → abstract category). A cross-encoder that attends to both texts jointly will dramatically improve ranking quality.

**Mechanism:** Bi-encoders compress each text into a fixed vector independently — the claim embedding doesn't "see" the POV description. Cross-encoders feed both texts together through a transformer, enabling token-level attention between claim words and description words. This is the standard approach for re-ranking in retrieval systems.

**Experiment:**
1. For each claim, use current bi-encoder to retrieve top-20 candidates (fast)
2. Re-rank top-20 using `cross-encoder/ms-marco-MiniLM-L-6-v2` (or `cross-encoder/stsb-distilroberta-base`)
3. Evaluate Top-1/Top-3/MRR on the re-ranked results

**Cost:** Inference-only, no training. ~20 cross-encoder calls per claim × 515 claims = ~10,300 forward passes. Minutes on CPU.

**Production integration:** Add re-ranking step after initial cosine retrieval. Latency: ~50-100ms per claim (acceptable for debate post-processing).

**Success criterion:** >5% MRR improvement over bi-encoder baseline.

### H2: Larger Embedding Model (HIGH expected impact)

**Hypothesis:** all-MiniLM-L6-v2 (22M params, 384-dim) lacks the capacity to capture the semantic nuance needed to distinguish 76-165 similar Belief nodes. A larger model with more dimensions will improve discrimination.

**Candidates:**
- `all-mpnet-base-v2` — 110M params, 768-dim. Same training, 4x capacity.
- `BAAI/bge-large-en-v1.5` — 335M params, 1024-dim. State-of-the-art general embedding.
- `intfloat/e5-large-v2` — 335M params, 1024-dim. Instruction-tuned.

**Experiment:**
1. Re-embed all 366 Belief nodes using each model (description only, no label — our best config)
2. Use pre-computed claim embeddings if model matches, otherwise re-embed claims too
3. Evaluate same golden set metrics

**Constraint:** Claims in debate files were embedded with all-MiniLM-L6-v2. Different models produce incompatible vector spaces. To test a new model, we must re-embed BOTH claims and POV nodes using the same model. This means either:
- A Python-only experiment that re-embeds everything (easy, what we've been doing)
- A production migration that switches the ONNX model for both claim and node embedding (larger effort)

**Success criterion:** >3% absolute Top-1 improvement.

### H3: Entity Annotation / Class Enrichment (MEDIUM expected impact)

**Hypothesis:** When claims DO contain specific references ("Stanford's 2023 Foundation Model Transparency Index"), the specifics anchor the embedding in an instance space that's far from the abstract POV node embedding. Annotating entities with their class ("Stanford [university]", "Foundation Model Transparency Index [benchmark report]") adds generalization signal.

**Note:** Only 15% of claims have detectable specifics, so the ceiling is limited — but these may be the hardest-to-match claims where improvement has outsized value.

**Experiment:**
1. Use spaCy NER or an LLM to detect and classify entities in claims
2. Append class labels: "Stanford" → "Stanford [university]", "37 out of 100" → "37 out of 100 [low score]"
3. Re-embed enriched claims, evaluate against same POV nodes

**Variants:**
- **H3a: Annotate** — append class in brackets: "Obama [president]"
- **H3b: Generalize** — replace specific with class: "Obama" → "a political leader"
- **H3c: Dual signal** — both: "Obama (a political leader)"

**Success criterion:** >1% MRR improvement overall, >5% on the high-specificity claim subset.

### H4: Claim Abstraction / Core Proposition Extraction (MEDIUM expected impact)

**Hypothesis:** Claims contain rhetorical scaffolding (hedging, debate references, connectives) that adds noise. Extracting the core proposition — the main assertion stripped of rhetoric — would produce cleaner embeddings that match abstract POV descriptions better.

**This differs from Round 2's decontextualization (B×ii)**, which only removed filler words and hedges via regex. This hypothesis uses an LLM to extract the core semantic proposition.

**Example:**
- Claim: "Stanford's 2023 Foundation Model Transparency Index scored the top ten foundation model developers an average of 37 out of 100 — a damning indictment that the market alone cannot produce adequate transparency."
- Core proposition: "Market forces alone cannot produce adequate AI transparency."

**Experiment:**
1. Use an LLM (Gemini flash, temp=0) to extract core propositions from all 515 claims
2. Re-embed core propositions
3. Evaluate against POV nodes

**Success criterion:** >2% MRR improvement.

### H5: Hybrid Retrieval — BM25 + Embeddings (MEDIUM expected impact)

**Hypothesis:** Embedding similarity and keyword overlap capture different signal. Specific terms in claims (even non-entity ones like "strict liability", "transparency") might keyword-match strongly against POV descriptions that use the same terminology, even when embedding vectors diverge.

**Experiment:**
1. Build BM25 index over POV node descriptions (full text with Excludes)
2. For each claim, compute BM25 score against all same-POV candidates
3. Test fusion strategies:
   - **Linear:** `α × cosine + (1-α) × BM25_normalized`, sweep α from 0.3 to 0.9
   - **Rank fusion:** Reciprocal Rank Fusion (RRF) of the two ranked lists
4. Evaluate combined scores

**Cost:** BM25 is trivial to compute (rank-bm25 Python package). No model loading needed.

**Success criterion:** >2% MRR improvement over embedding-only.

### H6: Remove Label from Embedding Input (HIGH confidence, LOW effort)

**Hypothesis:** Confirmed by Round 3 data — prepending `node.label` to the description before embedding hurts accuracy. Round 1-2 (no label) achieved MRR 0.1847 vs Round 3 W2 (with label) at 0.1522.

**Experiment:** Already effectively tested. Run one confirmation: Round 3 W3 weights (0.8/0.2) WITHOUT label prepending.

**Implementation:** Remove lines 208-210 in `embed_taxonomy.py` that prepend the label. Regenerate embeddings.

**Success criterion:** MRR approaches 0.18+ when combined with optimal weights.

### H7: Multi-Vector POV Representation (LOW expected impact)

**Hypothesis:** POV descriptions are semantically dense — they pack a core differentia, Encompasses items, and (now) Excludes into one text. A single 384-dim vector can't capture all facets. Multiple vectors per node (one for differentia, one for Encompasses, one for Excludes) with max-similarity matching could help.

**Experiment:**
1. Split each POV description into components: differentia, Encompasses items, Excludes items
2. Embed each component separately
3. For each claim, compute similarity against all component vectors; take the max per node
4. Rank by max component similarity

**Risk:** Increases candidate vectors 3x, slowing retrieval. May fragment signal rather than improve it.

**Success criterion:** >2% MRR improvement.

### H8: Contrastive Fine-Tuning (HIGH expected impact, HIGH effort)

**Hypothesis:** The embedding model was trained on general web text. Fine-tuning on our domain (claim→node pairs) would teach it the mapping between debate rhetoric and ontological descriptions.

**Experiment:**
1. Use the 515 golden set claim→node pairs as positive examples
2. Use same-POV non-attributed nodes as hard negatives
3. Fine-tune all-MiniLM-L6-v2 with contrastive loss (MultipleNegativesRankingLoss)
4. Evaluate with 5-fold cross-validation to avoid overfitting

**Risk:** Small training set (515 pairs). Overfitting is likely without careful regularization. The golden set ground truth is itself unvalidated (t/511).

**Prerequisite:** t/511 (ground truth validation) should complete first to ensure we're training on correct pairs.

**Success criterion:** >10% MRR improvement in cross-validation.

### H9: Matryoshka Representation Learning (TESTED — no benefit)

**Hypothesis:** MRL-trained models encode coarse semantics in early dimensions and fine detail in later dimensions. If the register gap between claims and POV descriptions is a "too much detail" problem, truncating to lower dimensions (e.g., 128 or 256) might improve matching by discarding register-specific noise while retaining topic-level similarity.

**Tested model:** nomic-ai/nomic-embed-text-v1.5 (768-dim, MRL-capable)

**Results:**

| Dimension | Top-1 | MRR | vs Full |
|-----------|-------|-----|---------|
| 768 (full) | 4.5% | 0.1127 | — |
| 512 | 4.8% | 0.1106 | -0.002 |
| 256 | 4.7% | 0.1066 | -0.006 |
| 128 | 2.9% | 0.0896 | -0.023 |
| 64 | 4.1% | 0.0934 | -0.019 |

**Conclusion:** Matryoshka truncation uniformly hurts — lower dimensions lose discriminative signal without gaining anything. The register gap is NOT a dimensionality problem. The coarse semantic features in early dimensions are not more useful than the full representation. Additionally, the nomic model itself significantly underperforms MiniLM (MRR 0.1127 vs 0.1640), so MRL with a better base model might behave differently — but no MRL-capable model in the MiniLM family exists.

---

## Experiment Results Summary

### Completed Experiments

| ID | Hypothesis | Result | MRR Impact |
|----|-----------|--------|------------|
| **H6** | Remove label prepending | **SHIPPED** ✓ | +0.007 |
| — | Restore Excludes (Round 1) | **SHIPPED** ✓ | +0.013 (experiment) |
| — | Reduce assumes weight (Round 3) | **SHIPPED** ✓ | +0.020 |
| H1 | Cross-encoder re-ranking | **FAILED** ✗ | -0.031 (ms-marco model wrong domain) |
| H5 | BM25 hybrid fusion | **FAILED** ✗ | 0.000 (vocabulary gap too large) |
| H2 | Larger embedding model | **FAILED** ✗ | -0.039 to -0.064 (all worse than MiniLM) |
| H9 | Matryoshka truncation | **FAILED** ✗ | -0.002 to -0.023 (loses signal) |
| H4 | LLM claim abstraction | **FAILED** ✗ | -0.026 to -0.084 (abstraction loses signal) |

### Key Lessons from Negative Results

1. **Off-the-shelf retrieval tools don't solve ontology classification.** BM25, a web-search cross-encoder (ms-marco), and larger general-purpose embedding models all fail. Note: only one cross-encoder architecture was tested — NLI-based and LLM-judge reranking remain untested (see H1b, H11).

2. **The vocabulary gap is real.** BM25 and cosine agree on top-1 only 10.5% of the time. Claims and POV descriptions use fundamentally different words for the same concepts.

3. **Larger off-the-shelf embedding models did not outperform MiniLM on this task.** MiniLM (22M params) beats models 5-7x larger. Possible explanations include training objective mismatch, domain mismatch, and pooling differences — not necessarily that model capacity is irrelevant.

4. **Matryoshka truncation did not help for nomic-embed-text-v1.5.** Dimensional truncation uniformly hurt. This does not rule out dimensionality effects for other architectures.

5. **Claim abstraction (information removal) destroys signal.** H4 and Round 2 both hurt accuracy. The "rhetorical scaffolding" carries vocabulary MiniLM uses for matching. However, information *addition* (query expansion into ontology language) is a fundamentally different operation and remains untested (see H10).

### Revised Problem Framing (per external review, 2026-06-08)

The "register gap" diagnosis is **partially correct but incomplete**. The actual task is **latent ontology classification disguised as retrieval**. The claim "Under-investment in safety is a false economy" maps to "market incentives fail to internalize AI safety externalities" not through lexical similarity but through shared economic reasoning, causal structure, and ideological framing. This means:

- Better embeddings alone may have a ceiling far below 100%
- The problem may not be solvable purely through representation learning
- Ground truth quality and ontology granularity may be dominant bottlenecks

### Critical Missing Analyses (identified by external review)

1. **Error taxonomy** — We've treated all ranking failures as one phenomenon. Need to categorize: near-miss sibling, wrong branch, wrong abstraction level, multiple valid nodes, golden-set ambiguity, missing ontology coverage. This determines which interventions can help.

2. **Hierarchical accuracy** — Collapse nodes to parent/grandparent categories and measure accuracy at each level. If parent-level accuracy is 45% while leaf is 10.5%, the model already understands concepts and fails only on granularity — changing strategy from "better embeddings" to "taxonomy restructuring."

3. **LLM classification upper bound** — Give an LLM the claim + all same-POV candidate descriptions and ask it to classify. If LLM achieves ~15%, the ontology itself is the bottleneck. If 60%, representation learning has room to improve. This provides the ceiling that contextualizes all embedding work.

### What This Points To

Six hypotheses have failed (H1, H2, H4, H5, H9, Round 2). Before pursuing more embedding experiments, we need diagnostic work that determines whether the problem is solvable through matching improvements at all.

**Tier 1 — Diagnostics (do first):**
- Ground truth audit (t/511) — GUI in progress
- Error taxonomy — build from existing 515-claim results
- Hierarchical accuracy — free from taxonomy parent_id structure
- LLM upper-bound classification — cheap benchmark

**Tier 2 — Informed experiments (after Tier 1):**
- H10: Query expansion into ontology language (adds information, unlike H4 which removed it)
- H1b: NLI/DeBERTa cross-encoder (tests entailment, not web relevance like ms-marco)
- H11: LLM-judge reranking

**Tier 3 — Only if Tier 1-2 show the task is learnable:**
- H8: Contrastive fine-tuning with leave-one-debate-out / leave-one-topic-out validation
- H3: Entity annotation (low expected value given H4 failure)

---

## H4: LLM Claim Abstraction — TESTED (negative)

### Rationale

The hypothesis was that semantic reformulation — using an LLM to extract the core abstract proposition from a claim — would bridge the register gap by producing text closer to DOLCE descriptions.

### Claim Transformation Examples

| Original Claim | Core Proposition |
|----------------|-----------------|
| "Stanford's 2023 Foundation Model Transparency Index scored the top ten foundation model developers an average of 37 out of 100 — a damning indictment that the market alone cannot produce adequate transparency." | "Market forces alone cannot produce adequate AI transparency." |
| "Under-investment in safety is a false economy, and strict liability corrects that market failure." | "Strict liability corrects the market failure of under-investment in AI safety." |
| "The state-of-the-art defense is particularly dangerous for AI because 'state of the art' in AI safety is contested, evolving, and inherently hard to define." | "State-of-the-art legal defenses are problematic for AI because AI safety standards are contested and ill-defined." |

### Experiment Protocol

**Step 1: Generate core propositions**
- LLM: Gemini Flash (free tier, temp=0, deterministic)
- Prompt:
  ```
  Extract the core abstract proposition from this debate claim.
  Strip: specific names, numbers, dates, citations, rhetorical devices,
  hedging, debate references, and examples.
  Keep: the fundamental assertion about AI policy, safety, or governance.
  Return ONLY the proposition in one sentence, no explanation.

  Claim: {claim_text}
  ```
- Generate for all 515 golden set claims
- Cache results (one-time cost)

**Step 2: Evaluate**
- Re-embed core propositions using all-MiniLM-L6-v2 (matching production model)
- Compare against same-POV Belief nodes using current production embeddings
- Evaluate Top-1/Top-3/MRR against golden set

**Step 3: Variant testing**
- **H4a: Core proposition only** — embed just the extracted proposition
- **H4b: Proposition + original** — concatenate: "{proposition}. {original_claim}"
- **H4c: Proposition + BDI tag** — prepend BDI category: "Belief: {proposition}" (tests whether BDI-tagging helps when combined with abstraction, even though it hurt alone in Round 2)

### Success Criteria

- >3% absolute MRR improvement over current production (0.1834)
- If successful, the LLM abstraction step can be added to the debate engine post-extraction pipeline — claims get abstracted before attribution

### Cost and Latency

- One-time generation: 515 claims × ~100 tokens = ~51,500 tokens (~$0.005 on Gemini Flash)
- Production latency: ~200ms per claim for LLM call + ~5ms for embedding — acceptable if batched per debate round
- Can be cached: same claim text → same proposition (deterministic at temp=0)

### Dependencies

- Gemini API key (available via `$env:GEMINI_API_KEY`)
- Current production embeddings (already generated)

### Results (2026-06-08)

**Model:** Gemini 2.5 Flash, temp=0. All 515 claims successfully abstracted (no fallback needed).

| Variant | Top-1 | Top-3 | MRR | Avg Sim | Gap | Novel% |
|---------|-------|-------|-----|---------|-----|--------|
| Baseline (raw claim) | 8.7% | 14.6% | 0.1632 | 0.4708 | 0.0249 | 12.6% |
| H4a: Core proposition | 3.5% | 6.6% | 0.1018 | 0.4546 | 0.0280 | 24.3% |
| H4b: Proposition + original | 6.2% | 13.6% | 0.1369 | 0.4968 | 0.0232 | 6.0% |
| H4c: Proposition + BDI tag | 2.7% | 7.0% | 0.0794 | 0.4983 | 0.0216 | 8.2% |

**Conclusion: FAILED.** All variants worse than baseline. Key observations:
1. **Abstraction destroys matching signal.** H4a's MRR drops 37.6% — the "rhetorical scaffolding" carries vocabulary that MiniLM uses for similarity matching.
2. **Novel rate doubles with abstraction.** 24.3% of abstracted claims fall below the 0.35 threshold (vs 12.6% baseline) — propositions are too generic to match any node.
3. **BDI tagging still hurts.** H4c is worst, consistent with Round 2 findings. BDI prefixes bias the embedding away from semantic content.
4. **Concatenation dilutes.** H4b retains the original text but the proposition prefix dilutes the signal — net negative.

The register gap cannot be bridged by reformulating claims to sound more like ontological descriptions. The LLM produces valid abstractions, but MiniLM can't match them against POV descriptions any better — the embedding space doesn't capture the semantic equivalence between "Market forces alone cannot produce adequate AI transparency" and "A Belief within safetyist discourse that posits market mechanisms are insufficient for ensuring transparency..."

---

## New Hypotheses (from external review, 2026-06-08)

### H10: Synthetic Query Expansion into Ontology Language

**Hypothesis:** Adding an LLM-generated ontology-language description to the claim (rather than replacing the claim as in H4) provides a semantic bridge that improves embedding similarity to DOLCE descriptions.

**Key distinction from H4:** H4 *removed* information (abstraction). H10 *adds* information (expansion). Query expansion often outperforms query abstraction in IR literature. The H4 failure does not predict H10 failure.

**Example:**
- Claim: "Under-investment in safety is a false economy."
- Generated bridge: "This claim expresses the belief that market incentives inadequately account for AI safety externalities and therefore require regulatory correction."
- Embedded text: "{claim}. {bridge}"

**Cost:** Same infrastructure as H4 — LLM generation + re-embedding. ~$0.01 on Gemini Flash.

### H1b: NLI/Entailment Cross-Encoder

**Hypothesis:** An NLI-trained cross-encoder (DeBERTa MNLI) that understands entailment/contradiction will outperform ms-marco (web relevance) for reranking.

**Rationale:** The original H1 tested only ms-marco-MiniLM, optimized for "query ↔ web document relevance." Our task is closer to "claim ↔ category entailment." NLI models are trained on exactly this kind of semantic relationship.

### H11: LLM-Judge Reranking

**Hypothesis:** An LLM can rerank top-N candidates more accurately than embedding similarity by reasoning about the semantic relationship between claim and node.

**Method:** For each claim, retrieve top-10 by cosine, then ask an LLM to select the best match with reasoning. Even if too expensive for production, this provides an upper bound on reranking quality.

### Diagnostic: LLM Classification Upper Bound

**Not an embedding experiment — a strategic benchmark.** Give an LLM the full claim + all same-POV candidate descriptions. If LLM achieves ~15%, the ontology is the bottleneck. If 60%+, representation learning has significant headroom.

### Diagnostic: Hierarchical Accuracy Analysis

**Not an embedding experiment — a granularity diagnostic.** Collapse nodes to parent/grandparent levels and measure accuracy. If parent-level accuracy is 45%+ while leaf is 10.5%, the model understands concepts but fails on ontology granularity. Strategy shifts from better embeddings to taxonomy restructuring.

### Diagnostic: Error Taxonomy

**Not an experiment — a prerequisite.** Categorize all 515 golden set failures into: near-miss sibling, wrong branch, wrong abstraction level, multiple valid nodes, golden-set ambiguity, missing ontology coverage. This determines which interventions can help and which are futile.

---

## Updated Priority (revised per external review)

### Tier 1 — Diagnostics (do first, before any more embedding experiments)

| Priority | Task | Status | Next Step |
|----------|------|--------|-----------|
| 1 | Ground truth audit | GUI in progress (t/520-523) | Complete GUI, review 50+ claims |
| 2 | Error taxonomy | **New** — ready to build | Analyze existing 515-claim results |
| 3 | Hierarchical accuracy | **New** — ready to build | Use taxonomy parent_id structure |
| 4 | LLM upper-bound classification | **New** — ready to run | ~500 LLM calls, trivial cost |

### Tier 2 — Informed experiments (after Tier 1 results)

| Priority | Hypothesis | Status | Next Step |
|----------|-----------|--------|-----------|
| 5 | H10: Query expansion | **New** — ready to design | Depends on Tier 1 findings |
| 6 | H1b: NLI cross-encoder | **New** — ready to run | DeBERTa MNLI reranking |
| 7 | H11: LLM-judge reranking | **New** — ready to run | Top-10 reranking benchmark |

### Tier 3 — Only if Tier 1-2 show the task is learnable

| Priority | Hypothesis | Status | Next Step |
|----------|-----------|--------|-----------|
| 8 | H8: Contrastive fine-tuning | Blocked by t/511 + Tier 1 | Leave-one-out validation design |
| 9 | H3: Entity annotation | LOW expected value | Run only if nothing else works |
