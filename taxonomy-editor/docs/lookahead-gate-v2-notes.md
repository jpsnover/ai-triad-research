# Lookahead Gate v2 — Spec Notes

These are raw notes for the selective claim filtering spec. Not a spec yet.

## Current behavior (what we have now)

- Statement generated first by LLM turn pipeline
- Claims extracted from statement via `classifyClaimsPrompt` / `extractClaimsPrompt`
- `processExtractedClaims` scores each claim (BDI composite, belief verification, specificity proxy)
- Lookahead gate evaluates **all claims as a batch** — composite utility delta across the whole set
- If gate fails: full response regeneration (up to 3 retries), re-extract all claims, re-evaluate
- Best batch wins; if nothing passes, commit anyway + log `low_utility_turn`

## Problems observed (s17 case study)

1. **All-or-nothing**: 2 strong claims (1.0) get thrown out because 1 weak claim (< 0.4) drags the composite. The gate can't keep the good claims and drop the bad one.

2. **Regen produces cosmetic rewording**: The LLM receives generic feedback ("make stronger assertions") but doesn't know which specific claim is weak. It rephrases the same ideas, gets the same scores, often worse composite.

3. **Transcript/claims mismatch (BUG, now fixed)**: Transcript text was updated unconditionally before deciding whether retry claims were better. If retry was worse, committed claims didn't match displayed text. Fixed: transcript now only updates when the best attempt improves on the original.

4. **Frozen crux_engagement (BUG, now fixed)**: crux_engagement was identical before/after because the crux tracker wasn't augmented with tentative edges. Fixed via `augmentCruxesForTentative`.

5. **Hint goes into `concessionHint`**: A soft context field the LLM can ignore. Not structurally enforced.

## Key architectural constraint

**Claims are not editable objects.** They are an analytical byproduct of the statement:

1. The LLM generates a **statement** (full prose response)
2. Claims are **extracted** from the statement after the fact
3. On retry, a **new statement** is generated from scratch
4. Claims are then extracted fresh from the new statement

There is no claim preservation, no surgical editing, no keeping individual claims. The only
lever we have is **influencing the next statement generation** so it produces a better set of
claims. We do this by analyzing what was strong and weak about the claims from the previous
statement, and feeding that analysis into the retry prompt as guidance.

## Desired behavior (what we want)

### Per-claim marginal utility analysis (diagnostic, not surgical)

After extracting claims from a statement, evaluate each claim's **marginal contribution**:
- For each tentative claim, compute utility with vs without that specific claim
- Classify each as STRONG (positive marginal delta) or WEAK (negative marginal delta)
- This analysis feeds into the retry prompt — it does NOT directly edit, keep, or drop claims

### Informed retry

When the gate fails:
- Analyze which extracted claims were strong and why (high specificity, anchors position, etc.)
- Analyze which extracted claims were weak and why (vague, dilutes position, avoids cruxes, etc.)
- Feed this analysis into the retry prompt as two blocks: "Strong Foundations" and "Do Not Use"
- The LLM generates a **completely new statement**, informed by what worked and what didn't
- Claims are extracted fresh from the new statement and evaluated again

### Open questions

- **Marginal utility is O(n) QBAF evaluations per turn** (one per tentative claim). For 3-6 claims on a 100-node network, this is 30-60ms — still negligible vs LLM latency. But worth noting.

- **Retry prompt design**: The current `buildRegenHint` gives aggregate feedback. Need a claim-level variant with two blocks:
  - **Strong Foundations** — "base your argument on these" (directive, empowering)
  - **Do Not Use** — "do not use these kinds of arguments for these reasons" (teaches what to avoid)
  - **Key constraint**: The retry LLM has no memory of the prior attempt — it's a fresh pipeline run. All language must be standalone guidance, never referencing "your previous response" or "do not repeat." Frame as "use" / "do not use".

- **Cumulative learning across retries**: Each retry generates a new statement and new claims. The analysis from all prior attempts should accumulate — attempt 2 gets the analysis from attempt 1, attempt 3 gets analysis from attempts 1 and 2. Strong foundations and avoid lists grow across retries.

- **How much of the analysis to surface**: The LLM doesn't know about QBAF, marginal utility, or base_strength. The prompt should translate technical metrics into natural strategic guidance (e.g. "this argument is too vague to score well" rather than "base_strength 0.35 due to low specificity").

## Data flow (current)

```
LLM turn pipeline
  → statement + my_claims (self-reported)
    → transcript entry saved
      → extractClaimsAndUpdateAN (fire-and-forget)
        → classifyClaimsPrompt / extractClaimsPrompt
          → processExtractedClaims (scoring, dedup, grounding)
            → embed claims
              → evaluateLookahead (batch, pre-commit)
                → if fail: regenCallback (full response regen, up to 3x)
                  → re-extract, re-score, re-evaluate
                    → best batch wins
                → commitAnNodes
```

## Data flow (proposed)

```
LLM turn pipeline (attempt 1)
  → statement₁
    → extract claims₁ → score → embed
      → evaluateLookaheadPerClaim (marginal utility per claim)
        → classify each claim as STRONG or WEAK with reasons
        → batch fails threshold?
          → YES: build retry guidance from per-claim analysis
            → LLM turn pipeline (attempt 2, with guidance)
              → statement₂ (entirely new, influenced by guidance)
                → extract claims₂ → score → embed
                  → evaluateLookaheadPerClaim
                    → accumulate analysis (attempt 1 + 2 results)
                    → batch fails threshold?
                      → YES: retry again (up to 3x), cumulative guidance
                      → NO: commit claims₂
          → NO: commit claims₁
```

