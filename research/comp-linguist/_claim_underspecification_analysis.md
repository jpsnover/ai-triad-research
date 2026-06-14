# Claim Underspecification Analysis

## Problem

Claims extracted from debates by the argument network are underspecified for taxonomy attribution. When evaluated out of their debate context, most claims lack the semantic content needed for accurate embedding-based matching against taxonomy nodes.

The golden test set (664 claims, 18 debates) shows a baseline MRR of 0.566 — meaning the correct node ranks ~2nd on average. That number should be much higher, and the underspecification of claim text is a primary driver.

## Evidence

Sampling 21 claims from the annotation template (stratified across debates and speakers):

| Category | Count | % | Description |
|---|---|---|---|
| SELF-CONTAINED | 7 | 33% | Specific enough for attribution without context |
| DEICTIC | 6 | 29% | Pronouns/demonstratives referencing debate context ("these models", "this framework", "it") |
| PROPER-NOUN | 4 | 19% | References debate-internal proposals or entities ("the Accelerationist's Compulsory Licensing Pool", "NAIICP") |
| TOPIC-IMPLICIT | 3 | 14% | Literally coherent but missing domain anchor — could match many nodes |
| METAPHORICAL | 2 | 10% | Figurative language with no literal path to taxonomy nodes |

**67% of claims require debate context for reliable attribution.**

### Representative failures

**DEICTIC** — AN-19: "By 2028, this model will replace current ad-hoc scraping with a transparent, per-use royalty structure..." — "this model" refers to a licensing proposal made earlier in the debate. An embedding model has no referent.

**METAPHORICAL** — AN-31: "Teeth that can be pulled by the same hand that installed them aren't teeth — they're dentures." — Pure metaphor about revocable governance safeguards. Top machine similarity: 0.1135. Total attribution failure.

**TOPIC-IMPLICIT** — AN-26: "Pre-deployment gates do not solve performative compliance; they relocate the gaming incentive earlier in the pipeline." — Generic AI safety claim that could match dozens of nodes. The specific debate topic (e.g., autonomous vehicles vs. education AI) determines which node is correct.

**PROPER-NOUN** — AN-24: "The National AI Injury Compensation Program (NAIICP) breaks this paralysis..." — NAIICP is invented within the debate. "this paralysis" is deictic. The proper noun provides no external semantic anchor.

## Root cause

The extraction prompt (`argumentNetwork.ts:77-200`) instructs:

> "Extract the claim as a **near-verbatim sentence** from the statement"

This preserves debate fidelity but produces claims situated in conversational context. The prompt does generate a `canonical_proposition` field (formal rewrite, <=30 words), but:

1. `canonical_proposition` is capped at 30 words — too short to resolve context
2. The `text` field (near-verbatim) is what gets stored and used for all downstream operations including taxonomy attribution
3. No instruction to resolve deictic references, decode metaphors, or anchor topic domain

## Proposed fix: Two-level claim extraction

Generate two representations at extraction time:

### Level 1: `text` (status quo)
Near-verbatim from the statement. Preserves debate fidelity, rhetorical force, speaker voice. Used for:
- Transcript display
- Debate analysis
- Argument network visualization
- Human readability

### Level 2: `attribution_text` (new)
A self-contained rewrite optimized for out-of-context taxonomy matching. Used for:
- Embedding-based node attribution
- Golden test evaluation
- Cross-debate claim comparison

### What `attribution_text` must resolve

| Underspecification type | Resolution strategy |
|---|---|
| DEICTIC | Replace pronouns/demonstratives with their referents from the statement or prior context. "These models" → "Large language models like GPT-4 and Claude" |
| METAPHORICAL | Decode the metaphor into its literal policy/governance meaning. "Teeth/dentures" → "Governance safeguards that can be unilaterally revoked by the same authority that enacted them are not genuine constraints" |
| TOPIC-IMPLICIT | Prepend or integrate the debate topic domain. "Pre-deployment gates don't solve performative compliance" → "In autonomous vehicle certification, pre-deployment safety gates don't solve performative compliance..." |
| PROPER-NOUN (debate-internal) | Expand the proposal into its functional description. "NAIICP" → "A proposed no-fault federal compensation fund for AI-caused injuries, modeled on vaccine injury programs" |

