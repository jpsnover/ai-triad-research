# AI Call Validation Audit

## Scope
Every site in the codebase where an AI/LLM API is called, plus every site where local ML models produce output that feeds into persisted data. For each, the current validation posture is assessed and mitigation opportunities are documented.

---

## Legend

| Symbol | Meaning |
|--------|---------|
| **Existing** | Validation already in place |
| **GAP** | No validation; opportunity identified |
| Risk: H/M/L | High / Medium / Low severity if the AI output is bad |
| Cost: negligible / low / moderate | Runtime cost of the proposed mitigation |
| **IMPLEMENTED** | Mitigation has been coded and merged |
| **PARTIAL** | Some but not all of the mitigation is in place |
| **OPEN** | Not yet implemented |

---

## Implementation Progress

**32 of 41 gaps implemented** (78%), 1 partial, 8 open.

| Status | Count | IDs |
|--------|-------|-----|
| **IMPLEMENTED** | 32 | 1.1, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 5.1, 5.2, 6.1, 6.2, 7.1, 7.2, 7.3, 7.4, 8.1, 9.1, 9.2, 10.1, 11.1, 11.2, 11.4, 11.6, 12.1, 12.2, 13.1, 13.2, 14.1, 15.1, 16.3, 17.1 |
| **PARTIAL** | 1 | 16.2 (basic schema validation but no enum validation for attack_type/scheme) |
| **OPEN** | 8 | 1.2, 4.1, 11.3, 11.5, 11.7, 15.2, 16.1, 16.4 |

---

## 1. PowerShell Pipeline — `Invoke-AIApi` (Central Dispatcher)

**File:** `scripts/AIEnrich.psm1:192-449`

### Existing Validation
- HTTP retry on 429/503/529 with configurable delays
- Backend-specific response envelope parsing (validates expected JSON shape)
- Gemini `finishReason` check — rejects blocked/safety-stopped responses
- Returns `$null` on any failure (callers must check)

### GAP 1.1: No `stop_reason` / `finish_reason` check for Claude or Groq — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | Medium — Claude `stop_reason: "max_tokens"` means truncated output; Groq `finish_reason: "length"` is the same. Both silently return the partial text today. |
| **Mitigation** | Check `stop_reason` (Claude) and `finish_reason` (Groq/OpenAI) analogously to the Gemini `finishReason` check. Warn and return `$null` when output was truncated, or set a `Truncated` flag on the result object so callers can decide. |
| **Cost** | Negligible — one property access per response. |

### GAP 1.2: No response-level token count tracking for budget enforcement — **OPEN**

| | |
|---|---|
| **Risk** | Low — cost overruns from unexpectedly large responses. |
| **Mitigation** | Parse `usage.total_tokens` (Groq/OpenAI), `usageMetadata` (Gemini), or `usage.output_tokens` (Claude) from `RawResponse` and expose on the result object. Callers can log or enforce budgets. |
| **Cost** | Negligible ��� parsing already-available fields. |

---

## 2. Metadata Extraction — `Get-AIMetadata`

**File:** `scripts/AIEnrich.psm1:496-585`

### Existing Validation
- Markdown fence stripping
- `ConvertFrom-Json` with error handling (returns `$null` on parse failure)
- POV tag whitelist validation — rejects unrecognized POV values
- Topic tag normalization to lowercase slugs

### GAP 2.1: No validation of `date_published` format — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | Medium — AI may return dates in inconsistent formats ("2024", "March 2024", "2024-03-15", "15/03/2024"). These propagate into `metadata.json` and break downstream filtering/sorting. |
| **Mitigation** | Regex check: accept `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`. Reject or normalize anything else (e.g., parse with `[datetime]::TryParseExact`). |
| **Cost** | Negligible — one regex test. |

### GAP 2.2: No length/quality gate on `title` and `one_liner` — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | Low — AI occasionally returns very long titles (full sentences) or empty one-liners. |
| **Mitigation** | Enforce max lengths (title ≤ 200 chars, one_liner ≤ 300 chars). Truncate with ellipsis or warn. Reject empty `title` when `FallbackTitle` is available. |
| **Cost** | Negligible. |

### GAP 2.3: No deduplication check for `authors` array — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | Low — AI sometimes returns the same author twice with variant formatting ("J. Smith", "John Smith"). |
| **Mitigation** | Deduplicate on normalized lowercase. Optionally fuzzy-match initials. |
| **Cost** | Negligible. |

