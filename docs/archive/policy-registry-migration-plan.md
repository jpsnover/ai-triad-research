# Policy Registry Migration — Phased Implementation Plan

## Current State

**Data repo** (`ai-triad-data`): Schema v1.1.0 with `policy_actions.json` registry (270 policies, `pol-NNN` IDs), `policy_id` references in all POV node `graph_attributes.policy_actions`, 452 policy-to-policy edges in `edges.json`, and 270 policy embeddings in `embeddings.json`.

**Code repo** (`ai-triad-research`): Partially updated. The taxonomy-editor UI is registry-aware (picker, alignment panel, edge visualization). Everything else — PowerShell cmdlets, prompts, summary-viewer, embed_taxonomy.py, tests — still uses the old `{action, framing}` format with no `policy_id`.

## Data Repo Cleanup (Pre-Phase)

Before starting code work, clean the data repo:

- [ ] Remove `sources/*_files/` directories (557 JS/CSS web snapshot artifacts, ~137MB)
- [ ] Remove `taxonomy/hierarchy-proposals/*.md` working documents
- [ ] Add `*_files/` and `hierarchy-proposals/*.md` to `.gitignore`
- [ ] Verify no executable code exists in the data repo

**Sync:** Commit and push `ai-triad-data`. No tests needed — data-only changes.

---

## Phase 1: PowerShell Core — Schema Alignment

**Goal:** All cmdlets that read/write policy_actions understand the new schema.

### 1.1 Update Find-PolicyAction.ps1
- Change output format from `{action, framing}` to `{policy_id, action, framing}`
- On generation: match new action text against existing registry entries (fuzzy/embedding match)
- If match found (sim >= 0.85): reuse existing `pol-NNN` ID
- If no match: assign next available `pol-NNN` ID and append to `policy_actions.json`
- Update `policy-actions-schema.prompt` to include `policy_id` in output schema
- Update `policy-actions.prompt` to instruct the LLM to use existing policy IDs when possible

### 1.2 Update Invoke-AttributeExtraction.ps1
- Same change: `policy_actions` output must include `policy_id`
- Update `attribute-extraction-schema.prompt` to include `policy_id`
- Update `attribute-extraction.prompt` to reference the policy registry

### 1.3 Update Invoke-POVSummary.ps1
- The summary pipeline reads taxonomy context. Ensure it passes policy_id references through correctly
- Update `pov-summary-system.prompt` to instruct the LLM to reference `pol-NNN` IDs when mapping claims to policies
- Update `pov-summary-schema.prompt` if summary output includes policy references

### 1.4 New cmdlet: Get-Policy
- Lookup policies by ID, keyword, or POV
- Show cross-node usage and edge summary
- Support pipeline input from Get-Tax

### 1.5 New cmdlet: Update-PolicyRegistry
- Rebuild `policy_actions.json` from all nodes' `graph_attributes.policy_actions`
- Detect orphans (in registry but not referenced) and remove
- Detect unregistered (referenced but not in registry) and assign IDs
- Update `member_count` and `source_povs` fields
- Called after bulk operations like Invoke-AttributeExtraction

### 1.6 Update Show-AITriadHelp.ps1
- Document new policy registry schema
- Document Get-Policy and Update-PolicyRegistry

### Tests
- `Find-PolicyAction` outputs `policy_id` field
- `Find-PolicyAction` reuses existing registry IDs for matching actions
- `Update-PolicyRegistry` correctly counts members and detects orphans
- `Get-Policy` returns correct results by ID and keyword

**Sync:** Commit and push `ai-triad-research`. Run `Invoke-Pester ./tests/`.

---

## Phase 2: Embeddings — Policy-Aware Pipeline

**Goal:** embed_taxonomy.py and all embedding consumers handle `pol-*` entries.