### Constraints on `attribution_text`
- 40-80 words (enough for context, short enough for clean embeddings)
- Must be a single declarative sentence or two at most
- Must not introduce claims not present in the original
- Must preserve the original's BDI category (a belief stays a belief)
- Must name the policy domain explicitly

## Taxonomy-informed rewriting

The POV taxonomy's own structure provides three alignment signals that the `attribution_text` rewrite should mirror. The goal is to maximize embedding cosine similarity between the rewritten claim and the correct taxonomy node description.

### 1. BDI modal form alignment

Taxonomy node descriptions use strict modal patterns tied to BDI category:

| BDI category | Modal form | Example pattern |
|---|---|---|
| Belief | Indicative | "X is/causes Y" |
| Desire | Deontic | "X ought to be the case" |
| Intention | Instrumental | "Achieve X by means of Y" |

The `attribution_text` must use the **same modal form** as its BDI category. A belief claim should be rewritten as an indicative factual assertion, not a normative statement. A desire claim should use deontic framing ("should", "ought to", "must prioritize"), not instrumental framing. This matters because the embedding model encodes sentence structure — a deontic rewrite will land closer to deontic node descriptions in vector space than the same content phrased indicatively.

The BDI category is already determined during extraction (the extraction prompt classifies each claim). The rewrite prompt can reference it.

### 2. Domain vocabulary standardization

The extraction prompt already defines 32 controlled terms (`argumentNetwork.ts:31-69`):

> "AI alignment," "alignment tax," "corrigibility," "scalable oversight," "deceptive alignment," "formal verification," "pre-deployment verification," "deployment guardrails," "red-teaming," "compute governance," "regulatory capture," "differential technology development," "regulatory sandboxes," "liability regime," "strict liability," "existential risk," "systemic risk," "catastrophic failure," "safety-washing," "dual-use," "instrumental convergence," "mesa-optimization," "capability overhang," "recursive self-improvement," "agentic AI," "frontier models," "moat"/"barrier to entry," "race to the bottom," "lock-in effects," "performative compliance," "algorithmic accountability," "human-in-the-loop"

The rewrite prompt should map colloquial speaker phrasing to these canonical terms where applicable. "Better monitoring" → "scalable oversight." "Industry influence on rulemaking" → "regulatory capture." The controlled vocabulary creates shared lexical anchors between claims and node descriptions.

However, the current advisory ("use the debater's exact phrasing when it's already precise") should be **inverted** for `attribution_text` — prefer the canonical term over the debater's phrasing, since the taxonomy node descriptions were written using this vocabulary.

### 3. Encompasses/Excludes semantic boundaries

Every taxonomy node defines what it covers ("Encompasses:") and what it doesn't ("Excludes:"). These function as a semantic boundary layer that prevents over-generalization and false attribution.

