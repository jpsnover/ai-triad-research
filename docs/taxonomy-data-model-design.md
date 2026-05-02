# Taxonomy & Data Model — High-Level Design

**Status:** Living document  
**Last updated:** 2026-05-01  
**Author:** Jeffrey Snover  
**Audience:** Engineers, researchers, and contributors who need to understand how the platform's data is structured, stored, and accessed.

---

## 1. Problem Statement

AI governance literature contains hundreds of interlocking arguments across multiple intellectual traditions. A single paper might contain empirical claims, normative commitments, and policy proposals — each of which relates differently to claims in other papers. Traditional citation networks capture "paper A cites paper B" but not "claim A1 attacks claim B3 while assuming claim C2."

The taxonomy data model provides a formal structure for these argument relationships: classifying claims by perspective and type, connecting them via typed edges, grounding them in concrete policy recommendations, and enabling semantic search across the full argument landscape.

## 2. Goals and Non-Goals

### Goals

- **G1:** Represent arguments from multiple perspectives without privileging any viewpoint
- **G2:** Classify claims by both perspective (who says it) and type (what kind of claim it is)
- **G3:** Capture directed relationships between claims (supports, contradicts, assumes, etc.)
- **G4:** Link abstract arguments to concrete policy actions with perspective-specific framing
- **G5:** Enable semantic search across all claims via dense vector embeddings
- **G6:** Scale to thousands of claims while remaining queryable from PowerShell, TypeScript, and UI

### Non-Goals

- **NG1:** Full formal ontology — we use BDI and AIF concepts but don't enforce ontological axioms
- **NG2:** Versioned schema with migration tooling — schema evolves via manual migration scripts, not automated migrations
- **NG3:** Multi-user concurrent editing — single-operator model with file-level locking
- **NG4:** Real-time synchronization between code and data repos — sync is manual (git pull)

## 3. System Context

```
┌──────────────────────────────────────────────────────────┐
│                   ai-triad-data (~410 MB)                 │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  taxonomy/Origin/                                    │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐            │ │
│  │  │ acc.json │ │ saf.json │ │ skp.json │ sit.json   │ │
│  │  └──────────┘ └──────────┘ └──────────┘            │ │
│  │  edges.json  embeddings.json  policy_actions.json   │ │
│  ├─────────────────────────────────────────────────────┤ │
│  │  sources/    summaries/    conflicts/    debates/    │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────┬───────────────────────────┘
                               │ read/write via file I/O
                               ▼
┌───────────────────────────────────────────────────────────┐
│                  ai-triad-research (code)                  │
│  ┌──────────┐  ┌─────────────┐  ┌──────────────────────┐ │
│  │ PS Module│  │ Debate      │  │ Taxonomy Editor      │ │
│  │ (75 cmds)│  │ Engine      │  │ (Electron)           │ │
│  └──────────┘  └─────────────┘  └──────────────────────┘ │
└───────────────────────────────────────────────────────────┘
```

**Why two repositories?** The data repo is ~410 MB (PDFs, embeddings, debate transcripts). Keeping it separate prevents code PRs from downloading hundreds of megabytes. CI uses shallow clones of the data repo and symlinks it to `../ai-triad-data`.

## 4. Data Architecture

### 4.1 Taxonomy Structure

The taxonomy is a forest of four trees, each representing a distinct perspective on AI governance:

```
┌─── Accelerationist (acc-) ───┐  ┌─── Safetyist (saf-) ─────────┐
│  ├── Beliefs                  │  │  ├── Beliefs                   │
│  │   ├── acc-beliefs-001      │  │  │   ├── saf-beliefs-001       │
│  │   ├── acc-beliefs-002      │  │  │   └── ...                   │
│  │   └── ...                  │  │  ├── Desires                   │
│  ├── Desires                  │  │  └── Intentions                │
│  └── Intentions               │  └────────────────────────────────┘
└───────────────────────────────┘
┌─── Skeptic (skp-) ───────────┐  ┌─── Situations (sit-) ─────────┐
│  ├── Beliefs                  │  │  sit-001 ─┬─ acc interpretation│
│  ├── Desires                  │  │           ├─ saf interpretation│
│  └── Intentions               │  │           └─ skp interpretation│
└───────────────────────────────┘  └────────────────────────────────┘
```

Within each POV tree, nodes organize hierarchically via `parent_id` with three relationship types:
- **is_a** — child is a specific type of parent
- **part_of** — child is a component of parent
- **specializes** — child narrows or refines parent

### 4.2 BDI Classification

Each claim node belongs to one of three Belief-Desire-Intention categories, adapted from the philosophical BDI agent architecture:

| Category | What It Represents | Example |
|---|---|---|
| **Belief** | Empirical claim about the world | "AGI will arrive within a decade" |
| **Desire** | Normative commitment or value | "We ought to prioritize safety research" |
| **Intention** | Strategic reasoning or action proposal | "We should slow down capability development" |

