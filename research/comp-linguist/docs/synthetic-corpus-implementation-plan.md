# Synthetic Statement Corpus: Implementation Plan

*Draft — pending Technical Lead review for cmdlet architecture and scope division. Design doc: `synthetic-corpus-external-review.md`*

## Execution Phases

### Phase 0: Gating (blocks all subsequent phases)

These steps are cheap, high-information, and determine whether the corpus earns its ~57K API call budget.

| Step | What | Owner | Cmdlet | Output |
|---|---|---|---|---|
| **0a** | Build clean gold set from debate AN claims | CL | `New-GoldenTestSet` | `_golden_test_set.json` (refreshed) |
| **0b** | IAA measurement: 2+ annotators independently assign top-1 for ~50-100 claims | CL + Human | `Measure-AttributionAgreement` | IAA score, attribution ceiling estimate |
| **0c** | Claim distribution analysis: embed real agent claims, visualize register space | CL | `Show-ClaimDistribution` | Register heatmap, audience-axis budget recommendation |
| **0d** | Encoder ablation: MiniLM vs mpnet vs BGE on current node embeddings | CL/TL | `Compare-EmbeddingModel` | MRR per encoder, ceiling estimate |
| **0e** | Reranker baseline: cross-encoder on top-K with current embeddings | TL | `Test-RerankerBaseline` | MRR with reranking, marginal lift estimate |

**Gate decision:** If IAA on top-1 is < 50%, reframe as top-K attribution. If encoder ablation or reranker captures > 80% of available lift, corpus may not earn its budget — revisit.

### Phase 1: Pilot (20-30 nodes)

| Step | What | Owner | Cmdlet |
|---|---|---|---|
| **1a** | Identify confusable neighbors for all nodes | CL | `Get-ConfusableNeighbors` |
| **1b** | Build POV vocabulary profiles from debate logs | CL | `Build-PovVocabularyProfile` |
| **1c** | Generate synthetic corpus for pilot nodes (45-50 candidates/node) | CL/TL | `New-SyntheticCorpus -PilotNodes <list>` |
| **1d** | Run prune-and-regenerate cycle | CL | `Invoke-CorpusPrune` |
| **1e** | Embed pruned corpus | TL | `Export-SyntheticEmbeddings` |
| **1f** | Measure MRR lift: max-sim vs mean-of-top-3 vs mean-of-top-5 | CL | `Measure-AttributionMRR -AggregationStrategy <strategy>` |
| **1g** | Poaching analysis | CL | `Test-VectorPoaching` |
| **1h** | Cluster separation on pilot nodes | CL | `Show-ClusterSeparation` |

**Pilot node selection:** Include 10 "easy" nodes (distinctive vocabulary, no close neighbors) and 10-20 "hard" nodes (high confusability scores from `Get-ConfusableNeighbors`). Spread across all 3 POVs.

**Pilot gate:** MRR lift of ≥ 0.10 on pilot nodes (from 0.354 baseline) justifies full-scale generation. If mean-of-top-3 outperforms max-sim, it becomes the production strategy.

### Phase 2: Full Corpus Generation

| Step | What | Owner | Cmdlet |
|---|---|---|---|
| **2a** | Generate corpus for all ~636 nodes | CL/TL | `New-SyntheticCorpus -Full` |
| **2b** | Prune-and-regenerate cycle (all nodes) | CL | `Invoke-CorpusPrune` |
| **2c** | Embed full corpus | TL | `Export-SyntheticEmbeddings` |
| **2d** | Full evaluation: MRR, Recall@1/3/5, NDCG, cluster separation | CL | `Measure-AttributionMRR` |
| **2e** | 50-claim blind human eval | CL + Human | Manual + `Measure-AttributionAgreement` |

### Phase 3: Complementary Approaches

| Step | What | Owner |
|---|---|---|
| **3a** | BM25 + dense hybrid with RRF | TL |
| **3b** | Cross-encoder/LLM reranker on top-5/10 | TL |
| **3c** | Contrastive fine-tuning using corpus hard negatives + taxonomy graph | CL/TL |

---

## Cmdlet Specifications

### Gating Cmdlets

#### `New-GoldenTestSet`
Extracts AN claim nodes from recent debates, re-embeds against current taxonomy, computes fresh attribution.

```
New-GoldenTestSet [-DebateCount <int>] [-OutputPath <path>]
```
- `-DebateCount`: Number of recent debates to extract from (default: 20)
- `-OutputPath`: Where to write the golden set (default: `research/comp-linguist/_golden_test_set.json`)
- **Replaces:** `_rebuild_golden_set.py` (existing Python script)

