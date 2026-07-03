# Plan: Assign `parent_id` to All POV Taxonomy Nodes

**Date:** 2026-03-27
**Status:** Draft

---

## Problem Statement

The taxonomy contains 390 nodes across four files. Only 3 nodes have a `parent_id` set (1 in ACC, 2 in SKP), and 0 nodes have `children` populated. The `parent_id` / `children` fields exist in the schema and are consumed by `ConvertTo-TaxonomyNode`, `Invoke-ProposalApply` (SPLIT/MERGE), and the Taxonomy Editor UI, but they are effectively unused. The taxonomy is flat.

A proper hierarchy would enable:
- Tree navigation in the Taxonomy Editor (collapsible parent groups)
- Attribute inheritance in graph queries (child inherits parent's epistemic type, audience, etc.)
- Better document mapping (map to most specific node; fall back to parent)
- Meaningful SPLIT proposals (the AI currently has no hierarchy to split into)
- Reduced visual clutter (299 Intentions nodes across 3 POVs become manageable groups)

### Inventory

| File | Nodes | Desires | Beliefs | Intentions | Has parent_id |
|------|-------|-------------|------------|-------------------|--------------|
| accelerationist.json | 74 | 12 | 15 | 47 | 1 |
| safetyist.json | 125 | 13 | 36 | 76 | 0 |
| skeptic.json | 100 | 13 | 38 | 49 | 2 |
| cross-cutting.json | 91 | -- | -- | -- | 0 |
| **Total** | **390** | **38** | **89** | **172** | **3** |

### Available Assets

- **Embeddings**: 384-dim MiniLM vectors for all 352 POV nodes in `embeddings.json`
- **Graph attributes**: ~255 of 299 POV nodes have `graph_attributes` (epistemic_type, assumes, intellectual_lineage, etc.)
- **Edges**: 13,941 edges (8,609 approved) with typed relations (SUPPORTS, ASSUMES, etc.)
- **Clustering**: `Get-EmbeddingClusters` already implements agglomerative clustering with cosine similarity
- **Topic labeling**: `topic-frequency-label.prompt` can name clusters

---

## Approach: AI-Assisted, Human-Approved, Per-POV-Per-Category

### Why Not Fully Manual?

299 nodes across three POVs require ~900 comparison decisions. Manual assignment would take days and produce inconsistent results across POVs. The existing embeddings, edges, and graph attributes provide strong signals for automated grouping.

### Why Not Fully Automated?

Parent-child relationships carry ontological commitments (is_a vs. part_of vs. specializes -- see `docs/bfo-prompt-recommendations.md` recommendation #6). These commitments require human judgment about what the hierarchy *means*, not just what's statistically similar.

### The Hybrid Approach

1. **Compute** candidate groupings using embeddings + edge structure
2. **Propose** parent assignments using an AI prompt grounded in those groupings
3. **Review** each POV/category interactively in the Taxonomy Editor
4. **Apply** approved assignments in bulk

---

## Phase 1: Pre-Computation (Automated)

### Step 1.1 — Cluster Within Each POV + Category

Use `Get-EmbeddingClusters` to group nodes within each of the 9 POV/category buckets (3 POVs x 3 categories). Cross-cutting nodes get their own pass.

**Parameters:**
- `MaxClusters`: scale by bucket size -- target 3-7 nodes per cluster
  - Buckets with < 10 nodes: `MaxClusters = 2-3`
  - Buckets with 10-30 nodes: `MaxClusters = 5-7`
  - Buckets with 30+ nodes: `MaxClusters = 8-12`
- `MinSimilarity`: 0.50 (slightly lower than default 0.55 to avoid orphan singletons)

**Output:** A JSON file per POV with cluster assignments:
```json
{
  "pov": "accelerationist",
  "category": "Intentions",
  "clusters": [
    {
      "cluster_id": 0,
      "node_ids": ["acc-intentions-001", "acc-intentions-023", "acc-intentions-032"],
      "centroid_node": "acc-intentions-001"
    }
  ]
}
```

### Step 1.2 — Enrich Clusters with Edge Evidence

For each cluster, query `edges.json` for intra-cluster edges. Clusters where members heavily SUPPORT or ASSUME each other are stronger candidates for parent-child hierarchy (they share logical dependencies). Clusters linked only by TENSION_WITH may be peers, not parent-child.

**Output:** Add to each cluster:
```json
{
  "intra_edges": {
    "SUPPORTS": 4,
    "ASSUMES": 2,
    "TENSION_WITH": 0
  },
  "cohesion_score": 0.73
}
```

### Step 1.3 — Enrich Clusters with Graph Attribute Patterns

For each cluster, check whether members share `epistemic_type`, `rhetorical_strategy`, or `intellectual_lineage`. Shared attributes strengthen the case for a common parent.

**Output:** Add to each cluster:
```json
{
  "shared_epistemic_type": "strategic_recommendation",
  "shared_rhetorical_strategies": ["appeal_to_evidence"],
  "attribute_coherence": 0.81
}
```

---

## Phase 2: Parent Node Generation (AI-Assisted)

### Step 2.1 — Create a Hierarchy Proposal Prompt

A new prompt `hierarchy-proposal.prompt` that receives one POV/category bucket at a time with its cluster data and proposes:

1. **Parent nodes** for each cluster that needs one (some clusters may be too small or incoherent to warrant a parent)
2. **Assignment of existing nodes** to those parents via `parent_id`
3. **Relationship type** for each parent-child link: `is_a`, `part_of`, or `specializes`

**Prompt design principles:**

```
You are an ontology engineer organizing taxonomy nodes into a shallow hierarchy.

You will receive:
  1. A POV (accelerationist / safetyist / skeptic) and a category
     (Desires, Beliefs, or Intentions)
  2. A set of nodes with their labels, descriptions, and graph attributes
  3. Pre-computed clusters with cohesion scores and edge evidence

Your task:
  For each cluster that warrants grouping (cohesion_score >= 0.60 OR
  cluster size >= 3), propose a PARENT NODE that captures the common
  theme of its members.

PARENT NODE RULES:
  - The parent must be MORE GENERAL than any of its children.
    Test: every child's description should be a specific case of the
    parent's description.
  - The parent label must be 3-8 words -- a thematic heading, not a
    sentence.
  - The parent description must use genus-differentia form:
    "A [category] within [POV] discourse that [differentia].
    Encompasses: [list child themes]. Excludes: [what is NOT covered]."
  - The parent inherits the same category as its children.
  - The parent gets a new ID following convention: {pov}-{category}-P{nn}
    where P signals it is a parent node and nn is a two-digit sequence.

RELATIONSHIP TYPE (required for each child):
  - "is_a": the child is a more specific version of the parent.
    Test: "Is [child] a kind of [parent]?"
  - "part_of": the child is a component or aspect of the parent.
    Test: "Is [child] a part of [parent]?"
  - "specializes": the child is a concrete implementation of the
    parent's general principle.
    Test: "Is [child] a specific way to do [parent]?"

STRUCTURAL CONSTRAINTS:
  - Target depth: exactly 2 levels (parent + leaf). Do NOT propose
    grandparent nodes. We can add depth in a future pass.
  - Every existing node becomes either a parent or a child. No node
    remains unassigned UNLESS it is truly an outlier with no thematic
    neighbors (cohesion_score < 0.40 with all clusters).
  - A parent node CAN be an existing node promoted to parent status
    (if one member of the cluster is clearly more general than the
    others). In that case, do not create a new node -- just mark the
    existing node as the parent.
  - Prefer promoting an existing node over creating a new one.
  - Maximum 12 parent nodes per POV/category bucket. If the bucket
    has fewer than 6 nodes, 1-2 parents are sufficient.

OUTPUT: JSON array of parent proposals.
```

**Output schema:**
```json
[
  {
    "parent": {
      "id": "acc-intentions-P01",
      "is_new": true,
      "label": "Open-Source AI Advocacy",
      "description": "A Intentions position within accelerationist discourse that advocates for open-source development as both a safety mechanism and a democratization strategy. Encompasses: open-source safety arguments, legal protection for open models, community-driven development. Excludes: closed-source safety testing (saf-intentions), market competition arguments (acc-intentions-012)."
    },
    "children": [
      {
        "node_id": "acc-intentions-002",
        "relationship": "is_a",
        "rationale": "Argues open-source is specifically safer -- a kind of open-source advocacy focused on the safety angle."
      },
      {
        "node_id": "acc-intentions-021",
        "relationship": "specializes",
        "rationale": "Proposes letting many AI variants flourish -- a specific implementation of the open-source philosophy."
      },
      {
        "node_id": "acc-intentions-022",
        "relationship": "specializes",
        "rationale": "Focuses on legal protection -- a specific policy mechanism for open-source advocacy."
      }
    ]
  }
]
```

### Step 2.2 — Process Each Bucket

Run the prompt for each of the 9 POV/category buckets + 1 cross-cutting pass:

| Pass | POV | Category | Node Count | Expected Parents |
|------|-----|----------|------------|-----------------|
| 1 | accelerationist | Desires | 12 | 2-3 |
| 2 | accelerationist | Beliefs | 15 | 3-4 |
| 3 | accelerationist | Intentions | 47 | 8-12 |
| 4 | safetyist | Desires | 13 | 2-3 |
| 5 | safetyist | Beliefs | 36 | 5-7 |
| 6 | safetyist | Intentions | 76 | 10-12 |
| 7 | skeptic | Desires | 13 | 2-3 |
| 8 | skeptic | Beliefs | 38 | 5-7 |
| 9 | skeptic | Intentions | 49 | 8-12 |
| 10 | cross-cutting | (none) | 91 | 10-15 |

**Estimated total new parent nodes:** 55-80
**Estimated API calls:** 10 (one per bucket)
**Recommended model:** gemini-2.5-flash (needs to reason about relationships, not just extract)

### Step 2.3 — Validate Proposals Structurally

Before human review, run automated checks:

1. **No cycles**: no node is its own ancestor
2. **Single parent**: each node has at most one `parent_id`
3. **Same-file**: parent and child are in the same taxonomy file
4. **Same-category**: parent and child share the same category (for POV nodes)
5. **Depth = 2**: no grandchildren proposed
6. **ID uniqueness**: no proposed parent ID collides with existing nodes
7. **Coverage**: every leaf node is assigned (warn on unassigned outliers)

Output a validation report flagging any failures for manual resolution.

---

## Phase 3: Human Review (Interactive)

### Step 3.1 — Generate Review Artifacts

For each POV, generate a Markdown review document:

```markdown
# Accelerationist Hierarchy Proposal — Intentions

## Parent: Open-Source AI Advocacy (acc-intentions-P01) [NEW]
> A Intentions position within accelerationist discourse that...

| Child | Label | Relationship | Rationale |
|-------|-------|-------------|-----------|
| acc-intentions-002 | Open Source AI is Safer AI | is_a | ... |
| acc-intentions-021 | Let a Thousand AIs Bloom | specializes | ... |
| acc-intentions-022 | Keep Open-Source AI Legal Everywhere | specializes | ... |

**Verdict:** [ ] Accept  [ ] Modify  [ ] Reject

---

## Parent: Market-Driven Progress (acc-intentions-012) [PROMOTED]
> ... (existing description, possibly revised)

| Child | Label | Relationship | Rationale |
...
```

### Step 3.2 — Review Workflow

For each proposal, the reviewer can:

- **Accept**: parent and all child assignments are applied as-is
- **Modify**: adjust the parent label/description, move a child to a different parent, change the relationship type, or merge two proposed parents
- **Reject**: the cluster remains flat (no parent_id assigned)

**Priority order for review:**
1. Start with the smallest buckets (Desires, 12-13 nodes each) to calibrate judgment
2. Then Beliefs (15-38 nodes) -- empirical claims cluster well
3. Then Intentions (47-76 nodes) -- largest and most ambiguous
4. Cross-cutting last -- most complex due to lack of category axis

### Step 3.3 — Resolve Edge Cases

Specific situations requiring human judgment:

- **Singleton outliers**: nodes that don't fit any cluster. Options: (a) leave flat with `parent_id = null`, (b) create a "Miscellaneous" parent (avoid if possible), (c) recognize the outlier as a candidate for MERGE or removal
- **Cross-category parents**: a proposed parent that arguably spans Goals and Methods. Decision: assign to the dominant category, or split into two parents
- **Overlapping clusters**: two clusters that share a plausible parent. Decision: merge into one larger group or keep separate with more specific parents
- **Existing `parent_id` conflicts**: the 3 nodes that already have `parent_id` set. Decision: honor, override, or integrate with the new hierarchy

---

## Phase 4: Application (Automated)

### Step 4.1 — Write a Bulk Hierarchy Applier

New function: `Set-TaxonomyHierarchy`

```powershell
function Set-TaxonomyHierarchy {
    param(
        [Parameter(Mandatory)]
        [string]$ProposalFile,    # Path to approved hierarchy JSON

        [switch]$DryRun,          # Show changes without writing
        [switch]$Force            # Overwrite existing parent_id values
    )
}
```

**Logic:**
1. Read the approved proposal JSON
2. For each new parent node: append to the appropriate taxonomy file
3. For each child assignment: set `parent_id` on the child node
4. For each parent node: populate `children` array with its child IDs
5. Update `last_modified` on each changed file
6. Write back to disk

**Safety:**
- Create a git-trackable backup before writing (the data repo has git)
- Validate the structural constraints from Step 2.3 before writing
- Refuse to write if validation fails
- `DryRun` mode shows a summary: "N new parents, M child assignments, K files modified"

### Step 4.2 — Update Downstream Systems

After hierarchy is applied:

1. **Regenerate embeddings** for new parent nodes (`embeddings.json` needs vectors for ~60 new nodes)
2. **Run attribute extraction** on new parent nodes (they need `graph_attributes`)
3. **Run edge discovery** on new parent nodes (they need edges to existing nodes)
4. **Update Taxonomy Editor** tree view to render collapsible parent groups
5. **Bump TAXONOMY_VERSION** to trigger summary re-validation (existing summaries are still valid -- they map to leaf nodes which haven't changed)

### Step 4.3 — Validate Consistency

Post-application checks:

- Every `parent_id` references a real node in the same file
- Every `children` array is the inverse of `parent_id` references to that node
- No orphan parent nodes (parents with zero children)
- No depth > 2 violations
- Edge counts haven't changed (existing edges reference leaf nodes, which are unchanged)

---

## Phase 5: Cross-Cutting Nodes (Special Handling)

Cross-cutting nodes differ from POV nodes:
- No `category` field
- Have `interpretations` (per-POV readings) and `linked_nodes` instead of `parent_id`/`children`
- The schema (`pov-taxonomy.schema.json`) currently doesn't define a cross-cutting node type -- `parent_id` and `children` are not in the cross-cutting structure

### Approach for Cross-Cutting

**Option A — Add `parent_id`/`children` to cross-cutting nodes** by extending the schema. This requires:
- Schema update (add optional `parent_id` and `children` to a new `CrossCuttingNode` definition)
- `ConvertTo-TaxonomyNode` update (it already handles the CC case, just needs the new fields)
- Cross-cutting hierarchy prompt (group by thematic area: "Risk & Safety", "Governance & Regulation", "Economic Impact", etc.)

**Option B — Use thematic tags instead of hierarchy** for cross-cutting. Add a `theme` field to cross-cutting nodes (e.g., `"theme": "governance"`) and group by theme in the UI without formal parent-child. This is simpler and may be sufficient since cross-cutting concepts are inherently lateral rather than hierarchical.

**Recommendation:** Option B for now. Cross-cutting concepts are definitional anchors -- they need to remain flat and accessible. Thematic grouping for navigation is sufficient without implying ontological subsumption.

---

## Timeline and Dependencies

| Phase | Steps | Depends On | Estimated Effort |
|-------|-------|-----------|-----------------|
| 1 — Pre-Computation | 1.1, 1.2, 1.3 | Embeddings + edges exist (done) | Build: 2-3 hours |
| 2 — AI Proposals | 2.1, 2.2, 2.3 | Phase 1 output | Prompt: 1-2 hours, Run: ~30 min |
| 3 — Human Review | 3.1, 3.2, 3.3 | Phase 2 output | Review: 2-4 hours |
| 4 — Application | 4.1, 4.2, 4.3 | Phase 3 decisions | Build: 1-2 hours, Run: ~1 hour |
| 5 — Cross-Cutting | Schema decision | Phase 4 complete | 1-2 hours |

**Total estimated effort:** 8-14 hours across build, run, and review

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| AI proposes parents that are too abstract | Hierarchy becomes useless for navigation | Prompt constrains parent to genus-differentia form with exclusion boundaries |
| Clusters are too coarse (many unrelated nodes grouped) | Forced parent-child relationships that aren't real | Cohesion threshold (0.60) rejects weak clusters; review can reject |
| Existing summaries reference leaf nodes that now have parents | Broken summary-to-node mappings | Leaf node IDs are unchanged -- only `parent_id` is added. Summaries remain valid |
| New parent node IDs (P01, P02...) conflict with future proposals | ID collision on next taxonomy proposal | Reserve the P-prefix namespace; update `taxonomy-proposal.prompt` to avoid it |
| Review fatigue on large buckets (76 SAF Methods nodes) | Reviewer rubber-stamps bad assignments | Process smallest buckets first for calibration; break large buckets into sub-batches |
| Cross-cutting nodes don't fit parent-child model | Forced hierarchy on lateral concepts | Use thematic tags (Option B) instead of hierarchy |

---

## Success Criteria

1. Every POV node has `parent_id` set (either a parent node ID or null for intentional outliers)
2. Every parent node has a non-empty `children` array that is the exact inverse of its children's `parent_id` values
3. Hierarchy depth is exactly 2 (parent + leaf) across all files
4. New parent nodes have embeddings, graph attributes, and edges
5. Taxonomy Editor renders the hierarchy as collapsible groups
6. Existing summaries, edges, and conflicts require zero changes