This three-way split is not merely organizational — it determines how claims are evaluated. A Belief can be fact-checked; a Desire can be ethically analyzed; an Intention can be assessed for feasibility. The debate engine's extraction pipeline classifies each claim accordingly, and the QBAF network treats BDI types differently when computing argument strength.

### 4.3 Situation Nodes

Situations are cross-cutting concepts that all three camps discuss but interpret differently. Each situation node contains per-POV BDI interpretations:

```
sit-001: "When Will Super-Smart AI Arrive?"
  ├── Accelerationist: belief="coming fast", desire="lead development", intention="build quickly"
  ├── Safetyist:       belief="coming fast", desire="prioritize safety",  intention="slow down"
  └── Skeptic:         belief="it's hype",   desire="focus on real harm", intention="ignore speculation"
```

Situations serve as natural debate topics because they force characters to engage with the same concept from incompatible premises. The `disagreement_type` field classifies whether the disagreement is interpretive (same facts, different conclusions), definitional (different meanings of key terms), or structural (different causal models).

### 4.4 Edge Model

Edges connect nodes with AIF-aligned relationship types:

| Type | Directionality | Meaning |
|---|---|---|
| SUPPORTS | A → B | Claim A strengthens claim B |
| CONTRADICTS | A ↔ B | Claims directly oppose each other |
| ASSUMES | A → B | Claim A requires B as a prerequisite |
| WEAKENS | A → B | Claim A undercuts B without direct contradiction |
| RESPONDS_TO | A → B | Claim A addresses or answers B |
| TENSION_WITH | A ↔ B | Implicit, unresolved conflict |
| INTERPRETS | A → B | Claim A provides meaning or context for B |

Each edge carries confidence (0–1), weight, status (proposed/approved/rejected), and a rationale field explaining the relationship. Edges can be AI-discovered (`Invoke-EdgeDiscovery`), manually created (`Set-Edge`), or extracted from debates.

### 4.5 Policy Actions Registry

The file `policy_actions.json` is a centralized registry of ~1,091 concrete policy recommendations. Each POV node references policies by `policy_id` with perspective-specific framing:

```
pol-001: "Fund retraining programs for workers displaced by AI automation"
  ├── Accelerationist framing: "Necessary investment to enable faster adoption"
  ├── Safetyist framing:       "Essential safety net during transition period"
  └── Skeptic framing:         "Minimum obligation to address real harm"
```

The registry is the canonical source — POV nodes reference it, they don't duplicate policy text. This ensures policy actions are comparable across perspectives even when framing differs.

### 4.6 Embeddings

All node descriptions are embedded using **all-MiniLM-L6-v2** (384 dimensions) and stored in `embeddings.json`. Uses:

- **Semantic search** — `Get-Tax -Similar "topic"` finds nodes by meaning, not keywords
- **RAG context selection** — during summarization, only inject taxonomy nodes semantically relevant to the source document
- **Situation candidate discovery** — cluster similar nodes across POVs to find potential new situation topics
- **Overlap detection** — identify near-duplicate nodes for merge proposals

Embeddings are regenerated via `Update-TaxEmbeddings` after taxonomy edits.

## 5. Data Flow: Document Ingestion to Taxonomy

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│ Source       │────►│ Import       │────►│ Markdown         │
│ (URL/file)   │     │ (slug, raw   │     │ Snapshot         │
│              │     │  storage)    │     │ + Metadata       │
└─────────────┘     └──────────────┘     └────────┬─────────┘
                                                   │
                                                   ▼
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│ Taxonomy    │◄────│ Unmapped     │◄────│ POV Summary      │
│ Updates     │     │ Resolution   │     │ (CHESS → RAG     │
│ (new nodes, │     │ (fuzzy match │     │  → FIRE/single   │
│  edges)     │     │  to existing)│     │  shot extraction) │
└─────────────┘     └──────────────┘     └────────┬─────────┘
                                                   │
                                                   ▼
                                         ┌──────────────────┐
                                         │ Conflict         │
                                         │ Detection        │
                                         │ (QBAF analysis)  │
                                         └──────────────────┘
