# Experiment: BACKGROUND Section Prompt Restructuring

**Ticket**: t/1029
**Author**: Computational Linguist
**Date**: 2026-06-26
**Status**: Design

## Motivation

The BRIEF stage prompt — the most context-heavy stage in the 4-stage debate pipeline (BRIEF → PLAN → DRAFT → CITE) — concatenates ~8 context sections as a single inline stream. This creates two known failure modes:

1. **Lost-in-the-Middle degradation**: Mid-prompt context (cruxes, cross-POV tensions) receives lower attention than content at prompt boundaries. Research (Liu et al., 2023) shows models attend most to content at the beginning and end of long prompts.

2. **Role confusion**: Reference data (taxonomy nodes, commitments) and behavioral instructions (output format, attribution rules) are interleaved. The model must parse what is "data to use" vs. "instructions to follow" from a single stream.

## Current BRIEF Prompt Structure

```
[Role definition — 2 sentences]
[explorationPriming — optional]
[taxonomyContext + commitmentContext + establishedPoints + edgeContext + concessionHint]
[KNOWN CROSS-POV TENSIONS — optional]
[DEBATE SCOPE — optional]
[priorCruxContext — optional]
[IDENTIFIED CRUXES — optional]
=== DEBATE TOPIC ===
[topic + user background]
=== RECENT DEBATE HISTORY ===
[transcript]
[documentBlock — optional]
=== ASSIGNMENT ===
[focusPoint]
[phaseInstructions]
[ATTRIBUTION FIDELITY]
[analysis instructions]
[GROUNDING DEPTH]
[GROUNDING WEIGHTS]
[NODE-ID ACCURACY]
[output format JSON schema]
```

**Problems with this layout:**
- Cruxes land in the middle — empirically the lowest-attention zone
- Attribution fidelity and grounding instructions come after the transcript — recency helps, but they compete with the output format block
- The role definition is just 2 sentences at the very top, giving the model minimal primacy anchoring on what it's supposed to do

## Proposed Variant B: Task / Reference / State

Restructure into three clearly delimited sections, placed for optimal attention:

```
## YOUR TASK
You are an analytical assistant preparing a situation brief for {label},
who represents the {pov} perspective on AI policy.

Your task is to comprehend the current debate state and identify what
matters most for {label}'s next response. This is pure analysis — do not
write any debate statement or adopt the debater's voice.

{phaseInstructions}

ATTRIBUTION FIDELITY: [...]
GROUNDING DEPTH: [...]
GROUNDING WEIGHTS: [...]
NODE-ID ACCURACY: [...]

Respond ONLY with a JSON object (no markdown, no code fences):
{output schema}

## REFERENCE MATERIAL

### Taxonomy Foundations
{taxonomyContext — BDI nodes only}

### Commitments & Positions
{commitmentContext}
{establishedPoints}
{concessionHint}

### Cross-POV Tensions
{edgeContext}
{cross-POV tensions}

### Crux Landscape
{priorCruxContext — cross-debate registry}
{currentCruxContext — this debate's cruxes}

### Source Material
{documentBlock — document analysis or source reminder}
{user background context}

{explorationPriming — if present}

## CURRENT STATE

=== DEBATE SCOPE ===
{topicScope constraints}

=== DEBATE TOPIC ===
"{topic}"

=== RECENT DEBATE HISTORY ===
{transcript}

=== ASSIGNMENT FOR NEXT TURN ===
{label} must address {addressing} on: {focusPoint}
```

### Placement Rationale

| Section | Position | Attention level | Why |
|---------|----------|----------------|-----|
| YOUR TASK | Top (primacy) | Highest | Instructions, output format, and behavioral rules anchor the model on what to do |
| REFERENCE MATERIAL | Middle | Moderate | Most stable content across turns; BDI node IDs are pattern-matchable even at lower attention |
| CURRENT STATE | Bottom (recency) | High | Per-turn state (transcript, assignment) needs high attention — it changes every turn |

### Key Differences from Control

1. **Instructions move to top** — phase instructions, attribution fidelity, grounding rules, and JSON schema all precede any context data
2. **Cruxes move out of the dead zone** — in the control they sit between taxonomy and transcript (middle); in variant B they sit in a clearly labeled subsection readers can scan
3. **Taxonomy context is decomposed** — commitments/established points are separated from raw BDI nodes into their own subsection, making the distinction between "what exists" and "what has happened" clearer
4. **Transcript moves to the very bottom** — ensures recency for the most volatile content

## Evaluation Protocol

### Topics (3, from golden set)

1. **Empirical**: "Should AI systems be required to explain their decision-making processes?" (predominantly Belief-grounded)
2. **Values**: "Should AI development prioritize safety over capability advancement?" (predominantly Desire-grounded)
3. **Mixed**: "How should governments regulate frontier AI development?" (Belief + Desire + Intention)

### Run Parameters

| Parameter | Value |
|-----------|-------|
| Model | gemini-2.5-flash (consistent, free-tier) |
| Temperature | 0.7 |
| Pacing | moderate |
| Max rounds | 8 |
| Speakers | accelerationist, safetyist, skeptic |
| Adaptive staging | on |
| Clarification | off (reduce noise) |

Each topic runs twice: control (flag off) and variant (flag on). Total: 6 debate runs.

### Metrics

**Primary (CL-owned)**:
- `crux_addressed_rate` — proportion of identified cruxes that debaters engage
- `repetition_rate` — proportion of semantically recycled arguments
- `claims_forgotten_rate` — proportion of proposed claims rejected/dropped

**Secondary**:
- Mean taxonomy refs per claim (grounding depth — should not decrease)
- Mean `computed_strength` of AN nodes (argument quality proxy)
- Qualitative review of 3 BRIEF outputs per condition (situation_assessment quality)

### Success Criteria

Variant B is recommended for adoption if:
- At least 2 of 3 primary metrics improve (any magnitude)
- No primary metric degrades by more than 10%
- Grounding depth does not decrease

## Implementation

### Feature Flag

Add `useBackgroundPrompt?: boolean` to `DebateConfig` (default: `false`).

### Code Changes (DebateTool scope)

1. `lib/debate/prompts.ts` — new `briefStagePromptV2(input: StagePromptInput): string` function
2. `lib/debate/turnPipeline.ts` — branch on `config.useBackgroundPrompt` to call V2
3. `lib/debate/debateEngine.ts` — add field to DebateConfig interface

### No Changes To

- PLAN, DRAFT, CITE stage prompts (BRIEF-only experiment)
- Calibration logger (metrics already captured)
- Taxonomy context formatting (same data, different arrangement)

## Risks

- **Low**: Feature flag ensures zero production impact
- **Reversible**: Flag off = instant rollback
- **Token cost**: Identical — same content, reordered
- **False positive risk**: 6 runs is small sample; results are directional, not statistically significant. A positive signal justifies a larger follow-up study, not immediate adoption.
