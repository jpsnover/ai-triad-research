# Proposal: LLM Attribute Graphs for AI Triad POV Taxonomy

**Date:** 2026-03-07
**Author:** AI Triad Research Project
**Status:** Draft

---

## 1. Executive Summary

The AI Triad project currently represents its POV taxonomy as a tree of labeled nodes with flat 384-dimensional embeddings for semantic search. This proposal introduces **LLM Attribute Graphs (LAGs)** — a technique where every taxonomy node, source document, factual claim, and conflict is represented as a richly attributed node in a typed, directed graph, with edges and attributes generated, maintained, and queryable via LLM reasoning.

An LLM Attribute Graph differs from a traditional knowledge graph in a critical way: the **attributes on nodes and edges are not limited to predefined schemas**. Instead, an LLM generates, refines, and interprets open-ended attribute sets — rhetorical tone, epistemic confidence, political valence, argumentative strategy, audience assumptions — that would be impractical to hand-engineer. The LLM acts as both the graph's builder and its query engine.

This would transform the AI Triad from a **lookup and search system** into a **reasoning and discovery system**.

---

## 2. What Is an LLM Attribute Graph?

### 2.1 Core Concept

An LLM Attribute Graph is a property graph where:

- **Nodes** represent entities (taxonomy claims, source documents, authors, factual assertions, conflicts, policy proposals).
- **Edges** represent typed relationships (SUPPORTS, CONTRADICTS, CITES, INTERPRETS, WEAKENS, ASSUMES, RESPONDS_TO).
- **Attributes** on both nodes and edges are LLM-generated key-value pairs that capture nuanced, multidimensional properties not easily reduced to categories or numbers.

### 2.2 Example: A Taxonomy Node Today vs. as a LAG Node

**Current representation (flat JSON):**
```json
{
  "id": "saf-goals-001",
  "label": "Prevent Catastrophic Outcomes",
  "description": "The primary goal is ensuring AI systems...",
  "category": "Goals/Values",
  "cross_cutting_refs": ["cc-001"]
}
```

**As a LAG node:**
```json
{
  "id": "saf-goals-001",
  "type": "taxonomy_claim",
  "label": "Prevent Catastrophic Outcomes",
  "description": "The primary goal is ensuring AI systems...",
  "category": "Goals/Values",
  "attributes": {
    "epistemic_type": "normative_prescription",
    "rhetorical_strategy": "precautionary_framing",
    "assumes": ["AGI is plausible within planning horizons",
                "Catastrophic outcomes are irreversible"],
    "audience": "policymakers, technical researchers",
    "emotional_register": "urgent but measured",
    "falsifiability": "low — value claim, not empirical",
    "policy_actionability": "high",
    "intellectual_lineage": ["Bostrom existential risk framework",
                             "nuclear nonproliferation analogy"],
    "steelman_vulnerability": "collapses if AGI timelines are > 50 years"
  },
  "edges": [
    {"type": "TENSION_WITH", "target": "acc-goals-001",
     "attributes": {"tension_type": "speed_vs_caution", "bridgeable": true,
                     "common_ground": "both accept AI is powerful"}},
    {"type": "ASSUMES", "target": "cc-001",
     "attributes": {"dependency_strength": "critical",
                     "if_false": "entire node loses urgency"}},
    {"type": "SUPPORTED_BY", "target": "doc:anthropics-responsible-scaling-policy-2026",
     "attributes": {"support_type": "institutional_endorsement",
                     "strength": 0.85}}
  ]
}
```

The key difference: the `attributes` object is **open-ended and LLM-populated**. No schema enumerates all possible attributes in advance. The LLM decides what is worth recording about each node based on what it reads.

---

## 3. How It Would Work in Practice

### 3.1 Graph Construction Pipeline

The LAG would be built incrementally, extending the existing ingestion pipeline:

```
Source Document
    |
    v
[Existing] Invoke-POVSummary  -->  POV key_points, factual_claims
    |
    v
[New] Invoke-AttributeExtraction
    |-- For each key_point: generate node attributes
    |-- For each factual_claim: generate claim-node attributes
    |-- For each pair of nodes: generate candidate edges + edge attributes
    |-- Compare against existing graph to detect new/changed relationships
    |
    v
[New] Merge into Graph Store
    |-- Deduplicate nodes (semantic similarity + LLM confirmation)
    |-- Merge attributes (append, override, or flag conflict)
    |-- Update edge weights based on accumulating evidence
```

### 3.2 Storage Options

