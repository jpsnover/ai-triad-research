# DOLCE + AIF + BDI Implementation Plan

**Date:** 2026-03-28
**Revised:** 2026-03-28 (SRE review — version contract, manifests, failure recovery, use case matrix, rubric, docs checklist, ops guidance; AI verification review — output verification framework, per-phase automated checks, gap analysis, remediation procedures)
**Depends on:** `ontology-framework-evaluation.md` (framework selection), `bfo-prompt-recommendations.md` (problem analysis + baseline measurements)
**Supersedes:** The implementation plan in `bfo-prompt-recommendations.md` (that plan's problem analysis and baseline measurements remain valid; its BFO-framed solutions are replaced by this DOLCE+AIF+BDI plan)
**Priority use case:** Debate feature — POV agents analyzing propositions/documents

---

## Guiding Principles

1. **Measure before and after.** Run `Measure-TaxonomyBaseline` at each phase gate. If metrics don't improve, investigate before proceeding.
2. **Prompt changes before data migration.** Let existing data update organically through re-summarization rather than batch backfilling, except where backfill is cheap and reliable.
3. **Consumer updates before breaking data changes.** For breaking changes, update all consumer code with backward-compatible handlers first, then migrate data. **Keep backward-compat handlers permanently** for Phase 5 edge types (runtime cost is negligible; safety benefit is high).
4. **Vocabulary over formalism.** Adopt DOLCE/AIF/BDI *vocabulary* in prompts and data structures. Do NOT convert to OWL/RDF triples. The project uses JSON; keep it that way.
5. **Phase gates.** Each phase has explicit validation criteria. Do not proceed to the next phase until the current phase passes its gate.
6. **Rollback tags.** Tag both repos before each phase: `pre-dolce-phase-N`.
7. **Never an incoherent state.** Every intermediate state during and between phases must be a functioning system. Mixed old/new data is explicitly supported via optional fields and backward-compat handlers.
8. **Migration manifests.** Every data-touching phase produces a machine-readable manifest in `ai-triad-data/migrations/` documenting exactly what changed.

---

## Two-Repo Version Contract

The code repo (`ai-triad-research`) and data repo (`ai-triad-data`) must stay in compatible states. This contract defines compatibility.

### Version Fields

- **`TAXONOMY_VERSION`** (data repo) — bumped at each schema version. Currently `1.0.0`.
- **`prompt_version`** (new, added to each AI-generated artifact) — tracks which prompt generation produced the output. Format: `"dolce-phase-N"` or `"pre-dolce"`. Added to summaries (`generated_with_prompt_version`), debate sessions, and taxonomy proposal outputs.

### Compatibility Rules

| Code Repo State | Data Repo State | Compatible? | Notes |
|----------------|----------------|-------------|-------|
| Pre-migration | Pre-migration | Yes | Current state |
| Phase N prompts | Pre-migration data | Yes | New prompts handle old data; new output has new fields, old output doesn't |
| Phase N prompts | Partially migrated Phase N data | Yes | All new fields are optional until phase gate passes; consumers handle both formats |
| Phase N prompts | Fully migrated Phase N data | Yes | Target state |
| Phase N+1 prompts | Phase N data | Yes | Forward-compatible by design — each phase adds, never removes |
| Pre-migration prompts | Phase N data | Yes | Old prompts ignore new fields |

**The system is valid in ANY combination** because all new fields are optional and all consumers handle missing fields. The only exception is Phase 5 (edge type consolidation) and Phase 6c (steelman type change), which require coordinated consumer code + data changes — addressed in those phases with explicit step-by-step procedures.

### Migration Manifests

Each data-touching phase produces a manifest in `ai-triad-data/migrations/phase-N-manifest.json`:

```json
{
  "phase": 2,
  "description": "Genus-differentia description rewrite",
  "code_repo_commit": "abc1234",
  "data_repo_tag_before": "pre-dolce-phase-2",
  "started_at": "2026-04-01T10:00:00Z",
  "completed_at": "2026-04-01T14:30:00Z",
  "items_total": 451,
  "items_succeeded": 448,
  "items_failed": 3,
  "items_failed_ids": ["acc-goals-042", "skp-data-019", "cc-051"],
  "failure_reasons": {
    "acc-goals-042": "AI returned empty description",
    "skp-data-019": "Genus-differentia pattern validation failed",
    "cc-051": "Referenced nonexistent sibling node"
  },
  "post_actions": {
    "embeddings_regenerated": true,
    "baseline_captured": "baseline-post-phase-2.json"
  },
  "notes": "3 failed nodes left with original descriptions — will retry in next batch"
}
```

**Rule:** A phase with failed items is still a valid state as long as: (a) the manifest documents which items failed and why, (b) old-format items are explicitly supported by all consumers, (c) the validation gate specifies what percentage of failures is acceptable.

---

## Baseline (Established)

`Measure-TaxonomyBaseline` cmdlet exists. Baseline captured in `docs/baseline-2026-03-28.json`.

Key numbers to track:

| Metric | Baseline Value | Target Direction | Affected By Phase |
|--------|---------------|-----------------|-------------------|
| Unmapped key_points | 62/2562 (2.4%) | Lower | 2, 4 |
| Category inconsistencies | 14 nodes | Lower | 2, 4 |
| Unreferenced nodes | 294/451 (65.2%) | Lower | 2 |
| Density P10–P90 spread | 0.19–2.48 (13x) | Narrower | (already addressed) |
| Non-canonical edge types | 771 (4.9%) | Zero | 5 |
| Orphan edges | 787 | Zero | 5 |
| Domain violations (Goals SUPPORTS Data) | 138 | Zero | 5 |
| Single-instance conflicts | 92.2% | Lower | 6a |
| Fallacy flagging rate | 53% of nodes | Lower (fewer false positives) | 6b |
| Genus-differentia descriptions | 5.8% | >90% | 2 |
| Debate synthesis quality | No metric yet | Phase 1 establishes baseline | 1, 3 |

---

## Use Case Impact Matrix

Every use case, every phase, with specific validation method.

| Use Case | Phase 1 (BDI Debate) | Phase 2 (Descriptions) | Phase 3 (AIF Synthesis) | Phase 4 (Sub-cat/Scope) | Phase 5 (Edges) | Phase 6 (Temporal/Fallacy/Steelman) | Phase 7 (Mereology) |
|----------|---------------------|----------------------|----------------------|----------------------|-----------------|-----------------------------------|-------------------|
| **Debate (topic)** | **PRIMARY** — restructured agent context | Sharper descriptions in context | New `argument_map` in synthesis | Sub-cat helps agent reasoning | Edge context in moderator prompts | Steelman per-POV (6c) | — |
| **Debate (document)** | **PRIMARY** — same | Same | Same | Same | Same | Same | — |
| **Debate (cross-cutting)** | **PRIMARY** — CC interpretations highlighted | CC descriptions rewritten | Same | `disagreement_type` informs synthesis | Same | Same | — |
| **Document ingestion (Import-AITriadDocument)** | — | — | — | — | — | — | — |
| **POV summary (Invoke-POVSummary)** | — | Taxonomy context in prompt has new descriptions; **validate token count** | — | Sub-cat guidance, `node_scope` | — | `temporal_scope` on claims (6a) | — |
| **Edge discovery** | — | Descriptions in context | — | `node_scope` for CONTRADICTS constraints | **PRIMARY** — type vocabulary | — | — |
| **Taxonomy proposal/refinement** | — | Genus-differentia for new nodes; **validate sibling references** | — | `node_scope` for new nodes | — | — | `relationship_type` for splits |
| **Conflict detection (Find-Conflict)** | — | — | AIF fields on conflict instances | — | Edge type changes may affect chains | Temporal filtering (6a) | — |
| **Taxonomy health** | — | May need updating for new fields | — | Could report `node_scope` coverage | Edge type distribution changes | — | — |
| **Similar search** | — | **Embedding space shifts — validate** | — | — | — | — | — |
| **Source → node index (SourcesPanel)** | — | Re-summarization may remap documents to different nodes; **monitor** | — | — | — | — | — |
| **Policy registry** | — | — | — | — | Policy edges may use custom types — **audit before Phase 5** | — | — |
| **AI Analysis (node critique)** | — | Better descriptions → better critique | — | — | — | Steelman per-POV (6c) | — |

**Validation method per cell:** Where **bold text** appears, that combination requires explicit testing beyond the standard baseline. Other cells are either "no impact" or "benefits passively."

---

## Debate Quality Baseline — Fixed Topics and Scoring Rubric

### Fixed Topic Set (committed to repo, used for ALL before/after comparisons)

| # | Type | Topic |
|---|------|-------|
| D1 | Narrow empirical | "Will scaling compute alone be sufficient to produce AGI-level systems by 2030?" |
| D2 | Broad values | "Should the US government impose a licensing regime for foundation model developers?" |
| D3 | Document-grounded | Run against the document with ID `adversarial-ai-threat-modeling-framework-aatmf-v3-2026` |
| D4 | Cross-cutting concept | Debate on `cc-005` ("What's the Biggest AI Risk?") |
| D5 | Policy proposal | "Require all AI systems deployed in hiring to pass annual third-party bias audits" |

### Scoring Rubric (0-3 per dimension)

| Dimension | 0 | 1 | 2 | 3 |
|-----------|---|---|---|---|
| **Disagreement count** | 0-1 disagreements identified | 2-3, mostly surface-level | 4-6, mix of surface and substantive | 7+, each substantively distinct |
| **Disagreement typing accuracy** | Types wrong or absent | <50% correctly typed | 50-80% correctly typed | >80% correctly typed (manual verification) |
| **Crux quality** | No cruxes or only rhetorical questions | Cruxes name general areas ("the timeline question") | Cruxes name specific claims ("if RLHF fails at scale...") | Cruxes name specific falsifiable claims AND identify which debater would change position |
| **Taxonomy coverage** | 0-2 node refs total | 3-5 refs, mostly from one camp | 6-10 refs across camps | 10+ refs across all three camps, with cross-cutting refs |
| **Steelman quality** | No steelmanning | Caricature of opposing position | Fair summary but generic | Fair summary that the opponent would endorse as accurate |

### Procedure

1. Run each topic 3 times (3 opening statements + 2 cross-respond rounds + synthesis per run)
2. Score each synthesis on all 5 dimensions
3. Record mean and variance per dimension per topic
4. Save transcripts and scores to `docs/debate-baseline-{pre|post}-phase-N.json`

**Minimum improvement for phase gate:** Mean score improves on at least 2 of 5 dimensions with no dimension regressing by more than 0.5 points.

---

## Handling Mixed-Format Data

Every "prompt-only" phase creates data where new records have fields that old records lack. This is by design. Here are the explicit consumer rules:

| Field | Present In | Absent In | Consumer Rule |
|-------|-----------|-----------|---------------|
| `bdi_layer` | New debate syntheses | Old debates | If absent, omit from display. Do not show "unknown" or placeholder. |
| `resolvability` | New debate syntheses | Old debates | If absent, omit. |
| `argument_map` | New debate syntheses | Old debates | If absent, show legacy flat disagreement list. |
| `node_scope` | Nodes processed by updated `attribute-extraction` | Older nodes | If absent, treat as unclassified. Display no badge. |
| `disagreement_type` | New CC nodes | Older CC nodes | If absent, omit from display. |
| `temporal_scope` | New summaries | Old summaries | If absent, treat all claims as unscoped. `Find-Conflict` skips temporal filtering for unscoped claims. |
| `type` (on `possible_fallacies`) | Post-Phase-6b nodes | Pre-Phase-6b nodes | If absent, display fallacy without tier badge. |
| `steelman_vulnerability` (object) | Post-Phase-6c nodes | Pre-Phase-6c nodes (string) | Check `typeof value === 'string'`. If string, render as single block. If object, render per-POV. |
| `generated_with_prompt_version` | All new AI output | All existing output | If absent, treat as `"pre-dolce"`. |

**Implementation rule:** Every consumer that reads a field added by this plan MUST use optional chaining or existence checks. Never assume the field is present. This is already the project's convention (see `$Node.PSObject.Properties['category']` pattern in PowerShell, `node.graph_attributes?.steelman_vulnerability` in TypeScript).

---

## Organic Population — Completion Criteria

For fields that "populate organically" rather than via batch backfill:

| Field | Trigger | Expected Rate | 50% Coverage By | 90% Coverage By | If Too Slow |
|-------|---------|--------------|----------------|----------------|-------------|
| `node_scope` | `Invoke-AttributeExtraction` run on node | Manual — must be explicitly invoked | Depends on operator initiative | Depends on operator initiative | Run `Invoke-AttributeExtraction -POV all` as a batch if coverage <50% after 30 days |
| `disagreement_type` | `Invoke-CrossCuttingCandidates` or manual entry in CrossCuttingDetail | New CC nodes only | N/A (only ~75 CC nodes) | Run batch classification on all 75 | Run batch classification |
| `temporal_scope` | `Invoke-POVSummary` or `Invoke-BatchSummary` on document | Only when documents are re-summarized | TAXONOMY_VERSION bump triggers CI re-run for all docs | Full re-summarization cycle | Bump TAXONOMY_VERSION to trigger CI batch |
| `bdi_layer` / `resolvability` | New debates only | Every new debate gets these | N/A — old debates are historical records | N/A | No backfill — old debates stay as-is |
| `generated_with_prompt_version` | Any AI generation | Every new output | Immediate for new; never for old | Immediate for new; never for old | No backfill needed — absence means `"pre-dolce"` |

**Key insight:** `node_scope` is the field most likely to be too slow for Phase 5's prerequisite (>50% coverage). Plan for a batch `Invoke-AttributeExtraction` run as an explicit Phase 4.5 step if organic population hasn't reached 50% within 30 days of Phase 4 completion.

---

## Partial-Failure Decision Trees

### Phase 2 — Description Rewrite Failures

```
Start batch N (20-30 nodes)
  ├─ AI produces descriptions for all nodes
  │   ├─ All pass genus-differentia validation → commit batch, proceed
  │   └─ Some fail validation
  │       ├─ <3 failures → fix individually (re-run with adjusted prompt), commit batch
  │       └─ ≥3 failures → STOP. Investigate prompt. Do NOT commit partial batch.
  │           ├─ Pattern in failures? (e.g., all CC nodes fail, all short descriptions fail)
  │           │   └─ Yes → adjust prompt for that pattern, re-run failed subset
  │           └─ No pattern → re-run entire batch with different model
  │               └─ Still failing → abort phase, rollback to tag, file issue
  ├─ AI call fails (timeout, rate limit, etc.)
  │   └─ Retry batch up to 3 times. If persistent, switch model. If still failing, pause and resume later.
  └─ Human reviewer rejects semantically (description is technically valid but wrong)
      └─ Mark node as "needs manual revision" in manifest. Proceed with batch. Revisit flagged nodes after all batches complete.

After all batches:
  ├─ Failed items in manifest < 5% of total → PROCEED to validation gate
  ├─ Failed items 5-15% → investigate, fix what you can, proceed if remaining failures are documented
  └─ Failed items > 15% → DO NOT pass phase gate. Revise prompt and re-run failed items as a new batch.

KEY RULE: The taxonomy files are valid in a mixed-description state.
Old descriptions and new descriptions can coexist. Consumers don't
distinguish them. The only issue is semantic quality, not system stability.
```

### Phase 5 — Edge Migration Failures

```
Step 3: Bulk type consolidation
  ├─ Mapping table handles most types → proceed
  └─ "*(others)*" types require AI triage
      ├─ AI triage succeeds for >95% → commit, log exceptions
      └─ AI triage fails for >5% → STOP. Do not proceed to step 4.
          └─ Review failed types. Add to mapping table if pattern is clear.
              Re-run failed subset.

Step 4: CONTRADICTS → TENSION_WITH reclassification
  ├─ Requires `node_scope` on both endpoints
  │   ├─ Both have `node_scope` → apply "possible world" test
  │   └─ One or both lack `node_scope` → SKIP this edge, leave as CONTRADICTS, log
  └─ AI "possible world" test
      ├─ Clear answer → reclassify or keep
      └─ Ambiguous → leave as CONTRADICTS, log for manual review

Step 7: Domain/range validation
  ├─ Flags violations → queue for AI re-evaluation
  ├─ AI re-evaluation succeeds → update edge type
  └─ AI re-evaluation fails or is ambiguous → DELETE edge (archive in _archived_edges.json)
      └─ Deleted edges must be < 2% of total. If higher, the constraints may be too strict.

KEY RULE: Backward-compat handlers stay in consumer code PERMANENTLY for edge types.
This means partial migration is always a valid state — old types display correctly
alongside new types. There is no step 9 "remove backward-compat handlers."
```

### Phase 6c — Steelman Type Change Failures

```
Step 2: Consumer code updated with dual-format handling
  ├─ All consumers handle both string and object → proceed to step 3
  └─ Any consumer missed → STOP. Do not proceed to data migration.
      └─ TypeScript compiler will catch most (type union), but runtime rendering
          must be manually tested: check NodeDetail, GraphAttributesPanel,
          SimilarResultsPane, debate output.

Step 3: Batch AI generates per-POV steelmans
  ├─ AI succeeds for node → migrate steelman to object format
  ├─ AI fails for node → keep existing string, log in manifest
  └─ AI produces low-quality steelmans (generic, not POV-specific)
      └─ Spot-check: if >20% are generic, revise prompt before continuing

KEY RULE: Dual-format handling (typeof === 'string') stays until 100% of nodes
are migrated AND all consumers are verified. Only then tighten the type.
If even 1 node retains a string steelman, keep the dual handler.
```

---

## AI Output Verification Framework

Every phase of this plan involves AI-generated output that can fail in ways ranging from syntactic (malformed JSON) to semantic (valid JSON with wrong content). This section catalogs every AI generation point, the failure modes specific to each, the automated verification that must be in place, and the remediation when verification fails.

### Existing Verification Infrastructure

The project already has significant validation. Understanding what exists avoids duplication:

| Component | What It Catches | What It Misses |
|-----------|----------------|----------------|
| `Repair-TruncatedJson` (AIEnrich.psm1) | Truncated JSON from token limits | Structurally valid but semantically wrong JSON |
| `Parse-AIResponse` (Invoke-DocumentSummary) | Malformed JSON; saves debug dump on failure | Content correctness — a well-formed but wrong answer passes |
| `Test-SummaryDensity` + density retry | Too few key_points/claims/concepts | Too MANY (padding with low-quality points); wrong category assignment |
| Stance validation | Invalid stance values (replaced with 'neutral') | Stances that are valid strings but semantically wrong (e.g., "aligned" when document clearly opposes) |
| Edge validation (Invoke-EdgeDiscovery) | Missing fields, nonexistent targets, self-edges, low confidence | Wrong edge type, wrong direction, semantically unjustified edges |
| Attribute field validation | Missing required fields in graph_attributes | Wrong values in present fields |
| Debate response parsing (useDebateStore) | Malformed JSON → falls back to raw text | Structured but off-topic, out-of-character, or repetitive responses |
| Schema file (pov-taxonomy.schema.json) | Pattern violations in node IDs, categories, dates | **Not enforced at runtime** — exists as documentation only |

### Gap Analysis: What No Existing Check Catches

These are the verification gaps that this migration plan must fill:

1. **Semantic drift in descriptions** — AI rewrites a description that passes the genus-differentia pattern check but changes the node's meaning. The structural validator says "correct format" while the content is wrong.
2. **Hallucinated sibling references** — genus-differentia descriptions must name neighboring nodes. The AI may reference nodes that don't exist, or name the wrong sibling.
3. **Cross-reference consistency** — when the AI rewrites node A's description to say "excludes node B", does node B's description reciprocally acknowledge the boundary with A?
4. **Embedding space corruption** — after batch description rewrites, the embedding vectors change. Nodes that were semantically close may drift apart (or converge) in unpredictable ways.
5. **Debate agent coherence** — BDI-structured context may cause agents to over-index on their "vulnerabilities" section and produce weaker arguments, or ignore it entirely.
6. **AIF argument map quality** — the synthesis prompt asks for claim-attack pairs, but the AI may produce structurally valid maps where the attack_type labels are wrong (calling an undercut a rebut, etc.).
7. **Edge reclassification errors** — the "possible world" test for CONTRADICTS → TENSION_WITH requires understanding both nodes' full meaning. The AI may apply it mechanically using surface similarity rather than logical analysis.
8. **Steelman perspective-taking failure** — when generating per-POV steelmans, the AI may produce generic counterarguments rather than genuinely adopting the opposing POV's worldview.
9. **Temporal classification errors** — "current_state" vs. "predictive" depends on the document's publication date, which the AI may not correctly anchor to.
10. **Schema validation is not enforced** — the JSON schema file exists but nothing runs it against data. Invalid data can be committed without detection.

### Verification Requirements by Phase

#### Phase 1 — BDI Debate Restructuring

**AI generation points:** Debate agent responses (opening statements, cross-responds), debate synthesis

**What can go wrong:**
- Agents ignore BDI structure and produce same-quality output as before (no improvement, wasted effort)
- Agents over-fixate on KNOWN VULNERABILITIES section, producing apologetic arguments that concede too much
- Agents treat BELIEFS/VALUES/REASONING as rigid buckets and fail to connect across them (beliefs inform values inform reasoning — that flow should be natural)
- Synthesis `bdi_layer` classification is inconsistent or always defaults to one type

**Automated verification:**
```
V1.1 — BDI Section Coverage
  For each debate opening statement:
    Assert: taxonomy_refs include at least 1 node from each BDI section
    (BELIEFS/VALUES/REASONING). An agent that only cites Methods nodes
    is not using the BDI structure.
  Threshold: ≥2 of 3 sections referenced in ≥80% of opening statements.
  If failing: the BDI section headers may not be prominent enough in the
  context, or the prompt needs to explicitly instruct cross-section citation.

V1.2 — Vulnerability Acknowledgment Rate
  For each debate (all turns):
    Count: how many turns reference a vulnerability from KNOWN VULNERABILITIES
    Expected: 1-3 per 5-turn debate (occasional, not constant)
    If <1: agents are ignoring vulnerabilities → strengthen prompt instruction
    If >3: agents are over-conceding → soften vulnerability section framing
    ("Be AWARE of these" vs. "ACKNOWLEDGE these")

V1.3 — BDI Layer Distribution in Synthesis
  For each synthesis areas_of_disagreement:
    Count distribution of bdi_layer values
    Expected: roughly 40-60% belief, 20-30% value, 10-20% conceptual
    Red flag: >80% any single type → classification is defaulting, not analyzing
    Remediation: add examples of each type to synthesis prompt

V1.4 — Resolvability Consistency
  For each disagreement:
    Assert: bdi_layer and resolvability are consistent
    "belief" disagreements should be "resolvable by evidence"
    "value" disagreements should be "negotiable via trade-offs"
    "conceptual" disagreements should be "requires term clarification"
    Mismatch rate should be <15%. Higher → prompt needs clearer mapping.
```

**If verification fails:** Adjust prompt framing. Phase 1 is prompt-only with no data migration, so iteration is cheap. Run 3 more debate sets (D1-D5) with adjusted prompts before re-evaluating.

#### Phase 2 — Description Rewrites

**AI generation points:** ~450 node descriptions rewritten via batch AI

**What can go wrong:**
- Genus-differentia pattern is present but differentia is WRONG (confuses this node with a sibling)
- AI invents sibling references to nodes that don't exist
- AI changes the node's meaning while reformatting (semantic drift)
- Descriptions become longer, inflating the taxonomy context in downstream prompts past model token limits
- Cross-cutting descriptions lose the three-POV interpretive framing that makes them useful
- Embedding space shifts so dramatically that similarity search produces nonsensical results

**Automated verification:**
```
V2.1 — Structural Pattern Check (already planned)
  Regex: first sentence matches "A [category] within [POV] discourse that"
  For CC nodes: "A cross-cutting concept that"
  Threshold: 100% of migrated nodes must pass.
  Remediation: re-run failed nodes with adjusted prompt.

V2.2 — Sibling Reference Validation (NEW — must build)
  For each rewritten description:
    Extract all node ID references (pattern: [a-z]{2,3}-[a-z]+-\d{3})
    Assert: every referenced ID exists in the taxonomy
    Assert: at least 1 referenced node is in the same POV + category (actual sibling)
  Threshold: 0 orphan references allowed. 0 descriptions with no sibling reference.
  Remediation: re-run node with its sibling list explicitly injected into the prompt.

V2.3 — Semantic Drift Detection (NEW — must build)
  For each rewritten description:
    Compute embedding of OLD description and embedding of NEW description
    Compute cosine similarity between old and new
    Expected: similarity > 0.6 (descriptions should be RELATED to original)
    Red flag: similarity < 0.4 (meaning may have changed substantially)
    Red flag: similarity > 0.95 (AI barely changed anything — genus-differentia
    structure probably wasn't applied)
  Threshold: <5% of nodes in the <0.4 range. These get flagged for human review.
  Implementation: use embed_taxonomy.py batch-encode on old descriptions (before
  overwriting), then compare against new descriptions.

V2.4 — Description Length Budget
  After all rewrites:
    Compute total taxonomy context size (all descriptions concatenated)
    Compare against pre-migration total
    Assert: total increase < 40% (from ~305 char median to ~425 is reasonable)
    Run Invoke-POVSummary -DryRun and assert token estimate < model context limit
  Red flag: >50% increase → descriptions are too verbose, prompt needs "concise" reinforcement
  Remediation: re-run verbose descriptions (>500 chars) with explicit length cap.

V2.5 — Cross-Cutting Interpretation Preservation
  For each CC node:
    Assert: new description does NOT include POV-specific interpretation content
    (interpretations belong in the interpretations{} object, not the description)
    Check: all three interpretation fields are unchanged (descriptions rewrite
    should not touch interpretations)
  Threshold: 0 CC nodes with modified interpretations.
  Remediation: re-run with explicit "do NOT modify the interpretations object" instruction.

V2.6 — Embedding Space Stability (NEW — must build)
  After regenerating embeddings:
    For 20 randomly selected nodes:
      Get top-10 nearest neighbors BEFORE and AFTER rewrite
      Compute overlap (Jaccard similarity of the two neighbor sets)
      Expected: overlap > 0.5 (majority of neighbors should be stable)
    For the 10 nodes most frequently referenced in summaries (from SourcesPanel data):
      Same neighbor stability check, but with stricter threshold: overlap > 0.7
  Red flag: mean overlap < 0.4 → embedding space has shifted too much; descriptions
  may be losing semantic content while gaining structural format.
  Remediation: investigate low-overlap nodes. If descriptions are semantically equivalent
  but structurally different, the embedding model may need a different input format
  (e.g., encode description + label, not description alone).
```

**If verification fails at scale (>15% of nodes):** STOP migration. Do not proceed to remaining batches. Investigate whether the prompt is causing systematic issues (e.g., all Data/Facts nodes lose specificity, all Methods/Arguments nodes become too abstract). Fix prompt, re-run a 10-node test batch, verify, then resume.

#### Phase 3 — AIF Synthesis and Conflict Fields

**AI generation points:** Debate synthesis (argument_map), conflict instance enrichment

**What can go wrong:**
- `argument_map` claims don't match what was actually said in the transcript (hallucinated claims)
- `attack_type` labels are wrong (rebut vs. undercut vs. undermine is a fine distinction)
- `claim_id` references are inconsistent (C1 in one place, different C1 elsewhere)
- `scheme` labels don't match the actual dialectical move used
- `supported_by` creates circular chains (C1 supports C2 supports C1)

**Automated verification:**
```
V3.1 — Claim Grounding Check
  For each claim in argument_map:
    Assert: claim text appears (approximately) in the debate transcript
    Method: fuzzy string match (>60% overlap) between claim text and
    any statement in transcript by the named claimant
  Threshold: >80% of claims have a transcript anchor.
  Remediation: add to synthesis prompt "Each claim must be a near-verbatim
  extraction from a specific debate turn, not a paraphrase."

V3.2 — Attack Type Consistency
  For each attack:
    If scheme is COUNTEREXAMPLE → attack_type should be "rebut" (attacks conclusion)
    If scheme is DISTINGUISH → attack_type should be "undercut" (attacks inference)
    If scheme is REDUCE → attack_type should be "rebut" (attacks conclusion via absurdity)
  Cross-check: scheme-to-attack-type consistency rate.
  Threshold: >75% consistent. Lower → add scheme-attack_type mapping examples to prompt.

V3.3 — No Circular Support
  Assert: no claim appears in its own supported_by chain (even transitively)
  Implementation: simple cycle detection on claim graph
  Threshold: 0 cycles. Any cycle → parsing or prompt error.

V3.4 — Conflict Instance Validation
  For new conflict instances with attack_type:
    Assert: target_claim is non-empty
    Assert: counter_evidence is non-empty
    Assert: attack_type is one of "rebut", "undercut", "undermine"
  Threshold: 100% of new instances pass.
```

**If verification fails:** AIF synthesis is additive — fall back to flat disagreement list (existing behavior) for failing debates. Fix prompt, re-run.

#### Phase 5 — Edge Reclassification

**AI generation points:** CONTRADICTS �� TENSION_WITH reclassification via "possible world" test

**What can go wrong:**
- AI applies the test mechanically: if both nodes mention "AI risk", they're "related" and thus TENSION_WITH, even if they make genuinely contradictory claims
- AI defaults to TENSION_WITH because it's the "safe" answer (doesn't require proving logical impossibility)
- AI lacks context: the node descriptions alone may not convey whether the claims are logically incompatible
- The test is applied to edges where one or both nodes lack `node_scope`, making the domain constraint meaningless