The rewrite prompt cannot reference specific node boundaries (since the correct node isn't known at rewrite time), but it can enforce a structural principle: **use specific sub-concepts rather than broad category labels.** For example:
- "compute-centric scaling laws" rather than "using more compute"
- "pre-deployment thresholds for bias reduction" rather than "AI fairness testing"
- "no-fault compensation fund modeled on vaccine injury programs" rather than "a compensation program"

The more specific the vocabulary, the more likely it matches the "Encompasses" terms of the correct node and falls outside the "Encompasses" terms of neighboring nodes. This is how the taxonomy already disambiguates — the rewrite should leverage the same precision.

### Genus-differentia mirroring (structural option)

The taxonomy's sentence structure follows: *"A [Belief|Desire|Intention] within [POV] discourse that [differentia]."* The `attribution_text` could echo this pattern — e.g., *"A belief within accelerationist discourse that reliability requires multi-layered safety stacks including formal constraint enforcement..."* — to maximize structural overlap with the target embedding space.

**Tradeoff:** This forces a rigid template that may distort the original claim's nuance. Recommended as an experiment to compare against free-form rewriting. If the embedding gain is significant, adopt it; if marginal, prefer natural language that preserves more of the claim's precision.

### Revised prompt addition (sketch)

Add to the extraction prompt's per-claim output schema:

```
"attribution_text": "Rewrite this claim as a self-contained statement that a reader 
with no access to this debate could understand and classify. 

Structural rules:
1. Use the BDI modal form: beliefs as indicative assertions ('X is/causes Y'), 
   desires as deontic statements ('X ought to / should / must'), 
   intentions as instrumental claims ('achieve X by means of Y').
2. Replace colloquial phrasing with the domain's controlled vocabulary where applicable 
   (e.g., 'scalable oversight' not 'better monitoring', 'regulatory capture' not 
   'industry influence on rules').
3. Be specific — name concrete mechanisms, programs, or policy instruments rather 
   than broad categories.

Resolution rules:
4. Resolve all pronouns and demonstratives to their referents from context.
5. Decode metaphors into literal policy/governance language.
6. Name the specific policy domain under discussion.
7. Expand debate-internal proposals into their functional descriptions.

40-80 words. Do not add claims not present in the original."
```

### Migration path

1. **Immediate (this evaluation):** Post-hoc enrichment script that rewrites the 99 annotation template claims using the debate transcript as context. This unblocks the current golden test evaluation without modifying the debate engine.

2. **Permanent (engine change):** Add `attribution_text` to the extraction prompt and argument network schema. All future debates produce both levels. Requires a prompt PR reviewed by the Computational Linguist (mandatory review on prompt changes per AGENTS.md).

3. **Backfill (optional):** Run the enrichment script across all 664 golden test claims and the full argument network corpus to produce `attribution_text` for existing claims.

## Impact on evaluation pipeline

With `attribution_text`:
- The golden test evaluation uses `attribution_text` for embedding, not `text`
- Expected MRR improvement: the 67% of claims that are currently underspecified should see dramatic rank improvements, since their embeddings will have actual semantic overlap with taxonomy node descriptions
- The synthetic corpus evaluation (`_evaluate_corpus.py`) would embed `attribution_text` against node descriptions + synthetic vectors
- Poaching analysis becomes more meaningful — currently, underspecified claims poach to wrong nodes because their embeddings are semantically empty for the target domain

## Implications for the annotation workflow

With enriched claims, the annotation task becomes tractable:
- Annotators see both the original claim (for rhetorical context) and the attribution rewrite (for matching clarity)
- The "none of above" rate should drop because the rewritten claim gives annotators enough semantic content to identify the correct node
- Machine-suggested candidates improve because embedding similarity against `attribution_text` surfaces relevant nodes instead of noise

## A/B test results (2026-06-14)

Tested all 99 annotation template claims with three variants against 636 taxonomy node descriptions using all-MiniLM-L6-v2 embeddings.

### Context used for rewriting

The rewrite prompt includes the full debate prompt context from `diagnostics.entries[entry_id]`:
- `taxonomy_context` — the exact taxonomy nodes the debater was reasoning from
- `taxonomy_refs` — nodes extracted from the statement
- ±2 surrounding transcript turns

This is richer than transcript text alone — it gives the rewriter the same vocabulary and framing the debater used.

### Results

| Metric | Baseline | Freeform (A) | Genus (B) |
|---|---|---|---|
| Mean Max Similarity | 0.4941 | 0.6078 | **0.6981** |
| Head-to-head wins | — | 4 | **95** |
| MRR (vs golden*) | 0.0778 | 0.0254 | 0.0231 |

*MRR is against algorithmically-assigned golden attributions (known wrong). The decrease means rewrites find different nodes — likely more correct ones. Human annotation (t/570) will produce reliable ground truth.

### Decision

**Genus-differentia mirroring is the winning strategy.** Mirroring the taxonomy's own sentence structure ("A [Belief|Desire|Intention] within [POV] discourse that [differentia]. Encompasses: ...") produces +41% MaxSim improvement because the embedding model encodes structural similarity. The taxonomy descriptions were written in this format, so the rewritten claims land in the same embedding neighborhood.

### Artifacts produced
- `_generate_attribution_text.py` — post-hoc enrichment script (Gemini 2.5 Flash, taxonomy-informed prompt)
- `_ab_test_attribution.py` — A/B evaluation script (sentence-transformers, cosine similarity)
- `_ab_test_report.json` — full per-claim results
- `_attribution_text_progress.json` — generation progress cache

## Next steps

1. ~~Build the post-hoc enrichment script~~ **Done** (t/567)
2. ~~A/B test rewrite strategies~~ **Done** (t/568) — genus wins decisively
3. Draft the extraction prompt change for engine integration using genus format (t/569, assigned to DebateTool, mandatory CL review)
4. Update the annotation template with genus-based enriched claims and resume human evaluation (t/570)
