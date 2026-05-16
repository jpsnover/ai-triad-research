# Draft Retry Ineffectiveness — Repeated Validation Failure Analysis

## Problem

Draft Attempt 1 and Draft Attempt 2 both fail with the identical error:
> "Your commitment must include 'concessions', 'conditions_for_change', and 'sharpest_disagreements' sub-fields."

The retry prompt does not effectively guide the LLM to fix the issue.

## Architecture: How Draft Retries Work

```
Draft Attempt 1
  → validateDraftStage() → fails (missing commitment fields)
  → repair hint: "Your commitment must include..."
  → buildRepairBlock(hints) → generates correction prompt
  → Draft Attempt 2 (with correction injected)
  → validateDraftStage() → fails AGAIN (same error)
```

## Root Cause: Three Compounding Failures

### 1. No specific repair pattern for commitment fields

`buildRepairBlock()` (turnPipeline.ts:567-649) has specific handlers for:
- Directive non-compliance (regex: `/directive|first paragraph|PIN|PROBE|CHALLENGE/`)
- Single paragraph (regex: `/single paragraph|split into/`)
- Hedge density (regex: `/hedge density/`)
- Claim specificity (regex: `/abstract|number.*entity.*timeline|specific/`)
- Statement duplication (regex: `/duplicate|repeated text/`)
- Move repetition (regex: `/move_types repeat/`)
- Constructive move (regex: `/constructive move|CONCEDE.*PIVOT.*INTEGRATE/`)

**Missing:** No handler for commitment schema compliance (`/concessions|conditions_for_change|sharpest_disagreements|commitment.*sub-fields/`).

The hint falls into the catch-all (line 636-644), which produces a generic `CORRECTIONS FROM PRIOR ATTEMPT:\n- [raw hint text]`.

### 2. Catch-all is conditional and may be silently dropped

```typescript
if (unmatched.length > 0 && sections.length === 0) {  // line 639
```

If ANY other hint matched a specific handler, the `sections.length === 0` condition is false, and the commitment hint is **silently dropped**. The LLM never sees the correction.

### 3. The repair hint lacks structural guidance

The hint from `moderator.ts:820`:
```
'Your commitment must include "concessions", "conditions_for_change", and "sharpest_disagreements" sub-fields.'
```

This tells the LLM WHAT is missing but not:
- The JSON schema expected
- WHERE in the response the commitment block goes
- WHAT the values should look like (arrays vs objects vs strings)
- An example of correct output

## Recommended Fix

### Fix 1: Add a specific repair handler for commitment fields

In `buildRepairBlock()`, add before the catch-all:

```typescript
// Commitment schema compliance (COMMIT move)
if (hints.some(h => /concessions|conditions_for_change|sharpest_disagreements|commitment.*sub-fields/i.test(h))) {
  sections.push(
    `MANDATORY CORRECTION — COMMITMENT STRUCTURE:\n` +
    `Your prior attempt was missing required commitment fields. Your response MUST include a "commitment" object with ALL THREE sub-fields:\n` +
    `{\n` +
    `  "commitment": {\n` +
    `    "concessions": ["specific point you concede to an opponent"],\n` +
    `    "conditions_for_change": ["If [specific evidence], then I would revise my position on [specific claim]"],\n` +
    `    "sharpest_disagreements": {\n` +
    `      "opponent_name": "One sentence: the core irreducible disagreement"\n` +
    `    }\n` +
    `  }\n` +
    `}\n` +
    `Each field must be non-empty. Be specific — name opponents, cite claims, state conditions.`
  );
}
```

### Fix 2: Make catch-all always append (not conditional on sections.length)

Change line 639 from:
```typescript
if (unmatched.length > 0 && sections.length === 0) {
```
to:
```typescript
if (unmatched.length > 0) {
```

This ensures unmatched hints are ALWAYS included, even when other hints also matched.

### Fix 3: Improve the repair hint at source

In `moderator.ts:820`, replace the generic hint with a structural one:

```typescript
repair_hint: 'Your commitment must include "concessions" (array of specific points you concede), "conditions_for_change" (array of "If X, then I would Y" statements), and "sharpest_disagreements" (object mapping opponent names to one-sentence irreducible disagreements). All three must be non-empty.',
```

## Impact

- **Fix 1** alone solves the immediate problem (LLM gets structural guidance on retry)
- **Fix 2** prevents silent hint dropping for any future validation errors
- **Fix 3** improves the hint at source so even the catch-all produces better output
- Together, they eliminate the "identical error on retry" pattern for commitment fields and reduce the class of bugs where repair hints are ineffective