---

## 3. POV Summary Extraction — `Invoke-SummaryPipeline`

**File:** `scripts/AITriad/Private/Invoke-SummaryPipeline.ps1`

### Existing Validation
- JSON parse with `Repair-TruncatedJson` fallback
- Density floor checking (`Test-SummaryDensity`) with one retry + nudge prompt
- Null-node rate tracking (key_points with no `taxonomy_node_id`)
- Unmapped concept resolution via embedding similarity

### GAP 3.1: No `taxonomy_node_id` existence validation — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | **High** — the AI returns taxonomy node IDs like `acc-beliefs-042` but nothing confirms the ID actually exists in the taxonomy. A hallucinated ID persists into `summaries/*.json` and breaks downstream graph queries, conflict detection, and topic frequency analysis. |
| **Mitigation** | After parsing, validate every `taxonomy_node_id` against the loaded taxonomy node set. Move invalid IDs to `unmapped_concepts` for resolution. |
| **Cost** | Low — hash-set lookup per key_point (~200 lookups for a large doc, <1ms total). |

### GAP 3.2: No `stance` value validation on key_points — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | Medium — key_points should have stance values from a controlled vocabulary (e.g., "agrees", "disagrees", "extends", "qualifies"). An unconstrained value like "partially concurs somewhat" makes stance analysis unreliable. |
| **Mitigation** | Validate `stance` against an allowed-values set. Normalize near-matches (e.g., "partially agrees" → "qualifies"). Flag unrecognized values. |
| **Cost** | Negligible — string comparison per key_point. |

### GAP 3.3: No cross-camp consistency check — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | Medium — the AI may assign the same claim to multiple POV camps with contradictory stances (e.g., accelerationist "agrees" and safetyist "agrees" on the same node, which is structurally valid but semantically suspicious for polarized nodes). |
| **Mitigation** | After extraction, flag key_points that reference the same taxonomy_node_id from different camps with the same stance. Emit a warning for human review. |
| **Cost** | Low — one pass over all key_points to build a node-id → camp+stance map. |

### GAP 3.4: Summary JSON top-level schema validation — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | Medium — the summary JSON must contain `pov_summaries` with exactly the expected camp keys, plus `factual_claims` and `unmapped_concepts` arrays. A missing field silently propagates as `$null`. |
| **Mitigation** | Validate top-level schema: required fields present, correct types (array vs. object), camp keys match expected set. Return structured error on mismatch. |
| **Cost** | Negligible — property-existence checks. |

---

## 4. FIRE Iterative Extraction — `Invoke-IterativeExtraction`

**File:** `scripts/AITriad/Private/Invoke-IterativeExtraction.ps1`

### Existing Validation
- Confidence gating (threshold default 0.7)
- Termination guardrails: max 5 iterations/claim, 20 total, 300s wall-clock, 25 API calls
- JSON parse with `Repair-TruncatedJson` fallback
- `verified: false` handling (mark as low confidence and stop)

### GAP 4.1: No validation that refined claims preserve the original claim's taxonomy mapping — **OPEN**

| | |
|---|---|
| **Risk** | Medium — during iterative refinement, the AI may subtly shift a claim so it no longer matches its `taxonomy_node_id`. The ID stays the same but the text no longer aligns. |
| **Mitigation** | After refinement, compute embedding similarity between the refined claim text and the taxonomy node description. Flag if similarity drops below 0.5 (using existing embedding infrastructure). |
| **Cost** | Moderate — one embedding computation + cosine similarity per refined claim. Only applies to the ~10-20% of claims that enter iteration. ~200ms per claim using local sentence-transformers. |

---

## 5. Fallacy Analysis — `Find-PossibleFallacy`

**File:** `scripts/AITriad/Public/Find-PossibleFallacy.ps1`

### Existing Validation
- JSON parse with `Repair-TruncatedJson` fallback
- Per-node response lookup (warns if node missing from response)

### GAP 5.1: No validation of fallacy type names — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | Medium — the AI should return canonical fallacy identifiers (e.g., "straw_man", "slippery_slope"). Without validation, it may return free-text names ("strawmanning the opponent's view") that can't be aggregated or linked to Wikipedia pages via `Show-FallacyInfo`. |
| **Mitigation** | Maintain a canonical fallacy registry (50-80 entries). Fuzzy-match AI responses against it (Jaccard on word tokens, threshold 0.6). Normalize to the canonical form. Warn on unrecognized fallacies but still store them. |
| **Cost** | Low — string matching against a small registry per fallacy per node. |

