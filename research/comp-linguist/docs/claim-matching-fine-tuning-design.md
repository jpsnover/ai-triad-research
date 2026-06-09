# Claim-Matching Fine-Tuning Design

**Author:** Computational Linguist  
**Last updated:** 2026-06-08  
**Status:** Design  
**Ticket:** t/524  

## 1. Problem Statement

The AI Triad debate engine attributes debate claims to taxonomy nodes using cosine similarity between claim embeddings and pre-computed node embeddings (all-MiniLM-L6-v2, 384-dim). Current production MRR is **0.1834** — meaning the correct node is, on average, ranked around position 5-6.

The root cause is a **register gap**: taxonomy node descriptions use formal DOLCE genus-differentia vocabulary ("A Desire within accelerationist discourse that advocates for deploying advanced artificial intelligence to eradicate material scarcity...") while debate claims use informal rhetorical language ("If we just let AI rip, we could fix climate change in a decade"). These occupy different regions of the embedding space despite being semantically equivalent.

After 11 experiments (Rounds 1-3, H1-H9), only embedding field weight optimization produced improvement. Larger models, cross-encoders, BM25 hybrid, LLM abstraction, and MRL all failed or showed negligible gains. The remaining viable path is **contrastive fine-tuning** of the bi-encoder: train it to map informal claims closer to their formal node descriptions.

The original plan assumed we'd need to generate 7,000-11,000 synthetic claim-node pairs via LLMs (InPars methodology). A data asset audit revealed we already have ~20,000+ real and extracted pairs across three project repos, with synthetic generation needed only as a gap-filler for ~87 uncovered nodes.

## 2. Data Asset Inventory

### 2.1 Three-Repo Architecture

| Repo | Path | Contents |
|------|------|----------|
| **ai-triad-research** | Code, scripts, experiment data | Golden test set, embedding pipeline |
| **ai-triad-data** | Taxonomy, summaries, edges, embeddings | LLM-generated analysis of source documents |
| **ai-triad-sources** | 530 source document folders | Real human-written text (snapshot.md + raw files) |

### 2.2 Quantified Data Assets

| Asset | Source | Count | Register | Quality |
|-------|--------|-------|----------|---------|
| **Real passages** from `snapshot.md` | ai-triad-sources | ~2,573 | Academic/journalistic/policy | Highest — actual author wording |
| **LLM facts** from `source_evidence_index.json` | ai-triad-data | 2,685 | Neutral summary | Medium — LLM paraphrase of source content |
| **POV key_points** from `summaries/*.json` | ai-triad-data | 8,698 | POV-framed analytical | Medium — LLM interpretation, closest to debate rhetoric |
| **Factual claims** from `summaries/*.json` | ai-triad-data | 3,014 | Factual/neutral | Medium — LLM-extracted, linked to taxonomy nodes |
| **Assumes** field from node `graph_attributes` | ai-triad-data | 2,308 | Informal presupposition | Medium — LLM-generated, but already informal register |
| **Policy actions** from node `graph_attributes` | ai-triad-data | 1,289 | Policy/action-oriented | Medium — concrete informal node descriptions |
| **Steelman vulnerability** from node `graph_attributes` | ai-triad-data | 714 | Counterargument | Hard negatives — opposing-POV framing |
| **Golden test set** (eval holdout) | research/comp-linguist | 515 | Debate rhetoric | Highest for eval — actual debate output |
| **SUPPORTS edges** (confidence ≥ 0.7) | ai-triad-data | 13,836 | N/A — graph signal | Soft positive propagation multiplier |
| **TENSION_WITH + CONTRADICTS edges** (conf ≥ 0.7) | ai-triad-data | 7,308 | N/A — graph signal | Hard negative mining |

**Total direct training pairs (before edge propagation): ~21,281**  
**Gap nodes needing synthetic generation: 87 of 715 (12.2%)**

### 2.3 Multi-Form Strategy

For each (node_id, doc_id) mapping, we extract up to three surface forms of the same semantic content:

```
Real passage (snapshot.md)      ──┐
LLM fact (evidence index)       ──┼──→ same node_id
POV key_point (summary)         ──┘
```

The bi-encoder learns that all three forms map to the same node despite different vocabulary, register, and framing. This is the core training signal: surface diversity with semantic consistency.

### 2.4 Node Coverage Analysis

