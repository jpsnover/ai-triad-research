# Synthetic Phrases — Theory of Success, Generation, and Use

**Last updated:** 2026-08-11

The **Phrases** tab on a taxonomy node shows a set of **synthetic statements** — machine-generated
sentences that express the node's position, grouped into seven **archetypes** (e.g. "45 synthetic
statements across 7 archetypes"). This document explains what problem those statements solve, the
theory for why they should solve it, how they are generated, and how they are used at attribution
time.

It is the reference behind the Phrases-tab bookmark. For the broader tab anatomy (all phrase source
types, not just synthetic), see [`_phrases_tab_guide.md`](../_phrases_tab_guide.md). For the full
build plan and cmdlet inventory, see
[`synthetic-corpus-implementation-plan.md`](synthetic-corpus-implementation-plan.md).

## The problem: attribution needs a wide semantic surface

The core runtime task is **claim-to-node attribution**: given a claim from a document or a debate
turn, find the taxonomy node it belongs to. This is done by embedding the claim and comparing it,
by cosine similarity, against a stored vector for each node.

The baseline representation is one 384-dim vector per node (`all-MiniLM-L6-v2`), computed from the
node's **description text only** (`embeddings.json`, loaded in `taxonomyLoader.ts`). That single
vector is a narrow target. A node's description is written in one register — usually the clipped,
academic phrasing of the source literature — but a real claim expressing the same position can
arrive as a policy demand, a defensive rebuttal, an appeal to an intellectual tradition, or a
concrete example. Those phrasings sit in different regions of embedding space, so a single
description vector misses them.

Two symptoms follow. First, attribution accuracy is capped: measured against the golden test set of
human-validated claims, top-1 recall leaves a large fraction of claims mis-attributed on the first
try. Second, **confusable neighbors** — nodes in the same POV and BDI category, often sharing a
taxonomy parent — collapse together, because their description vectors are close and there is
nothing else to separate them.

## The theory of success

The synthetic corpus is a bet with a specific, falsifiable mechanism:

> If each node is represented by *many* vectors that deliberately span the different rhetorical
> styles a claim can take — and if those vectors are pruned so none of them drifts closer to a
> neighbor node than to their own — then multi-vector attribution will catch claims that a single
> description vector misses, **without** increasing confusion between neighbors.

Two moving parts have to both hold:

1. **Breadth raises recall.** More vectors per node, spread across archetypes and audience
   registers, give the scorer more "hooks." A claim phrased as a policy implication can match the
   node's policy-implication statements even when it is far from the description vector. This is why
   the target is ~40 statements per node rather than a handful.
2. **Contrastive discipline protects precision.** Breadth is only safe if the added vectors stay on
   the correct side of every neighbor boundary. A statement that could equally describe a
   neighbor — a **boundary violator** — is worse than useless: it actively poaches the neighbor's
   claims. So generation is neighbor-aware and every statement passes a poaching gate before it is
   allowed into the pool.

The success criterion is empirical and pre-registered: a **pilot** (20–30 nodes, mixed easy/hard)
must show a **Mean Reciprocal Rank lift of ≥ 0.10** over the description-only baseline before
full-scale generation is authorized. If a cheaper intervention (a better encoder, or a cross-encoder
reranker on the top-K) captures most of the available lift, the corpus does not earn its API budget
and the bet is off. The corpus is not assumed to work; it has to beat that bar on the golden set.

## How the statements are generated

Generation is neighbor-aware and quality-gated. The pipeline (`New-SyntheticCorpus`, archetype
prompts in `_archetype_templates.py`) produces, for each node, a pool of candidates that is then
pruned down to the keepers shown in the tab.

### Seven archetypes — semantic breadth

Each archetype is a prompt template that asks the model to express the node's position in one
rhetorical mode. These are exactly the seven groups shown in the Phrases tab:

| Archetype | Label in tab | What it produces |
|-----------|--------------|------------------|
| `surface_claim` | Surface Claims | Direct, debate-ready assertions of the position |
| `assumption_expression` | Assumption Expressions | The hidden assumptions the position rests on |
| `defensive_formulation` | Defensive Formulations | Rebuttals to the position's known vulnerabilities (steelman attacks) |
| `counterargument_response` | Counterargument Responses | Replies to specific logical criticisms (e.g. fallacy accusations) |
| `policy_implication` | Policy Implications | Concrete policy proposals the position implies |
| `intellectual_lineage` | Intellectual Lineage | The position grounded in named intellectual traditions |
| `real_world_example` | Real-World Examples | Concrete scenarios that illustrate the position |

