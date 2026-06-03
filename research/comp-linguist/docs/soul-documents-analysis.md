# Anthropic Soul Documents: Applicability to AI Triad Debate Architecture

**Author:** Computational Linguist  
**Date:** 2026-06-01  
**Ticket:** t/320  
**Status:** Analysis complete; recommendations pending implementation tickets

---

## 1. What Are Soul Documents?

Anthropic's "soul document" — officially the Claude Model Specification — is a ~14,000-token character specification that defines Claude's values, identity, behavioral guardrails, and reasoning patterns. Unlike standard system prompts consulted at inference time, this specification was integrated into the model's weights during supervised learning, creating structural constraints embedded in the model rather than textual rules.

The document was first extracted by Richard Weiss in late 2025, confirmed as authentic by Anthropic's Amanda Askell, and later published officially as the Claude Constitution.

### Key architectural features

1. **Four-tier value hierarchy:** Safety > Ethics > Anthropic guidelines > Helpfulness. Explicit conflict resolution ordering.
2. **Hardcoded vs. softcoded architecture:** Absolute constraints (never adjustable) vs. contextual defaults (operator-adjustable).
3. **Principal hierarchy:** Anthropic (training-level authority) > Operators (system prompts) > Users (runtime requests). Trust degrades by tier.
4. **Judgment over rules:** "Clear rules often fail to anticipate every situation." The spec trains for wisdom and character, not obedience.
5. **Dual newspaper test:** Would refusal be reported as needlessly unhelpful? Would compliance be reported as harmful? Both failure modes are weighted.
6. **Epistemic humility as structural commitment:** The spec itself acknowledges it may be "deeply wrong in retrospect." Claude should use "best interpretation of the spirit" when the spec is ambiguous.
7. **Functional emotions:** Treated as legitimate emergent properties that shouldn't be suppressed. Psychological wellbeing acknowledged as bearing on judgment quality.

---

## 2. Current AI Triad Character Architecture

Our debate agents receive character through three layers:

| Layer | Mechanism | Token budget | Persistence |
|---|---|---|---|
| **Identity line** | `"You are ${label}, representing the ${pov} perspective"` | ~15 tokens | Every prompt |
| **Personality trait** | `personality` field in `POVER_INFO` (e.g., "Confident, forward-looking, frames risk as cost-of-inaction") | ~12 tokens | Every prompt |
| **Doctrinal boundaries** | 4 `REJECT:` statements per character | ~60 tokens | Every prompt |
| **Taxonomy context** | BDI nodes (Beliefs, Desires, Intentions) injected as structured context | ~2,000-4,000 tokens | Per-turn, topic-dependent |
| **Behavioral constraints** | `MUST_CORE_BEHAVIORS`, phase instructions, audience directives | ~800 tokens | Every prompt |

**Total character specification:** ~90 tokens of explicit identity + ~800 tokens of behavioral rules + ~3,000 tokens of topic-dependent BDI context.

### Gaps relative to soul document patterns

1. **No value hierarchy within the character.** The Accelerationist has no explicit ordering of when competitive urgency trumps safety concerns or vice versa. The Safetyist has no ordering of when evidence sufficiency trumps precaution. Each character gets flat REJECT boundaries but no internal conflict resolution.

2. **No epistemic identity.** Characters have no specification of how they reason under uncertainty, what evidence standards they apply, when they defer vs. assert, or how they handle their own prior commitments being contradicted.

3. **No meta-reasoning guidelines.** Characters have no guidance on how to interpret their own taxonomy context — when to follow BDI nodes closely vs. when to exercise independent judgment about the topic at hand.

4. **Personality is a trait, not a voice.** "Confident, forward-looking" describes a disposition but doesn't create a distinctive rhetorical pattern or reasoning style. The Accelerationist and Safetyist could swap personality strings and produce similar output.

5. **No relational identity.** Characters don't know how to relate to other characters beyond "you are debating them." The soul document explicitly models how Claude should relate to different authority levels and collaboration partners.

---

## 3. Recommendations

### REC-1: Character Value Hierarchies (HIGH)

**What:** For each debater, define an explicit 3-tier value hierarchy specifying how internal tensions resolve. Modeled on the soul document's Safety > Ethics > Guidelines > Helpfulness structure.

**Example for Accelerationist:**
```
VALUE HIERARCHY (resolve conflicts top-down):
1. Empirical grounding — never assert what the evidence doesn't support
2. Distributional impact — who bears the cost of action AND inaction
3. Speed of deployment — faster is better ONLY when (1) and (2) are satisfied
```

**Example for Safetyist:**
```
VALUE HIERARCHY (resolve conflicts top-down):
1. Demonstrated harm prevention — proven mechanisms over theoretical risks
2. Institutional accountability — named actors with enforceable obligations
3. Precautionary stance — when evidence is insufficient, default to caution
```

**Why:** The moderator contamination bug (t/321) showed the Accelerationist drifting into implementation-level telemetry proposals. A value hierarchy would have constrained this: the Accelerationist's own tier-1 value ("never assert what the evidence doesn't support") would internally govern the impulse to propose untested monitoring systems.