#### `Update-GoldenTestSet`
Incrementally updates the golden set with claims from new debates without regenerating existing entries.

```
Update-GoldenTestSet [-Since <datetime>] [-OutputPath <path>]
```

#### `Measure-AttributionAgreement`
Computes inter-annotator agreement on top-1 attribution for annotated claims.

```
Measure-AttributionAgreement -AnnotationFile <path> [-Metric <Cohen|Fleiss|Krippendorff>]
```
- `-AnnotationFile`: JSON with annotator assignments (claim_id → annotator → node_id)
- `-Metric`: Agreement metric (default: Cohen's kappa for 2 annotators, Fleiss for 3+)
- **Output:** IAA score, per-claim agreement breakdown, estimated attribution ceiling

#### `Show-ClaimDistribution`
Embeds real agent claims and visualizes their register distribution relative to taxonomy nodes.

```
Show-ClaimDistribution [-ClaimSource <golden_set|debates>] [-OutputFormat <html|json>]
```
- Produces a 2D projection (UMAP/t-SNE) of claim embeddings colored by POV, overlaid with node positions
- Reports which register regions are dense vs sparse in the claim distribution
- Recommends audience-axis budget allocation based on observed register coverage

#### `Compare-EmbeddingModel`
Encoder ablation: re-embeds nodes and golden set claims with alternative models, compares MRR.

```
Compare-EmbeddingModel [-Models <string[]>] [-GoldenSetPath <path>]
```
- `-Models`: Model names to compare (default: `all-MiniLM-L6-v2`, `all-mpnet-base-v2`, `bge-base-en-v1.5`)
- **Output:** MRR per model, per-POV breakdown, recommendation

#### `Test-RerankerBaseline`
Cross-encoder reranking on top-K candidates with current embeddings.

```
Test-RerankerBaseline [-TopK <int>] [-RerankerModel <string>] [-GoldenSetPath <path>]
```
- `-TopK`: Number of candidates to rerank (default: 10)
- `-RerankerModel`: Cross-encoder model (default: `cross-encoder/ms-marco-MiniLM-L-6-v2`)

### Corpus Generation Cmdlets

#### `Get-ConfusableNeighbors`
Identifies most confusable node pairs using content + graph proximity (no embedding signal).

```
Get-ConfusableNeighbors [-NodeId <string>] [-TopN <int>] [-OutputPath <path>]
```
- Without `-NodeId`: computes for all nodes, outputs full confusability matrix
- `-TopN`: Number of neighbors per node (default: 4)
- **Algorithm:**
  1. Graph signal: same BDI category + same POV (weight: 0.4). Shared taxonomy parent adds 0.1 boost.
  2. Content signal: BM25 similarity on `description` + `assumes` fields (weight: 0.6).
  3. Ranked blend, no embedding signal.
- **Output:** Per-node ranked neighbor list with scores, stored in `_confusable_neighbors.json`

#### `Build-PovVocabularyProfile`
Extracts POV-level vocabulary profiles from high-confidence debate claims for generation prompt anchoring.

```
Build-PovVocabularyProfile [-Pov <acc|saf|skp>] [-TopPercentile <int>] [-OutputPath <path>]
```
- `-TopPercentile`: Use top N% highest-similarity matches (default: 10)
- **Output:** Per-POV JSON with N-gram profiles, discourse markers, syntax patterns, few-shot exemplar claims

#### `New-SyntheticCorpus`
Generates synthetic statements for POV nodes using the hybrid archetype/audience scheme.

```
New-SyntheticCorpus [-Pov <acc|saf|skp|all>] [-PilotNodes <string[]>] [-Full]
    [-CandidatesPerNode <int>] [-Models <string[]>] [-Temperature <float>]
```
- `-PilotNodes`: Generate only for specified nodes (pilot mode)
- `-Full`: Generate for all nodes in the specified POV(s)
- `-CandidatesPerNode`: Pre-prune candidates (default: 48)
- `-Models`: Generation models (default: `gemini-flash`, `claude-sonnet`)
- `-Temperature`: Generation temperature (default: 1.0)
- **Requires:** `_confusable_neighbors.json` (from `Get-ConfusableNeighbors`), POV vocabulary profiles (from `Build-PovVocabularyProfile`)
- **Output:** Per-POV corpus files (`synthetic_corpus_acc.json`, etc.) with metadata per entry:
  ```json
  {
    "node_id": "acc-beliefs-003",
    "statement": "...",
    "archetype": "assumption_expression",
    "audience": null,
    "model": "gemini-flash",
    "generation_timestamp": "2026-06-15T...",
    "prompt_hash": "a1b2c3...",
    "description_hash": "d4e5f6...",
    "rationale": "...",
    "pruned": false,
    "prune_reason": null
  }
  ```

#### `Update-SyntheticCorpus`
Incremental update: detects stale (description_hash mismatch), deleted, and new nodes. Regenerates only affected entries + their neighbors.

```
Update-SyntheticCorpus [-Pov <acc|saf|skp|all>] [-Force]
```
- `-Force`: Regenerate all entries regardless of staleness

#### `Invoke-CorpusPrune`
Runs the prune-and-regenerate cycle on a generated corpus.

```
Invoke-CorpusPrune [-CorpusPath <path>] [-TargetPerNode <int>] [-PruneThreshold <float>]
    [-MaxCycles <int>]
```
- `-TargetPerNode`: Target keeper count (default: 40)
- `-PruneThreshold`: Prune rate that triggers regeneration (default: 0.25)
- `-MaxCycles`: Max prune-regenerate cycles (default: 2)
- **Pipeline:**
  1. Embed all candidates
  2. Per-candidate poaching analysis (closer to neighbor than own node?)
  3. Prune boundary violators + redundant statements (high intra-node cosine similarity)
  4. If prune rate > threshold: regenerate with strengthened contrastive instructions citing specific problematic neighbor
  5. Re-prune after regeneration
  6. Flag remaining high-prune-rate nodes as "hard nodes"
- **Output:** Pruned corpus, prune report (`_prune_report.json` with per-node prune rates, flagged hard nodes, neighbor violation details)

### Evaluation Cmdlets

#### `Measure-AttributionMRR`
Primary evaluation: MRR, Recall@K, NDCG against golden set.

```
Measure-AttributionMRR [-GoldenSetPath <path>] [-CorpusPath <path>]
    [-AggregationStrategy <max|mean_top_3|mean_top_5>] [-Detailed]
```
- `-AggregationStrategy`: How to aggregate multi-vector similarity (default: `mean_top_3`)
- `-Detailed`: Per-node and per-POV breakdown, hard-node identification
- **Output:** MRR, Recall@1/3/5, NDCG, per-POV breakdown, per-node difficulty scores

#### `Test-VectorPoaching`
Per-vector poaching analysis across the corpus.

```
Test-VectorPoaching [-CorpusPath <path>] [-GoldenSetPath <path>]
```
- For each synthetic vector: how often it wins the similarity for claims that belong to other nodes
- **Output:** Per-vector poaching rate, worst offenders list, per-node poaching summary

#### `Show-ClusterSeparation`
Inter-node cluster separation metrics.

```
Show-ClusterSeparation [-CorpusPath <path>] [-Scope <all|neighbors_only>]
```
- `-Scope`: Measure all node pairs or only confusable neighbor pairs (default: `neighbors_only`)
- **Output:** Mean cosine distance between synthetic statement clouds, per-pair separation scores, visualization

### Lifecycle Cmdlets

#### `Sync-SyntheticCorpus`
Detects corpus entries that are stale, orphaned, or missing. Reports status without modifying.

```
Sync-SyntheticCorpus [-CorpusPath <path>] [-Fix]
```
- Without `-Fix`: dry-run report only
- With `-Fix`: triggers `Update-SyntheticCorpus` for affected nodes

#### `Export-SyntheticEmbeddings`
Exports corpus embeddings in production format for both the PS/Python pipeline and the TS attribution pipeline.

```
Export-SyntheticEmbeddings [-CorpusPath <path>] [-OutputPath <path>] [-Format <all|numpy|json>]
```
- `-Format all` (default): Outputs both formats
- **NumPy format** (PS/Python pipeline): `{pov}_vectors.npy` + `{pov}_index.json` (node_id → vector range mapping)
- **JSON format** (TS attribution pipeline): `synthetic_embeddings.json` — single file consumed by `taxonomyLoader.ts`. Schema: per-node `{ pov, vectors[][], archetypes[], description_vector_index }` (see TS Consumption section)

---

## Data Storage Architecture

**Location:** `../ai-triad-data/taxonomy/Origin/synthetic/` (sibling to existing `embeddings.json`)

```
synthetic/
├── corpus_acc.json          # Synthetic statements for accelerationist nodes
├── corpus_saf.json          # Synthetic statements for safetyist nodes
├── corpus_skp.json          # Synthetic statements for skeptic nodes
├── embeddings_acc.npy       # Embedding vectors (NumPy format)
├── embeddings_saf.npy
├── embeddings_skp.npy
├── index_acc.json           # Vector index: node_id → vector range
├── index_saf.json
├── index_skp.json
├── confusable_neighbors.json # Per-node ranked neighbor lists
├── pov_profiles/
│   ├── acc_vocabulary.json  # POV vocabulary profile
│   ├── saf_vocabulary.json
│   └── skp_vocabulary.json
├── prune_report.json        # Latest prune cycle diagnostics
└── metadata.json            # Corpus-level metadata (build date, model versions, stats)
```

**Rationale:** Data repo (`ai-triad-data`) is the correct home — these are derived data artifacts, not code. Per-POV split keeps individual files under GitHub's size limits. NumPy format for embeddings (fast load, compact) with JSON index for metadata.

---

## Scope Division (TL-Approved)

*TL correction: TL designs and routes — does not implement cmdlets. Infrastructure cmdlets route to PowerShell role.*

| Cmdlet | Owner | Notes |
|---|---|---|
| `New-GoldenTestSet` / `Update-GoldenTestSet` | CL | Existing scope |
| `Measure-AttributionAgreement` | CL | Quality metric |
| `Show-ClaimDistribution` | CL (research script) | Gating/evaluation only — lives in `research/comp-linguist/`, not module Public/ |
| `Compare-EmbeddingModel` | **PowerShell** | CL defines methodology, PS implements |
| `Test-RerankerBaseline` | **PowerShell** | CL defines methodology, PS implements |
| `Get-ConfusableNeighbors` | CL | Algorithm design + implementation |
| `Build-PovVocabularyProfile` | CL | Linguistic analysis |
| `New-SyntheticCorpus` / `Update-SyntheticCorpus` | CL (prompts) + **PowerShell** (pipeline) | Split ownership |
| `Invoke-CorpusPrune` | CL | Quality gating |
| `Measure-AttributionMRR` | CL | Quality metric |
| `Test-VectorPoaching` | CL | Quality metric |
| `Show-ClusterSeparation` | CL (research script) | Evaluation only — lives in `research/comp-linguist/`, not module Public/ |
| `Sync-SyntheticCorpus` | **PowerShell** | Lifecycle infrastructure |
| `Export-SyntheticEmbeddings` | **PowerShell** | Embedding infrastructure — must output JSON alongside NumPy (see TS consumption below) |

### Module Placement

- **Production cmdlets** (ongoing use): `scripts/AITriad/Public/`
- **Research scripts** (gating/evaluation phases only): `research/comp-linguist/` — `Show-ClaimDistribution` and `Show-ClusterSeparation` are one-off analysis tools that don't belong in the module's public API

---

## TypeScript Embedding Consumption (TL-Identified Gap)

The PS pipeline generates and exports synthetic embeddings, but the production **TypeScript attribution pipeline** must also consume them. Currently:

- `lib/debate/taxonomyLoader.ts` loads `embeddings.json` — schema: `Record<nodeId, { pov: string; vector: number[] }>`
- `lib/debate/taxonomyRelevance.ts::scoreNodeRelevance()` computes single-vector cosine similarity per node
- `lib/debate/taxonomyRelevance.ts::scoreNodesViaAN()` takes max similarity across AN claims against one vector per node
- `taxonomy-editor/src/renderer/utils/taxonomyRelevance.ts` re-exports from `lib/debate/`

### Required TS Changes

**Must be resolved before Phase 1e (pilot embedding export).**

#### 1. Export format: `Export-SyntheticEmbeddings` must output JSON alongside NumPy

```json
// synthetic_embeddings.json — consumed by TS pipeline
{
  "metadata": { "model": "all-MiniLM-L6-v2", "vectors_per_node": 41, "aggregation": "mean_top_3" },
  "nodes": {
    "acc-beliefs-003": {
      "pov": "acc",
      "vectors": [[0.012, -0.034, ...], ...],  // 41 vectors (40 synthetic + 1 description)
      "archetypes": ["surface_claim", "assumption_expression", ...],  // parallel array
      "description_vector_index": 40
    }
  }
}
```

#### 2. Loader update: `taxonomyLoader.ts`

Update `LoadedTaxonomy.embeddings` type to support multi-vector:

```typescript
// Current
Record<string, { pov: string; vector: number[]; exclusion_vector?: number[] }>

// New — backward compatible
Record<string, {
  pov: string;
  vector: number[];                    // primary (description) vector — backward compat
  vectors?: number[][];                // multi-vector corpus (41 vectors)
  exclusion_vector?: number[];
}>
```

When `synthetic_embeddings.json` exists, load it and populate `vectors`. Fall back to single-vector `embeddings.json` when corpus isn't available.

#### 3. Scoring update: `taxonomyRelevance.ts`

New function `scoreNodeRelevanceMeanTopN()`:

```typescript
function scoreNodeRelevanceMeanTopN(
  queryVector: number[],
  nodeEmbeddings: Record<string, { vectors: number[][] }>,
  topN: number = 3
): Map<string, number> {
  // For each node: compute cosine similarity against all vectors,
  // sort descending, return mean of top-N
}
```

Update `scoreNodesViaAN()` to use multi-vector when available:
- For each AN claim × each node: compute mean-of-top-3 across node's 41 vectors
- Then take max across AN claims (existing behavior)

#### 4. Attribution update: `argumentNetwork.ts`

`computeClaimTaxonomyAttribution()` currently uses single-vector cosine. Update to call `scoreNodeRelevanceMeanTopN()` when multi-vector embeddings are loaded.

### Ownership

These TS changes are in `lib/debate/` (DebateTool scope). Tickets needed:

| Ticket | Owner | Blocked by |
|---|---|---|
| Multi-vector embedding loader | DebateTool / Shared Lib | `Export-SyntheticEmbeddings` JSON format spec |
| Mean-of-top-N scoring function | DebateTool / Shared Lib | Loader update |
| Attribution pipeline integration | DebateTool | Scoring function |

---

## Cost and Time Estimates

### API Call Budget

| Phase | Calls | Model | Estimated Cost |
|---|---|---|---|
| **Pilot** (25 nodes × 48 candidates × 2 models) | ~2,400 | Gemini Flash (free) + Claude Sonnet | ~$2-5 (Sonnet portion only) |
| **Full corpus** (636 nodes × 48 candidates × 2 models) | ~61,000 | Gemini Flash (free) + Claude Sonnet | ~$50-120 (Sonnet portion only) |
| **Regeneration cycles** (est. 15-20% of nodes need 1 extra cycle) | ~8,000-12,000 | Mixed | ~$10-25 |
| **Total** | ~70,000-75,000 | | **~$60-150** |

Gemini Flash free tier covers ~half the calls at zero cost. Claude Sonnet calls are the primary expense. Exact cost depends on prompt length (~800-1200 tokens input per call, ~200-400 tokens output).

### Wall-Clock Time

| Phase | Estimated Duration | Notes |
|---|---|---|
| Phase 0 (gating) | 1-2 days | Mostly human annotation time for IAA |
| Phase 1 (pilot) | 2-3 hours generation + 1 day evaluation | 25 nodes, parallelizable |
| Phase 2 (full corpus) | 8-12 hours generation | ~61K calls with rate limiting + batching |
| Prune-and-regenerate | 2-4 hours | Compute-bound (embedding + analysis) |

Batching strategy: group by archetype (all surface_claim prompts first, then all assumption_expression, etc.) to maximize prompt cache hits. Gemini Flash and Claude Sonnet calls can run in parallel.

---

## Key Design Decisions (Summary)

| Decision | Value | Rationale |
|---|---|---|
| Statements per node | ~40 (generate 45-50, prune to ~40) | Individual-assumption seeding + disagreement contrastives + audience modulation need headroom beyond 20 |
| Retrieval aggregation | Mean-of-top-3 (primary), max-sim (baseline) | Requires cluster density, dampens single-rogue-vector poaching, directly mitigates neighbor collapse |
| Diversity axis | Hybrid: 25-30 archetype + 8-12 audience + 2-4 contrastive | Archetype provides semantic diversity; audience adds register coverage; contrastives attack high-confusion pairs |
| Confusable neighbors | Content (BM25 on desc+assumes) + graph (BDI category + parent), no embeddings | Embedding proximity is contaminated by the model whose errors we're fixing |
| Vocabulary mismatch bridging | POV few-shot exemplars + vocabulary profiles + claim distribution feedback | Anchors synthetic language to observed claim register |
| Prune strategy | Prune-and-regenerate cycle (max 2 rounds, >25% threshold) | Self-correcting loop that uses prune diagnostics to improve regeneration |
| Model assignment | Randomized per archetype | Avoids confounding model identity with register |
| Embedding model | all-MiniLM-L6-v2 (384-dim), pending encoder ablation | Ablation in Phase 0d determines if upgrade is higher-leverage than corpus |