### 2.1 Update embed_taxonomy.py
- `generate` command: after embedding taxonomy nodes, also embed all policies from `policy_actions.json`
- Store policy embeddings with `"pov": "policy"` prefix in `embeddings.json`
- `query` command: include policy results (optionally filter with `--type policy` or `--type node`)
- `find-overlaps` command: support policy-to-policy overlap detection

### 2.2 Update Update-TaxEmbeddings.ps1
- No changes needed if embed_taxonomy.py handles policies internally
- Add `--policies-only` flag for quick policy re-embedding without full rebuild

### 2.3 Update taxonomy-editor embeddings.ts
- `loadEmbeddingsFile()` already loads all entries — no change needed
- `computeEmbeddings()` with IDs: pol-* IDs should resolve from cache like node IDs
- Verify `updateNodeEmbeddings()` works for policy entries (pov = 'policy')

### 2.4 Update summary-viewer embeddings.ts
- `loadEmbeddings()` already returns all entries — verify pol-* entries are included
- Similarity search should optionally include/exclude policies

### Tests
- `embed_taxonomy.py generate` produces embeddings for both nodes and policies
- `embed_taxonomy.py query "worker retraining"` returns pol-* results
- Embedding count matches node_count + policy_count
- TypeScript embedding cache includes pol-* entries

**Sync:** Commit and push both repos. Run `Invoke-Pester` + manual embedding generation test.

---

## Phase 3: Summary Viewer — Registry Integration

**Goal:** Summary viewer understands policy_id references and can display policy data.

### 3.1 Update summary-viewer types
- Add `policy_id?: string` to policy_actions type in `types/types.ts`
- Add `PolicyRegistryEntry` type

### 3.2 Add policy registry IPC
- Add `readPolicyRegistry()` to `summary-viewer/src/main/fileIO.ts`
- Add `load-policy-registry` IPC handler
- Add to preload and electron.d.ts

### 3.3 Update store
- Load policy registry on startup
- When displaying policy_actions, show registry action text (in case node text is stale)

### 3.4 Update KeyPointsPane / existing UI
- If policy_actions are displayed, show `pol-NNN` badge and cross-node reuse indicator
- Link to policy registry for shared policies

### Tests
- Summary viewer loads policy registry without errors
- Policy IDs resolve to correct action text
- UI renders policy badges

**Sync:** Commit and push `ai-triad-research`. Manual UI verification.

---

## Phase 4: Edge Discovery — Policy Edges in Pipeline

**Goal:** Edge discovery pipeline (Invoke-EdgeDiscovery) can propose and manage policy-to-policy edges.

### 4.1 Update Invoke-EdgeDiscovery.ps1
- Add policy-to-policy edge discovery mode
- Use embeddings to find candidate pairs, then NLI cross-encoder for classification
- Propose CONTRADICTS, COMPLEMENTS, TENSION_WITH edges
- Output to edges.json with `llm_proposed: true`

### 4.2 Update edge-discovery.prompt / schema
- Add policy-specific edge types or instructions for policy context
- Ensure the LLM understands pol-* IDs

### 4.3 Node-to-policy edges
- Add `PROPOSES` edge type to `edges.json` edge_types
- Generate edges: `acc-desires-001 --PROPOSES--> pol-001` from `graph_attributes.policy_actions`
- This makes the implicit link explicit and queryable

### 4.4 Update taxonomy-editor Edge Browser
- Edge Browser should display pol-* nodes with policy action text
- Filter by edge type should include policy-specific views

### Tests
- `Invoke-EdgeDiscovery` produces policy edges
- Node-to-policy PROPOSES edges are generated correctly
- Edge Browser displays policy edges

**Sync:** Commit and push both repos. Run Pester tests + manual edge browser verification.

---

## Phase 5: AI Analysis — Policy-Aware Critique

**Goal:** The AI Analysis feature in the taxonomy editor uses policy registry context.

### 5.1 Update nodeCritiquePrompt
- Include relevant policy registry entries in the critique context
- Instruct the AI to evaluate whether policy_actions reference the correct registry entries
- Check for policies that should be shared but aren't