| Option | Pros | Cons |
|--------|------|------|
| **JSON files (extend current)** | Zero new dependencies, git-diffable, works with existing PS7 tooling | Slow for graph traversal at scale |
| **SQLite + JSON columns** | Single-file DB, fast queries, portable | Loses git-diffable property |
| **Neo4j / Memgraph** | Native graph queries (Cypher), visualization built in | Infrastructure overhead, not git-friendly |
| **Hybrid: JSON canonical + SQLite index** | Best of both — JSON remains source of truth, SQLite provides fast query | Two representations to keep in sync |

**Recommendation:** Start with the **hybrid approach**. Keep the current JSON files as the canonical store (preserving git history and existing tooling) and generate a SQLite index on module load for fast graph queries. This mirrors the existing pattern where `embeddings.json` is a derived artifact from the taxonomy JSONs.

### 3.3 Query Interface

A new PowerShell cmdlet `Invoke-GraphQuery` would accept natural-language questions and translate them into graph operations:

```powershell
# Direct graph traversal
Get-GraphNode -Id "saf-goals-001" -Depth 2 -EdgeType TENSION_WITH

# Attribute-filtered search
Find-GraphNode -Where { $_.attributes.epistemic_type -eq "empirical_claim" `
                   -and $_.attributes.falsifiability -eq "high" }

# LLM-interpreted natural language query
Invoke-GraphQuery "What assumptions does the safetyist position share
                   with the accelerationist position?"

# Path discovery
Find-GraphPath -From "acc-goals-001" -To "skp-methods-003" -MaxHops 4
```

---

## 4. Scenarios and Functions Enabled

### 4.1 Assumption Surfacing

**Problem today:** The taxonomy captures *what* each POV believes, but not *why* — the hidden assumptions that make a claim feel obvious to one camp and absurd to another.

**With LAGs:** Every node carries an `assumes` attribute list. The system can:

- Surface shared assumptions across POVs that neither side examines ("Both safetyists and accelerationists assume AGI is economically transformative — skeptics do not").
- Identify **assumption chains** where Claim A depends on Assumption B, which depends on Assumption C, enabling targeted debate at the root rather than the leaves.
- Generate "What if X were false?" counterfactual analyses by tracing dependency edges.

```powershell
# "What does the accelerationist case actually rest on?"
Get-AssumptionChain -RootNode "acc-goals-001" -Depth 5

# Output:
# acc-goals-001: "Maximize AI Development Speed"
#   ASSUMES -> "Scaling laws continue to hold" (empirical, falsifiable)
#     ASSUMES -> "Compute cost continues to fall" (empirical, trend-based)
#     ASSUMES -> "No regulatory hard stop" (political, uncertain)
#   ASSUMES -> "First-mover advantage is decisive" (strategic, debatable)
#     WEAKENED_BY -> doc:ai-as-normal-technology-2026 (argues diffusion, not dominance)
```

### 4.2 Argument Mapping and Debate Preparation

**Problem today:** To understand how two sources interact, a researcher must read both summaries and mentally reconstruct the argument structure.

**With LAGs:** The graph explicitly encodes SUPPORTS, CONTRADICTS, RESPONDS_TO, and WEAKENS edges between claims across documents. This enables:

- **Automatic debate briefs:** "Generate the strongest accelerationist response to Timnit Gebru's resource-cost argument, drawing on sources in the corpus."
- **Steelman/strawman detection:** Flag when a source attacks a weak version of an opposing claim (the graph knows the strongest version).
- **Gap analysis:** "Which safetyist claims have no empirical support in our source corpus?" (nodes with no SUPPORTED_BY edges to empirical documents).

```powershell
Invoke-DebateBrief -Position "acc-goals-001" `
                   -Against "skp-methods-003" `
                   -Style "steelman_both"