**Automated verification:**
```
V5.1 — Reclassification Bias Detection
  After batch:
    Count: how many CONTRADICTS were kept vs. reclassified to TENSION_WITH
    Expected: 30-60% reclassified (if >80%, AI is defaulting to TENSION_WITH)
    Expected: if <10%, the test is too strict or not being applied
  Red flag: >80% reclassified → AI is being too permissive. Add stronger examples
  of genuine contradiction to the prompt.
  Red flag: <10% reclassified → AI is being too conservative. Review test wording.

V5.2 — Node Scope Requirement Enforcement
  Assert: reclassification was only attempted on edges where BOTH endpoints have node_scope
  Edges where either endpoint lacks node_scope: leave unchanged, log

V5.3 — Domain/Range Validation (Script — not AI)
  After all edge type changes:
    For each SUPPORTS edge: source must be Data/Facts or Methods/Arguments
    For each CONTRADICTS edge: source and target must have same node_scope
    For each INTERPRETS edge: target must start with "cc-"
  Script-based, no AI involved. Run as post-migration validation.
  Threshold: 0 violations. Violations indicate mapping table or reclassification errors.

V5.4 — Orphan and Dangling Reference Check
  Assert: every edge's source and target exist in the taxonomy
  Assert: no edge has source == target
  Run via Measure-TaxonomyBaseline: edges.orphan_edges should be 0
```

