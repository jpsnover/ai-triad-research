# POV Summary Prompt Review: Synthesis of Three External Critiques

**Ticket:** t/529
**Reviewer:** Computational Linguist
**Date:** 2026-06-09
**Prompt under review:** `scripts/AITriad/Prompts/pov-summary-system.prompt` (291 lines)
**Chunked variant:** `scripts/AITriad/Prompts/pov-summary-chunk-system.prompt` (105 lines)

## Executive Summary

Three independent reviewers analyzed our primary extraction prompt. Despite different analytical frameworks (information extraction theory, ontology engineering, computational linguistics), they converge on the same structural diagnosis: **the prompt fuses extraction, classification, and interpretation into a single generation pass, creating internal contradictions that degrade quality invisibly.**

The highest-leverage changes are:
1. Replace per-cell output floors with effort-floors plus licensed emptiness
2. Add a `canonical_proposition` field written in the taxonomy's own register
3. Define salience explicitly relative to the BDI frame
4. Allow non-contiguous verbatim spans

## Recommendations

### REC-1: Replace Output Floors with Effort Floors (CRITICAL)

**Problem:** The non-negotiable minimums (`KP_MIN` per camp, `FC_MIN`, `UC_MIN`) at lines 33-61 conflict with the anti-fabrication rule at lines 52-58. All three reviewers identify this as the #1 structural defect. When a document genuinely contains zero accelerationist intentions, the model fabricates to avoid rejection. The damage is concentrated in the 3×3 BDI grid — nine cells that every document must fill regardless of content.

**Evidence:** Reviewer 3 frames this precisely: "never set a per-cell floor on a quantity the document doesn't control." The floor is a strong, checkable, punitive instruction; anti-fabrication is a soft instruction with no enforcement mechanism. Under pressure, the floor wins every time.

**Proposed change:**

Replace lines 33-61 with:

```
REQUIRED EXTRACTION EFFORT (hard constraints):
  This document is approximately {{WORD_COUNT}} words.

  EFFORT REQUIREMENTS (non-negotiable):
    • Examine ALL nine BDI cells (3 POV camps × 3 categories) for every document.
    • For each cell, extract every distinct point the document actually contains.
    • If a cell is genuinely empty (the document does not engage this frame),
      report it explicitly:
        "empty_cells": [
          {"camp": "accelerationist", "category": "Intentions",
           "reason": "Document is a technical safety paper; no accelerationist
           policy proposals or strategic arguments are present."}
        ]
    • factual_claims: count every statistic, study result, historical assertion,
      date-specific prediction, and quantitative comparison. Each is a separate
      factual_claim.
    • unmapped_concepts: search all four taxonomy files before declaring any
      concept unmapped. Target: {{UC_MIN}}-{{UC_MAX}}.

  DENSITY GUIDANCE (targets, not floors):
    • key_points: target {{KP_MIN}}-{{KP_MAX}} per camp for a {{WORD_COUNT}}-word
      document. Longer documents should yield more points. But a document that
      yields 2 accelerationist key points and 12 safetyist key points is CORRECT
      if that reflects the document's actual content.
    • If total extraction across all camps falls below {{TOTAL_FLOOR}}, re-examine
      the document — you may have missed salient content.

  ANTI-FABRICATION RULE: Every key_point and factual_claim MUST be traceable to
  specific text in the document. Do NOT pad to hit targets. An honest extraction
  of 3 points beats a fabricated extraction of 7. Accuracy > quantity, always.

  SELF-CHECK: Count your extractions. If any camp has zero points AND you did not
  report an empty_cell with a reason, go back and look again.
```

**Blast radius:** `pov-summary-system.prompt` lines 33-61, `pov-summary-chunk-system.prompt` lines 33-39 (chunk variant already uses softer "QUANTITY GUIDANCE" language — less affected). Downstream merge logic in PowerShell must handle `empty_cells` array. Density floor validation in the extraction pipeline must be updated to accept intentional empties.

**Feasibility:** High. The change is prompt-only plus minor schema addition. No model change needed.

**Priority:** CRITICAL — this is producing invisible extraction noise on every run.

---

### REC-2: Add `canonical_proposition` Field (CRITICAL)