```

### 4.3 Rhetorical and Epistemic Analysis

**Problem today:** All claims are treated as equivalent entries in a flat taxonomy. A normative value judgment ("AI should be open-source") sits alongside an empirical assertion ("training runs cost $100M") with no distinction.

**With LAGs:** Attributes like `epistemic_type`, `falsifiability`, `rhetorical_strategy`, and `emotional_register` enable:

- **Epistemic filtering:** Show only empirical, falsifiable claims — the subset where evidence can actually resolve disagreements.
- **Rhetorical pattern detection:** "Accelerationist sources disproportionately use inevitability framing; safetyist sources use precautionary framing."
- **Audience analysis:** Cluster sources by assumed audience (policymakers vs. engineers vs. general public) and identify how the same claim is reframed for different audiences.

```powershell
# Which claims are actually resolvable by evidence?
Get-GraphNode -Where { $_.attributes.epistemic_type -eq "empirical_claim" `
                  -and $_.attributes.falsifiability -eq "high" } |
    Group-Object { $_.pov }

# How does framing differ by POV?
Compare-RhetoricalProfile -POV accelerationist, safetyist
```

### 4.4 Conflict Evolution Tracking

**Problem today:** Conflicts are append-only logs of positions. There is no way to see how a conflict evolves, whether positions are converging, or where resolution might be possible.

**With LAGs:** Each conflict instance becomes a node with temporal attributes and edges to the claims and documents involved. This enables:

- **Convergence detection:** "The energy-cost conflict has narrowed — both sides now agree on the magnitude but disagree on whether it matters."
- **Resolution pathways:** Trace edges to find claims that, if conceded, would collapse a conflict (the `if_false` attribute on ASSUMES edges).
- **Conflict clustering:** Discover that 5 apparently separate conflicts all depend on the same contested assumption.

```powershell
Get-ConflictEvolution -Id "conflict-agi-timelines-001" |
    Show-ConvergenceTimeline
```

### 4.5 Taxonomy Health and Completeness

**Problem today:** `Get-TaxonomyHealth` reports basic coverage metrics (nodes without sources, sources without mappings). It cannot assess *structural* health.

**With LAGs:** Graph analysis enables:

- **Orphan detection:** Nodes with no inbound edges (nothing supports, assumes, or references them).
- **Echo chamber detection:** Subgraphs where all edges are SUPPORTS with no CONTRADICTS or TENSION_WITH — indicating an internally consistent but externally unchallenged cluster.
- **Balance scoring:** Does the graph have roughly equal structural richness across POVs, or is one POV over-developed while another is skeletal?
- **Missing-edge prediction:** The LLM examines pairs of nodes that *should* have a relationship but don't, and proposes candidate edges.

```powershell
# Find the weakest parts of the taxonomy
Get-TaxonomyHealth -GraphMode |
    Where-Object { $_.orphan_score -gt 0.7 -or $_.echo_chamber_risk -gt 0.5 }
```

### 4.6 Source Recommendation

**Problem today:** Choosing the next source to ingest is a manual editorial decision.

**With LAGs:** The graph can identify structural gaps and recommend sources that would fill them:

- "The skeptic position on compute costs has only one supporting source. Here are candidate URLs that might provide additional evidence."
- "These three accelerationist claims have no empirical backing — prioritize ingesting empirical studies."
- "This conflict has only one side represented in the corpus — the graph is lopsided."

```powershell
Get-IngestionPriority -MaxSuggestions 10
# Returns ranked list of topics/claims that most need new sources
```

### 4.7 Cross-Cutting Concept Discovery

**Problem today:** Cross-cutting nodes are manually authored. Identifying that three POVs are actually debating the same underlying concept requires human insight.

**With LAGs:** Automatic cross-cutting detection by finding:

- Clusters of nodes (one per POV) with high semantic similarity but different stances.
- Shared assumption subgraphs — nodes from different POVs that depend on the same premises.
- **Bridge nodes** — concepts that, if reframed, could connect opposed positions.

```powershell
Find-CrossCuttingCandidates -MinPOVs 2 -Method "shared_assumptions"
```

### 4.8 Interactive Dialogue Simulation

**Problem today:** The project studies the AI debate but cannot *simulate* it.

**With LAGs:** The graph provides grounded context for multi-agent dialogue:

- Instantiate three LLM agents, each grounded in a POV subgraph.
- Agents argue using only claims and evidence present in the graph (preventing hallucination).
- The system tracks which nodes and edges are activated during the debate, revealing which parts of the taxonomy are load-bearing.
- Post-debate analysis: "The accelerationist agent could not respond to the skeptic's labor-displacement argument — the taxonomy has a gap here."

```powershell
Start-TriadDialogue -Topic "Should frontier AI labs self-regulate?" `
                    -Rounds 5 `
                    -GroundInGraph
```

---

## 5. Implementation Roadmap

### Phase 1: Attribute Extraction (Weeks 1-3)

- Define a **starter attribute schema** (epistemic_type, rhetorical_strategy, assumes, falsifiability, audience) — not as a rigid schema, but as guidance for the LLM.
- Add an `Invoke-AttributeExtraction` step to the summarization pipeline.
- Store attributes as a new `graph_attributes` key on existing taxonomy nodes (backwards-compatible).
- No new infrastructure required — extends current JSON files.

**Deliverable:** Every taxonomy node gains a rich attribute set.

### Phase 2: Edge Generation (Weeks 4-6)

- Build `Invoke-EdgeDiscovery` — for each node, the LLM proposes typed edges to other nodes with edge attributes.
- Implement deduplication and human-review workflow for proposed edges.
- Store edges in a new `edges.json` per POV directory (parallel to `embeddings.json`).
- Add `Get-GraphNode` and `Find-GraphPath` cmdlets.

**Deliverable:** The taxonomy becomes a navigable graph.

### Phase 3: Query Engine (Weeks 7-9)

- Build `Invoke-GraphQuery` — natural language to graph traversal, powered by LLM.
- Implement graph-aware conflict analysis (`Get-ConflictEvolution`).
- Add graph visualization to the Taxonomy Editor Electron app (using a library like vis-network or d3-force).

**Deliverable:** Researchers can ask questions of the graph in natural language.

### Phase 4: Active Discovery (Weeks 10-12)

- Implement `Get-IngestionPriority`, `Find-CrossCuttingCandidates`.
- Build dialogue simulation (`Start-TriadDialogue`).
- Add graph health metrics to `Get-TaxonomyHealth -GraphMode`.

**Deliverable:** The system actively identifies gaps and generates research directions.

---

## 6. Cost and Complexity Considerations

### LLM Token Budget

Attribute extraction and edge discovery are LLM-intensive. Estimated costs per document:

| Operation | Tokens (est.) | Cost @ Gemini Flash |
|-----------|--------------|---------------------|
| Attribute extraction (per node) | ~800 output | < $0.001 |
| Edge discovery (per node pair) | ~500 output | < $0.001 |
| Full graph rebuild (131 nodes) | ~200K total | ~$0.10 |
| Incremental update (1 new doc) | ~15K total | ~$0.01 |

The existing multi-backend AIEnrich module already handles rate limiting and model selection. LAG operations would use the same infrastructure.

### Schema Drift

Open-ended attributes risk inconsistency. Mitigations:
- **Attribute vocabulary file** — a living list of preferred attribute keys and value formats, provided to the LLM as guidance (not enforcement).
- **Periodic normalization pass** — an LLM reviews all attributes and harmonizes terminology.
- **Attribute frequency report** — flag attributes that appear on < 5% of nodes (likely noise) or > 95% (likely uninformative).

### Graph Size

With ~131 taxonomy nodes, ~30 sources, and ~40 conflicts, the graph is small enough that:
- JSON storage is viable for years.
- Full-graph LLM analysis (feeding the entire graph as context) is feasible within a single context window.
- No graph database infrastructure is needed unless the corpus grows 10x+.

---

## 7. Relationship to Current Architecture

The LAG proposal is **additive, not replacive**. It builds on every existing component:

| Existing Component | LAG Extension |
|-------------------|---------------|
| Taxonomy JSON nodes | Gain `graph_attributes` field |
| `embeddings.json` (384-dim vectors) | Vectors remain for fast similarity; attributes add interpretability |
| `Find-Conflict` (claim matching) | Conflicts gain typed edges to assumptions and evidence |
| `Invoke-POVSummary` (key_points extraction) | Key points become graph nodes with edges to taxonomy |
| `Invoke-TaxonomyProposal` (AI suggestions) | Proposals become graph-aware: "add node X with edges to Y, Z" |
| `Get-TaxonomyHealth` (coverage stats) | Gains structural graph metrics |
| Cross-cutting `interpretations` | Become first-class INTERPRETS edges with attributes |
| Taxonomy Editor (Electron) | Gains graph visualization pane |

No existing functionality is removed or broken. The graph layer is a new lens on the same data.

---

## 8. Conclusion

The AI Triad project has built a solid foundation: structured taxonomy, AI-powered ingestion, conflict detection, and semantic search. But the current architecture treats each component — nodes, documents, claims, conflicts — as largely independent objects connected by ID references.

LLM Attribute Graphs would weave these objects into a single, richly connected structure where the *relationships* between ideas become as queryable and analyzable as the ideas themselves. The technique is uniquely suited to this project because:

1. **The domain is inherently relational** — the AI debate is defined by tensions, assumptions, and contested interpretations between positions.
2. **The LLM is already in the loop** — the project already uses LLMs for summarization and proposal generation; attribute extraction is a natural extension.
3. **The scale is right** — the corpus is large enough to benefit from graph structure but small enough that LLM-powered graph operations are affordable and fast.
4. **The goal is understanding, not just retrieval** — LAGs enable the transition from "find me nodes about X" to "explain how X relates to Y, and what would change if Z were false."

The proposed phased rollout ensures that value is delivered incrementally, each phase builds on the last, and the existing architecture is preserved throughout.