### GAP 5.2: No confidence score range validation — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | Low — the schema asks for confidence but nothing validates it's a number in [0, 1]. |
| **Mitigation** | Clamp to [0.0, 1.0]. Reject entries where confidence is not numeric. |
| **Cost** | Negligible. |

---

## 6. Policy Action Discovery — `Find-PolicyAction`

**File:** `scripts/AITriad/Public/Find-PolicyAction.ps1`

### Existing Validation
- JSON parse with `Repair-TruncatedJson` fallback
- Per-node response lookup
- Policy ID assignment (new pol-NNN IDs or reuse existing)

### GAP 6.1: No validation that reused `policy_id` references actually exist in registry — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | **High** — if the AI returns `"policy_id": "pol-999"` and that ID doesn't exist in `policy_actions.json`, the reference is dangling. Downstream aggregation and the policy registry become inconsistent. |
| **Mitigation** | After parsing, validate every non-null `policy_id` against the loaded registry. Treat unknown IDs as new policies (assign next available ID). |
| **Cost** | Negligible — hash-set lookup per policy action. |

### GAP 6.2: No word-count enforcement on action text — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | Low — the prompt asks for 5-15 words but the AI sometimes returns full sentences (30+ words). Long actions break display and aggregation. |
| **Mitigation** | Word-count check: warn if action text exceeds 20 words; optionally truncate at sentence boundary. |
| **Cost** | Negligible. |

---

## 7. Edge Discovery — `Invoke-EdgeDiscovery` / `Invoke-NodeEdgeDiscovery`

**File:** `scripts/AITriad/Public/Invoke-EdgeDiscovery.ps1`, `Private/Invoke-NodeEdgeDiscovery.ps1`

### Existing Validation
- JSON parse with `Repair-TruncatedJson` fallback
- Edge discovery returns with per-node tracking

### GAP 7.1: No validation that `source` and `target` node IDs exist in taxonomy — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | **High** — hallucinated node IDs in edges create broken graph links. These persist to `edges.json` and corrupt graph queries. |
| **Mitigation** | Validate both `source` and `target` against the full taxonomy node set before persisting. Reject edges with unknown IDs. |
| **Cost** | Negligible — hash-set lookup per edge. |

### GAP 7.2: No edge-type validation against allowed types — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | Medium — the edge discovery prompt defines allowed edge types (SUPPORTS, CONTRADICTS, ENABLES, etc.) but nothing enforces this. Novel types like "slightly_related_to" can appear. |
| **Mitigation** | Validate `edge_type` against the canonical set. Reject or map to nearest canonical type (using a synonym table). |
| **Cost** | Negligible — string comparison per edge. |

### GAP 7.3: No self-loop detection — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | Low — AI may propose an edge from a node to itself. |
| **Mitigation** | Reject edges where `source === target`. |
| **Cost** | Negligible. |

### GAP 7.4: No duplicate edge detection within a single discovery run — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | Low — AI may propose the same edge (same source, target, type) twice in one response. |
| **Mitigation** | Deduplicate on `(source, target, edge_type)` tuple before persisting. |
| **Cost** | Negligible — hash-set per batch. |

---

## 8. Graph Query — `Invoke-GraphQuery`

**File:** `scripts/AITriad/Public/Invoke-GraphQuery.ps1`

### Existing Validation
- JSON parse

### GAP 8.1: No validation of cited node IDs in the answer — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | Medium — when the AI cites taxonomy nodes in its answer, those IDs may be hallucinated. The answer looks authoritative but cites non-existent nodes. |
| **Mitigation** | Post-process the answer: extract all node ID references (regex `[a-z]{2,3}-[a-z]+-\d{3}`), validate against taxonomy, and annotate unverified citations in the output. |
| **Cost** | Low — regex scan + hash-set lookups. |

---

## 9. Taxonomy Proposal — `Invoke-TaxonomyProposal`

**File:** `scripts/AITriad/Public/Invoke-TaxonomyProposal.ps1`

### Existing Validation
- JSON parse with repair