**Problem:** The `point` field (3-6 sentences) fuses faithful paraphrase + mechanism + POV interpretation + caveats into a prose blob. This is useful for human readers but computationally opaque for taxonomy matching. The taxonomy nodes use terse genus-differentia statements; matching long elaborated prose against short canonical statements creates a register mismatch that degrades similarity regardless of method.

**Evidence:** All three reviewers converge here. Reviewer 1 calls it "atomic proposition," Reviewer 2 calls it "normalized proposition," Reviewer 3 calls it "canonical_proposition." The concept is identical: a single-clause statement stripped of POV interpretation, written in the taxonomy's own modal register.

**Proposed change:**

Add to the key_point schema (after `verbatim`, before `extraction_confidence`):

```
"canonical_proposition": "Frontier AI models exhibit emergent capabilities at
  unpredictable scale thresholds."
```

Rules for `canonical_proposition`:
- One sentence, maximum 30 words
- Written in the modal register matching its BDI type:
  - Beliefs: indicative assertion ("X is/causes/produces Y")
  - Desires: deontic frame ("X ought to / it is necessary that Y")
  - Intentions: instrumental frame ("Achieve X by means of Y")
- No POV interpretation, no caveats, no "the document argues that"
- Uses controlled vocabulary terms where applicable
- This is the field the taxonomy matcher operates on; the `point` field remains for human review

Add to the prompt near line 101 (KEY POINT DEPTH section):

```
CANONICAL PROPOSITION (required for every key_point):
  In addition to the full "point" narrative, provide a "canonical_proposition"
  field: one sentence (≤30 words) that captures the core claim in the register
  matching its BDI type.

  Modal register by category:
    Beliefs: indicative assertion — "X is the case" / "X causes Y"
      Example: "Frontier models exhibit unpredictable emergent capabilities at
      scale thresholds."
    Desires: deontic frame — "X ought to be the case" / "It is necessary that X"
      Example: "Open-source model access ought to be protected as prerequisite
      for democratic AI governance."
    Intentions: instrumental frame — "Achieve X by means of Y"
      Example: "Mitigate AI displacement through sector-specific retraining
      programs funded by automation taxes."

  The canonical_proposition is the matching target for taxonomy alignment.
  Write it in the same voice as taxonomy node descriptions. Use standardized
  vocabulary_terms where applicable. Strip POV framing, caveats, and hedging —
  state the core proposition directly.
```

Update the three example key_points (lines 130-159) to include `canonical_proposition`.

**Blast radius:** Schema change affects: `pov-summary-system.prompt`, `pov-summary-chunk-system.prompt`, PowerShell extraction output parsing, any downstream consumers of key_point JSON. Taxonomy matcher in `build_training_corpus.py` should be updated to match on `canonical_proposition` instead of (or in addition to) `point`.

**Feasibility:** High. Prompt-only change plus schema addition. The canonical field is shorter than the existing point field, so token overhead is modest (~15-20 tokens per key_point).

**Priority:** CRITICAL — this is the single highest-leverage change for taxonomy matching accuracy. It directly addresses the register mismatch that drives the claim-to-node attribution gap we're investigating in t/507.

---

### REC-3: Define Salience Explicitly (MAJOR)

**Problem:** The prompt never defines what makes a point "salient." The model uses its own implicit notion of "interesting," producing different results across runs. Reviewer 2 proposes a tiered salience hierarchy.

**Proposed change:**

Add before the RULES section (~line 214):

```
SALIENCE DEFINITION — what makes a point worth extracting:
  A span is salient if it expresses or bears on a belief, desire, or intention
  that one of the three POV camps would endorse, contest, or need to account for.

  Salience tiers (extract in this priority order):
    Tier 1 (always extract):
      - Central thesis statements
      - Explicit policy recommendations
      - Core empirical claims with evidence
      - Direct normative commitments ("should", "must", "ought")
    Tier 2 (extract if they materially support Tier 1):
      - Causal arguments and mechanism descriptions
      - Evidence cited more than once
      - Key assumptions the argument depends on
    Tier 3 (extract only if they introduce a novel concept):
      - Illustrative examples and analogies
      - Historical anecdotes
      - Hypothetical scenarios

  A point that is generically interesting but not mappable to any BDI frame
  is NOT salient for this extraction. Skip it.
```