### 5.2 Accept button for policy changes
- When AI suggests policy_action changes, the Accept button should:
  - Match proposed actions against the registry
  - Reuse existing pol-NNN IDs where possible
  - Create new registry entries for genuinely new policies

### 5.3 Policy-specific analysis
- Add "Policy Analysis" option that critiques a specific pol-NNN entry
- Evaluate: is this policy well-scoped? Are its edges accurate? Should it be split or merged?

### Tests
- AI Analysis prompt includes policy context
- Accept button correctly matches/creates registry entries
- Policy-specific analysis runs without errors

**Sync:** Commit and push `ai-triad-research`. Manual testing of AI Analysis flow.

---

## Phase 6: Data Quality & Cleanup

**Goal:** Final validation and cleanup across both repos.

### 6.1 Policy canonical text refinement
- For the 49 merged policies, use AI to generate POV-neutral canonical text
- Currently some carry one POV's wording as the canonical text

### 6.2 Policy categorization
- Add `category` and `tags` fields to registry entries (workforce, regulation, funding, transparency, taxation, etc.)
- Update the policy picker to support filtering by category

### 6.3 Validation cmdlet
- `Test-TaxonomyIntegrity` — validate:
  - All `policy_id` references resolve to registry entries
  - All registry entries are referenced by at least one node
  - `member_count` and `source_povs` are accurate
  - No duplicate policy_id references within a single node
  - Edge source/target IDs all resolve to existing nodes/policies
  - Embeddings exist for all nodes and policies

### 6.4 Remove `policy_actionability` legacy field
- Audit which nodes still have the old `policy_actionability` string field
- Migrate any remaining data, then remove the field from types

### Tests
- `Test-TaxonomyIntegrity` passes with zero errors
- Full Pester test suite passes
- Both apps launch and display data correctly

**Sync:** Final commit and push to both repos.

---

## Known Issues & Missing Connections

### Data Repo
1. **Web snapshot artifacts** — 557 JS files in `sources/*_files/` directories (~137MB) should be removed
2. **Working documents** — `taxonomy/hierarchy-proposals/*.md` are intermediate review files, not canonical data
3. **Stale embeddings** — embeddings.json may drift from taxonomy if nodes are edited without re-running Update-TaxEmbeddings

### Code Repo
4. **POViewer app** (`poviewer/`) — reads taxonomy but has no policy awareness. Needs audit.
5. **Graph database** (`Install-GraphDatabase`, `Invoke-CypherQuery`, `Export-TaxonomyToGraph`) — Cypher export doesn't include policy registry or policy edges
6. **Triad Dialogue** (`Show-TriadDialogue`) — debate system references taxonomy nodes but not policies. Debates about policy alignment could benefit from policy context.
7. **Import pipeline** (`Import-AITriadDocument`) — when new documents are ingested and summarized, the pipeline should match extracted policy positions against the registry
8. **Batch operations** (`Invoke-BatchSummary`) — runs Invoke-POVSummary in parallel. Must handle policy registry as a shared resource (read-only during batch, update after)
9. **Taxonomy proposals** (`Invoke-TaxonomyProposal`, `Approve-TaxonomyProposal`) — when proposing new nodes, policy_actions should reference the registry

### Cross-Cutting Concerns
10. **Schema versioning** — TAXONOMY_VERSION is 1.1.0 but there's no migration script for moving from 1.0.0 to 1.1.0 format programmatically
11. **Backward compatibility** — `policy_id` is optional in types. All code paths must handle nodes that haven't been migrated yet (policy_id undefined)
12. **Registry write contention** — multiple cmdlets may try to append to `policy_actions.json` simultaneously during batch operations. Need a locking strategy or single-writer pattern.
13. **Test coverage** — only one test file (`AITriad.Module.Tests.ps1`). Need policy-specific test scenarios.