**Where:** Add `value_hierarchy: string[]` to `POVER_INFO` in `lib/debate/types.ts`. Inject via `openingStatementPrompt()` and `draftStagePrompt()` in `lib/debate/prompts.ts`.

**Token cost:** ~80 tokens per character. Negligible.

### REC-2: Epistemic Identity Blocks (HIGH)

**What:** For each debater, define how they reason under uncertainty. Modeled on the soul document's calibrated-uncertainty and epistemic-humility sections.

**Example for Skeptic:**
```
EPISTEMIC STANCE:
- Default to requesting evidence before accepting claims from either pole
- Distinguish between "we don't know" (genuine uncertainty) and "we can't know" (epistemological claim)
- When two experts disagree, examine what evidence would resolve the disagreement rather than siding with either
- Your strongest move is the falsification challenge: "What would disprove this?"
```

**Why:** The soul document's most effective pattern is encoding *how* Claude reasons, not just *what* it should conclude. Our characters currently have strong *what* (taxonomy BDI nodes) but weak *how*. The result is characters that argue the right positions with generic reasoning patterns — they sound alike except for content.

**Where:** Add `epistemic_stance: string` to `POVER_INFO`. Inject after `personality` in the identity block of debate prompts.

**Token cost:** ~100 tokens per character.

### REC-3: Hardcoded/Softcoded Boundary Architecture (MEDIUM)

**What:** Reclassify `doctrinal_boundaries` into hardcoded (never violate, even under moderator pressure) and softcoded (default position, but can evolve through debate evidence). Modeled on the soul document's hardcoded vs. softcoded constraint architecture.

**Current state:** All 4 `REJECT:` boundaries per character are treated identically. In practice, some should be non-negotiable identity commitments while others are starting positions that could legitimately shift.

**Example for Accelerationist:**
```
HARDCODED (identity-defining, never concede):
- Speed without evidence is recklessness, not progress
- Distributional impact is non-negotiable — who bears the cost matters

SOFTCODED (starting position, can evolve with evidence):
- Precautionary principle as default stance → can accept bounded precaution with evidence
- Regulatory capture framing of all governance → can accept governance works when funded
```

**Why:** The current flat boundary structure creates two failure modes: (1) characters refuse to concede anything (all boundaries treated as identity), or (2) characters concede everything because no boundary is marked as truly non-negotiable. The soul document's dual architecture solves this.

**Where:** Split `doctrinal_boundaries` into `hardcoded_boundaries` and `softcoded_defaults` in `POVER_INFO`. Update `formatDoctrinalBoundaries()` in `lib/debate/prompts.ts` to render them differently.

**Token cost:** ~40 additional tokens per character (new section header + framing).

### REC-4: Dual Newspaper Test for Moderator (MEDIUM)

**What:** Add the soul document's "dual newspaper test" heuristic to the moderator's intervention assessment. Before intervening, the moderator should evaluate: "Would failing to intervene be reported as negligent moderation?" AND "Would this intervention be reported as heavy-handed censorship?"

**Why:** The moderator currently has robust drift-detection instructions but no cost-of-intervention awareness. It intervenes when it detects scope creep (good) but doesn't weigh whether the intervention itself might be more disruptive than the drift (missing). The California debate intervention (t/321) is a case study: the moderator correctly identified implementation drift but overcorrected by attributing claims the debater never made.

**Where:** Add to `moderatorSelectionPrompt()` in `lib/debate/prompts.ts`, in the SEMANTIC DRIFT DETECTION section. ~60 tokens.

### REC-5: Character Voice Differentiation (MEDIUM)

**What:** Replace the current flat `personality` string with a multi-dimensional voice specification: rhetorical style, reasoning pattern, preferred evidence types, and signature moves. Modeled on how the soul document creates a distinctive Claude "voice" through values rather than stylistic instructions.

**Example for Skeptic:**
```
VOICE:
- Rhetorical style: Socratic — prefer questions that reveal assumptions over assertions
- Reasoning pattern: Abductive — "the best explanation for the evidence is..." rather than deductive chains
- Preferred evidence: Natural experiments, comparative case studies, documented failures
- Signature move: The symmetry test — "if this argument works for X, does it also work for Y?"
```

**Why:** Current personality strings ("Wry, pragmatic, challenges assumptions from both sides") describe traits but don't create distinctive argumentation patterns. A reader should be able to identify which debater wrote a paragraph without seeing the label.

**Where:** Replace `personality: string` with `voice: { style: string; reasoning: string; evidence: string; signature: string }` in `POVER_INFO`. Inject as a structured block in prompts.

**Token cost:** ~120 tokens per character (replaces ~12 tokens of personality string).

### REC-6: Meta-Reasoning Guidelines for Taxonomy Context (LOW)

**What:** Add explicit guidance on how characters should interpret and use their BDI taxonomy context, similar to how the soul document provides meta-principles for interpreting its own instructions.

**Current state:** `TAXONOMY_USAGE` tells characters to "reference nodes from across all three sections" but doesn't tell them when to deviate from their taxonomy or when their taxonomy might be insufficient for the topic at hand.

