# Policymaker-Adapted Debate — Implementation Guide

**Companion to:** `research/comp-linguist/docs/policymaker-adapted-debate-design.md`
**Author:** Technical Lead
**Date:** 2026-05-27
**Status:** Approved — ready for implementation

---

## Phase 3: Claim Extraction — Quality Control

### Schema

Add to `ArgumentNetworkNode` in `types.ts`:
```typescript
political_salience?: 'high' | 'medium' | 'low';
```

Zod schema in `schemas.ts`:
```typescript
political_salience: z.enum(['high', 'medium', 'low']).optional().catch('medium')
```

Uses `.catch('medium')` to auto-correct invalid values at the parsing boundary. Omission returns `undefined` via `.optional()`.

### Extraction Prompt Criteria

Include in extraction prompt ONLY when `audience === 'policymakers'`:

```
"political_salience":
  "high" = Names a specific bill, agency, budget line, executive order,
           identifiable constituency, or references a specific court ruling
           or legal standard (e.g., Chevron deference, Section 230, strict
           liability standard). The claim could appear in a committee
           hearing or regulatory comment letter.
  "medium" = Relevant to governance but requires translation to connect
             to a pending decision. Discusses institutional structures,
             regulatory frameworks, or enforcement in general terms.
  "low" = Technically important but requires multiple inferential steps
          to connect to any pending political decision.
```

### QBAF Boost

In `processExtractedClaims()`: when `audience === 'policymakers'` AND `political_salience === 'high'`, add +0.10 to `base_strength`. Only fires on explicit `'high'`, never on `undefined`.

### Calibration

- Golden set: 20 claims (10 from existing policymaker debates, 10 synthetic) with human-labeled salience
- Metric: `political_salience_calibration` = % agreement LLM vs human. Target: 80%+
- No FIRE-style iterative refinement — refine prompt criteria if calibration < 70%

---

## Phase 4: Situation Injection — Runtime Computation

### Function

```typescript
// In lib/debate/taxonomyRelevance.ts
export function computePolicymakerRelevanceBoost(
  situation: SituationNode,
  audience: string,
): number {
  if (audience !== 'policymakers') return 0;
  const desc = (situation.description || '').toLowerCase();
  const keywords = /\b(regulation|regulatory|legislation|legislative|enforcement|agency|commission|mandate|compliance|jurisdiction|statute|executive order|rulemaking|oversight body|congressional|parliamentary)\b/gi;
  const matches = (situation.description || '').match(keywords) || [];
  return matches.length >= 2 ? 0.10 : 0;
}
```

- Requires 2+ keyword matches (avoids false positives from incidental mentions)
- Called in `selectRelevantSituationNodes()` alongside embedding similarity
- No schema change on `SituationNode`

### Injection Manifest

Log alongside lineage boost:
```json
{
  "policymaker_situation_boost": {
    "boosted": 3,
    "situations": ["sit-042", "sit-089", "sit-155"]
  }
}
```

---

## Phase 5: Moderator — IMPLEMENTATION CHALLENGE Move

### Trigger Conditions

New move type in `moderator.ts`. Fires when ALL conditions hold:
1. `audience === 'policymakers'`
2. Debate in argumentation phase for 3+ rounds
3. `pragmatic_convergence > 0.60` (debaters are agreeing in principle)
4. Average `operationality` of cited Intention nodes < 3.0 (discussion is abstract)

### Move Template

```
MODERATOR: The debaters agree on principles but haven't addressed
implementation. A policymaker needs specifics: Who writes the regulation?
Which agency enforces it? What's the budget? What happens when the first
company challenges it in court? [target_debater], address implementation.
```

---

## Diagnostics Plan

| Phase | Data | Panel | Flight Recorder | Calibration |
|-------|------|-------|----------------|-------------|
| 1. Topic | `policymaker_scores: { actor_specificity, decision_proximity, constituency_impact }` | Topic critique section (sub-scores) | Yes | Yes |
| 3. Extraction | `political_salience` per claim | Claims tab (badges + histogram) | Yes (per-turn counts) | Yes (`salience_calibration`) |
| 4. Situations | `policymaker_situation_boost: { boosted, situations }` | Injection manifest panel | Yes (via manifest) | No |
| 5. Moderator | IMPLEMENTATION_CHALLENGE count + triggers | Moderator panel (new row) | Yes | Yes (firing rate) |
| 6. Synthesis | `political_feasibility`, `implementation_specificity` scores | Synthesis section (new columns) | Yes | No |

---

## Owner Map

| Ticket | Owner | Blocked By |
|--------|-------|------------|
| Schema + extraction gating + QBAF boost | Shared Lib | — |
| Situation relevance boost | Shared Lib | — |
| Moderator IMPLEMENTATION CHALLENGE | Shared Lib | — |
| Prompt text (persona, synthesis, news report, topic) | CL (prompts) + Shared Lib (gating) | — |
| Diagnostics UI (badges, histograms, panels) | Taxonomy Editor | Schema ticket |
| Calibration golden set | CL | Schema ticket |
