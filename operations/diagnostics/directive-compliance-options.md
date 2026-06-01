# Directive Compliance for Procedural Interventions — Options Analysis

**Ticket:** t/315
**Date:** 2026-05-31
**Author:** Diagnostics

## Problem

When the moderator fires a procedural intervention (SEQUENCE, BALANCE, REDIRECT), the directive content compliance check (`turnValidator.ts:1225-1236`) verifies that the debater's first paragraph addresses the directive by checking term overlap. Flash-lite consistently fails this check, especially for SEQUENCE — observed: 3 consecutive failures for Skeptic in round 6, each triggering a full retry (~3s and an additional API call per attempt).

The immediate bug (hardCompliance flag ignored for directive content) is tracked separately in p/48. Even with that fix downgrading these to warnings, the model still isn't structuring responses as requested — the moderator's intent is lost silently.

## Current Architecture

```
Moderator fires SEQUENCE → pendingIntervention injected into draft prompt
  → Model generates response
  → turnValidator checks:
      1. Intervention compliance (structured field, e.g. policy_challenge_response) ← has micro-fixer
      2. Directive content compliance (first paragraph term overlap)              ← NO micro-fixer
  → On failure: full retry with generic repair hint
```

The intervention micro-fixer (`turnPipeline.ts:1036-1114`) only handles missing structured fields. Directive content failures have no targeted recovery path.

## Options

### Option A: First-Paragraph Micro-Fixer

Add a micro-fixer that rewrites only the first paragraph to address the moderator's directive, similar to the existing specificity micro-fixer.

**How it works:**
- After directive content validation fails, extract the first paragraph
- Send a targeted prompt: "Rewrite this opening paragraph to directly address the moderator's SEQUENCE directive. The directive asked: [text]. Keep the rest of the argument intact."
- Splice the revised paragraph back into the statement
- Re-validate directive content compliance

**Pros:**
- Targeted fix — doesn't regenerate the entire response
- Fast (~1-2s vs ~3-4s for full retry)
- Preserves the substance of the argument
- Consistent with existing micro-fix architecture

**Cons:**
- Another API call (though smaller than a full retry)
- First-paragraph splice could break flow with second paragraph
- Still relies on flash-lite producing a good rewrite (may fail on the same model limitation)

**Estimated effort:** Medium — follows existing micro-fix pattern

### Option B: Pre-Inject Directive Template into Draft Prompt

Instead of checking compliance after the fact, inject a structural template into the draft prompt that makes compliance the path of least resistance.

**How it works:**
- When `pendingIntervention` exists, modify the draft prompt to include an explicit response skeleton:
  ```
  REQUIRED OPENING: Your first paragraph MUST begin with a direct response to the moderator's directive.
  Example: "Structuring my response as requested: On [topic 1]:..."
  ```
- For SEQUENCE specifically, inject numbered section headers into the response format

**Pros:**
- Prevents the problem rather than fixing it after
- No additional API calls
- Works even on weaker models — structural prompting is more reliable than term-matching
- Zero runtime cost

**Cons:**
- Increases prompt size slightly
- May feel formulaic — every SEQUENCE response starts the same way
- Different interventions need different templates (maintenance burden)
- Prompt injection for DIRECT_RESPONSE_PATTERNS already exists (`moderator.ts:710`) but is clearly insufficient for flash-lite

**Estimated effort:** Low — extend existing `DIRECT_RESPONSE_PATTERNS` and strengthen injection in `buildDraftPrompt`

### Option C: Relax Term-Matching for Procedural Moves

Lower the compliance threshold for procedural interventions so that weaker engagement still passes.

**How it works:**
- `checkDirectiveContentCompliance` currently requires ≥2 matching terms for targeted directives
- For procedural family moves (SEQUENCE, BALANCE, REDIRECT), reduce to ≥1 term OR check for structural signals (numbered lists, section headers) instead of keyword overlap

**Pros:**
- Simplest change — a few lines in the validator
- No additional API calls
- Reduces false negatives for models that comply structurally but don't echo the directive's vocabulary

**Cons:**
- Risks false positives — a model might pass compliance without actually following the directive
- Doesn't improve the model's behavior, just stops flagging it
- Different from the existing approach for other intervention types

**Estimated effort:** Low

### Option D: Hopeless Hint Suppression (Already Available)

Leverage the existing `suppressedHints` mechanism (from t/304) to stop retrying directive compliance after N consecutive failures on the same model.

**How it works:**
- The `classifyHintKey` function already maps directive hints to `directive_compliance`
- After 2-3 consecutive failures, the hint gets suppressed — no more retries
- The directive failure is still logged for observability

**Pros:**
- Zero new code — the mechanism already exists
- Stops wasting API calls on models that can't comply
- Model-agnostic — adapts automatically

**Cons:**
- Doesn't improve compliance at all — just gives up faster
- The moderator's intent is completely lost
- Only useful as a backstop, not a primary strategy

**Estimated effort:** None (already implemented, fires automatically)

## Recommendation

**Combine Option B + Option D** as the primary approach:

1. **Option B** (strengthen prompt injection) addresses the root cause — flash-lite can follow structural directives when they're explicit enough, but the current `DIRECT_RESPONSE_PATTERNS` text is too subtle. Making the template more prescriptive should improve first-attempt compliance rates significantly.

2. **Option D** (hopeless suppression) is already in place as a backstop — if a model truly can't comply even with stronger prompting, stop burning retries after 2 failures.

Option A (first-paragraph micro-fixer) is worth considering as a Phase 2 improvement if Option B doesn't achieve >80% first-attempt compliance on flash-lite. Option C (relaxed thresholds) is a last resort — it masks the problem rather than solving it.

## Validation Plan

1. Run a flash-lite debate that triggers SEQUENCE interventions (lower the health floor temporarily to force one)
2. Measure first-attempt directive compliance rate before and after the prompt change
3. Confirm no regression on POLICY_CHALLENGE and other hardCompliance interventions
