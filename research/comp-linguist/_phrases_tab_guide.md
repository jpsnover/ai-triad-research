# Phrases Tab — Reference Guide

## What You're Looking At

The **Phrases tab** in the Taxonomy Editor shows all text fragments associated with a taxonomy node. These fragments are the raw material for **claim-to-node attribution** — when the system encounters a claim from a document or debate, it compares the claim's embedding vector against these phrases to determine which taxonomy node the claim best aligns with.

For example, the node `acc-desires-010` ("Absorb All Human Knowledge into AI") has 158 phrases across 10 source types. Each phrase is a distinct text snippet that expresses, supports, or relates to this node's position in the AI policy discourse.

## Header Elements

| Element | Description |
|---------|-------------|
| **Node label** | Human-readable name (e.g., "Absorb All Human Knowledge into AI") |
| **Node ID** | Machine identifier (e.g., `acc-desires-010`) — format: `{pov}-{category}-{NNN}` |
| **Category badge** | BDI category: BELIEFS, DESIRES, or INTENTIONS |
| **Total count** | "158 phrases across 10 source types" — total phrases and distinct source categories |
| **Tabs** | Content, Attributes, Related, **Phrases**, Sources, Facts, Research |

## Phrase Source Types (in display order)

The Phrases tab groups entries by **source type** — each expandable section shows a count badge and can be clicked to reveal individual phrases. Source types are listed in descending count order.

### Direct Node Sources (intrinsic to this node)

These come from the node's own content and metadata:

| Source Type | Internal Key | Where It Comes From | Typical Count |
|-------------|-------------|---------------------|---------------|
| **Document Passages** | `snapshot_passage` | Real passages from source documents (PDFs, papers) matched to this node via semantic search. These are verbatim excerpts from the research literature. | 1–20 |
| **POV Key Points** | `pov_keypoint` | Key points extracted from POV summary files (`ai-triad-data/taxonomy/Origin/summary/*.json`). Each POV camp has curated summaries; key points from those summaries are linked to specific nodes. | 5–15 |
| **Assumptions** | `assumes` | From the node's `graph_attributes.assumes[]` field. These are explicitly listed assumptions that underpin the node's position. | 0–10 |
| **Policy Actions** | `policy_action` | From `graph_attributes.policy_actions[]`. Specific policy proposals associated with this node, cross-referenced against `policy_actions.json`. | 0–5 |
| **Evidence Facts** | `evidence_fact` | LLM-extracted facts from `source_evidence_index.json` — structured factual claims derived from source documents and linked to this node. | 0–10 |

### Edge-Propagated Sources (borrowed from connected nodes)

These are **soft positives** propagated through taxonomy edges (SUPPORTS, ASSUMES relationships). If node A supports node B, then A's phrases become weak evidence for B:

| Source Type | Internal Key | How It Works |
|-------------|-------------|--------------|
| **Edge-Propagated Passages** | `edge_propagated_snapshot_passage` | Document passages from nodes connected via SUPPORTS/ASSUMES edges, with a decay factor of 0.5 and minimum weight of 0.3. Capped at 2 propagations per source pair. |
| **Edge-Propagated Key Points** | `edge_propagated_pov_keypoint` | POV key points from connected nodes, same propagation rules. |
| **Edge-Propagated Facts** | `edge_propagated_evidence_fact` | Evidence facts from connected nodes. |
| **Edge-Propagated Claims** | `edge_propagated_summary_factual_claim` | Factual claims from summary files linked to connected nodes. |

Edge-propagated phrases carry a **reduced training weight** (0.3–0.5 vs 1.0 for direct sources). They broaden the node's embedding footprint but contribute less per phrase to attribution scoring.

### Contrastive Sources

| Source Type | Internal Key | Purpose |
|-------------|-------------|---------|
| **Hard Negatives** | `steelman_hard_negative` | Phrases that this node should **not** be confused with. Generated from TENSION_WITH and CONTRADICTS edges combined with `steelman_vulnerability` attributes. These carry **negative training weight** (-1.0) — they teach the embedding model what this node is *not*. |

## How Phrases Are Generated

All phrases originate from `build_training_corpus.py` (`research/comp-linguist/scripts/`), which runs a 6-phase extraction pipeline:

1. **Phase 1** — Semantic search over document snapshots to find real passages matching each node
2. **Phase 2** — Extract structured facts from `source_evidence_index.json`
3. **Phase 3** — Pull key points from POV summary files
4. **Phase 4** — Pull factual claims from summary files
5. **Phase 5** — Extract node attributes (assumes, policy_actions) from taxonomy graph
6. **Phase 6a** — Propagate Phases 1–5 through SUPPORTS/ASSUMES edges (soft positives)
7. **Phase 6b** — Generate hard negatives from TENSION_WITH/CONTRADICTS edges + steelman vulnerabilities

