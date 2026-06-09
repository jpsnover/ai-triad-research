# Debate Claim Extraction Pipeline: t/529 Applicability Assessment

**Ticket:** t/533
**Source:** t/529 review (`pov-summary-prompt-review.md`)
**Reviewer:** Computational Linguist
**Date:** 2026-06-09

## Executive Summary

The document extraction pipeline (`pov-summary-system.prompt`) and the debate claim extraction pipeline (`lib/debate/prompts.ts` + `turnPipeline.ts` + `argumentNetwork.ts`) share the same fundamental problem: claims extracted in one register are matched against taxonomy nodes in a different register. But the pipelines differ in important ways — debate extraction is shorter, single-speaker, real-time, and deliberately informal. Of the 8 recommendations from t/529, **4 are directly applicable, 2 are applicable as variants, and 2 are not applicable** to the debate pipeline.

The single highest-leverage change is the same as for document extraction: **add a `canonical_proposition` field (REC-2)**. This directly attacks the t/507 claim matching gap where it's actually measured — on debate-extracted claims.

## Pipeline Comparison

| Dimension | Document Extraction | Debate Extraction |
|-----------|-------------------|-------------------|
| Input | Full academic documents (1K-20K words) | Single debater turn (~300 words) |
| Register | Academic/analytical | Debate/rhetorical ("arguably", "the thing is") |
| BDI classification | Explicit per-point | Implicit via attributed_node ID |
| Granularity target | 3-6 sentence key_points | 1-3 sentence argumentative points |
| Claim count guidance | Hard floors (KP_MIN) | Soft range (5-12 per turn) |
| Node matching | LLM + cross-POV search | Embedding cosine similarity (post-hoc) |
| Matching field | `point` (prose blob) | `claim_text` (debate register) |
| Current MRR | Not measured | 0.1834 (t/507) |

## Recommendation-by-Recommendation Assessment

### REC-1: Effort Floors + Licensed Emptiness → VARIANT

**Document problem:** Hard per-cell minimums force fabrication.

**Debate manifestation:** The debate pipeline uses a soft range (5-12 claims per turn) rather than hard floors — no rejection threat. However, there's an implicit quota pressure: the extraction prompt expects claims from a debater who is *arguing* (i.e., the turn always contains claims by design). The equivalent risk is **overcounting** — splitting one argumentative point into sub-assertions to appear thorough.

**Assessment:** The granularity guidance already addresses this ("one element per complete argumentative point, not sub-assertions"). No change needed for quota pressure. But the debate pipeline should **license zero-claim turns** — a procedural turn (concession, question, redirect) may contain no extractable claims. Currently there's no mechanism to report "this turn had no extractable claims" cleanly.

**Recommendation:** Add a `no_claims_reason` field to the extraction output for turns that yield zero claims. Low priority — this is a rare case.

**Applicability:** Variant (minor).

---

### REC-2: `canonical_proposition` Field → DIRECTLY APPLICABLE (CRITICAL)

**Document problem:** Prose `point` field doesn't match taxonomy register.

**Debate manifestation:** This is the **core t/507 problem**. Debate claims are extracted in debate register:

> "Strict liability creates a market-based audit mechanism that scales automatically and replaces bureaucratic gatekeeping"

Taxonomy nodes are in ontological register:

> "A Belief within safetyist discourse that contemporary reinforcement learning and alignment techniques are structurally insufficient..."

The claim matcher embeds both with all-MiniLM-L6-v2 and computes cosine similarity. The register mismatch dominates the embedding space — informal rhetoric and formal genus-differentia descriptions occupy different regions regardless of semantic content.

**Evidence:** The t/507 experiments confirm this. H4 (abstracting claims to core propositions) failed because abstraction *destroyed* signal — but that approach removed information entirely. REC-2 is the opposite: it **adds** a register-normalized representation alongside the original, preserving the debate-register text while providing a matching-optimized target.

**Proposed change for debate pipeline:**

After claim extraction, add a second LLM pass (or inline field) that produces a `canonical_proposition` for each claim:

```json
{
  "claim_text": "Strict liability creates a market-based audit mechanism that scales automatically and replaces bureaucratic gatekeeping",
  "canonical_proposition": "Strict product liability for AI systems produces market incentives for pre-deployment safety verification.",
  "claim_id": "AN-15",
  "speaker": "accelerationist"
}
```

Rules (same as document extraction):
- One sentence, ≤30 words
- Written in the modal register matching BDI type:
  - Beliefs: indicative ("X is/causes Y")
  - Desires: deontic ("X ought to be the case")
  - Intentions: instrumental ("Achieve X by means of Y")
- No debate rhetoric, hedging, or informal language
- Uses controlled vocabulary terms where applicable

The taxonomy matcher then operates on `canonical_proposition` instead of (or as a weighted blend with) `claim_text`.

**Implementation options:**
1. **Inline extraction** — add `canonical_proposition` to the claim extraction prompt's output schema. Cheapest, but risks the same single-pass fusion problem t/529 identified.
2. **Second pass** — extract claims first, then normalize in a separate LLM call. Cleaner separation but doubles claim-extraction API calls.
3. **Embedding-time normalization** — keep extraction as-is, add a normalization step before embedding for matching. Doesn't require prompt changes but adds pipeline complexity.

**Recommended approach:** Option 1 (inline) as a first experiment. The debate claim extraction prompt is simpler than the document extraction prompt — single speaker, short turn, already in a structured JSON schema. The fusion risk is lower. If quality is insufficient, upgrade to Option 2.

**Impact on t/507:** This is potentially the highest-leverage intervention for the MRR gap. The current MRR of 0.1834 is measured on raw `claim_text` vs node descriptions. Matching on `canonical_proposition` (same register as nodes) should substantially improve similarity scores for correct matches while reducing spurious matches from shared rhetoric.