```

Each stage is independently re-runnable. Re-running `Invoke-POVSummary -Force` on a previously summarized document regenerates the summary without re-importing. Conflict detection is append-only — re-running never overwrites existing conflict records.

## 6. Data Path Resolution

The system runs in three deployment contexts with different data locations:

| Context | Data Location | Resolution Mechanism |
|---|---|---|
| Dev (sibling repos) | `../ai-triad-data` | `.aitriad.json` → `data_root: "."` |
| PSGallery install | Platform-specific | Windows: `%LOCALAPPDATA%\AITriad\data` |
| Container | `/data` volume | `$AI_TRIAD_DATA_ROOT=/data` |

Resolution priority: env var > `.aitriad.json` > platform default.

The `.aitriad.json` file maps logical names to directory paths:

```json
{
  "data_root": ".",
  "taxonomy_dir": "taxonomy/Origin",
  "sources_dir": "sources",
  "summaries_dir": "summaries",
  "conflicts_dir": "conflicts",
  "debates_dir": "debates"
}
```

At module load time, `Resolve-DataPath` evaluates this chain once and caches the result. All downstream code uses accessor functions (`Get-TaxonomyDir`, `Get-SourcesDir`, etc.) that return resolved absolute paths.

## 7. Node Graph Attributes

Beyond basic properties, each node carries AI-extracted graph attributes that enable deeper analysis:

| Attribute | Purpose |
|---|---|
| `epistemic_type` | Classification: normative_prescription, empirical_claim, definitional, etc. |
| `rhetorical_strategy` | How the argument persuades: techno_optimism, fear_appeal, etc. |
| `assumes` | Hidden premises the claim depends on |
| `falsifiability` | How testable is this claim? (low/medium/high) |
| `audience` | Who is this argument targeting? (public, policymakers, researchers) |
| `emotional_register` | Tone: aspirational, alarmist, pragmatic, etc. |
| `intellectual_lineage` | Philosophical traditions (Effective Altruism, Critical Theory, etc.) |
| `steelman_vulnerability` | The strongest counterargument to this claim |
| `possible_fallacies` | Flagged reasoning issues with confidence levels |
| `policy_actions` | Linked policies with POV-specific framing |
| `node_scope` | AIF classification: claim, scheme, preference, etc. |

These attributes are extracted by `Invoke-AttributeExtraction` and stored on the node's `graph_attributes` field. They enable queries like "find all claims that assume AI is inherently beneficial" or "show normative prescriptions targeting policymakers."

## 8. Design Decisions and Trade-offs

### D1: Two-Repository Split (Code + Data)

**Chosen:** Separate git repositories for code (~50 MB) and data (~410 MB).

**Why:** The data repository contains PDFs, debate transcripts with full LLM responses, and 384-dim embedding vectors. A single repo would mean every `git clone` downloads 410 MB — unacceptable for CI (2 jobs per push) and for contributors who only want the code. Shallow clones of the data repo in CI reduce checkout to ~50 MB.

**Trade-off accepted:** Data path resolution adds complexity (3-level priority chain). Developers must remember to pull both repos. `.aitriad.json` and `Resolve-DataPath` are the tax we pay for this split.

**Alternative considered:** Git LFS. Rejected because GitHub LFS has bandwidth quotas that would be exceeded by CI, and LFS-tracked files still inflate clone operations for users who don't configure LFS properly.

### D2: BDI Classification Over Alternative Taxonomies

**Chosen:** Belief-Desire-Intention from philosophical agent theory.

**Why:** AI governance arguments naturally decompose into "what is" (Belief), "what should be" (Desire), and "what to do" (Intention). This maps cleanly to academic argumentation: empirical claims can be fact-checked, values can be ethically analyzed, action proposals can be assessed for feasibility. Other classification schemes (Toulmin's model, pragma-dialectics) were evaluated — Toulmin lacks a clean normative/strategic split; pragma-dialectics is too focused on debate procedure rather than claim type.

**Trade-off accepted:** BDI categories have different AI extraction reliability (Beliefs: 0.30, Desires: 0.65, Intentions: 0.71). We accept this because the alternative — treating all claims uniformly — would hide quality differences rather than exposing them.

### D3: JSON Files Over a Database

**Chosen:** Plain JSON files on disk, loaded into memory at module startup.

**Why:** The dataset is small enough (~320 nodes, ~500 edges) that full in-memory operation is practical. JSON files are diffable in git, inspectable in any text editor, and require zero infrastructure. The PowerShell module loads all taxonomy files at import time into `$script:TaxonomyData` — subsequent queries are pure in-memory operations with no I/O.

**Trade-off accepted:** No query optimizer, no indexing, no transactions. Concurrent writes could corrupt data (mitigated by single-operator model — NG3). If the taxonomy grows to 10,000+ nodes, the in-memory model may need revisiting.

**Alternative considered:** SQLite. Would provide proper queries and indexing but would break the git-diffable property that makes data review easy. Neo4j is available as an export target (`Export-TaxonomyToGraph`) for users who need graph queries, but it's not the source of truth.

### D4: Centralized Policy Registry

**Chosen:** Single `policy_actions.json` file with POV-specific framing on nodes.

**Why:** The same policy action ("fund retraining programs") can be framed differently by each perspective. Without a canonical registry, the same action appears as three different policies that are difficult to compare. The registry normalizes action text while preserving framing diversity via the `framing` field on POV node references.

**Trade-off accepted:** The registry has grown to 1,091 entries, some of which are near-duplicates with slightly different wording. `Invoke-PolicyRefinement` consolidates framings, but manual review is still needed for borderline cases.

### D5: all-MiniLM-L6-v2 for Embeddings

**Chosen:** 384-dimensional embeddings from a lightweight sentence transformer.

**Why:** The model is small enough to run locally (no API calls for embedding), fast enough for batch operations (re-embedding 320 nodes takes seconds), and quality is sufficient for semantic search and similarity clustering at our scale. 384 dimensions keep `embeddings.json` manageable (~500 KB).

**Trade-off accepted:** Lower quality than larger models (e.g., OpenAI's text-embedding-3-large at 3072 dims). For our use case — finding which of 320 taxonomy nodes are relevant to a query — the quality difference is negligible. If the taxonomy grows to 10,000+ nodes, a higher-quality model may be needed to maintain search precision.

### D6: AIF-Aligned Edge Types

**Chosen:** Seven edge types inspired by the Argument Interchange Format.

**Why:** AIF is the established standard for computational argumentation. Our edge types map to AIF concepts: SUPPORTS/CONTRADICTS correspond to inference/conflict schemes, ASSUMES maps to enthymematic premises, WEAKENS captures undercutting. This alignment lets us export to standard argumentation tools and grounds our model in published research.

**Trade-off accepted:** AIF is richer than our seven types. We deliberately simplified to avoid edge-type proliferation — the LLM models that discover edges are more reliable with fewer categories. The `attack_type` subfield on edges (rebut/undercut/undermine) captures finer distinctions when needed.

### D7: Append-Only Conflict Detection

**Chosen:** Conflict detection never overwrites existing conflict records.

**Why:** Conflicts represent historical factual disagreements between documents. If a conflict was detected between papers A and B, re-running detection on paper C should not remove or modify the A-B conflict. Append-only semantics prevent data loss from re-runs.

**Trade-off accepted:** Duplicate conflicts can accumulate. `conflicts-consolidated/` contains a deduplicated set, but the raw `conflicts/` directory may contain redundant entries.

## 9. Schema Evolution

The taxonomy schema has evolved through 6 phases:

| Phase | Change | Migration |
|---|---|---|
| 1 | Initial node schema (label, description, category) | — |
| 2 | Added graph_attributes (AI-extracted enrichment) | `Invoke-AttributeExtraction` backfill |
| 3 | Added edge types (AIF-aligned) | `Invoke-EdgeDiscovery` backfill |
| 4 | Added policy_actions registry | `Find-PolicyAction` extraction + `Update-PolicyRegistry` |
| 5 | BDI migration (category rename, ID scheme change) | `Invoke-SchemaMigration` with manifest |
| 6 | Situations refactor (cross-cutting → situations, per-POV interpretations) | Manifest-tracked rename |

Migrations are recorded in manifest files (`_bdi_migration_manifest.json`, `_id_migration_manifest.json`, `_situations_migration_manifest.json`) for auditability. `Invoke-SchemaMigration` supports dry-run mode for previewing changes.

There is no automated migration framework — this is a deliberate non-goal (NG2). The dataset is small enough that manual migration scripts with manifests are manageable.

## 10. Risks and Open Questions

| Risk | Impact | Mitigation |
|---|---|---|
| **Scale limits** | In-memory model breaks above ~10K nodes | Current count is 320; monitor growth rate |
| **Embedding model lock-in** | Changing models requires full re-embedding + threshold recalibration | Embeddings regenerable via `Update-TaxEmbeddings`; thresholds configurable |
| **Concurrent writes** | File corruption from parallel editing | Single-operator model; no multi-user support |
| **Schema evolution** | No automated migration framework | Manifests + `Invoke-SchemaMigration` sufficient at current scale |
| **Edge reliability** | AI-discovered edges have ~70% precision | Status field (proposed/approved/rejected) supports human review workflow |

## 11. Glossary

| Term | Definition |
|---|---|
| **POV** | Point of view — one of four perspective camps (acc, saf, skp, sit) |
| **BDI** | Belief-Desire-Intention — claim classification scheme from philosophy of mind |
| **AIF** | Argument Interchange Format — standard for computational argumentation |
| **I-node** | Information node in AIF — a discrete claim or piece of evidence |
| **QBAF** | Quantitative Bipolar Argumentation Framework — graph with computed strengths |
| **Situation** | Cross-cutting concept interpreted differently by each POV camp |
| **RAG** | Retrieval-Augmented Generation — selecting relevant taxonomy nodes for prompts |
| **CHESS** | Pre-classification step determining which POVs are relevant to a document |
| **FIRE** | Iterative extraction with confidence gating — multi-turn claim extraction |