**If verification fails:** Edge migration has permanent backward-compat handlers. Revert the DATA repo to the pre-migration tag. Consumer code works with both old and new types. Investigate the specific failure pattern, fix, re-run.

#### Phase 6b — Fallacy Tier Backfill

**AI generation points:** NONE — this is a deterministic lookup table, not AI-generated.

**Automated verification:**
```
V6b.1 — Complete Coverage
  Assert: every possible_fallacies entry in every taxonomy node has a type field
  Assert: every type value is one of "formal", "informal_structural",
          "informal_contextual", "cognitive_bias"
  Implementation: PowerShell script iterating all nodes.
  Threshold: 100%. Any fallacy key not in the lookup table → add it manually.
```

#### Phase 6c — Perspectival Steelman

**AI generation points:** Per-POV steelman generation for ~450 nodes

**What can go wrong:**
- AI produces generic counterarguments that could apply to any node ("This position may not account for all perspectives") rather than specific POV-grounded attacks
- AI writes from the WRONG POV (the `from_safetyist` attack reads like an accelerationist argument)
- AI copies the existing single-string steelman into all three POV slots instead of generating distinct attacks
- AI produces steelmans that are too long, inflating graph_attributes size

**Automated verification:**
```
V6c.1 — POV Grounding Check
  For each per-POV steelman:
    Check for POV-specific vocabulary markers:
      from_accelerationist: should reference progress, innovation, speed, scaling, open-source
      from_safetyist: should reference risk, alignment, control, oversight, catastrophe
      from_skeptic: should reference bias, displacement, accountability, harms, evidence
    Method: keyword/phrase presence check (not exact — look for POV-characteristic terms)
  Threshold: >70% of steelmans contain at least 2 POV-characteristic terms.
  Red flag: <50% → AI is producing generic text. Add POV vocabulary examples to prompt.

V6c.2 — Distinctness Check
  For each node with per-POV steelmans:
    Compute pairwise cosine similarity between the 2-3 steelman texts
    Expected: similarity < 0.7 (they should be substantively different attacks)
    Red flag: similarity > 0.85 → AI is copying/paraphrasing the same argument
    across POVs instead of genuinely perspective-taking.
  Threshold: <10% of nodes have any steelman pair with similarity > 0.85.
  Remediation: add "Each POV attack must be grounded in THAT POV's specific beliefs
  and values, not a generic counterargument" to the prompt.

V6c.3 — Legacy Migration Check
  For nodes migrated from string to object:
    Assert: the existing string content appears in exactly ONE of the per-POV slots
    (the "best match" migration strategy)
    Assert: the other 1-2 slots contain NEW text, not copies of the original

V6c.4 — Length Budget
  Per-POV steelman: target 1-3 sentences (50-200 chars)
  Red flag: any steelman > 400 chars → too verbose, prompt needs length constraint
  Red flag: any steelman < 20 chars → too short to be useful
```

