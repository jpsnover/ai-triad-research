# Prompt Improvements Through the Lens of Basic Formal Ontology

> **Superseded by [`dolce-aif-bdi-implementation-plan.md`](dolce-aif-bdi-implementation-plan.md).** This document's problem analysis and baseline measurements remain valid reference material, but its BFO-framed implementation plan has been replaced by the DOLCE+AIF+BDI migration plan.

**Author:** Ontology review, 2026-03-27
**Revised:** 2026-03-28 (added baseline measurements, risk analysis, consumer audit, revised implementation plan)
**Scope:** All prompt templates in `scripts/AITriad/Prompts/`, `prompts/`, and `taxonomy-editor/src/renderer/prompts/`

---

## Executive Summary

The AI Triad taxonomy is an applied ontology for mapping AI policy discourse. It already exhibits several strong ontological commitments: a fixed upper-level partition (three POVs + cross-cutting), a triaxial category system (Desires, Beliefs, Intentions), and typed relations between nodes. However, when evaluated against the design principles of Basic Formal Ontology (BFO) -- the ISO/IEC 21838-2 standard for top-level ontologies -- several systematic issues emerge in the prompts that instruct AI models to populate, extend, and reason over this taxonomy.

This document proposes 10 recommendations ordered by expected impact, a baseline measurement to track results, a complete consumer audit of affected code, and a phased implementation plan with validation gates and rollback procedures.

---

## Baseline Measurements (2026-03-28)

Before any changes, run `Measure-TaxonomyBaseline` to establish quantitative baselines. These numbers are the success criteria: each phase must demonstrably improve at least one metric without regressing others.

**Current state** (from `docs/baseline-2026-03-28.json`):

