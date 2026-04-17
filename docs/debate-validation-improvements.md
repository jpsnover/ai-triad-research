# Debate Turn Validation — Improvement Recommendations

**Date:** 2026-04-17
**Based on:** Analysis of 50 turns across 4 debates (2 Claude Sonnet 4.5, 1 Gemini 3.1 Flash Lite, 1 mixed)

## Findings Summary

| Pattern | Scope | Severity |
|---|---|---|
| Single-paragraph wall of text | All backends, all debates | High — universal ignore of formatting guidance |
| Gemini bypasses LLM judge entirely | Gemini backend only | High — no quality feedback on 18/18 turns |
| Taxonomy ref exhaustion in late rounds | All backends, rounds 5+ | Medium — 5 turns scored 0.7–0.8 |
| Abstract claims after round 3 | Gemini dominant (12/18 turns) | Medium — claims lack specificity |
| Clarifies dimension never fires without judge | Structural (validator logic) | Low — score ceiling 0.9 for non-judged turns |
| Repair hints from `accept_with_flag` are discarded | Structural (prompt pipeline) | Medium — no cross-turn feedback loop |

## Recommendation 1: Enforce paragraph structure in prompt and validator

**Problem:** `DETAIL_INSTRUCTION` (prompts.ts:29) says "3-5 paragraphs" but the JSON output examples show `"statement": "your response text"` with no structural cue. Every backend produces single-paragraph walls.

**Prompt change (prompts.ts, `OUTPUT_FORMAT` block ~line 494):**

Add to the `"statement"` field description:

> Your statement MUST contain 3-5 paragraphs separated by `\n\n`. Each paragraph develops one idea. A single unbroken block will be flagged for retry.

**Validator change (turnValidator.ts, lines 151-154):**

Escalate single-paragraph responses from warning to error:

```typescript
// Rule 6: paragraph count 3–5
const paragraphs = statement.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
if (paragraphs.length === 1) {
  // Single-paragraph wall — treat as error to trigger retry
  const msg = `Statement is a single paragraph — split into 3–5 double-newline-separated blocks.`;
  errors.push(msg);
} else if (paragraphs.length < 3 || paragraphs.length > 5) {
  const msg = `Statement has ${paragraphs.length} paragraphs — target 3–5 double-newline-separated blocks.`;
  warnings.push(msg);
}
```

**Priority:** High — affects every turn across all backends.

## Recommendation 2: Ensure Gemini turns reach the LLM judge

**Problem:** The judge gate (turnValidator.ts:328-331) skips Stage-B when Stage-A has errors. Gemini responses pass all deterministic checks cleanly, so they never reach the judge. Result: every Gemini turn gets a flat `pass` at score 0.9 with no advancement narrative, no taxonomy clarification signals, and no contextual repair hints.

**Investigation:** Confirm whether the Gemini debate configs set `deterministicOnly: true` or use a `sampleRate` below 1.0. If so, that's the root cause — remove those overrides for Gemini.

**If configs are not the cause**, the judge gate is already correct (it fires when Stage-A passes). The issue is that Gemini turns produce less sophisticated content that happens to satisfy the deterministic rules. In that case, Recommendation 1 (paragraph enforcement) and Recommendation 4 (abstract claim escalation) will force Gemini turns into retry, which indirectly exposes them to judge review on the retry attempt.

**Alternative structural fix:** Add a "quality floor" gate that triggers the judge when Stage-A produces zero errors AND zero warnings — a suspiciously clean pass from a weaker model may indicate the deterministic checks are too coarse to catch the quality gap.

**Priority:** High — 18 consecutive unjudged turns is a validation gap.

## Recommendation 3: Supply more uncited nodes in late rounds

**Problem:** By round 5+, agents have cited their "obvious" nodes and start recycling, triggering `no_new_refs` warnings and dropping advancement scores to 0.7-0.8.

**Prompt change (prompts.ts, `crossRespondPrompt` ~lines 1007-1019):**

- Increase the uncited node sample from 12 to 20
- After round 4, include a small set of cross-POV nodes from shared policy actions or cross-cutting concerns as citation candidates, with a note like:

> You may also cite nodes from other POVs when engaging directly with their claims. Cross-POV citation demonstrates you understand their position, not that you endorse it.

**Repair prompt change (turnValidator.ts, `buildRepairPrompt` ~line 444):**

When advancement fails due to `no_new_refs`, include specific uncited node IDs in the repair hint rather than the generic instruction. This requires passing `availablePovNodeIds` into the validator (currently not available there).