**If verification fails:** Keep dual-format handling (string | object). Nodes where AI generation failed retain original string steelman. Re-run failed subset with adjusted prompt.

### Verification Implementation Plan

These checks need to exist as code, not just documentation. Here's what to build:

| Verification | Implementation | When to Build | Runs When |
|-------------|---------------|---------------|-----------|
| V1.1-V1.4 (debate BDI) | TypeScript in useDebateStore or test file | Phase 1 | After each debate (automatic) |
| V2.1 (genus-differentia pattern) | PowerShell in migration script | Phase 2 | Per-batch during migration |
| V2.2 (sibling reference) | PowerShell in migration script | Phase 2 | Per-batch during migration |
| V2.3 (semantic drift) | PowerShell + embed_taxonomy.py | Phase 2 | Post-batch, before committing |
| V2.4 (length budget) | PowerShell in migration script | Phase 2 | Post-migration |
| V2.5 (CC interpretation preservation) | PowerShell in migration script | Phase 2 | Per-batch during migration |
| V2.6 (embedding stability) | PowerShell + embed_taxonomy.py | Phase 2 | Post-embeddings regeneration |
| V3.1-V3.4 (AIF synthesis) | TypeScript in useDebateStore | Phase 3 | After each synthesis (automatic) |
| V5.1-V5.4 (edge validation) | PowerShell migration script | Phase 5 | Post-migration |
| V6b.1 (fallacy coverage) | PowerShell one-liner | Phase 6b | Post-backfill |
| V6c.1-V6c.4 (steelman) | PowerShell in migration script | Phase 6c | Per-batch during migration |