### GAP 9.1: No schema validation on proposal structure — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | Medium — proposals should be NEW/SPLIT/MERGE/RELABEL with specific fields per type. Malformed proposals may crash `Invoke-ProposalApply` or silently produce garbage. |
| **Mitigation** | Validate each proposal's `type` against allowed set. Validate required fields per type (e.g., MERGE requires `source_ids` array, NEW requires `pov` and `category`). |
| **Cost** | Negligible — field-existence checks per proposal. |

### GAP 9.2: No duplicate proposal detection — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | Low — AI may propose a MERGE that is semantically identical to an existing proposal or an already-completed merge. |
| **Mitigation** | Compare new proposals against existing proposals in `taxonomy/proposals/`. Flag duplicates by checking source_ids overlap. |
| **Cost** | Low — file read + set comparison. |

---

## 10. Hierarchy Proposal — `Invoke-HierarchyProposal`

**File:** `scripts/AITriad/Public/Invoke-HierarchyProposal.ps1`

### GAP 10.1: No cycle detection in proposed parent-child relationships — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | Medium — the AI may propose A→B→C→A hierarchy cycles, creating infinite loops in tree rendering. |
| **Mitigation** | After collecting all proposed edges, run a topological sort. Reject back-edges that would create cycles. |
| **Cost** | Low — O(V+E) graph traversal on the small proposal set. |

---

## 11. Debate Engine — `lib/debate/debateEngine.ts`

### Existing Validation
- `parseAIJson()` / `parseJsonRobust()` with multi-strategy JSON repair (fence strip, trailing comma fix, bracket extraction)
- `parseStageResponse<T>()` with TypeScript type assertion per pipeline stage
- Fallback evaluation objects on parse failure
- Temperature differentiation by stage purpose

### GAP 11.1: No validation that taxonomy_refs cite real node IDs — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | **High** — the debate engine's Cite stage produces `taxonomy_refs[]` which are displayed in the UI and used for grounding scores. Hallucinated IDs look authoritative. |
| **Mitigation** | In `turnPipeline.ts` after the Cite stage, filter `taxonomy_refs` against the loaded taxonomy node set. Remove or annotate refs with unknown IDs. |
| **Cost** | Low — hash-set lookup per ref. |

### GAP 11.2: No `disagreement_type` enum validation — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | Low — should be EMPIRICAL | VALUES | DEFINITIONAL but nothing enforces this. |
| **Mitigation** | Normalize in `assemblePipelineResult()` via `normalizeDisagreementType()`: exact match → pass through; strip AI-added suffixes (e.g., "empirical_disagreement" → "EMPIRICAL"); keyword scoring against 3 categories with 0.3 confidence threshold; default to "EMPIRICAL" only if no category scores above threshold. |
| **Cost** | Negligible. |

### GAP 11.3: No statement length bounds — **OPEN**

| | |
|---|---|
| **Risk** | Low — AI may generate extremely long debate turns that flood the UI and waste tokens in subsequent rounds. |
| **Mitigation** | Enforce a max character limit on `statement` (e.g., 3000 chars for opening, 2000 for debate turns). Trim with a "continued in next turn" marker if exceeded. |
| **Cost** | Negligible. |

### GAP 11.4: `my_claims` not validated against `statement` text — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | **High** — the prompt demands that `my_claims[].claim` be a "near-verbatim sentence" from the statement, but nothing checks this. The AI can invent claims not present in its own statement. The argument network then contains nodes disconnected from actual debate prose. |
| **Mitigation** | After the Cite stage, check each claim against the statement using word-overlap (existing `wordOverlap()` helper). Flag claims with <40% overlap as fabricated. Non-AI check. |
| **Cost** | Negligible — string tokenization + set intersection per claim. |

### GAP 11.5: Judge fallback defaults to `advances: true` — **OPEN**

| | |
|---|---|
| **Risk** | **High** — when `parseJudgeVerdict()` fails to parse the LLM judge response, it returns `{ advances: true, recommend: 'pass' }`. A consistently failing judge silently marks every turn as advancing the debate. This is undetectable degradation. |
| **Mitigation** | On judge parse failure, return `{ advances: null, recommend: 'accept_with_flag' }` instead. Track consecutive judge failures and disable judge sampling (revert to Stage-A only) if >3 failures in a debate. Non-AI mechanism. |
| **Cost** | Negligible — change default values + add a counter. |