```typescript
if (!v.dimensions.advancement.pass) {
  sections.push('• Cite at least one of these uncited nodes: ' + uncitedSample.join(', '));
}
```

**Priority:** Medium — affects late-round quality, especially in longer debates.

## Recommendation 4: Escalate abstract claims to error after round 4

**Problem:** Claim specificity (turnValidator.ts:189-203) is always a warning. For Gemini, warnings never trigger retries because Stage-A errors are what drive the retry decision. Result: 12 of 18 Gemini turns flagged for abstract claims with no consequence.

**Validator change (turnValidator.ts, ~line 189):**

```typescript
// Rule 9: claim specificity — error after round 4, warning after round 3
if (round >= 3) {
  const claims = meta.my_claims ?? [];
  const specific = claims.some(c =>
    /\d|[A-Z][a-z]+\s[A-Z][a-z]+|within|by\s\d{4}|percent|%|per year/.test(c.claim),
  );
  if (claims.length === 0) {
    const msg = 'my_claims is empty after round 3 — add at least one claim with a number, timeline, or named entity.';
    (round >= 4 ? errors : warnings).push(msg);
  } else if (!specific) {
    const msg = 'my_claims are all abstract — include a number, named entity, or timeline (e.g. "by 2028", "within 12 months", "≥20%").';
    (round >= 4 ? errors : warnings).push(msg);
  } else {
    advancementSignals.push('specific_claim');
  }
}
```

**Priority:** Medium — primarily benefits Gemini backend quality.

## Recommendation 5: Add deterministic fallback for `clarifies` dimension

**Problem:** `clarifies.pass` is hard-coded to `false` when the judge doesn't run (turnValidator.ts:217). Non-judged turns always score 0.9 max (missing the 0.1 clarifies weight). This removes any incentive for taxonomy clarification without the judge.

**Validator change (turnValidator.ts, in `runStageA`):**

Add a heuristic check on taxonomy_ref relevance strings:

```typescript
// Rule 10: deterministic clarifies signal
const CLARIFY_PATTERNS = /\b(should be (narrowed|broadened|split|merged|qualified|retired))\b|\b(could be split)\b|\b(this (broadens|narrows|qualifies))\b|\b(scope (should|could|needs to))\b/i;
const hasClarifySignal = taxonomyRefs.some(r => CLARIFY_PATTERNS.test(r.relevance ?? ''));
```

Then in the dimensions return, set `clarifies.pass` to `hasClarifySignal` instead of unconditional `false`, and add a signal string when detected.

**Priority:** Low — nice-to-have scoring accuracy improvement.

## Recommendation 6: Feed `accept_with_flag` hints into the next turn's prompt

**Problem:** When a turn gets `accept_with_flag`, the repair hints are recorded in the debate JSON but never shown to the agent again. The agent doesn't learn from flagged issues, so the same problems recur on subsequent turns.

**Prompt change (prompts.ts, `crossRespondPrompt`):**

Add a new parameter `priorFlaggedHints?: string[]` and, when non-empty, append a block before the assignment:

```
=== PRIOR TURN FEEDBACK ===
Your last response was accepted but flagged with these issues:
${hints.map(h => '- ' + h).join('\n')}
Address at least one of these weaknesses in your current response.
```

**Engine change (debateEngine.ts):**

When building the cross-respond call, look up the most recent `turn_validations` entry for the same speaker. If its outcome was `accept_with_flag`, extract `repairHints` and pass them to the prompt builder.

**Priority:** Medium-High — closes the feedback loop without burning retry budget.

## Implementation Status

| Rec | Description | Status | Commit |
|-----|-------------|--------|--------|
| 1 | Paragraph enforcement (single-paragraph → error) | **Done** | `a241212` |
| 2 | Judge model fallback for non-Anthropic backends | **Done** | `a241212` |
| 3 | Expanded uncited nodes + cross-POV suggestions in late rounds | **Done** | see below |
| 4 | Abstract claims escalated to error after round 4 | **Done** | see below |
| 5 | Deterministic fallback for `clarifies` dimension | Not started | — |
| 6 | Feed `accept_with_flag` hints into next turn prompt | **Done** | `a241212` |

## Files Affected

| File | Recommendations |
|---|---|
| `lib/debate/prompts.ts` | 1, 3, 6 |
| `lib/debate/turnValidator.ts` | 1, 4, 5 |
| `lib/debate/debateEngine.ts` | 2 (fallback judge), 3 (cross-POV node IDs), 6 (prior hints to prompt) |