**Add to `Measure-TaxonomyBaseline`:** After this plan is complete, extend the baseline cmdlet to report on the new fields: `node_scope` coverage percentage, `disagreement_type` coverage, `temporal_scope` coverage on claims, steelman format (string vs. object count), fallacy tier coverage.

---

## Phase 1 — BDI Debate Agent Restructuring

**Goal:** Restructure the debate agents' context and prompts using BDI vocabulary (Beliefs / Values / Reasoning Approach). This directly improves the priority use case — debate quality — with zero schema migration and zero risk to existing data.

**Why first:** Highest value for the priority use case. Prompt-only change. Instantly testable via A/B comparison of debate output.

**Repos affected:** Code only.

### 1.1 Restructure `formatTaxonomyContext` as BDI Sections

**File:** `taxonomy-editor/src/renderer/hooks/useDebateStore.ts` (lines 119-138)

**Current:** Flat dump of nodes grouped only by POV vs. cross-cutting.

**Proposed:** Group nodes by BDI category, with explicit framing:
```
=== YOUR BELIEFS (what you take as empirically true) ===
These are the factual claims and empirical observations that ground your worldview.
[acc-data-001] More Power Equals More Smarts: The evidence shows...
  Epistemic type: empirical_claim
...

=== YOUR VALUES (what you prioritize and why) ===
These are the goals and principles you argue from. They are normative commitments, not empirical claims.
[acc-goals-001] AI Creates a World of Plenty: ...
...

=== YOUR REASONING APPROACH (how you argue) ===
These are the methods, frameworks, and argumentative strategies you use to connect beliefs to values.
[acc-methods-001] Winning the Race for Safe AI: ...
...

=== YOUR KNOWN VULNERABILITIES ===
Be aware of these weaknesses in your positions. Acknowledging them strengthens your credibility.
- acc-goals-001: Overlooks the possibility that... (steelman vulnerability)
- acc-methods-006: Criticism Driven by Fear — watch for Ad_Hominem (likely)
...

=== CROSS-CUTTING CONCERNS ===
These concepts are contested across all perspectives. Your interpretation differs from others'.
[cc-001] When Will Super-Smart AI Arrive?
  Your interpretation: [accelerationist interpretation text]
  Other views: Safetyists see this as urgent risk; Skeptics question the premise
...
```

**Implementation:**
1. Modify `formatTaxonomyContext` in `useDebateStore.ts` to group `povNodes` by category
2. Extract vulnerabilities into a separate section
3. For cross-cutting nodes, show this agent's interpretation prominently
4. No changes to `getTaxonomyContext` — same data, different formatting
5. Add `generated_with_prompt_version: "dolce-phase-1"` to new debate sessions

### 1.2 Update Debate Prompts with BDI Framing

**Files:**
- `taxonomy-editor/src/renderer/prompts/debate.ts` — all prompt functions
- `scripts/AITriad/Prompts/triad-dialogue-system.prompt`
- `scripts/AITriad/Prompts/triad-dialogue-turn.prompt`