Each retry is a **full statement regeneration**. Claims are never preserved across attempts.
The only thing carried forward is the **analysis** of what was strong and weak.

## Files that would change

- `lib/debate/lookaheadGate.ts` — new `evaluateLookaheadPerClaim` function, `buildClaimAnalysis` function
- `lib/debate/prompts.ts` — `planStagePrompt` gets strong foundations / avoid claims blocks
- `lib/debate/envelopes.ts` — `planStageEnvelope` gets the same blocks
- `lib/debate/turnPipeline.ts` — add `strongFoundations` / `avoidClaims` to `TurnPipelineInput`
- `taxonomy-editor/src/renderer/hooks/useDebateStore.ts` — refactor retry loop to accumulate analysis across attempts
- `taxonomy-editor/src/renderer/components/DiagnosticsWindow.tsx` — render per-claim marginal utility

## Retry injection points in the turn pipeline

The turn pipeline has 3 stages: **Brief → Plan → Draft**. Each can be frozen from a prior run.

### Option A: Freeze Brief, inject guidance into Plan (recommended)

- Freeze the Brief from the first run (`frozenBrief`) — situation assessment doesn't change
- Add `strongFoundations` and `avoidClaims` to `TurnPipelineInput`
- Plan prompt gets two new blocks derived from per-claim analysis:

```
=== STRONG FOUNDATIONS ===
These arguments are strategically valuable. Base your statement on them.

- "Hardware-locked trust anchors are a necessary component..." (strength: 1.0, Δu: +0.012)
  Why strong: Strong declarative claim — anchors position with high specificity.
- "Automated hardware anchors should manage the screening..." (strength: 1.0, Δu: +0.008)
  Why strong: Concrete mechanism proposal — advances the debate with actionable specificity.

Ground your statement in these strong positions. You may extend or sharpen them.

=== DO NOT USE THESE ARGUMENTS ===
These arguments weaken your overall position. Do not use them or make substantially
similar arguments.

- "Human-in-the-loop oversight is not a mere performance bottleneck..." (strength: 0.35, Δu: -0.020)
  Why weak: Low specificity belief — vague assertion without concrete mechanism or evidence.
  This kind of argument dilutes your position against otherwise strong claims.
```

- **Key constraint**: The retry LLM has no memory of prior attempts. All prompt text must be
  standalone guidance — never reference "your previous response," "do not repeat," or "revised."
  Frame as "use" / "do not use."
- The framing is **directive, not prescriptive**: "base your statement on these" gives the LLM
  strong foundations; "do not use these for these reasons" teaches what to avoid
- The LLM generates a **completely new statement** — it is not editing or patching the previous one
- Plan stage produces `planned_moves` informed by the analysis; Draft builds the statement from the plan
- **Pro**: LLM can rethink strategy with clear guidance; 2 LLM calls per retry (Brief is skipped)
- **Con**: No guarantee the new statement will contain claims similar to the strong foundations — the
  guidance is influential, not deterministic

### Option B: Full pipeline with guidance (slower, more flexible)

- Run full Brief → Plan → Draft pipeline with guidance injected into Plan
- Don't freeze anything — let the LLM fully reconsider the situation
- **Pro**: Most flexible; LLM can discover better strategies
- **Con**: 3 LLM calls per retry; slowest; Brief is redundant work

### Recommendation

Option A — freeze Brief, inject into Plan. Best balance of speed (2 calls) and quality (LLM
can strategize around guidance). The Brief is stable across retries (debate situation doesn't
change between attempts), but the Plan should adapt to the claim-level analysis.

### New fields on TurnPipelineInput

```typescript
/** Strong claims to base the argument on — injected into Plan stage as foundations. */
strongFoundations?: {
  text: string;
  marginal_delta: number;
  base_strength: number;
  reason: string;  // e.g. "Strong declarative claim — anchors position"
}[];
/** Weak claims to avoid using — injected into Plan stage with reasons. */
avoidClaims?: {
  text: string;
  marginal_delta: number;
  base_strength: number;
  reason: string;
}[];
```

### regenCallback shape (Option A)

```typescript
const regenPipelineInput = {
  ...pipelineInput,
  frozenBrief: firstRunBrief,           // skip Brief stage
  strongFoundations: strongClaims,       // "base your argument on these"
  avoidClaims: weakClaims,               // "do not use these for these reasons"
};
```

### Additional files that would change (for Option A)

- `lib/debate/turnPipeline.ts` — add `strongFoundations` / `avoidClaims` to `TurnPipelineInput`
- `lib/debate/prompts.ts` — `planStagePrompt` gets strong foundations / avoid claims blocks
- `lib/debate/envelopes.ts` — `planStageEnvelope` gets the same blocks

## Diagnostics UI changes

- Show marginal Δu per tentative claim (color-coded: green positive, red negative)
- Tag each claim as STRONG or WEAK with reason
- For each retry attempt, show the full set of claims extracted from the new statement
- Show which guidance was injected (strong foundations + avoid list)
- Overall summary: "Attempt 1: Δu = -0.008 (2 strong, 1 weak). Attempt 2: Δu = +0.005 (accepted)"