**Blast radius:** Prompt-only. No schema change. Improves inter-run consistency.

**Feasibility:** High. Pure prompt addition.

**Priority:** MAJOR — directly addresses inter-run reliability.

---

### REC-4: Allow Non-Contiguous Verbatim Spans (MAJOR)

**Problem:** The current rule (lines 246-248) requires 1-5 contiguous sentences. Real arguments are often distributed across paragraphs — claim in ¶1, evidence in ¶5, qualifier in ¶9. The contiguity constraint biases toward punchy isolated sentences over representative evidence.

**Proposed change:**

Replace lines 246-248 with:

```
  - For each key_point, the "verbatim" field contains the source text that
    grounds the point. Two formats are accepted:
      Single span: a string of 1-5 contiguous sentences copied EXACTLY from
        the document (word-for-word).
      Multiple spans: an array of 2-4 non-contiguous quotes when the argument
        is distributed across the document. Each span must be copied exactly.
        Example: ["Quote from paragraph 2.", "Supporting data from paragraph 7."]
    Use single span when a contiguous passage captures the point. Use multiple
    spans when the argument requires evidence from different locations. Do NOT
    paraphrase, summarize, or alter any text.
```

**Blast radius:** Schema change — `verbatim` becomes `string | string[]`. Affects: prompt, PowerShell extraction parsing, any code that reads `verbatim` as a string. The chunked variant cannot use multi-span (spans from different chunks aren't visible), so this applies to single-pass extraction only.

**Feasibility:** Medium. Requires downstream parser updates to handle both string and array types.

**Priority:** MAJOR — improves traceability for distributed arguments.

---

### REC-5: Add HOW-Dominates Precedence Rule for BDI Classification (MAJOR)

**Problem:** The category disambiguation tests (lines 15-31) rely on surface cues — modal verbs like "should" route to Desires. But "Regulation should be triggered by demonstrated harm" is an Intention (it specifies a mechanism), not a Desire. The prompt's own Intentions example at line 152 demonstrates this contradiction.

**Proposed change:**

Add a precedence rule to the CATEGORY DISAMBIGUATION section:

```
  PRECEDENCE RULE: When surface cues conflict, apply this hierarchy:
    1. If the span specifies a METHOD or MECHANISM (HOW to achieve something)
       → Intentions, regardless of modal verbs like "should" or "must"
    2. If the span states a desired end-state WITHOUT a mechanism
       → Desires
    3. If the span makes an empirical claim (true/false evaluable)
       → Beliefs

  Example applying precedence:
    "Regulation should be triggered by demonstrated harm"
    Surface cue "should" → Desires?
    But it specifies a mechanism (harm-triggered regulation) → Intentions ✓

    "AI systems should be safe"
    "Should" + no mechanism → Desires ✓

    "Open-source models will reduce monopolistic control"
    Empirical prediction → Beliefs ✓
```

**Blast radius:** Prompt-only change to the disambiguation section. May shift some existing extractions from Desires to Intentions on re-run — this is a correctness improvement, not a regression.

**Feasibility:** High. Pure prompt change.

**Priority:** MAJOR — fixes a documented category confusion bug.

---

### REC-6: Extract Argument Links Between Points (SUGGESTION)

**Problem:** Two reviewers note that extraction treats points as independent, losing inferential chains (Belief → supports Desire → motivates Intention). The prompt already has `claim_relations` for factual claims (lines 208-212) but nothing equivalent for key_points.

**Proposed change:**

Add an optional `argument_links` array to the output schema:

```json
"argument_links": [
  {
    "premise_ids": ["key_point_index_0", "key_point_index_2"],
    "conclusion_id": "key_point_index_5",
    "relation": "supports"
  }
]
```

**Blast radius:** Schema addition. New array in output JSON. No existing fields affected. Downstream consumers can ignore if not ready.

**Feasibility:** Medium. Adds complexity to an already dense prompt. Risk of the model fabricating spurious links to appear thorough.

**Priority:** SUGGESTION — valuable for future reasoning but lower leverage than REC-1 through REC-5. Consider implementing after the critical changes are validated.

---

### REC-7: Normalize Taxonomy Node Descriptions for Matching (SUGGESTION)

**Problem:** Reviewer 1 proposes decomposing taxonomy nodes into structured semantic slots (`actor`, `relation`, `object`, `modality`, `polarity`). Reviewer 3 suggests matching on differentia + Excludes rather than full genus-differentia strings (since the shared genus "A Belief within safetyist discourse that..." dominates embedding similarity).

**Assessment:** Both are valid but represent significant architectural changes to the taxonomy data model. The `canonical_proposition` field (REC-2) addresses 80% of the matching problem at 20% of the cost by putting extraction output in the taxonomy's register. Structured semantic slots are a Tier 2 optimization.

**Proposed action:** Defer to a follow-up ticket. If REC-2 is implemented and matching accuracy still underperforms, revisit structured decomposition.

**Priority:** SUGGESTION — deferred pending REC-2 results.

---

### REC-8: Sub-type Intentions Category (SUGGESTION)

**Problem:** Reviewer 1 notes that Intentions conflates policy proposals, governance mechanisms, technical approaches, argumentative frameworks, and interpretive lenses. This produces heterogeneous clusters.

**Assessment:** The prompt already lists sub-types at line 27 ("policy proposals, governance frameworks, technical approaches, rhetorical strategies"). The issue is that these sub-types aren't enforced as a required classification. Adding a required `intention_subtype` field is low-cost and improves downstream analysis.

**Proposed change:** Add an optional `intention_subtype` enum to key_points where `category == "Intentions"`:

```
"intention_subtype": "policy_proposal" | "governance_mechanism" |
  "technical_approach" | "argumentative_framework" | "interpretive_lens"
```

**Priority:** SUGGESTION — useful refinement, low urgency.

---

## Compatibility with Chunked Extraction Variant

The chunked prompt (`pov-summary-chunk-system.prompt`) is simpler and already avoids some problems:
- Uses "QUANTITY GUIDANCE" (soft targets) instead of hard minimums — REC-1 is less urgent here
- No SENTENCE 1 FIDELITY section — simpler extraction pass
- Prioritizes exhaustiveness by design ("extract EVERY point")

Changes required for compatibility:
- **REC-1:** Chunk variant already uses soft guidance. Add `empty_cells` support.
- **REC-2:** Add `canonical_proposition` to chunk variant schema.
- **REC-3:** Add salience definition (identical text).
- **REC-4:** Non-contiguous spans are NOT applicable to chunks (can't reference other chunks). Single-span only.
- **REC-5:** Add precedence rule to chunk variant's disambiguation section.

## Implementation Priority

| # | Recommendation | Priority | Effort | Scope |
|---|---------------|----------|--------|-------|
| REC-1 | Effort floors + licensed emptiness | CRITICAL | Low | Prompt + schema |
| REC-2 | `canonical_proposition` field | CRITICAL | Low | Prompt + schema + matcher |
| REC-3 | Explicit salience definition | MAJOR | Low | Prompt only |
| REC-5 | HOW-dominates precedence rule | MAJOR | Low | Prompt only |
| REC-4 | Non-contiguous verbatim spans | MAJOR | Medium | Prompt + schema + parsers |
| REC-6 | Argument links | SUGGESTION | Medium | Prompt + schema |
| REC-7 | Structured semantic slots | SUGGESTION | High | Taxonomy data model |
| REC-8 | Intention sub-types | SUGGESTION | Low | Prompt + schema |

**Recommended execution order:** REC-1 → REC-2 → REC-3 + REC-5 (batch) → REC-4 → evaluate before proceeding to suggestions.

## Cross-References

- **t/507** — Claim-to-POV attribution improvement. REC-2 (`canonical_proposition`) directly addresses the register mismatch identified as the core matching problem.
- **t/525** — Low extraction density on chunked documents. REC-1 (effort floors) may help by removing fabrication pressure that produces low-quality points.
- **t/528** — Situation hierarchy review. REC-7 (structured semantic slots) would benefit situation matching if implemented.