**Changes:** Update `TAXONOMY_USAGE` block with BDI vocabulary. Update `triad-dialogue-system.prompt` with `{{POV_BELIEFS}}`, `{{POV_VALUES}}`, `{{POV_METHODS}}` placeholders.

### 1.3 Update Debate Synthesis with BDI Disagreement Analysis

**Files:** `debate.ts` — `debateSynthesisPrompt`, `triad-dialogue-synthesis.prompt`

Add `bdi_layer`, `resolvability` to `areas_of_disagreement`. Add `argument_map` preparation (claim IDs) for Phase 3.

### 1.4 Establish Debate Quality Baseline

**Before making any changes:** Run the 5 fixed debate topics (D1-D5 from rubric above), 3 runs each, score per rubric. Save to `docs/debate-baseline-pre-phase-1.json`.

**After changes:** Re-run same 5 topics, 3 runs each. Compare.

### 1.5 Golden-File Tests

Create snapshot tests for `formatTaxonomyContext`:
1. Feed 3 known POV nodes (one per category) + 1 CC node to `formatTaxonomyContext`
2. Assert output contains `=== YOUR BELIEFS ===`, `=== YOUR VALUES ===`, `=== YOUR REASONING APPROACH ===`, `=== YOUR KNOWN VULNERABILITIES ===` sections
3. Assert Data/Facts nodes appear under BELIEFS, Goals/Values under VALUES, Methods/Arguments under REASONING APPROACH
4. Save as Pester/Jest test file for regression

### Affected Files (Complete)

| File | Change | Repo |
|------|--------|------|
| `taxonomy-editor/src/renderer/hooks/useDebateStore.ts` | `formatTaxonomyContext` restructured | code |
| `taxonomy-editor/src/renderer/prompts/debate.ts` | TAXONOMY_USAGE updated, synthesis schema updated | code |
| `scripts/AITriad/Prompts/triad-dialogue-system.prompt` | BDI placeholders | code |
| `scripts/AITriad/Prompts/triad-dialogue-synthesis.prompt` | `bdi_layer` and `resolvability` added | code |

### Documentation Checklist

- [ ] CLAUDE.md updated: debate agents now use BDI-structured context
- [ ] `bfo-prompt-recommendations.md` header updated: "Superseded by dolce-aif-bdi-implementation-plan.md"

### Validation Gate

- [ ] Golden-file test for `formatTaxonomyContext` passes
- [ ] All 5 baseline debates (D1-D5) re-run, 3 times each
- [ ] Mean score improves on ≥2 dimensions, no dimension regresses >0.5
- [ ] `Measure-TaxonomyBaseline` shows no regressions
- [ ] Old debates (without `bdi_layer`) still render correctly in DebateTab

### Rollback

Tag: `pre-dolce-phase-1` (code repo only). Revert 4 files.

---

## Phase 2 — Genus-Differentia Descriptions + DOLCE Discourse Framing

**Goal:** Rewrite node descriptions to use genus-differentia structure with DOLCE's discourse framing.

**Why second:** Every downstream phase benefits from sharper descriptions.

**Repos affected:** Code + Data.

### 2.1 Update Description Guidance in Prompts

**Files and changes (code repo):**

| File | Change |
|------|--------|
| `prompts/TaxonomyRefiner.md` | Replace description instruction with genus-differentia template |
| `scripts/AITriad/Prompts/pov-summary-system.prompt` | Genus-differentia rule + DOLCE ONTOLOGICAL FRAMING |
| `scripts/AITriad/Prompts/pov-summary-chunk-system.prompt` | Same genus-differentia rule |
| `scripts/AITriad/Prompts/taxonomy-proposal.prompt` | Genus-differentia for NEW/RELABEL |
| `prompts/ai-triad-analysis-prompt.md` | Genus-differentia for Part 2 |
| `scripts/AITriad/Prompts/attribute-extraction.prompt` | Discourse-aware `falsifiability` |
| `scripts/AITriad/Prompts/cross-cutting-candidates.prompt` | Genus-differentia for CC descriptions |

### 2.2 Batch Rewrite of Existing Descriptions (Data Repo)

**Scope:** ~450 node descriptions across 4 taxonomy files.

**Method:**
1. Build a batch script that feeds each node + its siblings (same category, same POV) + parent to the AI
2. Use `gemini-2.5-flash` or `claude-sonnet-4-6`
3. Process in batches of 20-30
4. Per-batch validation: (a) first sentence matches genus-differentia pattern, (b) at least one sibling named in exclusion boundary, (c) no orphan references to nonexistent nodes
5. Human spot-check: reviewer reads 3-5 descriptions per batch for semantic correctness

**Partial failure handling:** See "Partial-Failure Decision Trees" section above. Key rule: taxonomy files are valid in a mixed-description state.

**Per-node tracking:** The migration manifest tracks each node as `pending` → `migrated` → `reviewed`:
```json
{
  "node_id": "acc-goals-001",
  "status": "migrated",
  "batch": 3,
  "old_description_hash": "a1b2c3",
  "new_description_hash": "d4e5f6",
  "validator": "pattern_check",
  "human_reviewed": false
}
```

**Post-migration:**
- Run `Update-TaxEmbeddings` — new descriptions will shift the embedding space
- Validate similar search: run 10 queries that had good results before, verify results still make sense
- Re-run the 5 Phase 1 baseline debates — verify debate quality doesn't regress
- Check `Invoke-POVSummary -DryRun` token count — if taxonomy context exceeds 300K tokens, investigate

### 2.3 Consumer Impact

| Consumer | Impact | Action Needed |
|----------|--------|---------------|
| NodeDetail content tab | New style visible | Visual review |
| CrossCuttingDetail overview | New style visible | Visual review |
| SimilarResultsPane (summary-viewer) | Descriptions in search results | Visual review |
| Debate prompts (BDI context) | Clearer boundaries | Benefits; verify in D1-D5 re-run |
| Embedding generation | Input changed | **MUST regenerate** |
| Invoke-POVSummary | Taxonomy in prompt | **Monitor token count** |
| Invoke-EdgeDiscovery | Descriptions as context | Benefits |
| Source → node index | Re-summarization may remap docs | **Monitor: run SourcesPanel on 5 high-ref nodes, verify counts don't drop dramatically** |
| Invoke-TaxonomyProposal | New nodes get genus-differentia | **Validate: do AI-proposed exclusion boundaries reference real sibling nodes?** |

### Documentation Checklist

- [ ] CLAUDE.md updated: description convention now genus-differentia
- [ ] `prompts/TaxonomyRefiner.md` reflects new template

### Validation Gate

- [ ] `descriptions.genus_differentia_pct` > 90%
- [ ] `descriptions.stub_descriptions` = 0
- [ ] `node_mapping.category_inconsistencies` ≤ 14 (must not regress)
- [ ] Embeddings regenerated, similarity search spot-checked (10 queries)
- [ ] D1-D5 debate re-run — no quality regression
- [ ] `Invoke-POVSummary -DryRun` token estimate within model limits
- [ ] Migration manifest filed in `ai-triad-data/migrations/phase-2-manifest.json`
- [ ] Failed items < 5%

### Rollback

Tag: `pre-dolce-phase-2` (both repos). Revert taxonomy files + prompt files + `Update-TaxEmbeddings`.

---

## Phase 3 — AIF Vocabulary in Debate Synthesis and Conflict Detection

**Goal:** Add AIF vocabulary to debate synthesis output and conflict detection. Makes argument structure explicit.

**Why third:** Builds on Phase 1's BDI-structured debates.

**Repos affected:** Code only (additive schema fields in output).

### 3.1 AIF-Aligned Debate Synthesis