### GAP 11.6: Stage parse errors produce empty work products that cascade — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | **High** — in `turnPipeline.ts`, if `parseStageResponse()` fails for the Brief or Plan stage, it returns `{ product: {} as T, error: msg }`. Downstream stages (Draft, Cite) then operate on empty context, producing incoherent responses. |
| **Mitigation** | If Brief or Plan stage parse fails, abort the pipeline and return an error result rather than continuing with empty data. The caller already handles pipeline failures with retry. Non-AI mechanism. |
| **Cost** | Negligible — one conditional check per stage. |

### GAP 11.7: Relevance filler detection is weak — **OPEN**

| | |
|---|---|
| **Risk** | Medium — the filler regex `/^(supports|relevant|important|my view|this is)/i` only catches trivial prefixes. A 50-char string like "This is very important and supports my position regarding this debate" passes validation despite being pure filler. |
| **Mitigation** | Augment filler detection: (a) check information density — reject if >50% of words are stop-words/hedges, (b) require at least one domain-specific term (node label word, policy term, named entity). Non-AI mechanism. |
| **Cost** | Low — tokenize + set intersection against stop-word list. |

---

## 12. Summary Viewer — `summary-viewer/src/main/generateContent.ts`

### Existing Validation
- Per-backend response envelope parsing
- HTTP status checking with retry (Gemini 429 only)
- Empty response detection

### GAP 12.1: No retry logic for Claude/Groq/OpenAI backends — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | Medium — only Gemini has retry-on-429. Claude, Groq, and OpenAI rate limits cause immediate failure. |
| **Mitigation** | Unify retry logic across all backends (same exponential backoff pattern as Gemini). |
| **Cost** | Negligible — code structure change only. |

### GAP 12.2: No response content validation before passing to renderer — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | Medium — raw AI text is forwarded to the Electron renderer via IPC. If the AI returns HTML or script tags, it could be rendered unsafely. |
| **Mitigation** | Sanitize AI text output before sending to renderer: strip `<script>` tags and escape HTML entities. Or ensure the renderer uses `textContent` / React's default escaping (verify this). |
| **Cost** | Negligible — one sanitization pass. |

---

## 13. POViewer — `poviewer/src/main/aiEngine.ts`

### Existing Validation
- JSON parse with markdown fence stripping
- Offset clamping (startOffset/endOffset bounded to source text length)
- Missing text infill from offsets
- 3 retry attempts with exponential backoff

### GAP 13.1: No validation that mapped `nodeId` values exist in taxonomy — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | Medium — the AI maps text segments to taxonomy node IDs, but those IDs aren't validated against the loaded taxonomy. Hallucinated IDs silently persist in analysis results. |
| **Mitigation** | Load the taxonomy node ID set at analysis start. Filter out mappings with non-existent IDs (or annotate as "unverified"). |
| **Cost** | Low — one file read + hash-set lookups. |

### GAP 13.2: No alignment value validation — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | Low — alignment should be "agrees" | "contradicts" | "extends" | "qualifies" but nothing enforces this. |
| **Mitigation** | Validate and normalize the `alignment` field against allowed values. |
| **Cost** | Negligible. |

---

## 14. Taxonomy Editor — `taxonomy-editor/src/main/embeddings.ts`

### Existing Validation
- Multi-backend text generation with per-backend response parsing
- Gemini rate limit detection (distinguishes RPM/TPM/RPD)
- Embedding batch processing with retry
- NLI classification via local cross-encoder

### GAP 14.1: Gemini embedding dimension validation — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | Low — if the embedding model changes, the vector dimension may change (e.g., 768 vs 384), causing silent cosine-similarity failures against the existing embeddings.json which uses 384-dim vectors. |
| **Mitigation** | After fetching embeddings, verify dimension matches the expected constant (384 for all-MiniLM-L6-v2). Warn if mismatched. |
| **Cost** | Negligible — one array-length check per batch. |

---

## 15. Python Embedding Scripts

### `scripts/embed_taxonomy.py`

### Existing Validation
- NLI confidence margin check (if best - second < 1.0, downgrade to "neutral")
- Embedding shape validation

### GAP 15.1: No detection of degenerate embeddings — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | Medium — if a node's text is empty or all stop-words, the embedding is a near-zero vector. Cosine similarity against it is numerically unstable and returns spurious high-similarity matches. |
| **Mitigation** | After encoding, check vector norm. If `‖v‖ < 0.01`, flag as degenerate and exclude from similarity searches. |
| **Cost** | Negligible — one norm computation per embedding. |