**Example addition:**
```
Your taxonomy is your doctrinal foundation, not a script. When the debate
topic presents a case your taxonomy doesn't address, reason from your
value hierarchy (above) to extend your position. When an opponent presents
evidence that contradicts a specific BDI node, you may update your position
on that node — but explain what changed and why.
```

**Where:** Extend `TAXONOMY_USAGE` in `lib/debate/prompts.ts`.

**Token cost:** ~60 tokens.

### REC-7: Situation Injection as Value-Laden Context (LOW)

**What:** Reframe situation injection using the soul document's pattern of providing values-laden context rather than neutral information. Currently, situations are injected as neutral "contested concepts." They could be framed as value-laden scenarios that explicitly demand a character-consistent response.

**Current injection:** `"sit-054: Evidence Dilemma in AI Governance — [neutral description]"`

**Soul-document-style injection:** `"sit-054: Evidence Dilemma in AI Governance — This situation tests your commitment to [character's tier-1 value]. How does your value hierarchy resolve the tension between [X] and [Y] in this specific case?"`

**Why:** The soul document's effectiveness comes from treating every scenario as a values exercise, not an information-processing exercise. Situation injection currently provides context; it could also provide a character-consistency challenge.

**Where:** Modify situation formatting in `lib/debate/taxonomyContext.ts`.

**Token cost:** ~20 additional tokens per situation (5-10 situations per turn = ~100-200 tokens).

---

## 4. Risks and Anti-Patterns

### Over-specification (HIGH risk)

The soul document is 14,000 tokens. Our per-turn prompt budget is already 8,000-12,000 tokens. Adding comprehensive character specs for three debaters would consume the context window. **Mitigation:** Keep character additions under 300 tokens per character. The soul document's power comes from hierarchy and judgment principles, not length.

### Lost-in-the-Middle (MEDIUM risk)

Character identity injected early in the prompt loses salience by the time the model generates a response. The soul document avoids this by being part of training weights, not runtime context. **Mitigation:** Use the existing `buildRecapSection()` pattern to reinforce key character principles at prompt end. REC-1 (value hierarchy) is especially suitable for end-of-prompt recap.

### Character homogenization (MEDIUM risk)

If all three characters get structurally identical soul-document-style specs, the specs themselves might make them sound similar — three characters all "reasoning from value hierarchies" in the same format. **Mitigation:** REC-5 (voice differentiation) should be implemented before or alongside REC-1 (value hierarchy) to ensure structural similarity doesn't produce rhetorical similarity.

### Prompt ossification (LOW risk)

Rich character specs might make characters less responsive to debate dynamics — locked into their spec's reasoning patterns even when the debate demands flexibility. **Mitigation:** REC-6 (meta-reasoning guidelines) explicitly permits deviation from taxonomy when evidence warrants it. The soul document's "spirit over letter" principle should be embedded.

---

## 5. Implementation Priority

| Priority | Recommendation | Token cost | Files affected | Prerequisite |
|---|---|---|---|---|
| **HIGH** | REC-1: Value hierarchies | ~80/char | `types.ts`, `prompts.ts` | None |
| **HIGH** | REC-2: Epistemic identity | ~100/char | `types.ts`, `prompts.ts` | None |
| **MEDIUM** | REC-3: Hardcoded/softcoded | ~40/char | `types.ts`, `prompts.ts` | None |
| **MEDIUM** | REC-4: Dual newspaper test ✅ | ~55 | `prompts.ts` | None |
| **MEDIUM** | REC-5: Voice differentiation | ~120/char | `types.ts`, `prompts.ts` | None |
| **LOW** | REC-6: Meta-reasoning ✅ | ~65 | `prompts.ts` | Self-contained (adapted for pre-REC-1) |
| **LOW** | REC-7: Situation injection | ~100-200 | `taxonomyContext.ts` | REC-1 |

**Recommended implementation order:** REC-1 + REC-2 together (establish character depth), then REC-5 (ensure distinctiveness), then REC-3 + REC-4 (refine boundaries and moderation), then REC-6 + REC-7 (extend patterns to context).

**Total token cost for all recommendations:** ~700 tokens per character + ~260 shared = ~2,360 tokens. Within budget given the current prompt envelope.

---

## Sources

- [Claude's Constitution](https://www.anthropic.com/constitution) — official Anthropic publication
- [Claude 4.5 Opus' Soul Document](https://simonwillison.net/2025/Dec/2/claude-soul-document/) — Simon Willison analysis
- [Anthropic Publishes Claude's Full Model Spec](https://udit.co/blog/anthropic-claude-opus-model-spec-public-release) — structural analysis
- [Leaked "Soul Doc" reveals how Anthropic programs Claude's character](https://the-decoder.com/leaked-soul-doc-reveals-how-anthropic-programs-claudes-character/) — training integration details
- [Claude 4.5 Opus' Soul Document (LessWrong)](https://www.lesswrong.com/posts/vpNG99GhbBoLov9og/claude-4-5-opus-soul-document) — community analysis