The seven modes are chosen to cover the ways the same position actually shows up in debate and
documents — the register axis that a single description vector cannot span.

### Audience modulation — register coverage

Most archetypes are additionally generated in **audience-modulated** variants for three overlays,
each shown as a small badge on the statement:

- **Industry** (`industry_leader`) — business pragmatics, ROI framing.
- **Policy** (`policymaker`) — regulatory and governance framing.
- **Technical** (`technical_researcher`) — precise, mechanistic vocabulary.

Audience adds register coverage on top of the archetype's semantic mode, so the pool reaches
claims phrased for different readers.

### Neighbor-awareness — the anti-poaching mechanism

Before generation, the pipeline computes each node's **confusable neighbors**
(`Get-ConfusableNeighbors`) using content signal (BM25 on `description` + `assumes`) blended with
graph signal (same BDI category and POV, shared taxonomy parent) — deliberately **not** using
embeddings, because embedding proximity is contaminated by the very model whose errors the corpus
is meant to fix. Generation prompts are anchored to POV vocabulary profiles built from
high-confidence debate claims, so the synthetic language matches how claims are actually phrased.

### Prune-and-regenerate — the quality gate

Candidates (~45–50 per node) are embedded and passed through the pruning cycle
(`Invoke-CorpusPrune`) down to ~40 keepers:

1. **Poaching check** — is the statement's embedding closer to a neighbor node than to its own? If
   so it is a boundary violator and is pruned.
2. **Redundancy check** — is it a near-duplicate of another kept statement for the same node
   (intra-node cosine above threshold)? If so it adds no breadth and is pruned.
3. **Rationale filter** — the model emits a `rationale` for why the statement belongs to this node
   and not its neighbors; a rationale that reveals the model was actually thinking about a neighbor
   is a signal to prune.

If a node's prune rate exceeds ~25%, it is **regenerated** with strengthened contrastive
instructions that name the specific neighbor it kept colliding with (max two cycles). Nodes that
stay high-prune-rate are flagged as "hard nodes" for review. Each entry keeps a `pruned` flag and
`prune_reason`; the tab shows only the keepers (`!pruned`).

## How the statements are used

### At attribution time — multi-vector scoring

The payoff is at scoring time. When synthetic embeddings are exported
(`Export-SyntheticEmbeddings` → `synthetic_embeddings.json`) and loaded, each node carries a
`vectors[]` array (the synthetic statements' embeddings) alongside its single description vector.
The scorer then has two modes:

- **Single-vector** (`scoreNodeRelevance`) — cosine of the query against the one description
  vector. This is the current baseline.
- **Multi-vector mean-of-top-N** (`scoreNodeRelevanceMeanTopN`) — cosine of the query against
  *every* vector in `node.vectors`, sorted descending, averaged over the top N. Falls back to
  single-vector when no `vectors` array is present.

**Mean-of-top-3** is the intended production aggregation, not max-similarity. The reason is directly
tied to the theory of success: mean-of-top-N requires a *cluster* of the node's statements to be
near the claim, which dampens the poaching risk from a single rogue vector. Max-sim would let one
boundary-violating statement win an attribution on its own; averaging the top few demands
agreement.

### In the Phrases tab — inspection

The tab (`PhrasesPanel.tsx`) loads the per-POV synthetic corpus for the node's POV
(`api.loadSyntheticCorpus`), filters to this node's un-pruned entries, and groups them by archetype
in the fixed order above. When no synthetic entries exist for a node it falls back to the older flat
`debate_claims_corpus.json` and shows a "legacy corpus" badge. The tab is the human-readable window
onto exactly the vectors the multi-vector scorer uses — it is where you inspect whether a node's
generated statements are on-target and whether any read like a neighbor's.

## Current status

The corpus is in **pilot** scope — the mechanism and pipeline are built and a small set of nodes is
generated and pruned; full-scale generation (~700 nodes × ~40 statements) is gated on the pilot MRR
lift clearing the ≥ 0.10 bar on the golden set. The Phrases tab already renders the archetype-grouped
synthetic view for nodes that have a corpus, falling back to legacy for the rest. The TypeScript
multi-vector loader/scorer path is specified and partially in place; the production attribution
pipeline switches to mean-of-top-N once `synthetic_embeddings.json` is available for a POV.

Until the evaluation clears the gate, treat the synthetic phrases as a **candidate** improvement
under measurement, not a shipped one. Every number that matters — MRR, Recall@1/3/5, per-vector
poaching rate — is measured against the human-validated golden set, and the corpus keeps its budget
only by beating the baseline there.