### `scripts/consolidate_conflicts.py`

### GAP 15.2: No validation that re-linked conflicts reference existing taxonomy nodes — **OPEN**

| | |
|---|---|
| **Risk** | Medium — `relink_conflicts()` finds top-K similar taxonomy nodes by embedding similarity, but doesn't confirm the node IDs still exist after taxonomy edits. |
| **Mitigation** | Load current taxonomy node IDs and filter re-linked references. |
| **Cost** | Negligible. |

---

## 16. Standalone Backfill Scripts

### `scripts/Invoke-DescriptionRewrite.ps1`

### Existing Validation
- JSON parse with repair
- Retry on failure

### GAP 16.1: No semantic drift detection — **OPEN**

| | |
|---|---|
| **Risk** | Medium — rewriting descriptions to "plain language" may inadvertently change the meaning. A description about "existential risk from misaligned AGI" could be rewritten to "dangers of advanced AI" — technically correct but informationally lossy. |
| **Mitigation** | After rewrite, compute embedding similarity between old and new description. Warn if similarity drops below 0.7 (meaning may have shifted). Require human review for low-similarity rewrites. |
| **Cost** | Moderate — one embedding computation per node (~200ms for local sentence-transformers). For a full taxonomy (~400 nodes), ~80 seconds. Run once. |

### `scripts/Invoke-ArgumentMapBackfill.ps1`

### GAP 16.2: No validation of argument map structure — **PARTIAL**

| | |
|---|---|
| **Risk** | Medium — argument maps should have `premises`, `conclusion`, and optionally `counter_arguments`. Missing fields break downstream rendering. |
| **Mitigation** | Validate required fields after JSON parse. Reject maps with no `conclusion`. |
| **Cost** | Negligible. |

### `scripts/Invoke-TemporalScopeBackfill.ps1`

### GAP 16.3: No temporal scope value validation — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | Low — temporal_scope should be from a controlled vocabulary (e.g., "near-term", "medium-term", "long-term", "timeless"). Free-text values break aggregation. |
| **Mitigation** | Validate against allowed values. Normalize near-matches. |
| **Cost** | Negligible. |

### `scripts/generate-lineage-info.ps1`

### GAP 16.4: No URL validation for intellectual lineage links — **OPEN**