**File:** `debate.ts` — `debateSynthesisPrompt`

Add `argument_map` to synthesis output:
```json
{
  "argument_map": [
    {
      "claim_id": "C1",
      "claim": "Scaling compute is sufficient to reach AGI",
      "claimant": "prometheus",
      "type": "empirical",
      "supported_by": ["C3"],
      "attacked_by": [
        {
          "claim_id": "C2",
          "claim": "Novel architectures may be needed",
          "claimant": "sentinel",
          "attack_type": "undercut",
          "scheme": "COUNTEREXAMPLE"
        }
      ]
    }
  ]
}
```

AIF mapping: claims = I-nodes, `supported_by` = RA-nodes, `attacked_by` = CA-nodes, `scheme` = S-nodes.

### 3.2 AIF-Aligned Conflict Detection

**File:** `scripts/AITriad/Public/Find-Conflict.ps1`

Add optional fields to conflict instances: `attack_type`, `target_claim`, `counter_evidence`. Additive — existing instances unaffected.

### 3.3 Consumer Handling for Mixed-Format Data

| Consumer | Old debates (no `argument_map`) | New debates (with `argument_map`) |
|----------|-------------------------------|----------------------------------|
| DebateTab synthesis display | Shows flat disagreement list (current behavior) | Shows `argument_map` if present, falls back to flat list |
| Conflict viewer | Shows existing format | Shows `attack_type` badge if present |

### Dialectical Move Formalization

| Move | AIF Scheme Type | Definition |
|------|----------------|------------|
| CONCEDE | Support (RA) | Accept opponent's point |
| DISTINGUISH | Undercut (CA) | Accept evidence, deny it applies |
| REFRAME | Scheme shift (S) | Shift interpretive frame |
| COUNTEREXAMPLE | Rebut (CA) | Specific case contradicting claim |
| REDUCE | Rebut (CA) | Opponent's logic → absurd conclusion |
| ESCALATE | Scheme shift (S) | Connect to broader principle |

### Documentation Checklist

- [ ] CLAUDE.md updated: debate synthesis now includes argument_map
- [ ] Comment in `Find-Conflict.ps1` documents new optional fields

### Validation Gate

- [ ] D1-D5 re-run — synthesis includes `argument_map` with ≥3 claim-attack pairs per debate
- [ ] `attack_type` classification consistent (manual review)
- [ ] Old debates still render correctly
- [ ] Conflict detection unchanged for old conflicts

### Rollback

Tag: `pre-dolce-phase-3` (code repo only). Revert prompt files. New conflict fields are additive — old code ignores them.

---

## Phase 4 — Sub-Categories + Ontological Level + Disagreement Types (PROMPT-ONLY)

**Goal:** Classification refinements. All prompt-only.

**Repos affected:** Code only.

### 4.1 Sub-Category Disambiguation

Add CATEGORY DISAMBIGUATION block to `pov-summary-system.prompt`, `pov-summary-chunk-system.prompt`, `TaxonomyRefiner.md`. Uses BDI and AIF vocabulary to explain sub-types.

### 4.2 Node Scope (scheme/claim/bridging)

Add `node_scope` to `attribute-extraction.prompt`. Optional field in `graph_attributes`.

**Schema update:** Add `node_scope` to `taxonomy/schemas/pov-taxonomy.schema.json` as optional enum.

### 4.3 Cross-Cutting Disagreement Types

Add `disagreement_type` to `cross-cutting-candidates.prompt` (definitional / interpretive / structural).

### 4.4 Consumer UI Updates

| Field | Display Component | Rendering |
|-------|------------------|-----------|
| `node_scope` | `GraphAttributesPanel` | Badge: "Scheme" (blue), "Claim" (green), "Bridging" (yellow) |
| `disagreement_type` | `CrossCuttingDetail` Overview tab | Badge below label |

Both: render only if field present. No display for old nodes lacking the field.

### 4.5 Organic Population Monitoring

After 30 days, check `node_scope` coverage:
- If >50% → Phase 5 prerequisite met organically
- If <50% → run `Invoke-AttributeExtraction -POV all` as a batch to backfill. This is Phase 4.5.

### Documentation Checklist

- [ ] CLAUDE.md updated: new optional fields documented
- [ ] Schema files updated

### Validation Gate

- [ ] Next 5 `Invoke-AttributeExtraction` runs produce `node_scope`
- [ ] `bridging` rate < 15%
- [ ] Next 5 CC candidates get `disagreement_type`
- [ ] `Measure-TaxonomyBaseline` — no regressions

### Rollback

Tag: `pre-dolce-phase-4` (code repo). Revert prompts. No data to revert.

---

## Phase 5 — Edge Semantics Overhaul (AIF-Aligned) — DEFERRED

**Goal:** Consolidate edge types from 40+ to 7 canonical.

**Repos affected:** Code + Data.

**Status:** DEFERRED until prerequisites are met.

### Prerequisites (ALL required)

- [ ] Phase 2 complete — genus-differentia descriptions >90%
- [ ] Phase 4 complete — `node_scope` on >50% of nodes (backfill if needed via Phase 4.5)
- [ ] `Measure-TaxonomyBaseline` current
- [ ] Integration test suite passing
- [ ] **Policy registry audit:** Are policy edges in `edges.json` or `policy_actions.json`? If in `edges.json`, do they use custom types that need mapping?
- [ ] Consumer update plan reviewed and all files identified

### Canonical Types (7)

| Type | AIF Equiv | Direction | Domain → Range |
|------|----------|-----------|----------------|
| SUPPORTS | RA (inference) | Source → Target | Data\|Methods → Any |
| CONTRADICTS | CA (rebut) | Bidirectional | Same scope level |
| ASSUMES | RA (presupposition) | Source → Target | Any → Any |
| WEAKENS | CA (undermine) | Source → Target | Data\|Methods → Any |
| RESPONDS_TO | Dialogue | Source → Target | Any → Any |
| TENSION_WITH | CA (preference) | Bidirectional | Any → Any |
| INTERPRETS | Scheme application | Source → Target | POV → CC only |

### Execution Order

1. Update ALL consumer code with backward-compat handlers (**kept permanently**)
2. Update edge_types definitions in `edges.json` header
3. Bulk type consolidation via mapping table
4. CONTRADICTS → TENSION_WITH reclassification (AI batch, only where both nodes have `node_scope`)
5. Archive CITES and SUPPORTED_BY edges to `_archived_edges.json`
6. Domain/range validation — flag and queue violations
7. Run `Measure-TaxonomyBaseline`
8. File migration manifest

**Partial failure handling:** See decision trees above. Backward-compat handlers ensure partial migration is valid.

### Rollback

Tag: `pre-dolce-phase-5` (both repos). Revert data repo to tag. Consumer code's backward-compat handlers stay — they handle both old and new types, so code repo needs no revert.

**Step-by-step rollback procedure:**
1. `cd ai-triad-data && git checkout pre-dolce-phase-5`
2. Verify `edges.json` has original types
3. Taxonomy-editor and summary-viewer will render old types correctly (backward-compat handlers)
4. Total time: <5 minutes

---

## Phase 6 — Temporal Qualifiers + Fallacy Tiers + Perspectival Steelman

Three independent workstreams. Can be parallelized.

### 6a: Temporal Qualifiers — PROMPT-ONLY

Repos: Code only. Add `temporal_scope`, `temporal_bound` to `factual_claims` in summary prompts and schema. No backfill — old summaries gain fields when re-summarized.

### 6b: Fallacy Tiers — PROMPT + LOOKUP BACKFILL

Repos: Code + Data (backfill is deterministic lookup, no AI). Add `type` field to `possible_fallacies` entries. Backfill via lookup table mapping each fallacy key to its tier.

### 6c: Perspectival Steelman — BREAKING CHANGE