| Category | Total nodes | Covered by source evidence or key_points | Gap nodes |
|----------|-------------|------------------------------------------|-----------|
| Beliefs | 366 | ~340 | ~26 |
| Intentions | 268 | ~220 | ~48 |
| Desires | 81 | ~68 | ~13 |
| **Total** | **715** | **628 (87.8%)** | **87 (12.2%)** |

The golden test set covers only beliefs (515 claims, 175 unique nodes). The training data and evaluation must extend to all BDI categories.

### 2.5 Data Provenance

| Data element | Provenance | Notes |
|--------------|-----------|-------|
| Node descriptions | Human-authored | DOLCE genus-differentia pattern, manually curated |
| `snapshot.md` files | Mechanical conversion | pandoc/gs PDF→Markdown, preserves author wording |
| `source_evidence_index.json` claims | LLM-generated (Gemini) | Paraphrases, not verbatim quotes |
| `summaries/*.json` key_points | LLM-generated (Gemini) | POV-framed interpretation of source content |
| `graph_attributes` (assumes, steelman, etc.) | LLM-generated + validated | Gemini extraction → automated validation → dual-LLM re-verification |
| Edges | LLM-generated + approved | Gemini discovery with confidence scores, `status: approved` |

## 3. Multi-Form Extraction Pipeline

### 3.1 Phase 1: Real Passage Extraction

**Input:** source_evidence_index.json (2,685 node→doc_id pairs)  
**Source:** `ai-triad-sources/<doc_id>/snapshot.md`

**Algorithm:**
1. For each (node_id, doc_id, llm_claim) triple in the evidence index
2. Load `ai-triad-sources/<doc_id>/snapshot.md`
3. Split into paragraphs (blank-line delimited)
4. Embed paragraphs using all-MiniLM-L6-v2 (same model as production)
5. Embed the `llm_claim` text as query
6. Retrieve top-3 paragraphs by cosine similarity (threshold ≥ 0.35)
7. Emit (paragraph, node_id) pairs as training data

**Output:** ~2,573 real-passage training pairs (415 of 433 doc_ids have snapshots available)

**Design choices:**
- Paragraph-level granularity balances context (enough to capture the idea) against the 128-token model limit (paragraphs that exceed 128 tokens are truncated by the model, losing tail information — but this is acceptable since the key content is usually in the opening sentence)
- Using the LLM claim as the search query leverages the LLM's understanding of which node concept the passage relates to
- Threshold of 0.35 prevents false-positive passage extraction from unrelated sections

### 3.2 Phase 2: LLM Fact Collection

**Input:** source_evidence_index.json  
**Output:** 2,685 (llm_claim, node_id) pairs

Direct extraction — no processing needed. These are already claim-length text mapped to node_ids.

### 3.3 Phase 3: POV Key_Point Collection

**Input:** `summaries/<doc_id>.json` → `pov_summaries.{pov}.key_points[]`  
**Output:** 8,698 (key_point_text, taxonomy_node_id) pairs

Each key_point has:
- `taxonomy_node_id` — the mapped node
- `point` — POV-framed analytical text
- `stance` — aligned/challenged/qualified

**Filtering:** Include all stances for positive pairs (even "challenged" stance text relates to the node, just from a different angle — the bi-encoder should learn to match both).

### 3.4 Phase 4: Summary Factual Claims

**Input:** `summaries/<doc_id>.json` → `factual_claims[]`  
**Output:** 3,014 (claim_text, node_id) pairs (one pair per linked node)

Each factual claim has `linked_taxonomy_nodes` (array). Emit one training pair per linked node.

### 3.5 Phase 5: Node Attribute Pairs

**Assumes:** 2,308 (assumes_text, node_id) pairs — already informal register, zero-cost.

**Policy actions:** 1,289 (policy_action_text, node_id) pairs — concrete informal descriptions.

**Steelman vulnerability:** 714 items — used as HARD NEGATIVES, not positives. Each steelman is a counterargument to the node. See Section 5.2.

## 4. Edge-Augmented Training Signal

### 4.1 Soft Positive Propagation

**Principle:** If claim C is a positive for node A, and A SUPPORTS B with high confidence, then C is a soft positive for B with reduced weight.

**Algorithm:**
```
For each training pair (text, node_A, weight=1.0):
    For each edge where source=node_A AND type=SUPPORTS AND confidence >= 0.7:
        target_node = edge.target
        propagated_weight = weight × edge.confidence × DECAY_FACTOR
        if propagated_weight >= MIN_WEIGHT:
            emit (text, target_node, propagated_weight)
```