| | |
|---|---|
| **Risk** | Medium — the AI generates Wikipedia and reference URLs for lineage entries. These URLs may be hallucinated (e.g., Wikipedia pages that don't exist). |
| **Mitigation** | Batch-validate generated URLs with HEAD requests. Flag 404s for human review. Run as a separate post-processing step to avoid blocking the main pipeline. |
| **Cost** | Moderate — one HTTP HEAD per URL. For ~200 lineage entries with ~2 URLs each, ~400 requests at ~100ms each = ~40 seconds. Run once as a post-step. |

---

## 17. Document Ingestion — `Import-AITriadDocument`

**File:** `scripts/AITriad/Public/Import-AITriadDocument.ps1`

### Existing Validation
- Delegates to `Get-AIMetadata` (see section 2)
- Falls back to heuristic title on AI failure

### GAP 17.1: No idempotency check for re-ingestion — **IMPLEMENTED**

| | |
|---|---|
| **Risk** | Low — re-ingesting the same URL generates a new doc-id slug, potentially creating a duplicate source entry. |
| **Mitigation** | Before ingestion, check if any existing source has the same URL in its metadata.json. Warn and offer to update instead. (Non-AI validation.) |
| **Cost** | Low — scan metadata files for URL match. |

---

## Summary: Priority Matrix

### Critical (implement first — prevents data corruption or silent quality degradation)

| ID | Cmdlet / Component | Gap | Mechanism | Status |
|----|-------------------|-----|-----------|--------|
| 3.1 | Invoke-SummaryPipeline | Hallucinated `taxonomy_node_id` in summaries | Hash-set lookup | **IMPLEMENTED** |
| 6.1 | Find-PolicyAction | Dangling `policy_id` references | Hash-set lookup | **IMPLEMENTED** |
| 7.1 | Invoke-EdgeDiscovery | Hallucinated node IDs in edges | Hash-set lookup | **IMPLEMENTED** |
| 11.1 | Debate Engine (Cite stage) | Hallucinated `taxonomy_refs` | Hash-set lookup | **IMPLEMENTED** |
| 11.4 | Debate Engine (Claims) | `my_claims` not validated against statement text | Word overlap | **IMPLEMENTED** |
| 11.5 | Debate Engine (Judge) | Judge parse failure defaults to `advances: true` | Change defaults | OPEN |
| 11.6 | Debate Engine (Pipeline) | Stage parse errors cascade as empty work products | Abort on failure | **IMPLEMENTED** |

Items 3.1, 6.1, 7.1, 11.1 share one pattern: **validate AI-generated IDs against the loaded taxonomy**. A single shared helper (`Test-TaxonomyNodeId` in PS, `isValidNodeId()` in TS) covers all four.

Items 11.4, 11.5, 11.6 are all non-AI deterministic checks in the debate engine.

**Estimated implementation: ~3 hours. Runtime cost per call: <1ms. (6 of 7 implemented; 11.5 remains open.)**

### High (prevent semantic errors)

| ID | Cmdlet / Component | Gap | Mechanism | Status |
|----|-------------------|-----|-----------|--------|
| 1.1 | Invoke-AIApi | Missing truncation detection for Claude/Groq | Property check | **IMPLEMENTED** |
| 2.1 | Get-AIMetadata | Unvalidated date_published format | Regex | **IMPLEMENTED** |
| 3.4 | Invoke-SummaryPipeline | No top-level schema validation | Property checks | **IMPLEMENTED** |
| 5.1 | Find-PossibleFallacy | Unvalidated fallacy type names | Registry lookup | **IMPLEMENTED** |
| 7.2 | Invoke-EdgeDiscovery | Unvalidated edge types | Enum check | **IMPLEMENTED** |
| 9.1 | Invoke-TaxonomyProposal | No proposal schema validation | Field checks | **IMPLEMENTED** |
| 11.7 | Debate Engine (Relevance) | Filler detection too weak — boilerplate passes | Stop-word density | OPEN |
| 15.1 | embed_taxonomy.py | Degenerate embedding detection | Norm check | **IMPLEMENTED** |

**Estimated implementation: ~4 hours total. Runtime cost: negligible. (7 of 8 implemented.)**

### Medium (improve quality, low urgency)

| ID | Cmdlet / Component | Gap | Mechanism | Status |
|----|-------------------|-----|-----------|--------|
| 3.2 | Invoke-SummaryPipeline | Unvalidated stance values | Enum check | **IMPLEMENTED** |
| 3.3 | Invoke-SummaryPipeline | Cross-camp consistency | Map scan | **IMPLEMENTED** |
| 4.1 | Invoke-IterativeExtraction | Claim drift after refinement | Embedding similarity | OPEN |
| 7.3 | Invoke-EdgeDiscovery | Self-loop detection | Equality check | **IMPLEMENTED** |
| 7.4 | Invoke-EdgeDiscovery | Duplicate edge detection | Hash-set | **IMPLEMENTED** |
| 8.1 | Invoke-GraphQuery | Hallucinated citations in answers | Regex + hash-set | **IMPLEMENTED** |
| 10.1 | Invoke-HierarchyProposal | Cycle detection | Topological sort | **IMPLEMENTED** |
| 12.1 | Summary Viewer | No retry for Claude/Groq/OpenAI | Code refactor | **IMPLEMENTED** |
| 12.2 | Summary Viewer | No XSS sanitization of AI output | HTML escape | **IMPLEMENTED** |
| 13.1 | POViewer | Unvalidated nodeId in mappings | Hash-set lookup | **IMPLEMENTED** |
| 16.1 | Invoke-DescriptionRewrite | Semantic drift detection | Embedding similarity | OPEN |
| 16.4 | generate-lineage-info.ps1 | Unvalidated URLs | HTTP HEAD | OPEN |

### Low (nice-to-have)

| ID | Cmdlet / Component | Gap | Mechanism | Status |
|----|-------------------|-----|-----------|--------|
| 1.2 | Invoke-AIApi | Token count tracking | Field parsing | OPEN |
| 2.2 | Get-AIMetadata | Title/one_liner length | String length | **IMPLEMENTED** |
| 2.3 | Get-AIMetadata | Author deduplication | Normalize + dedup | **IMPLEMENTED** |
| 5.2 | Find-PossibleFallacy | Confidence range clamping | Numeric clamp | **IMPLEMENTED** |
| 6.2 | Find-PolicyAction | Action text word count | Word count | **IMPLEMENTED** |
| 9.2 | Invoke-TaxonomyProposal | Duplicate proposal detection | Set comparison | **IMPLEMENTED** |
| 11.2 | Debate Engine | disagreement_type enum | Enum check | **IMPLEMENTED** |
| 11.3 | Debate Engine | Statement length bounds | String length | OPEN |
| 13.2 | POViewer | Alignment value validation | Enum check | **IMPLEMENTED** |
| 14.1 | Taxonomy Editor | Embedding dimension validation | Array length | **IMPLEMENTED** |
| 15.2 | consolidate_conflicts.py | Stale node ID references | Hash-set | OPEN |
| 16.2 | Invoke-ArgumentMapBackfill | Argument map schema | Field checks | PARTIAL |
| 16.3 | Invoke-TemporalScopeBackfill | Temporal scope enum | Enum check | **IMPLEMENTED** |
| 17.1 | Import-AITriadDocument | Idempotency check | URL scan | **IMPLEMENTED** |

---

## Recommended Implementation Order

**Phase 1: ID validation foundation (~1 hour)** — DONE

1. ~~**Build `Test-TaxonomyNodeId` helper** (PS) and `isValidNodeId()` (TS) — shared by gaps 3.1, 6.1, 7.1, 11.1, 8.1, 13.1.~~ Implemented via HashSet lookups in each component.

**Phase 2: Debate engine hardening (~1.5 hours)** — 3 of 4 done

2. **Fix judge fallback defaults** (gap 11.5) — OPEN. Change parse failure defaults from `advances: true` to `advances: null, recommend: 'accept_with_flag'`. Add consecutive failure counter.
3. ~~**Abort pipeline on early stage failure** (gap 11.6)~~ — DONE.
4. ~~**Validate claims against statement** (gap 11.4)~~ — DONE.
5. ~~**Filter `taxonomy_refs` in Cite stage** (gap 11.1)~~ — DONE.

**Phase 3: PowerShell pipeline hardening (~1.5 hours)** — DONE

6. ~~**Add truncation detection** to `Invoke-AIApi` (gap 1.1)~~ — DONE.
7. ~~**Validate `taxonomy_node_id`** in `Invoke-SummaryPipeline` (gap 3.1)~~ — DONE.
8. ~~**Validate `policy_id`** in `Find-PolicyAction` (gap 6.1)~~ — DONE.
9. ~~**Add edge validation** (gaps 7.1-7.4)~~ — DONE.

**Phase 4: Field-level validation sweep (~1.5 hours)** — 5 of 6 done

10. ~~**Summary schema validation** (gap 3.4)~~ — DONE.
11. ~~**Date format validation** (gap 2.1)~~ — DONE.
12. ~~**Fallacy name registry** (gap 5.1)~~ — DONE.
13. ~~**Proposal schema validation** (gap 9.1)~~ — DONE.
14. ~~**Degenerate embedding detection** (gap 15.1)~~ — DONE.
15. **Relevance filler strengthening** (gap 11.7) — OPEN. Stop-word density + domain-term requirement.

**Total estimated effort: ~5.5 hours for all Critical + High items. Status: 13 of 15 steps complete.**

All mitigations are non-AI mechanisms (hash-set lookups, regex, enum checks, string comparisons). No additional API calls required. Runtime cost across the entire pipeline: <100ms cumulative.

### Remaining Open Items

| ID | Priority | Gap | Notes |
|----|----------|-----|-------|
| 1.2 | Low | Token count tracking for budget enforcement | Nice-to-have |
| 4.1 | Medium | Claim drift detection after FIRE refinement | Requires embedding similarity (~200ms/claim) |
| 11.3 | Low | Statement length bounds in debate engine | Simple string length check |
| 11.5 | **Critical** | Judge parse failure defaults to `advances: true` | Last remaining critical-priority gap |
| 11.7 | High | Relevance filler detection too weak | Stop-word density + domain term check |
| 15.2 | Low | Stale node ID refs in consolidate_conflicts.py | Hash-set lookup |
| 16.1 | Medium | Semantic drift detection in description rewrites | Requires embedding similarity |
| 16.2 | Low | Argument map enum validation (partial) | Basic schema exists, enums not validated |
| 16.4 | Medium | URL validation for lineage links | HTTP HEAD batch, ~40s one-time |