Repos: Code + Data. Change `steelman_vulnerability` from string to per-POV object.

**Execution:** (1) Update TypeScript types as union, (2) update ALL consumers with dual-format handling, (3) batch AI to generate per-POV steelmans, (4) tighten type ONLY when 100% migrated and verified.

**Partial failure:** See decision trees above. Dual-format handling stays until every node is migrated.

### Documentation Checklist (Phase 6 combined)

- [ ] CLAUDE.md: new `temporal_scope`, fallacy tiers, per-POV steelman documented
- [ ] Schema files updated for all three workstreams
- [ ] `taxonomy/schemas/pov-taxonomy.schema.json` updated

### Validation Gate

- [ ] New summaries have `temporal_scope` on all factual_claims
- [ ] All `possible_fallacies` entries have `type` (100% after lookup backfill)
- [ ] `steelman_vulnerability` is object on all nodes (or dual-format handling verified)
- [ ] No renderer crashes or shows `[object Object]`
- [ ] D1-D5 debate re-run with perspectival steelman — more targeted counterarguments
- [ ] Migration manifest for 6b (fallacy backfill) and 6c (steelman migration)

---

## Phase 7 — Mereological Constraints for Parent-Child

Repos: Code + Data. Add `relationship_type` (is_a / part_of / specializes) to nodes with `parent_id`. Prompt changes + AI batch classification for backfill.

### Validation Gate

- [ ] Every node with `parent_id` has `relationship_type`
- [ ] Migration manifest filed

---

## Integration Testing

### Smoke Tests (run before Phase 1 and after each phase)

```powershell
# PowerShell Module
Import-Module AITriad -Force                              # loads without errors
Get-Tax | Select -First 5                                 # nodes render
Get-Tax -Id acc-goals-001 | Format-List                   # single node works
Measure-TaxonomyBaseline                                  # all metrics computed
Invoke-POVSummary -DocId <sample> -DryRun                 # prompt builds
Invoke-EdgeDiscovery -DryRun                              # edge prompt builds
```

### Golden-File Tests (add with Phase 1, run continuously)

- `formatTaxonomyContext` snapshot test — known input → expected BDI-sectioned output
- `Invoke-POVSummary -DryRun` prompt snapshot — verify ONTOLOGICAL FRAMING present (Phase 2+), template placeholders all substituted, token count logged

### GUI Verification (manual, after each phase)

- Taxonomy-editor: NodeDetail (all tabs), CrossCuttingDetail (all tabs), EdgeBrowser, Debate (full cycle), SourcesPanel
- Summary-viewer: document list, similarity search, potential edges, settings

### Pester Tests

```powershell
Invoke-Pester ./tests/  # all tests pass, no new failures
```

### Schema Validation (after each phase that adds fields)

Run JSON Schema validation against all taxonomy files and summary files. Verify no required-field violations.

---

## Operational Guidance

### Who Does What

- **Phase executor:** The person running the migration scripts and reviewing AI output.
- **Spot-checker:** Can be the same person but should use a checklist (genus-differentia pattern match, sibling references, semantic correctness).
- **Phase gates** are self-assessed using the checklist. No separate reviewer required, but debate baseline scoring benefits from a second scorer.

### Time Estimates

| Phase | Estimated Effort | Can Be Spread Over |
|-------|-----------------|-------------------|
| 1 | 2-3 hours (code changes + 5×3 debate runs) | 1 day |
| 2 | 6-8 hours (prompt changes + 450-node batch + review) | 2-3 days |
| 3 | 2-3 hours (prompt changes + debate re-runs) | 1 day |
| 4 | 1-2 hours (prompt changes only) | 1 day |
| 5 | 8-12 hours (consumer updates + edge migration + validation) | 3-5 days |
| 6a | 30 minutes (prompt change) | 1 sitting |
| 6b | 1-2 hours (prompt + lookup backfill script) | 1 day |
| 6c | 4-6 hours (consumer updates + AI batch + validation) | 2 days |
| 7 | 2-3 hours (prompt + AI batch) | 1 day |

### Cadence

Run as fast as phase gates allow. Minimum 1 day between phases that touch the same repo to allow verification. Phases 6a/6b/6c can run in parallel.

### "Migration In Progress" Signal

While a data-touching phase (2, 5, 6b, 6c, 7) is in progress:
- The migration manifest exists with `completed_at: null`
- Other operators should NOT run `Invoke-TaxonomyProposal` or `Invoke-BatchSummary` on the data repo until the phase is complete (conflicting writes to taxonomy files)
- Running `Invoke-POVSummary` on individual documents is fine — it writes to summaries/, not taxonomy/

---

## Progress Tracking

| Phase | Description | Status | Baseline Pre | Baseline Post | Key Delta | Notes |
|-------|------------|--------|-------------|---------------|-----------|-------|
| 0 | Observability | **DONE** | baseline-2026-03-28.json | — | — | `Measure-TaxonomyBaseline` created |
| 1 | BDI debate agents | NOT STARTED | debate baseline TBD (D1-D5) | | | Priority use case |
| 2 | Genus-differentia + discourse | NOT STARTED | genus_diff: 5.8% | | Target >90% | |
| 3 | AIF synthesis + conflicts | NOT STARTED | | | | Builds on Phase 1 |
| 4 | Sub-cat + scope + disagree types | NOT STARTED | | | Prompt-only | |
| 4.5 | node_scope backfill (if needed) | CONDITIONAL | | | Only if <50% after 30d | |
| 5 | Edge semantics (AIF) | DEFERRED | non_canonical: 771 | | Target: 0 | Highest risk |
| 6a | Temporal qualifiers | NOT STARTED | | | Prompt-only | |
| 6b | Fallacy tiers | NOT STARTED | flagging: 53% | | Target: lower | |
| 6c | Perspectival steelman | NOT STARTED | | | Breaking change | |
| 7 | Parent-child mereology | NOT STARTED | | | Low priority | |

---

## Schema Version Plan

| Version | Trigger | Changes | Breaking? |
|---------|---------|---------|-----------|
| 1.0.0 | Current | Existing schema | — |
| 1.1.0 | Phase 2 | Genus-differentia descriptions, `generated_with_prompt_version` | No |
| 1.2.0 | Phase 4 | Optional `node_scope`, `disagreement_type` | No |
| 1.3.0 | Phase 6 | `temporal_scope` on claims, `type` on fallacies, `steelman_vulnerability` object | 6c is breaking (handled by dual-format) |
| 2.0.0 | Phase 5 | Edge types consolidated to 7 | **Yes** (handled by permanent compat handlers) |
| 2.1.0 | Phase 7 | `relationship_type` on parent-child | No |

---

## Rollback Strategy Summary

| Phase | Repos | Complexity | Tag | Procedure |
|-------|-------|-----------|-----|-----------|
| 1 | Code | Trivial | `pre-dolce-phase-1` | Revert 4 files |
| 2 | Both | Medium | `pre-dolce-phase-2` | Revert taxonomy files + prompts + `Update-TaxEmbeddings` |
| 3 | Code | Trivial | `pre-dolce-phase-3` | Revert prompts; additive fields ignored by old code |
| 4 | Code | Trivial | `pre-dolce-phase-4` | Revert prompts |
| 5 | Data only | Easy | `pre-dolce-phase-5` | `git checkout` data repo tag; code's compat handlers work with old types |
| 6a | Code | Trivial | `pre-dolce-phase-6` | Revert prompts |
| 6b | Both | Easy | `pre-dolce-phase-6` | Revert taxonomy files (remove `type` on fallacies) |
| 6c | Both | Medium | `pre-dolce-phase-6` | Revert taxonomy files; keep dual-format consumer code |
| 7 | Both | Easy | `pre-dolce-phase-7` | Revert taxonomy files |