**Applicability:** Directly applicable. CRITICAL priority.

---

### REC-3: Explicit Salience Definition → NOT APPLICABLE

**Document problem:** "Salient" is never defined for extraction from long documents.

**Debate manifestation:** Not relevant. Debate turns are short (~300 words) and every sentence is an argumentative move. There's no "is this salient?" question — the debater chose to say it, so it's part of their argument. The granularity control (5-12 claims per turn) handles density.

**Applicability:** Not applicable.

---

### REC-4: Non-Contiguous Verbatim Spans → NOT APPLICABLE

**Document problem:** Distributed arguments across a long document.

**Debate manifestation:** Debate turns are short and contiguous. A debater's argument is complete within a single turn by design. Cross-turn argument chains exist but are handled by the argument network's edge structure, not by the claim extraction.

**Applicability:** Not applicable.

---

### REC-5: HOW-Dominates Precedence Rule → DIRECTLY APPLICABLE (MAJOR)

**Document problem:** "Should" routes to Desires even when a mechanism is specified.

**Debate manifestation:** The debate claim extraction doesn't explicitly classify claims into BDI — it relies on post-hoc attribution to a taxonomy node, which carries its BDI category implicitly. But the **matching** is affected: if a claim's canonical proposition (REC-2) is written with the wrong modal register because of surface-cue confusion, the match quality degrades.

More importantly, the debater's prompts already use BDI-structured taxonomy context. If the debater's own reasoning confuses Desires and Intentions (because the prompt's disambiguation tests have the surface-cue bug), the generated arguments may anchor to the wrong BDI category, producing claims that are harder to attribute correctly.

**Proposed change:** Apply the HOW-dominates precedence rule to:
1. The `canonical_proposition` normalization (if REC-2 is implemented)
2. The debater briefing prompts where BDI categories are explained
3. The claim extraction prompt's output guidance

**Applicability:** Directly applicable. MAJOR priority.

---

### REC-6: Argument Links Between Points → VARIANT (already exists)

**Document problem:** Inferential chains are lost.

**Debate manifestation:** The argument network **already captures this** via its edge structure. Claims are connected by SUPPORTS, CONTRADICTS, WEAKENS, etc. The QBAF propagation computes argument strength through these links. This is one area where the debate pipeline is ahead of the document pipeline.

**Gap:** The links are between claims (AN nodes), not between claims and their internal premises. A single claim like "Strict liability creates a market-based audit mechanism that scales automatically" bundles a conclusion + mechanism. The internal structure is lost.

**Assessment:** The debate pipeline's argument-level granularity (1 claim = 1 complete argumentative point) is appropriate for its purpose. Decomposing into premise/conclusion would produce too many fine-grained nodes for the AN. No change recommended.

**Applicability:** Already addressed (variant form).

---

### REC-7: Structured Semantic Slots → VARIANT

**Document problem:** Taxonomy nodes should have structured fields (actor, relation, object, modality).

**Debate manifestation:** Same underlying issue, but the fix is on the taxonomy side, not the debate pipeline. If taxonomy nodes gain structured semantic slots, the debate claim matcher should match against those slots rather than (or in addition to) description text. But this is a taxonomy data model change, not a debate extraction change.

**Applicability:** Deferred — same as document pipeline. Evaluate after REC-2 results.

---

### REC-8: Intention Sub-Types → DIRECTLY APPLICABLE (SUGGESTION)

**Document problem:** Intentions conflate policy proposals, governance mechanisms, technical approaches, etc.

**Debate manifestation:** Same issue. Debate claims attributed to `*-intentions-*` nodes may be arguing for a policy action, deploying a reasoning framework, or proposing a technical approach — all classified as "Intentions." The matching challenge is that these sub-types occupy different semantic regions.

**Proposed change:** If `canonical_proposition` (REC-2) is implemented, add an optional `intention_subtype` field to the normalization output. This enables the matcher to weight sub-type similarity.

**Applicability:** Directly applicable. SUGGESTION priority.

---

## Summary Table

| REC | Document Pipeline | Debate Pipeline | Priority | Notes |
|-----|------------------|-----------------|----------|-------|
| REC-1 | Effort floors | License zero-claim turns | Low | Minor variant |
| **REC-2** | **canonical_proposition** | **canonical_proposition** | **CRITICAL** | **Highest-leverage t/507 intervention** |
| REC-3 | Salience definition | Not applicable | — | Turns are short; no salience ambiguity |
| REC-4 | Non-contiguous spans | Not applicable | — | Turns are contiguous by design |
| **REC-5** | **HOW-dominates** | **HOW-dominates** | **MAJOR** | Affects canonical prop + debater prompts |
| REC-6 | Argument links | Already exists (AN edges) | — | Debate pipeline ahead here |
| REC-7 | Semantic slots | Deferred | — | Taxonomy-side change |
| REC-8 | Intention sub-types | Intention sub-types | Suggestion | Add to canonical normalization |

## Recommended Implementation Order

1. **REC-2 for debate claims** — add `canonical_proposition` to claim extraction output schema in `prompts.ts`. Start with inline extraction (Option 1). Measure MRR delta on golden test set.
2. **REC-5 for debater prompts** — add precedence rule to BDI disambiguation in debater briefing and claim extraction prompts.
3. **REC-8 sub-typing** — add after REC-2 if Intentions remain a weak matching category.

## Cross-References

- **t/507** — Claim matching improvement. REC-2 for debate claims is the most direct intervention.
- **t/529** — Source review document with full recommendation text.
- **t/530** — Document-side implementation of REC-1 + REC-2 (PowerShell scope).
- **t/531** — Document-side implementation of REC-3 + REC-5 (PowerShell scope).
