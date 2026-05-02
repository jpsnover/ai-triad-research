# Taxonomy & Data Model

## Overview

The taxonomy is the core knowledge structure of the AI Triad Research platform. It represents ~320 argumentative claims about AI policy, organized into four perspective camps and three argument categories, connected by typed edges and grounded in a shared policy registry.

All taxonomy data lives in the sibling repository `ai-triad-data`, under `taxonomy/Origin/`.

## Four POV Camps

Each perspective camp represents a distinct intellectual tradition in AI governance debates:

| POV | ID Prefix | Color | Characterization |
|---|---|---|---|
| **Accelerationist** | `acc-` | Green (#27AE60) | Technology-optimist. AGI is coming fast; scaling is safe; maximize capability and progress. |
| **Safetyist** | `saf-` | Blue | Existential risk focus. AGI timelines are urgent; misalignment is catastrophic; prioritize safety research. |
| **Skeptic** | `skp-` | Orange (#F39C12) | Concrete harm focus. AGI is hype; current AI causes real problems — labor displacement, bias, surveillance. |
| **Situations** | `sit-` | Shared | Cross-cutting concepts interpreted differently by each camp. Not a "position" but a shared reference point. |

## BDI Categories

Within each POV, nodes belong to one of three Belief-Desire-Intention categories:

- **Beliefs** — Empirical claims and factual assertions (e.g., "AGI will arrive within a decade")
- **Desires** — Normative commitments and values (e.g., "We ought to prioritize safety research")
- **Intentions** — Strategic reasoning and action proposals (e.g., "We should slow down capability development")

This decomposition follows the BDI (Belief-Desire-Intention) agent architecture from philosophy of mind, adapted for argumentation analysis.

## Node ID Structure

POV nodes follow the pattern `{pov}-{category}-{NNN}`:
- `acc-desires-001` — Accelerationist, Desires category, node #1
- `saf-beliefs-042` — Safetyist, Beliefs category, node #42
- `skp-intentions-017` — Skeptic, Intentions category, node #17

Situation nodes use `sit-{NNN}` (e.g., `sit-001` — "When Will Super-Smart AI Arrive?").

Policy actions use `pol-{NNN}` from the shared registry.

## Node Properties

Each taxonomy node carries:

```json
{
  "id": "acc-desires-001",
  "category": "Desires",
  "label": "Achieving Global Post-Scarcity",
  "description": "Full text description of the claim...",
  "parent_id": "acc-desires-013",
  "parent_relationship": "is_a | part_of | specializes",
  "parent_rationale": "Why this parent-child relationship holds",
  "children": ["acc-desires-044", "acc-desires-045"],
  "situation_refs": ["sit-001", "sit-004"],
  "conflict_ids": ["conflict-123"],
  "debate_refs": ["75a57b33-fe6d-4e8b-a665-7a107d7206e8"],
  "vocabulary_terms": ["governance_adaptive", "capabilities_scaling"],
  "graph_attributes": {
    "epistemic_type": "normative_prescription",
    "rhetorical_strategy": "techno_optimism, inevitability_framing",
    "assumes": ["AI is inherently beneficial..."],
    "falsifiability": "low",
    "audience": "general_public, policymakers",
    "emotional_register": "aspirational",
    "intellectual_lineage": ["Effective Altruism", "Singularitarianism"],
    "steelman_vulnerability": "...",
    "possible_fallacies": [
      {
        "fallacy": "optimism_bias",
        "type": "cognitive_bias",
        "confidence": "likely",
        "explanation": "..."
      }
    ],
    "policy_actions": [
      {
        "policy_id": "pol-930",
        "action": "Allocate significant funding towards AI R&D",
        "framing": "POV-specific framing of this policy..."
      }
    ],
    "node_scope": "claim"
  }
}
```

Graph attributes are AI-extracted using the `Invoke-AttributeExtraction` cmdlet, following the AIF (Argument Interchange Format) ontology.

## Situation Nodes

Situations represent concepts that all camps discuss but interpret differently. Each situation node contains per-POV BDI interpretations:

```json
{
  "id": "sit-001",
  "label": "When Will Super-Smart AI Arrive?",
  "interpretations": {
    "accelerationist": {
      "belief": "Exponential growth makes AGI within a decade likely",
      "desire": "Ensure democratic nations lead AGI development",
      "intention": "Build AGI as fast as possible",
      "summary": "Rapid AGI development is a moral imperative"
    },
    "safetyist": { ... },
    "skeptic": { ... }
  },
  "linked_nodes": ["acc-desires-002", "saf-beliefs-002", "skp-intentions-005"],
  "disagreement_type": "interpretive | definitional | structural"
}
```

## Edge Types

Edges connect nodes with AIF-aligned relationship types:

| Type | Meaning |
|---|---|
| `SUPPORTS` | Strengthens the target claim |
| `CONTRADICTS` | Directly opposes the target |
| `ASSUMES` | Has the target as a prerequisite |
| `WEAKENS` | Undercuts without direct contradiction |
| `RESPONDS_TO` | Answers or replies to the target |
| `TENSION_WITH` | Implicit, unresolved conflict |
| `INTERPRETS` | Provides meaning or context for the target |

Each edge carries: source, target, type, bidirectional flag, confidence (0–1), weight, rationale, status (`proposed|approved|rejected`), model (which AI generated it), and strength (`strong|moderate|weak`).

Edges are stored in `edges.json`. Historical/deprecated edges are archived in `_archived_edges.json`.

## Policy Actions Registry

The file `policy_actions.json` is a centralized registry of ~1,091 concrete policy recommendations extracted from taxonomy nodes:

```json
{
  "id": "pol-001",
  "action": "Fund retraining programs for workers displaced by AI automation",
  "source_povs": ["situations"],
  "member_count": 1,
  "tags": ["workforce", "funding"]
}
```

Each POV node references policies by `policy_id` with POV-specific framing — the same policy action is described differently depending on the perspective.

## Embeddings

All node descriptions are embedded using **all-MiniLM-L6-v2** (384 dimensions) and stored in `embeddings.json`:

```json
{ "acc-desires-001": [0.123, -0.045, ...] }
```

Embeddings power semantic search (`Get-Tax -Similar`), RAG context selection during summarization, and clustering for situation candidate discovery. Regenerated via `Update-TaxEmbeddings`.

## Parent-Child Hierarchy

Nodes organize into trees via `parent_id`, `parent_relationship`, and `children` fields. Relationships follow ontological patterns:
- **is_a** — The child is a specific type of the parent
- **part_of** — The child is a component of the parent
- **specializes** — The child refines or narrows the parent

Hierarchies can be auto-proposed via `Invoke-HierarchyProposal` and reviewed via the Taxonomy Editor.

## Data Directory Layout

```
ai-triad-data/
├── taxonomy/
│   └── Origin/
│       ├── accelerationist.json     # ~80 nodes
│       ├── safetyist.json           # ~80 nodes
│       ├── skeptic.json             # ~80 nodes
│       ├── situations.json          # ~78 situation nodes
│       ├── policy_actions.json      # 1,091 policies
│       ├── edges.json               # 500+ typed edges
│       ├── embeddings.json          # 384-dim vectors
│       ├── lineage_categories.json  # Category inheritance
│       └── _archived_edges.json     # Historical edges
├── sources/                         # 134 ingested documents
│   └── {doc-id}/
│       ├── raw/                     # Original files (PDF, HTML, DOCX)
│       ├── snapshot.md              # Converted Markdown
│       └── metadata.json            # Title, authors, dates, POV tags
├── summaries/                       # 92 AI-generated POV summaries
│   └── {doc-id}.json
├── conflicts/                       # 713 auto-detected factual conflicts
├── conflicts-consolidated/          # Deduplicated conflict set
├── debates/                         # Structured debate sessions
│   ├── {uuid}.json                  # Debate transcript
│   ├── {uuid}-qbaf.json            # QBAF network
│   └── {uuid}-diagnostics.json     # Turn-by-turn trace
├── qbaf-conflicts/                  # QBAF-analyzed conflicts
├── dictionary/                      # Vocabulary definitions
└── chats/                           # Chat history
```

## Taxonomy Coverage

As of April 2026:
- ~320 total POV nodes across three camps
- ~78 situation nodes with three interpretations each
- 1,091 policy actions in the shared registry
- 500+ typed edges
- 134 ingested source documents
- 92 completed POV summaries
- 713 detected factual conflicts