Output: `research/comp-linguist/training_corpus.json` (~65,000 pairs across ~966 nodes)

## How Phrases Are Used

### In the Taxonomy Editor
The Phrases tab currently loads data from **`debate_claims_corpus.json`** via `api.readResearchFile('comp-linguist/debate_claims_corpus.json')` (see `PhrasesPanel.tsx:33`). This is an older, uniform corpus with exactly **5 synthetic claims per node** across all 712 nodes — generated before the archetype template system existed. It has no archetype diversity, audience modulation, or confusable-neighbor awareness.

The new synthetic corpus (from `_archetype_templates.py` + `New-SyntheticCorpus`) lives in `ai-triad-data/taxonomy/Origin/synthetic/corpus_{acc,saf,skp}.json` and is **not yet wired into the Phrases tab**. Once the full corpus is generated, the PhrasesPanel will need to be updated to load from the new corpus files, which will show ~40-44 statements per node grouped by archetype instead of 5 flat entries.

### For Embedding / Attribution
Phrases serve one purpose: **contrastive fine-tuning**. `train_claim_matcher.py` uses the training corpus (positive pairs + hard negatives with MultipleNegativesRankingLoss) to fine-tune `all-MiniLM-L6-v2` so the model better discriminates between confusable nodes.

Phrases are **not** used as runtime vectors. The runtime attribution system has two layers:

1. **`embeddings.json`** — one 384-dim vector per node, computed from the **node description text only**. This is the baseline representation. (`taxonomyLoader.ts:182-187`)

2. **`synthetic/synthetic_embeddings.json`** (optional) — **multiple vectors per node**, one per synthetic statement. Produced by `Export-SyntheticEmbeddings`. When this file exists, the loader merges the `vectors[]` array onto each node alongside the single description vector. (`taxonomyLoader.ts:189-201`)

At scoring time, the engine offers two modes:
- **Single-vector** (`scoreNodeRelevance`) — cosine(query, node.vector). Uses only the description embedding. This is the current baseline.
- **Multi-vector mean-of-top-N** (`scoreNodeRelevanceMeanTopN`) — computes cosine similarity between the query and *every* vector in `node.vectors`, sorts descending, and averages the top N. Falls back to single-vector if no `vectors` array exists. (`taxonomyRelevance.ts:121-139`)

This is why the synthetic corpus matters for attribution accuracy — each synthetic statement becomes an additional vector in the node's `vectors[]` array, giving the multi-vector scorer more diverse "hooks" to catch claims expressed in different rhetorical styles.

### In the Debate Engine
`lib/debate/evidenceFromSummaries.ts` uses `source_evidence_index.json` (which shares content with Evidence Facts phrases) to provide evidence for debate turns — debaters cite these facts when arguing their positions.

## The Phrase Coverage Problem

For many nodes, the phrase distribution is heavily skewed:

- **Edge-propagated content dominates** — often 80–90% of phrases come from connected nodes, not the node itself. In the `acc-desires-010` example: 138/158 (87%) are edge-propagated.
- **Node-intrinsic signal is sparse** — only 20 phrases come from the node's own content.
- **No variation in expression style** — existing phrases are extracted verbatim from academic papers. They don't cover how a real debater would frame the same position as a policy demand, a defensive rebuttal, or a practical example.

This matters because attribution accuracy depends on the phrases capturing the full range of ways a position can be expressed. The current baseline MRR (Mean Reciprocal Rank) is **0.566** with Recall@1 of **39.3%** — meaning only 4 in 10 claims are correctly attributed on the first try.

## How the Synthetic Corpus Addresses This

The synthetic corpus pipeline generates **purpose-built attribution statements** that supplement the extracted phrases. Each statement is designed to express a node's position in a specific rhetorical style while being clearly distinguishable from confusable neighbors.

### What gets generated

For each taxonomy node, the pipeline produces ~40–44 statements across **7 archetype templates**:

| Archetype | What It Produces | Count |
|-----------|-----------------|-------|
| `surface_claim` | Direct, debate-ready assertions of the node's position | 5–7 |
| `assumption_expression` | Statements expressing the hidden assumptions behind the position | 5–7 |
| `defensive_formulation` | Rebuttals to known vulnerabilities (steelman attacks) | 4–5 |
| `counterargument_response` | Responses to specific logical criticisms (fallacy accusations) | 3–4 |
| `policy_implication` | Concrete policy proposals derived from the position | 4–5 |
| `intellectual_lineage` | Statements grounding the position in named intellectual traditions | 3–4 |
| `real_world_example` | Concrete real-world scenarios illustrating the position | 3–4 |