| Metric | Value | Notes |
|--------|-------|-------|
| Taxonomy nodes | 451 | Across 4 POV files |
| Summaries | 118 | Documents processed |
| Edges | 15,813 | In edges.json |
| Conflicts | 1,145 | In conflicts/ |
| **Node Mapping** | | |
| Total key_points across all summaries | 2,562 | |
| Unmapped (null taxonomy_node_id) | 62 (2.4%) | Low is good |
| Invalid node refs (node doesn't exist) | 8 | Data hygiene issue |
| Category inconsistencies | 14 nodes | Same node assigned different categories across summaries |
| Unreferenced nodes | 294/451 (65.2%) | Nodes never cited by any document |
| **Density** | | |
| Median KP per 1K words | 1.95 | |
| P10–P90 range | 0.19–2.48 | 13x spread (addressed by density scaling) |
| Zero-KP camp entries | 0 | Good — every doc yields something per camp |
| **Edges** | | |
| Canonical types (7) | 15,042 (95.1%) | |
| Non-canonical types (40+) | 771 (4.9%) | Phase 3 target |
| Orphan edges (ref deleted nodes) | 787 | Data hygiene |
| Self-edges | 0 | Good |
| Domain violations (Goals SUPPORTS Data) | 138 | Phase 3 target |
| **Conflicts** | | |
| Single-instance | 1,056 (92.2%) | Only 89 have corroboration from multiple sources |
| **Fallacies** | | |
| Nodes flagged | 239/451 (53%) | Phase 5 target: should this be lower? |
| Total flags | 395 (likely: 137, possible: 202, borderline: 56) | |
| Avg per flagged node | 1.7 | |
| **Descriptions** | | |
| Median length | 305 chars | |
| Short (<50 chars) | 16 | |
| Stubs (description == label) | 20 | |
| Already genus-differentia | 26 (5.8%) | Phase 1 target: 100% |
| **Unmapped Concepts** | | |
| Total across summaries | 425 | |
| Resolved to new nodes | 52 (12.2%) | |

**Re-run after each phase:** `Measure-TaxonomyBaseline -OutputPath ./docs/baseline-post-phase-N.json`

---

## Consumer Audit

Every data element changed by this plan is consumed by code in multiple locations. Changes that don't update all consumers will cause runtime errors or silent data corruption. This audit must be verified before each phase begins.

### Data Element: Node Descriptions

Changed by: Phase 1 (genus-differentia rewrite)

| Consumer | File | How It Uses Descriptions |
|----------|------|------------------------|
| NodeDetail content tab | `taxonomy-editor/src/renderer/components/NodeDetail.tsx` | Renders description in editable textarea |
| CrossCuttingDetail overview | `taxonomy-editor/src/renderer/components/CrossCuttingDetail.tsx` | Renders description in editable textarea |
| SourcesPanel | `taxonomy-editor/src/renderer/components/SourcesPanel.tsx` | Not affected (shows source points, not node descriptions) |
| SimilarResultsPane | `summary-viewer/src/renderer/components/SimilarResultsPane.tsx` | Displays description in search results |
| Debate prompts | `taxonomy-editor/src/renderer/prompts/debate.ts` | Feeds description as context to debate agents |
| Analysis prompts | `taxonomy-editor/src/renderer/prompts/analysis.ts` | Feeds description to AI analysis |
| Research prompt | `taxonomy-editor/src/renderer/prompts/research.ts` | Uses description in research prompt generation |
| Embedding generation | `scripts/embed_taxonomy.py` | Encodes descriptions as vectors — new style may shift similarity space |
| Get-TaxonomyHealth | `scripts/AITriad/Public/Get-TaxonomyHealth.ps1` | Reads descriptions for coverage analysis |
| Invoke-POVSummary | `scripts/AITriad/Prompts/pov-summary-system.prompt` | Full taxonomy (with descriptions) embedded in every prompt |
| Invoke-EdgeDiscovery | `scripts/AITriad/Prompts/edge-discovery.prompt` | Node descriptions used as context for edge proposal |

**Risk:** Changing description style from conversational to formal will affect embedding similarity space. Nodes that were "similar" under narrative descriptions may become "dissimilar" under genus-differentia definitions, or vice versa. After Phase 1, embeddings MUST be regenerated (`Update-TaxEmbeddings`) and similarity search results reviewed.

### Data Element: Edge Types

Changed by: Phase 3 (consolidation from 40+ types to 7 canonical)

| Consumer | File | How It Uses Edge Types |
|----------|------|----------------------|
| RelatedEdgesPanel | `taxonomy-editor/src/renderer/components/RelatedEdgesPanel.tsx` | Renders edge type as colored badge, filters by type |
| EdgeDetailPanel | `taxonomy-editor/src/renderer/components/EdgeDetailPanel.tsx` | Displays edge type in detail view |
| EdgeBrowser | `taxonomy-editor/src/renderer/components/EdgeBrowser.tsx` | Search/sort/filter by edge type; type dropdown |
| edge_types definitions | `taxonomy/Origin/edges.json` (lines 5–266) | Defines all valid types with metadata |
| Invoke-EdgeDiscovery | `scripts/AITriad/Prompts/edge-discovery.prompt` | Lists valid types for AI to assign |
| edge-discovery-schema | `scripts/AITriad/Prompts/edge-discovery-schema.prompt` | Schema includes type enum |
| potentialEdges | `summary-viewer/src/renderer/prompts/potentialEdges.ts` | Lists edge types for LLM proposals |
| Find-Conflict | `scripts/AITriad/Public/Find-Conflict.ps1` | Uses edges for conflict chain detection |
| Get-TaxonomyHealth | `scripts/AITriad/Public/Get-TaxonomyHealth.ps1` | Counts edge types for coverage metrics |

**Risk:** This is the highest-blast-radius change. Every file above has hardcoded type strings. Phase 3 requires updating ALL of them atomically — partial migration leaves the system in an inconsistent state.

### Data Element: `steelman_vulnerability`

Changed by: Phase 5 (string → object with per-POV keys)

| Consumer | File | How It Uses It |
|----------|------|---------------|
| NodeDetail content tab | `taxonomy-editor/src/renderer/components/NodeDetail.tsx` | Renders as text in Content tab |
| GraphAttributesPanel | `taxonomy-editor/src/renderer/components/GraphAttributesPanel.tsx` | Displays in attributes view |
| Debate prompts | `taxonomy-editor/src/renderer/prompts/debate.ts` | May feed to debate agents as vulnerability context |
| Analysis prompts | `taxonomy-editor/src/renderer/prompts/analysis.ts` | Used in AI analysis |
| SimilarResultsPane | `summary-viewer/src/renderer/components/SimilarResultsPane.tsx` | Displays in expanded node details |
| TypeScript type | `taxonomy-editor/src/renderer/types/taxonomy.ts` | `steelman_vulnerability?: string` type definition |

**Risk:** Changing from `string` to `{ from_accelerationist, from_safetyist, from_skeptic }` is a breaking type change. Every renderer that does `node.graph_attributes.steelman_vulnerability` and expects a string will show `[object Object]` or crash. TypeScript type definitions, renderer components, and prompt templates must all update simultaneously.

### Data Element: `possible_fallacies`

Changed by: Phase 5 (add `type` field to each fallacy entry)

| Consumer | File | How It Uses It |
|----------|------|---------------|
| GraphAttributesPanel | `taxonomy-editor/src/renderer/components/GraphAttributesPanel.tsx` | Renders fallacy badges |
| FallacyPanel | `taxonomy-editor/src/renderer/components/FallacyPanel.tsx` | Dedicated fallacy display |
| fallacyInfo | `taxonomy-editor/src/renderer/data/fallacyInfo.ts` | Fallacy metadata/descriptions |
| AttributeFilterPanel | `taxonomy-editor/src/renderer/components/AttributeFilterPanel.tsx` | Filter nodes by fallacy type |

**Risk:** Low — adding a new field (`type`) to existing objects is additive. Consumers that don't know about `type` will ignore it. But to realize the value (filtering by fallacy tier), UI components need updating.

### Data Element: `factual_claims` (temporal fields)

Changed by: Phase 5 (add `temporal_scope`, `temporal_bound`)

| Consumer | File | How It Uses It |
|----------|------|---------------|
| KeyPointsPane | `summary-viewer/src/renderer/components/KeyPointsPane.tsx` | Displays factual claims |
| Find-Conflict | `scripts/AITriad/Public/Find-Conflict.ps1` | Processes claims for conflict detection |
| Invoke-POVSummary | `scripts/AITriad/Public/Invoke-POVSummary.ps1` | Writes claims to summary files |
| pov-summary-schema | `scripts/AITriad/Prompts/pov-summary-schema.prompt` | Defines claim structure |

**Risk:** Low for new summaries (schema is additive). Backfilling 118 existing summary files with retroactive temporal classification is error-prone — the AI is classifying claims it didn't extract, without access to the original document context.

### Data Element: Cross-cutting `disagreement_type`

Changed by: Phase 4 (new field on CC nodes)

| Consumer | File | How It Uses It |
|----------|------|---------------|
| CrossCuttingDetail | `taxonomy-editor/src/renderer/components/CrossCuttingDetail.tsx` | Should display it (new UI needed) |
| cross-cutting-candidates | `scripts/AITriad/Prompts/cross-cutting-candidates.prompt` | Produces it |
| Debate synthesis | `scripts/AITriad/Prompts/triad-dialogue-synthesis.prompt` | Classifies disputes |

**Risk:** Low — purely additive field.

### Data Element: `ontological_level`

Changed by: Phase 2 (new field in graph_attributes)

| Consumer | File | How It Uses It |
|----------|------|---------------|
| GraphAttributesPanel | `taxonomy-editor/src/renderer/components/GraphAttributesPanel.tsx` | Should display it (new UI needed) |
| attribute-extraction | `scripts/AITriad/Prompts/attribute-extraction.prompt` | Produces it |
| Edge discovery | `scripts/AITriad/Prompts/edge-discovery.prompt` | Phase 3 uses it for CONTRADICTS constraints |

**Risk:** Low — additive field. But Phase 3 depends on it being populated accurately, creating an ordering dependency.

---

## Recommendations

The 10 recommendations below are ordered by expected impact on output quality. Each identifies the BFO principle, affected prompts, the proposed change, and the risks specific to this project.

### 1. Enforce Genus-Differentia Definitions for All Nodes

**BFO Principle:** Every class must be defined by its genus (parent class) and differentia (distinguishing characteristics from siblings).

**Current Problem:** Descriptions are narrative paragraphs that tell readers what a node is *about*, not what *kind of thing* it is or what *distinguishes* it from neighbors. This causes node overlap, ambiguous mapping, and false MERGE proposals.

**Affected Prompts:**
- `TaxonomyRefiner.md` — replace description instruction with genus-differentia template
- `pov-summary-system.prompt` — add genus-differentia rule for `suggested_description`
- `taxonomy-proposal.prompt` — add genus-differentia rule for NEW/RELABEL descriptions
- `ai-triad-analysis-prompt.md` — add genus-differentia rule for Part 2

**Proposed Change:**

In `TaxonomyRefiner.md`, replace the current description instruction with:

```
Genus-Differentia Description (3-6 Sentences):
  Sentence 1 MUST follow this pattern: "A [category] within [POV] discourse
  that [differentia]." The differentia must state what distinguishes this node
  from its siblings under the same parent and within the same category.

  Sentences 2-3: Specify the necessary conditions for a passage to be classified
  under this node. What MUST be present in a text for this node to apply?

  Sentences 4-5: Specify the exclusion boundary. Name the closest neighboring
  node(s) and state the specific criterion that separates this node from each.

  Sentence 6 (optional): Note any edge cases or borderline situations.

  IMPORTANT: Write for a policy reporter or congressional staffer — active voice, named actors, one idea per sentence, concrete examples over abstractions. Every sentence quotable without rewriting. No nominalizations, no hedge stacking. Technical terms fine when load-bearing; define on first use. The genus-differentia structure should be clear but the language should remain conversational.

  Example:
    BEFORE: "The best way to make AI smarter is to give it more computing
    power and data, without limits."
    AFTER: "A goal within accelerationist discourse that advocates removing
    constraints on compute and data scaling as the primary path to AI capability
    gains. Applies when a text argues that scaling laws are reliable, resource
    caps are counterproductive, or compute access should be expanded. Excludes
    arguments about architectural innovation (acc-intentions-X) or open-source
    access (acc-desires-003), which concern HOW capabilities are distributed
    rather than WHETHER to scale."
```

In `pov-summary-system.prompt`, add to unmapped concept instructions:

```
  • suggested_description MUST begin with: "A Belief | A Desire |
    An Intention" [position | claim | approach] within [POV] discourse
    that..." followed by the distinguishing characteristic. Then state what
    must be present in a text for this concept to apply and what the nearest
    existing node is and why this concept is distinct from it.
```

**Style Risk:** The "write for a policy reporter" convention and newspaper-headline style must be preserved. Genus-differentia structure should organize the content but not make it read like a textbook. The example above demonstrates this balance. Validate with the prompt: "Could a reporter quote this sentence without rewriting it?"

**Measurement:** Compare `descriptions.genus_differentia_pct` (currently 5.8%), `node_mapping.category_inconsistencies` (currently 14), and `node_mapping.unreferenced_node_count` (currently 294) before and after.

---

### 2. Distinguish Universals from Particulars in Node Classification

**BFO Principle:** BFO draws a hard line between universals (types/classes) and particulars (specific instances).

**Current Problem:** The taxonomy intermixes class-level nodes ("Preventing AI Global Catastrophe") with instance-level nodes ("RLHF reliably prevents deceptive alignment") without distinguishing them. This causes `falsifiability` to be assigned uniformly, CONTRADICTS edges between nodes at different generality levels, and inconsistent granularity in taxonomy proposals.

**Affected Prompts:**
- `attribute-extraction.prompt` — add `ontological_level` as required attribute
- `edge-discovery.prompt` — add ontological constraint on CONTRADICTS (Phase 3 dependency)
- `taxonomy-proposal.prompt` — add ontological level guidance for NEW nodes

**Proposed Change:**

In `attribute-extraction.prompt`, add:

```
  ontological_level (required, string -- pick ONE):
    "universal" -- this node defines a CLASS of claims, positions, or approaches.
      Multiple distinct arguments from different documents can be instances of it.
      Example: "Preventing AI Global Catastrophe" is a universal.
    "particular" -- this node states a SPECIFIC claim, prediction, or policy
      proposal. It is a single assertion, not a category.
      Example: "AGI will arrive by 2030" is a particular.
    "bridging" -- this node defines a class but is narrow enough that it is
      approaching a single claim. Flag for potential split or reclassification.
```

**Risk:** The `bridging` category may become a dumping ground. After Phase 2, check: if >15% of nodes get `bridging`, the distinction isn't working and the definition needs sharpening.

**Measurement:** Cross-check after population: nodes with `ontological_level: "particular"` should have `falsifiability: "high"` or `"medium"`; `universal` nodes should rarely be `"high"`. Disagreement rate indicates classification quality.

---

### 3. Sub-Category Disambiguation for Goals/Data/Methods

**BFO Principle:** BFO partitions dependent continuants into qualities, dispositions, and roles. The Goals/Data/Methods triaxis conflates sub-types within each.

**Current Problem:** "Intentions" conflates policy mechanisms (things people DO) with reasoning frameworks (things people SAY). "Desires" conflates terminal values with instrumental goals. "Beliefs" conflates observations, predictions, and consensus claims. This causes the most common inter-run classification disagreements.

**Affected Prompts:**
- `pov-summary-system.prompt` — add CATEGORY DISAMBIGUATION block
- `TaxonomyRefiner.md` — add same disambiguation section

**Proposed Change:**

Add after category definitions in `pov-summary-system.prompt`:

```
  CATEGORY DISAMBIGUATION (apply when a passage could fit multiple categories):

  Desires splits into:
    - Terminal values: desired end-states valued for their own sake.
      TEST: "Would this camp want this even if it didn't lead to anything else?"
    - Instrumental goals: desired states valued as means to terminal values.
      TEST: "Does this camp want this BECAUSE it leads to something else?"

  Beliefs splits into:
    - Empirical observations: measured, documented phenomena with citations
    - Predictions: forecasts about future states
    - Consensus claims: positions attributed to expert communities

  Intentions splits into:
    - Policy mechanisms: concrete interventions with implementers and targets.
      TEST: "Could this be written into a bill or regulation?"
    - Reasoning frameworks: interpretive lenses, analogies, or argumentative
      structures. TEST: "Is this a way of THINKING about the issue rather
      than a way of ACTING on it?"

  When assigning category, use these sub-categories to resolve ambiguity.
  Record the sub-category in the "category" field using the format
  "Intentions" (parent) -- the sub-category aids your classification
  but does not change the schema.
```

**Risk:** This is prompt-only guidance with no schema field to capture it. The AI may apply it inconsistently since there's no structured output to enforce it. Consider adding an optional `sub_category` field to key_points in a future iteration if measurement shows improvement.

**Measurement:** Compare `node_mapping.category_inconsistencies` (currently 14) before and after.

---

### 4. Formalize Relation Semantics in Edge Discovery

**BFO Principle:** The OBO Relation Ontology defines relations with domain/range constraints, transitivity, symmetry, and formal definitions.

**Current Problem:** Edge types lack formal constraints. Desires nodes SUPPORTS Beliefs nodes (138 domain violations). CONTRADICTS is used between universals (should be TENSION_WITH). 40+ custom types exist beyond the 7 canonical types. SUPPORTED_BY is a redundant inverse of SUPPORTS.

**Affected Prompts:**
- `edge-discovery.prompt` — replace type definitions with formally constrained versions
- `edge-discovery-schema.prompt` — update to match reduced vocabulary
- `summary-viewer/src/renderer/prompts/potentialEdges.ts` — align edge types

**Proposed Change:**

Replace edge type definitions with formally constrained 7-type vocabulary:

```
EDGE TYPE VOCABULARY (with formal constraints):

  SUPPORTS (directional: source -> target)
    Domain: Beliefs or Intentions nodes
    Range:  any node
    Definition: The source provides empirical evidence, logical reasoning,
    or methodological justification that increases confidence in the target.
    NOT for: values endorsing other values (use ASSUMES or TENSION_WITH).
    Transitivity: NOT transitive.

  CONTRADICTS (bidirectional)
    Domain: nodes at the same ontological level (both universals or both
    particulars) AND within the same or comparable categories
    Range:  same constraints as domain
    Definition: Accepting the source as true requires rejecting the target.
    Test: "Is there a possible world where both are true?" If yes, use
    TENSION_WITH instead.
    Transitivity: NOT transitive.

  ASSUMES (directional: source -> target)
    Domain: any node
    Range:  any node
    Definition: The source's claim LOGICALLY DEPENDS on the target being true.
    Test: "Does denying the target make the source incoherent?"
    Transitivity: YES -- only propose direct assumptions.

  WEAKENS (directional: source -> target)
    Domain: Beliefs or Intentions nodes
    Range:  any node
    Definition: The source reduces confidence in the target WITHOUT making
    it logically impossible.
    Boundary with CONTRADICTS: if the source is true, could the target
    STILL be true? If yes -> WEAKENS. If no -> CONTRADICTS.

  RESPONDS_TO (directional: source -> target)
    Domain: any node
    Range:  any node
    Definition: The source was formulated as a REACTION to the target.
    NOTE: RESPONDS_TO is about provenance, not logic. Also consider
    a companion SUPPORTS/CONTRADICTS/WEAKENS edge.

  TENSION_WITH (bidirectional)
    Domain: any node
    Range:  any node
    Definition: The source and target pull in different directions but
    are not logically incompatible.

  INTERPRETS (directional: source -> target)
    Domain: POV-specific nodes (acc-, saf-, skp-)
    Range:  Cross-cutting nodes (cc-) only
    Definition: The source provides a POV-specific reading of the target.
```

Remove CITES (document-level, not semantic) and SUPPORTED_BY (redundant inverse).

**Edge type consolidation mapping for existing edges:**

| Custom Type | -> Canonical Type | Rationale |
|-------------|-----------------|-----------|
| REITERATES | SUPPORTS | Restating is supporting |
| COMPLEMENTS | SUPPORTS | Complementary is mutually supporting |
| VALIDATES_ARGUMENT_WITHIN | SUPPORTS | Validation is evidence |
| HIGHLIGHTS_VULNERABILITY_TO | WEAKENS | Exposing vulnerability weakens |
| POSES_PROBLEM_FOR | WEAKENS | Posing a problem reduces confidence |
| EXACERBATES | WEAKENS | Making worse weakens position |
| IS_A_POSITION_WITHIN | ASSUMES | Being a position within implies dependence |
| ENABLES | SUPPORTS | Enabling provides basis for |
| CAUSES | SUPPORTS | Causal link is evidentiary |
| EXPLAINS | SUPPORTS | Explanation provides reasoning |
| *(others)* | *(AI triage)* | Review remaining custom types individually |

**CRITICAL RISK:** This is the highest-blast-radius change. See the Consumer Audit "Edge Types" section above — 9+ files with hardcoded type strings must all update atomically. A partial migration leaves the system inconsistent.

**Measurement:** Compare `edges.non_canonical_type_count` (currently 771), `edges.goals_supports_data` (currently 138), and `edges.orphan_edges` (currently 787) before and after.

---

### 5. Cross-Cutting Disagreement Type Declarations

**BFO Principle:** BFO distinguishes qualities, dispositions, and roles. Cross-cutting concepts represent different kinds of disagreement that should be classified.

**Current Problem:** Cross-cutting concepts conflate contested terms (definitional disagreement), shared phenomena with contested interpretations (interpretive disagreement), and structural tensions (inherent trade-offs). The prompts treat all three identically.

**Affected Prompts:**
- `cross-cutting-candidates.prompt` — add `disagreement_type` classification
- `cross-cutting-candidates-schema.prompt` — add field
- `triad-dialogue-synthesis.prompt` — add dispute classification

**Proposed Change:**

```
  disagreement_type (required, string -- pick ONE):

    "definitional" -- The POVs disagree about what this WORD MEANS.
      Test: "Do the POVs disagree about the referent of this term?"
      Examples: "safety", "harm", "alignment", "fairness"

    "interpretive" -- The POVs agree on what exists but disagree about
      its SIGNIFICANCE, implications, or appropriate response.
      Test: "Do the POVs agree this thing exists but disagree about
      what to do about it?"
      Examples: "scaling laws", "AI labor displacement"

    "structural" -- The concept names an inherent TENSION or trade-off
      that every POV must navigate.
      Test: "Is this a dilemma rather than a position?"
      Examples: "innovation vs. precaution", "openness vs. security"
```

In `triad-dialogue-synthesis.prompt`, classify each area of disagreement as definitional (resolvable by clarifying terms), empirical (resolvable by evidence), evaluative (negotiable via value trade-offs), or structural (persistent).

**Risk:** Low — additive field, no breaking changes.

**Measurement:** After population, verify distribution is not dominated by one type (would indicate the distinction isn't being applied).

---

### 6. Mereological Constraints for Parent-Child Relationships

**BFO Principle:** BFO distinguishes is_a (subsumption), part_of (parthood), and specialization.

**Current Problem:** `parent_id`/`children` structure doesn't specify the relationship type. In practice it's used for subsumption, decomposition, and elaboration interchangeably.

**Affected Prompts:**
- `taxonomy-proposal.prompt` — add relationship type for SPLIT actions
- `TaxonomyRefiner.md` — node calibration
- `attribute-extraction.prompt` — attribute inheritance rules

**Proposed Change:**

For SPLIT proposals, specify relationship type:

```
  "is_a" -- Every child is a more specific version of the parent.
    Test: "Is [child label] a kind of [parent label]?"

  "part_of" -- The children are components or aspects of the parent.
    Test: "Is [child label] a part of [parent label]?"

  "specializes" -- The children are concrete instances or applications.
    Test: "Is [child label] a specific way to implement [parent label]?"
```

Add inheritance rule: is_a hierarchies inherit parent attributes; part_of hierarchies may not.

**Risk:** Medium — requires auditing all existing parent-child relationships. Many may be ambiguous.

---

### 7. Separate Discourse-Level from Domain-Level Ontological Claims

**BFO Principle:** Distinction between domain ontology (representing subject matter) and discourse ontology (representing arguments and positions about the subject).

**Current Problem:** The taxonomy models what people *say* about AI policy, but prompts don't make this explicit. The AI sometimes confuses positions (discourse-level) with facts (domain-level), leading to category errors in `falsifiability` and CONTRADICTS edge assignment.

**Affected Prompts:**
- `pov-summary-system.prompt` — add ONTOLOGICAL FRAMING block
- `attribute-extraction.prompt` — reframe `falsifiability` to discourse-aware

**Proposed Change:**

Add to `pov-summary-system.prompt`:

```
ONTOLOGICAL FRAMING:
  You are mapping DISCOURSE -- what people argue, claim, and advocate -- not
  the world itself. A taxonomy node represents a POSITION held by a community
  of thinkers, not a fact about reality.

  This means:
  - When you assign a key_point to a node, you are saying "this passage
    expresses this discursive position," not "this passage proves this true."
  - When you flag a factual_claim, you identify a domain-level assertion
    EMBEDDED within a discursive position.
  - When you identify an unmapped_concept, you discover a NEW discursive
    position, not a new fact about AI.
```

Reframe `falsifiability` in `attribute-extraction.prompt`:

```
  falsifiability: How testable are the EMPIRICAL CLAIMS EMBEDDED in this
  discursive position?
    "high" -- specific, falsifiable predictions that could be disproven
    "medium" -- some testable elements plus value judgments or long horizons
    "low" -- primarily normative, definitional, or resistant to testing
  Note: this describes TESTABILITY of factual content, not "truth" of the
  position. A value-laden position with "low" falsifiability is not inferior.
```

**Risk:** Low — framing change, no schema impact.

---

### 8. Temporal Qualifiers for Factual Claims

**BFO Principle:** Every assertion about a continuant should be indexed to a time or time interval.

**Current Problem:** `factual_claims` have no temporal indexing. Stale claims persist without expiration signals. Predictions lack temporal bounds. Conflict detection can't distinguish temporal disagreement from genuine contradiction.

**Affected Prompts:**
- `pov-summary-system.prompt` — add `temporal_scope` and `temporal_bound` to factual_claims
- `pov-summary-schema.prompt` — update schema

**Proposed Change:**

```
  For each factual_claim, also provide:
    "temporal_scope" (required): "current_state" | "historical" | "predictive" | "timeless"
    "temporal_bound" (optional): explicit time reference, e.g. "by 2030", "since GPT-4"
```

**Risk:** Low for new summaries. Backfilling existing summaries is error-prone (AI classifies without document context). Recommend: add to prompts now, backfill only when documents are re-summarized.

**Measurement:** Compare `conflicts.single_instance_pct` (currently 92.2%) after temporal-aware conflict detection is enabled — temporal filtering should reduce false single-instance conflicts.

---

### 9. Structured Fallacy Taxonomy

**BFO Principle:** Dispositions (like fallacious reasoning patterns) become actual only under triggering conditions.

**Current Problem:** 48+ fallacy keys listed as flat vocabulary. No distinction between structural fallacies (always invalid) and contextual fallacies (invalid only in certain contexts). Cognitive biases (properties of reasoners) conflated with fallacies (properties of arguments).

**Affected Prompts:**
- `fallacy-analysis.prompt` — restructure into 4 tiers
- `attribute-extraction.prompt` — add `type` to `possible_fallacies` entries

**Proposed Change:**

```
FALLACY CLASSIFICATION — determine TYPE before assigning:

  1. FORMAL (argument structure is invalid — always a fallacy):
     affirming_the_consequent, denying_the_antecedent, etc.

  2. INFORMAL-STRUCTURAL (reasoning pattern is problematic regardless of context):
     circular_reasoning, false_dilemma, straw_man, etc.
     Flag with confidence "likely" when clearly present.

  3. INFORMAL-CONTEXTUAL (problematic ONLY in certain contexts):
     appeal_to_authority (fallacious only if authority is irrelevant),
     slippery_slope (fallacious only if mechanism is unsubstantiated), etc.
     Flag with confidence "possible" and ALWAYS explain WHY the context
     makes it fallacious rather than legitimate.

  4. COGNITIVE BIASES (properties of REASONERS, not arguments):
     Flag only when the TEXT EXHIBITS SYMPTOMS of the bias, not when the
     author might privately hold it.
```

**Risk:** Low — adds a `type` field to existing `possible_fallacies` entries. Additive.

**Measurement:** Compare `fallacies.flagging_rate_pct` (currently 53%), `fallacies.confidence_likely` (currently 137), and total flags (currently 395) after reprocessing with structured tiers.

---

### 10. Perspectival Steelman Vulnerabilities

**BFO Principle:** BFO treats roles as perspective-relative. The same entity bears different vulnerabilities from different relational contexts.

**Current Problem:** `steelman_vulnerability` is a single string. The strongest counterargument depends on which POV is attacking.

**Affected Prompts:**
- `attribute-extraction.prompt` — change from string to per-POV object

**Proposed Change:**

```
  steelman_vulnerability (required, object):
    "from_accelerationist": 1-2 sentences (omit if source IS accelerationist)
    "from_safetyist": 1-2 sentences (omit if source IS safetyist)
    "from_skeptic": 1-2 sentences (omit if source IS skeptic)
    For cross-cutting nodes, provide all three.
```

**BREAKING CHANGE:** `steelman_vulnerability` changes from `string` to `object`. See Consumer Audit above — every component rendering this field must update simultaneously.

**Measurement:** Qualitative — debate tool output should show more targeted counterarguments.

---

## Implementation Plan

### Guiding Principles

1. **Measure first.** Run `Measure-TaxonomyBaseline` before and after each phase. If a metric doesn't improve, investigate before proceeding.
2. **Prompt changes before data migration.** Update prompts so new AI runs produce the improved output. Let existing data update organically through re-summarization rather than batch backfilling, except where the backfill is cheap and reliable.
3. **Consumer updates before data changes.** For breaking changes (edge types, steelman_vulnerability), update all consumer code first with backward-compatible handlers, then migrate data.
4. **Phase gates.** Each phase has explicit validation criteria. Do not proceed to the next phase until the current phase passes its gate.
5. **Rollback tags.** Tag both repos before each phase: `pre-bfo-phase-N`.

### Phase 0 — Observability (DONE)

**Deliverable:** `Measure-TaxonomyBaseline` cmdlet and `docs/baseline-2026-03-28.json`.

**Validation gate:** Cmdlet runs without errors and produces JSON with all 7 metric sections populated.

---

### Phase 1 — Genus-Differentia Definitions (#1) + Discourse Framing (#7)

**Why first:** Every downstream phase benefits from sharper descriptions and the discourse/domain distinction.

**Prompt changes (code repo):**
- `TaxonomyRefiner.md` — replace description instruction with genus-differentia template
- `pov-summary-system.prompt` — add genus-differentia rule for `suggested_description` + ONTOLOGICAL FRAMING block
- `taxonomy-proposal.prompt` — add genus-differentia rule for NEW/RELABEL
- `ai-triad-analysis-prompt.md` — add genus-differentia rule for Part 2
- `attribute-extraction.prompt` — reframe `falsifiability` to discourse-aware version

**Data migration:**

| Asset | Change | Method |
|-------|--------|--------|
| POV node descriptions (4 files) | Rewrite every `description` to genus-differentia form | Batch AI: feed each node + siblings + parent; human review before commit |
| CC node descriptions | Same rewrite (genus = "cross-cutting concept") | Same batch pass |
| `falsifiability` values | Re-evaluate under discourse-aware definition | Batch AI re-extraction of `falsifiability` only; diff review |

**Estimated scope:** ~450 node descriptions. Run in batches of 20-30 with human spot-checks.

**Post-migration:**
- Run `Update-TaxEmbeddings` to regenerate similarity space from new descriptions
- Spot-check 10 similar-search queries in taxonomy-editor — verify results still make sense
- Re-run `Measure-TaxonomyBaseline`

**Validation gate:**
- `descriptions.genus_differentia_pct` > 90%
- `node_mapping.category_inconsistencies` <= current (14) — must not regress
- No renderer displays broken (manual spot-check of NodeDetail, SimilarResultsPane, debate output)

**Rollback:** `git checkout pre-bfo-phase-1` in both repos + `Update-TaxEmbeddings`.

---

### Phase 2 — Sub-Categories (#3) + Universal/Particular (#2) — PROMPT ONLY

**Why prompt-only:** These changes add guidance and an optional field. The value comes from improved future output, not from backfilling existing data. Avoid the cost and error risk of retroactive classification.

**Prompt changes (code repo):**
- `pov-summary-system.prompt` — add CATEGORY DISAMBIGUATION block
- `TaxonomyRefiner.md` — add same disambiguation
- `attribute-extraction.prompt` — add `ontological_level` as optional attribute
- `taxonomy-proposal.prompt` — add ontological level guidance for NEW nodes

**Schema update:** Add `ontological_level` to `pov-taxonomy.schema.json` as optional enum in `graph_attributes`. Backward-compatible.

**NO data migration.** The field populates organically when:
- `Invoke-AttributeExtraction` is run on nodes
- New nodes are proposed via `Invoke-TaxonomyProposal`
- Documents are re-summarized after `TAXONOMY_VERSION` bump

**Validation gate:**
- Prompts updated and pass manual dry-run review
- Schema validates with new optional field
- Next 5 `Invoke-AttributeExtraction` runs produce `ontological_level` values
- `bridging` assignment rate < 15%

---

### Phase 3 — Edge Semantics Overhaul (#4) — DEFERRED

**Why deferred:** This is the highest-risk, highest-effort change with the most consumers. It requires Phase 2's `ontological_level` to be populated (for CONTRADICTS constraints) and should only be undertaken when there's evidence that edge type noise is causing user-facing problems.

**Prerequisites before starting:**
- Phase 2 `ontological_level` populated on >80% of nodes
- `Measure-TaxonomyBaseline` run showing current edge quality numbers
- Complete consumer update plan written (all 9+ files listed in Consumer Audit)
- Integration test: script that loads taxonomy, renders node detail, queries edges, runs similarity search — asserts all produce valid output

**When ready, execution order:**
1. Update ALL consumer code first with backward-compatible handlers (accept both old and new type strings)
2. Update edge type definitions in `edges.json` header
3. Run bulk type consolidation script (mapping table above)
4. Run CONTRADICTS → TENSION_WITH reclassification (AI batch with possible-world test)
5. Remove CITES and SUPPORTED_BY edges (archive to `_archived_edges.json`)
6. Run domain/range validation script, queue violations for AI re-evaluation
7. Update prompts to use 7-type vocabulary
8. Remove backward-compat handlers from consumer code
9. Re-run `Measure-TaxonomyBaseline`

**Validation gate:**
- All edges have one of 7 canonical types
- No domain/range violations
- CONTRADICTS edges only connect nodes at same ontological level
- INTERPRETS edges only target `cc-*` nodes
- All consumer UIs render correctly (manual spot-check)
- `edges.non_canonical_type_count` = 0
- `edges.orphan_edges` = 0
- `edges.goals_supports_data` = 0

---

### Phase 4 — Cross-Cutting Enrichment (#5) + Parent-Child Audit (#6)

**Prompt changes (code repo):**
- `cross-cutting-candidates.prompt` — add `disagreement_type` classification
- `cross-cutting-candidates-schema.prompt` — add field
- `triad-dialogue-synthesis.prompt` — add dispute classification
- `taxonomy-proposal.prompt` — add relationship type for SPLIT actions

**Data migration (low-risk):**

| Asset | Change | Method |
|-------|--------|--------|
| CC nodes `disagreement_type` | New field | Batch AI classification using `interpretations` object |
| Parent-child `relationship_type` | Fill in on nodes with `parent_id` | AI classification using tests from #6 |

**Consumer update:**
- `CrossCuttingDetail.tsx` — add `disagreement_type` display (badge in overview tab)

**Validation gate:**
- Every CC node has `disagreement_type`
- Every node with `parent_id` has `relationship_type`
- Distribution is not dominated by one type

---

### Phase 5 — Temporal (#8) + Fallacy Structure (#9) + Perspectival Steelman (#10)

These three changes are independent and can be parallelized.

**5a: Temporal qualifiers — PROMPT ONLY (no backfill)**

- Update `pov-summary-system.prompt` and `pov-summary-schema.prompt` with `temporal_scope` and `temporal_bound`
- New summaries get temporal fields automatically
- Existing summaries gain them when re-summarized (triggered by `TAXONOMY_VERSION` bump)

**5b: Fallacy structure — PROMPT + LOW-RISK BACKFILL**

- Update `fallacy-analysis.prompt` and `attribute-extraction.prompt` with 4-tier structure
- Backfill `type` field on existing `possible_fallacies` entries via lookup table (no AI needed — map each `fallacy` key to its tier)

**5c: Perspectival steelman — BREAKING CHANGE, REQUIRES CONSUMER UPDATE FIRST**

Execution order:
1. Update TypeScript type: `steelman_vulnerability?: string | { from_accelerationist?: string; from_safetyist?: string; from_skeptic?: string }`
2. Update ALL consumers to handle BOTH formats (check `typeof value === 'string'`)
3. Run batch AI pass to generate per-POV steelmans for all nodes
4. Migrate existing string values: use as "best match" POV steelman, generate remaining two
5. After migration complete: remove backward-compat string handling, tighten type to object-only

**Validation gate:**
- No summary has a factual_claim without `temporal_scope` (for newly processed docs only)
- All `possible_fallacies` entries have a `type`
- `steelman_vulnerability` is an object on all POV nodes and a 3-key object on all CC nodes
- No renderer crashes or shows `[object Object]`

---

## Cross-Cutting Concerns

### Batch AI Processing Strategy

- Use `gemini-3.1-flash-lite-preview` for classification tasks (ontological_level, disagreement_type, temporal_scope, fallacy_type) — cheap, fast, sufficient
- Use `gemini-2.5-flash` or `claude-sonnet-4-6` for generative tasks (description rewrites, steelman generation, edge reclassification) — quality matters
- All batch outputs go through diff review before committing to `ai-triad-data`

### Backward Compatibility

- All new fields are added as OPTIONAL first, then made required after backfill
- Schema versions: `1.0.0` → `1.1.0` (Phase 1-2), → `1.2.0` (Phase 4-5)
- Phase 3 (if executed): `2.0.0` (breaking edge type change)
- `TAXONOMY_VERSION` bump after Phase 1 triggers CI re-summarization with updated prompts

### Rollback Strategy

- Each phase commits to `ai-triad-data` as a separate branch/PR
- Pre-migration snapshots tagged: `pre-bfo-phase-N`
- Phase 3 edge migration gets `_archived_edges.json` with original types
- Rollback procedure: revert both repos to tagged state + `Update-TaxEmbeddings`

### Integration Testing

Before Phase 1 and after each phase, run this validation checklist:

1. `Import-Module AITriad -Force` — module loads without errors
2. `Get-Tax | Select -First 5` — nodes render with descriptions
3. `Get-Tax -Id acc-desires-001 | Format-List` — single node detail works
4. `Measure-TaxonomyBaseline` — all metrics computed without errors
5. `Invoke-POVSummary -DocId <sample> -DryRun` — prompt assembly works
6. Start taxonomy-editor — NodeDetail renders, Sources tab loads, Related tab shows edges
7. Start summary-viewer — documents list, similarity search works, potential edges work

### Progress Tracking

After each phase, update this table:

| Phase | Status | Baseline Pre | Baseline Post | Key Delta | Notes |
|-------|--------|-------------|---------------|-----------|-------|
| 0 | DONE | baseline-2026-03-28.json | — | — | Cmdlet created |
| 1 | NOT STARTED | | | genus_differentia_pct: 5.8% → ? | |
| 2 | NOT STARTED | | | prompt-only, no migration | |
| 3 | DEFERRED | | | Requires Phase 2 completion | |
| 4 | NOT STARTED | | | | |
| 5a | NOT STARTED | | | prompt-only, no migration | |
| 5b | NOT STARTED | | | lookup-table backfill | |
| 5c | NOT STARTED | | | breaking change | |