**Parameters:**
- `DECAY_FACTOR`: 0.5 (recommended starting point — propagated pairs contribute half the training signal of direct pairs)
- `MIN_WEIGHT`: 0.3 (below this, the pair is too weak to help)
- **One-hop only** — transitive propagation (A→B→C) compounds noise; restrict to direct edges
- 13,836 SUPPORTS edges × decay produces an estimated 5,000-8,000 additional weighted pairs

**Training integration:** Use weighted contrastive loss where each pair's contribution is scaled by its weight. Alternatively, sample propagated pairs with probability proportional to weight during batch construction.

### 4.2 Hard Negative Mining

**Principle:** Random negatives are too easy — the model already separates unrelated topics. The register gap is between nodes that share the same TOPIC but have different STANCES. Edge types TENSION_WITH and CONTRADICTS identify exactly these pairs.

**Algorithm:**
```
For each training pair (text, node_A):
    hard_negatives = []
    For each edge where source=node_A AND type IN (TENSION_WITH, CONTRADICTS) AND confidence >= 0.7:
        hard_negatives.append(edge.target)
    Sample k hard negatives from this set (k=3 recommended)
```

**Rationale:** 7,308 high-confidence TENSION_WITH + CONTRADICTS edges. A claim about `saf-desires-001` (preventing AI catastrophe) is a hard negative for `acc-desires-001` (deploying AI for abundance) — same topic (AI's future), opposite stance. This is the hardest discrimination task and the most valuable training signal.

**Steelman as hard negative:** Each node's `steelman_vulnerability` text is a counterargument — assign it as a hard negative for that node. Use TENSION_WITH edges to find which opposing node it's a positive for:
```
steelman_text of node_A → hard negative for node_A
steelman_text of node_A → soft positive for node_B where (A, B) has TENSION_WITH edge
```

### 4.3 ASSUMES Edge Integration

1,557 ASSUMES edges (conf ≥ 0.7) link nodes to their presuppositions. If claim C matches node A, and A ASSUMES B, then C implicitly relates to B. Weight these lower than SUPPORTS propagation (DECAY_FACTOR × 0.7) since the relationship is presuppositional, not evidential.

## 5. Training Protocol

### 5.1 Model and Loss Function

- **Base model:** `all-MiniLM-L6-v2` (22M params, 384-dim, 128 max tokens)
- **Loss:** `MultipleNegativesRankingLoss` (MNRL) with in-batch negatives + mined hard negatives
- **Framework:** sentence-transformers 4.1.0 (pinned — 5.x has ESM/native addon issues)

MNRL treats every other pair in the batch as a negative. Adding edge-mined hard negatives (Section 4.2) as explicit negatives increases difficulty and forces the model to learn stance distinctions, not just topic matching.

### 5.2 Training Data Composition

| Source | Pairs | Weight | Role |
|--------|-------|--------|------|
| Real snapshot passages | ~2,573 | 1.0 | Primary positives |
| LLM facts (evidence index) | 2,685 | 0.8 | Secondary positives (LLM paraphrase) |
| POV key_points | 8,698 | 0.8 | Secondary positives (closest to debate register) |
| Summary factual claims | 3,014 | 0.7 | Tertiary positives |
| Assumes field | 2,308 | 0.6 | Auxiliary positives |
| Policy actions | 1,289 | 0.5 | Auxiliary positives |
| Edge-propagated soft positives | ~5,000-8,000 | 0.3-0.5 | Graph-derived signal |
| Steelman → hard negatives | 714 | N/A | Explicit hard negatives |
| Edge hard negatives (TENSION/CONTRADICTS) | ~7,308 | N/A | Mined hard negatives |

**Total training pairs:** ~21,000-28,000 (before edge propagation adds volume)

**Weight rationale:** Real text gets full weight (1.0). LLM-generated text gets reduced weight (0.6-0.8) because model-specific artifacts may introduce noise. Edge-propagated pairs get lowest weight (0.3-0.5) because the semantic connection is indirect.

### 5.3 Batch Construction

- Batch size: 64 (standard for MNRL with MiniLM)
- Each batch: 64 positive pairs + in-batch negatives (63 per pair) + 3 mined hard negatives per pair
- Stratify batches to include pairs from multiple sources (don't let a batch be all key_points or all snapshot passages)
- Ensure each batch contains at least 2 hard negative edges to force stance discrimination

### 5.4 Validation Strategy

**Primary metric:** MRR on golden test set (515 claims, 175 unique nodes — beliefs only)

**Extended evaluation (new):** Build an extended eval set covering desires and intentions:
- Sample 50 claims from debates attributed to desire nodes (manual review)
- Sample 50 claims from debates attributed to intention nodes (manual review)
- Report MRR separately per BDI category

**5-fold cross-validation:**
- Split training pairs into 5 folds, stratified by node_id
- Train on 4 folds, eval on held-out fold + golden test set
- Report mean ± std MRR across folds

**Human ceiling comparison:** When t/511 (golden set validation) completes, compare model MRR to human inter-rater agreement to understand how close we are to the theoretical maximum.

### 5.5 Overfitting Detection

- Track train loss and validation MRR per epoch
- Early stopping: patience=3 epochs (stop if val MRR doesn't improve for 3 consecutive epochs)
- Learning rate: 2e-5 with linear warmup over 10% of steps, then linear decay
- Max epochs: 10 (expect convergence in 3-5 with this data volume)
- Log per-source performance: if key_point pairs improve but snapshot pairs degrade, the model is learning LLM artifacts rather than semantic matching

### 5.6 Production Compatibility

The fine-tuned model must be a drop-in replacement for `all-MiniLM-L6-v2`:
- Same dimensionality (384)
- Same tokenizer
- Same max sequence length (128 tokens)
- Re-embed all taxonomy nodes with the fine-tuned model after training
- Update `embeddings.json` via `scripts/embed_taxonomy.py` using the fine-tuned model

## 6. Synthetic Gap-Fill

### 6.1 Scope

87 nodes (12.2%) have no source evidence or key_point coverage. These need synthetic claims to participate in training.

### 6.2 Generation Prompt

For each gap node, generate 10-15 synthetic debate claims using:

```
You are generating training data for a semantic matching system. Given a 
taxonomy node description, generate {count} diverse debate claims that a 
real speaker would make when arguing for or engaging with this concept.

NODE:
ID: {node_id}
Description: {node_description}
Assumes: {assumes_list}
Rhetorical strategy: {rhetorical_strategy}
Epistemic type: {epistemic_type}

REQUIREMENTS:
- Use informal, rhetorical debate language — NOT academic or ontological language
- Include hedges ("arguably", "I think"), connectives ("but look", "the thing is"), 
  and concrete examples where appropriate
- Vary specificity: some abstract claims, some with concrete scenarios
- Generate from the perspective of a {speaker_pov} speaker
- Each claim should be 1-3 sentences, as it would appear in a debate transcript

EXAMPLES OF REAL DEBATE CLAIMS (for register calibration):
{few_shot_examples_from_golden_set}

Generate {count} claims, one per line:
```

**Few-shot examples:** Draw 3 examples from the golden test set where the attributed node is in the same BDI category and same POV as the target node.

### 6.3 Generation Parameters

- **Model:** Gemini 2.5 Flash (cost-effective, adequate quality for this task)
- **Temperature:** 0.9 (maximize diversity)
- **Count per node:** 15 claims × 87 gap nodes = ~1,305 synthetic pairs
- **Cost estimate:** ~87 prompts × ~1,500 input tokens × ~2,000 output tokens ≈ 260K input + 174K output tokens ≈ $0.03 on Gemini Flash

### 6.4 Quality Gate

After generation, filter synthetic claims:
1. Embed each synthetic claim using the base model
2. Compute cosine similarity to the target node
3. Discard claims with similarity < 0.15 (too distant to be useful)
4. Discard claims with similarity > 0.60 (suspiciously close — may be parroting the description)
5. Expected retention: ~70-80%

### 6.5 Multi-Model Ablation (Optional)

If time permits, compare generation quality across:
- **A.** Gemini 2.5 Flash only (baseline)
- **B.** Gemini Flash + Claude Haiku (diversity)
- **C.** Gemini Flash + Claude Haiku + GPT-4o-mini (max diversity)

Metric: MRR on golden set for models trained with each generation strategy. If multi-model shows <1% MRR improvement over single-model, prefer the simpler pipeline.

## 7. Generative Translation Variant

### 7.1 Hypothesis

Expert review identified that H4 (LLM abstraction) failed because it mapped claims to a neutral register (Register B) instead of translating INTO the DOLCE register (Register C). Generative translation — rewriting claims in DOLCE style — is a distinct untested hypothesis.

### 7.2 Experiment Design

**At retrieval time:** Before embedding a debate claim for matching, translate it:

```
Rewrite the following debate claim as a DOLCE-style taxonomy node description.
Use the genus-differentia pattern: "A [Belief|Desire|Intention] within [speaker] 
discourse that [differentia]. Encompasses: [scope]. Excludes: [boundaries]."

Claim: "{claim_text}"
Speaker: {speaker}

Rewrite:
```

**Evaluation:**
1. Translate all 515 golden set claims to DOLCE style
2. Embed the translations using the base model (not the fine-tuned model)
3. Compute MRR against the same node embeddings
4. Compare to production MRR (0.1834)

This tests whether bridging the register gap at query time (no training required) is viable. If MRR improves significantly, it can be combined with fine-tuning for a compound effect.

### 7.3 As Training Data

If translation works, use (original_claim, dolce_translation) pairs as additional contrastive training data — teaching the bi-encoder that these two forms should be close in embedding space.

## 8. Implementation Phases

### Phase 1: Data Extraction Pipeline (est. 2-3 days)

Build `research/comp-linguist/scripts/build_training_corpus.py`:
1. Extract real passages from snapshots via semantic search
2. Collect LLM facts from source evidence index
3. Collect POV key_points from summaries
4. Collect factual claims from summaries
5. Collect assumes and policy_actions from node attributes
6. Output: `training_corpus.json` with provenance metadata per pair

### Phase 2: Edge Augmentation (est. 1-2 days)

Extend the corpus builder:
1. Load edges.json, filter by type and confidence
2. Propagate soft positives through SUPPORTS edges
3. Mine hard negatives from TENSION_WITH and CONTRADICTS edges
4. Assign steelman vulnerabilities as hard negatives
5. Output: augmented `training_corpus.json` with edge-derived pairs and weights

### Phase 3: Baseline Training (est. 1-2 days)

1. Split corpus into train/val (80/20, stratified by node_id)
2. Train all-MiniLM-L6-v2 with MNRL + hard negatives
3. Evaluate MRR on golden test set
4. Ablate: train on each data source individually to measure contribution

### Phase 4: Gap-Fill and Iteration (est. 1 day)

1. Generate synthetic claims for 87 gap nodes
2. Add to training corpus, retrain
3. Evaluate marginal MRR improvement from synthetic data
4. If <0.5% improvement, synthetic generation adds insufficient value — stop here

### Phase 5: Generative Translation Test (est. 1 day)

1. Translate 515 golden set claims to DOLCE style
2. Evaluate translation-only MRR (no fine-tuning)
3. If promising, add as training data and retrain

## 9. Decision Framework

| MRR Result | Action |
|-----------|--------|
| < 0.20 (no improvement) | Investigate data quality issues; the register gap may not be learnable at this model scale |
| 0.20 - 0.25 | Modest improvement; deploy if stable across folds, continue to Phase 4-5 |
| 0.25 - 0.35 | Strong improvement; deploy, evaluate whether two-stage pipeline (bi-encoder + re-ranker) is warranted |
| > 0.35 | Excellent; deploy, consider whether the fine-tuned model generalizes to other matching tasks |

**Go/no-go gate:** After Phase 3, if MRR on real+extracted data alone is ≥ 0.25, the approach is validated. Phases 4-5 are optimization, not validation.

## 10. Cost Estimate

| Item | Cost |
|------|------|
| Passage extraction (embedding 530 documents) | ~$0.00 (local model, CPU) |
| Synthetic gap-fill (87 nodes × 15 claims) | ~$0.03 (Gemini Flash) |
| Generative translation (515 claims) | ~$0.01 (Gemini Flash) |
| Fine-tuning compute (10 epochs, 28K pairs) | ~5 min on GPU, ~30 min on CPU |
| Re-embedding taxonomy (715 nodes) | ~$0.00 (local model) |
| **Total** | **< $0.10 + compute time** |

The approach is essentially free — all significant costs are in compute time, not API calls.

## References

- Bonifacio et al., "InPars: Data Augmentation for Information Retrieval using Large Language Models"
- Thakur et al., "Augmented SBERT: Data Augmentation Method for Improving Bi-Encoders for Pairwise Sentence Scoring Tasks"
- Claim-matching experiments report: `docs/claim-matching-experiments-report.md`
- Golden test set: `research/comp-linguist/_golden_test_set.json`
- Embedding pipeline: `scripts/embed_taxonomy.py`