Each archetype also generates **audience-modulated variants** for 3 audience overlays:
- **Industry leader** — business pragmatics, ROI framing
- **Policymaker** — regulatory and governance framing
- **Technical researcher** — precise, mechanistic vocabulary

This produces ~19 prompt groups per node (7 base + 7×3 audience - overlaps where field data is missing).

### Where synthetic statements live

```
ai-triad-data/taxonomy/Origin/synthetic/
├── corpus_acc.json      # Accelerationist POV statements
├── corpus_saf.json      # Safetyist POV statements
├── corpus_skp.json      # Skeptic POV statements
└── metadata.json        # Generation metadata (models, counts, timing)
```

Each corpus file contains entries structured as:

```json
{
  "pov": "acc",
  "entries": [
    {
      "node_id": "acc-intentions-008",
      "statement": "Regulatory intensity should scale proportionally...",
      "archetype": "surface_claim",
      "audience": null,
      "model": "claude-sonnet-4-5",
      "generation_timestamp": "2026-06-12T22:10:49Z",
      "prompt_hash": "7c9c74c6935d11e4",
      "description_hash": "31c00e01053a6897",
      "rationale": "Directly articulates the tiered architecture...",
      "pruned": false,
      "prune_reason": null
    }
  ]
}
```

Key fields:
- **statement** — the generated text (what would appear as a phrase)
- **archetype** — which template produced it
- **audience** — null for base, or `industry_leader`/`policymaker`/`technical_researcher`
- **rationale** — the model's explanation of why this statement belongs to this node and not its neighbors
- **pruned/prune_reason** — quality gate status (boundary violators and redundant statements are marked pruned)

### Quality gating

Before synthetic statements join the phrase pool, they pass through the pruning pipeline (`_prune_corpus.py`):

1. **Poaching check** — is the statement's embedding closer to a neighbor node than its own? If yes, it's a boundary violator.
2. **Redundancy check** — is it a near-duplicate of another statement for the same node? (cosine similarity > 0.92)
3. **Rationale filter** — does the generation rationale reveal the model was actually thinking about a neighbor?

Nodes with >25% prune rate get flagged for **contrastive regeneration** — a second generation pass with strengthened anti-poaching instructions targeting the specific neighbors that caused violations.

### Current status

The synthetic corpus is currently in **pilot mode** — 6 nodes, 268 statements. Full-scale generation (~720 nodes × ~44 statements ≈ 31,000+ statements) is pending. The evaluation harness (`_evaluate_corpus.py`) will measure whether synthetic statements improve MRR and Recall@k against the golden test set of 664 human-validated claims.

### Integration path

Once generated, pruned, and evaluated, synthetic statements will be:
1. Embedded using the same all-MiniLM-L6-v2 model
2. Added to the multi-vector attribution pipeline (configurable aggregation: max-sim, mean-of-top-3, or mean-of-top-5)
3. Visible in the Taxonomy Editor's Phrases tab as a new source type

## Key Files Reference

| File | Purpose |
|------|---------|
| `taxonomy-editor/src/renderer/components/PhrasesPanel.tsx` | Phrases tab UI component |
| `taxonomy-editor/src/main/ipcHandlers.ts:1273` | IPC handler loading training_corpus.json |
| `research/comp-linguist/scripts/build_training_corpus.py` | 6-phase phrase extraction pipeline |
| `research/comp-linguist/training_corpus.json` | Generated training corpus (~65K pairs) |
| `research/comp-linguist/scripts/train_claim_matcher.py` | Contrastive fine-tuning script |
| `research/comp-linguist/_archetype_templates.py` | Synthetic statement prompt templates |
| `research/comp-linguist/_prune_corpus.py` | Pruning quality gate |
| `research/comp-linguist/_evaluate_corpus.py` | Evaluation harness (MRR, Recall, NDCG) |
| `research/comp-linguist/_golden_test_set.json` | 664 human-validated claims for evaluation |
| `research/comp-linguist/_confusable_neighbors.json` | 636 nodes × 4 neighbors for contrastive generation |
| `ai-triad-data/taxonomy/Origin/synthetic/` | Generated synthetic corpus files |
| `ai-triad-data/taxonomy/Origin/embeddings.json` | Node embedding vectors (384-dim) |
