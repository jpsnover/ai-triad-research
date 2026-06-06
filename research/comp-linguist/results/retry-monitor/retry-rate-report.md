# Retry Rate Monitor — t/307 Results

**Date:** 2026-06-03
**Debates analyzed:** 5 (injection experiments, May 22-23, post-specificity-fix)
**Model:** gemini-2.5-flash
**Total turns:** 40
**Retried turns:** 13
**Overall retry rate:** 32.5% (target: <25%, baseline: ~30%)
**Verdict:** FAIL — retry rate above 25% target. Specificity fix alone is insufficient.

## Per-Debate Breakdown

| # | Config | Retried | Rate |
|---|--------|---------|------|
| 1 | L10-R1 | 3/8 | 37.5% |
| 2 | L20-R1 | 4/8 | 50.0% |
| 3 | L20-F5-R1 | 3/8 | 37.5% |
| 4 | L20-F3-R1 | 2/8 | 25.0% |
| 5 | L25-F3-R1 | 1/8 | 12.5% |

## Root Cause Analysis

16 repair hints from 13 retried turns, classified by category:

| Category | Count | % | Description |
|----------|-------|---|-------------|
| **Intervention compliance** | 7 | 44% | Missing required response fields (`commitment`, `reflection`, `challenge_response`, `probe_response`) for moderator interventions |
| **Claim specificity** | 5 | 31% | Empty `my_claims` or all-abstract claims without numbers/entities/timelines |
| **Paragraph formatting** | 2 | 12.5% | Single-paragraph statements needing 3-5 block split |
| **Citation quality** | 2 | 12.5% | Claims presented without direct citations for specific statistics |

## Key Finding

The **specificity fix** (t/305/t/306) addresses only **31% of retry triggers**. The dominant cause is **intervention compliance failures** (44%) — the model fails to include required structured response fields when responding to moderator interventions (COMMIT, META-REFLECT, CHALLENGE, PROBE).

These are not prompt clarity issues — the intervention schemas are present in the prompt. The model is either ignoring the response field requirement or the field instruction is getting lost in a long prompt.

## Recommendations

1. **Intervention response field reinforcement (HIGH):** Add the required response field name to the intervention injection text itself (not just in OUTPUT FORMAT). E.g., the COMMIT intervention text should end with: `Your response MUST include a "commitment" field.` This places the instruction at recency position relative to the generation.

2. **Lost-in-the-Middle audit for intervention fields (MEDIUM):** The response field schemas are defined in `_buildInterventionResponseField()` but injected mid-prompt. Consider duplicating the field name in the RECALL section when an intervention is active.

3. **Specificity monitoring (LOW):** The specificity fix reduced abstract_claims triggers to 31% of total, down from a higher baseline. Continue monitoring but deprioritize relative to intervention compliance.

## Data Sources

- `research/comp-linguist/results/tmp-L10-R1-*/injection-experiment-l10-r1-debate.json`
- `research/comp-linguist/results/tmp-L20-R1-*/injection-experiment-l20-r1-debate.json`
- `research/comp-linguist/results/tmp-L20-F5-R1-*/injection-experiment-l20-f5-r1-debate.json`
- `research/comp-linguist/results/tmp-L20-F3-R1-*/injection-experiment-l20-f3-r1-debate.json`
- `research/comp-linguist/results/tmp-L25-F3-R1-*/injection-experiment-l25-f3-r1-debate.json`
