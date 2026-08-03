# Topic Wisdom Evaluation and Reframing Specification

## Overview

This spec adds a **topic wisdom evaluation** step to the debate setup flow, inserted between topic refinement and clause decomposition. It scores candidate topics across 10 dimensions -- 5 deterministic and 5 LLM-assessed -- and triggers an LLM-powered reframing pass when the score falls below threshold.

Grounded in [wisdom-generating-topics.md](../analyses/wisdom-generating-topics.md). Implementation owned by Shared Lib.

---

## Integration Point

In debateEngine.ts, method runClarification(), insert two new steps after topic synthesis and before clause decomposition:

| Step | Current | Proposed |
|------|---------|----------|
| 1 | clarificationPrompt | clarificationPrompt |
| 2 | concludingPrompt -> topic.final | concludingPrompt -> topic.final |
| **3** | -- | **evaluateTopicWisdom()** |
| **4** | -- | **reframeForWisdom()** if score below threshold |
| 5 | decomposeResolutionIntoClauses | decomposeResolutionIntoClauses |
| 6 | embedResolutionAnchors | embedResolutionAnchors |

Both new steps are **non-fatal**. If evaluation or reframing fails, topic.final is preserved and the debate proceeds normally.

---

## Part 1: Deterministic Scoring (5 dimensions, 0-2 each)

New file: **lib/debate/topicWisdomScore.ts**

### Prerequisites

- Topic embedding: computed from topic.final via adapter.computeQueryEmbedding
- Node embeddings: already in taxonomy.embeddings
- Source evidence index: already lazy-loaded as this.sourceEvidenceIndex in debateEngine
- Node metadata: POV parsed from node ID prefix, BDI category from middle segment

### D1. Crux Density (POV balance)

Score taxonomy nodes activated by the topic. A node is activated if cosine similarity to topic embedding exceeds 0.35.

Count activated nodes per POV (acc, saf, skp). Compute each POV's share of total activated nodes. Take the maximum share.

| Score | Condition |
|-------|----------|
| 2 | max share <= 0.40 (all three POVs balanced) |
| 1 | max share <= 0.60 (two POVs well-represented) |
| 0 | max share > 0.60 (one POV dominates) |

### D2. Evidence Coverage

For each activated node, check whether sourceEvidenceIndex has an entry with at least one fact or keyPoint.

coverage_ratio = nodes_with_evidence / total_activated

| Score | Condition |
|-------|----------|
| 2 | coverage > 0.60 |
| 1 | coverage > 0.30 |
| 0 | coverage <= 0.30 |

### D3. BDI Heterogeneity

Classify activated nodes by BDI category (parsed from node ID: *-beliefs-*, *-desires-*, *-intentions-*). Compute each category's share of total.

| Score | Condition |
|-------|----------|
| 2 | All three categories have share >= 0.20 |
| 1 | Exactly two categories have share >= 0.20 |
| 0 | One category dominates at > 0.70 |

### D4. Abstraction Level

avg_per_pov = total_activated / 3

| Score | Condition |
|-------|----------|
| 2 | 8 <= avg_per_pov <= 15 (sweet spot) |
| 1 | 5-7 or 16-30 per POV |
| 0 | < 5 or > 30 per POV |

### D5. Situation Node Activation

Count activated situation nodes (sit-* or cc-* prefix).

| Score | Condition |
|-------|----------|
| 2 | 2-5 situation nodes |
| 1 | 1 situation node |
| 0 | 0 situation nodes |

---

## Part 2: LLM Frame Assessment (5 dimensions, 0-2 each)

A single LLM call scores the topic's linguistic frame on 5 dimensions. This runs once at debate setup, using the evaluator model.

### Prompt: topicFrameAssessmentPrompt

Add to prompts.ts:

---

> You are evaluating a debate topic's framing to predict whether it will generate productive disagreement. Score each dimension 0, 1, or 2.
>
> Topic: "{topic}"
>
> **CONDITIONALITY** -- Does the topic invite conditional reasoning or binary positions?
> - Score 0: Binary frame that invites yes/no ("Should we regulate AI?")
> - Score 1: Partially conditional ("Should we X given Y?")
> - Score 2: Fully conditional ("Under what conditions would X produce Y?")
>
> **MECHANISM** -- Does the topic ask about causal pathways or just outcomes?
> - Score 0: Outcome-only ("Will X happen?")
> - Score 1: Mixed outcome and mechanism
> - Score 2: Mechanism-first ("Through what pathways does X affect Y?")
>
> **STAKEHOLDER BREADTH** -- Does the topic distribute agency across actors?
> - Score 0: Single actor implied
> - Score 1: Two actors named or implied
> - Score 2: Multiple stakeholders with distinct roles
>
> **TENSION ACKNOWLEDGMENT** -- Does the topic name a genuine conflict?
> - Score 0: Neutral or bland ("Discuss X")
> - Score 1: Tension implied but not named
> - Score 2: Tension explicitly named, ideally with meta-invitation ("Is this even the right framing?")
>
> **SCOPE BOUNDEDNESS** -- Is the topic anchored to concrete artifacts?
> - Score 0: Open-ended ("What should AI policy look like?")
> - Score 1: Partially bounded
> - Score 2: Concrete policy artifacts or phenomena named, specific tension identified
>
> Respond ONLY with JSON:
> {"conditionality": N, "mechanism": N, "stakeholder": N, "tension": N, "scope": N, "reasoning": "one sentence per dimension"}

---

### Composite Score

total = D1 + D2 + D3 + D4 + D5 + F1 + F2 + F3 + F4 + F5

Maximum: 20. Default reframe threshold: **12**.

Persist the full TopicWisdomScore to session.topic.wisdom_score for diagnostics and calibration correlation.

---

## Part 3: Reframing Prompt

When total score < REFRAME_THRESHOLD, the system runs one LLM call to improve the topic. The reframing prompt receives both the topic AND the diagnostic scores, so it knows exactly which dimensions are weak.

### Prompt: reframeTopicForWisdomPrompt

Add to prompts.ts:

---

> You are a debate topic designer optimizing for productive multi-perspective disagreement. A candidate topic has been scored on 10 dimensions and needs improvement.
>
> Original topic: "{topic}"
>
> Wisdom score: {total}/20 (threshold: {threshold})
>
> Weak dimensions (scored 0):
> {weakest_dimensions_list}
>
> Full scores:
> {score_breakdown}
>
> Reframe the topic to improve the weak dimensions. Follow these rules:
>
> CONDITIONALITY: Replace binary framing with conditional framing. Instead of "Should we X?", ask "Under what conditions would X produce Y?" This creates surface area for crux identification -- debaters must specify what would have to be true for their position to hold.
>
> MECHANISM: Replace outcome framing with mechanism framing. Instead of "Will X happen?", ask "Through what pathways does X interact with Y?" Each causal step becomes an independently testable claim, generating richer argument networks.
>
> STAKEHOLDER BREADTH: Distribute agency across multiple actors. Instead of "How should developers ensure safety?", ask "How should responsibility be distributed among developers, regulators, deployers, and affected communities?" This gives each debate perspective natural entry points.
>
> TENSION ACKNOWLEDGMENT: Name the specific conflict, then invite meta-engagement. Instead of "Discuss governance", say "X creates tension between Y and Z -- how should this be resolved, and is 'tension' even the right framing?" This produces argument at both object and frame levels.
>
> SCOPE BOUNDEDNESS: Anchor to concrete policy artifacts or empirical phenomena. Name specific legislation, standards, or documented events as shared reference points.
>
> IMPORTANT CONSTRAINTS:
> - Preserve the original topic's core subject matter -- reframe, do not replace
> - One to three sentences maximum
> - Only improve dimensions that scored 0 or 1 -- do not weaken dimensions that already scored 2
> - The reframed topic must remain debatable from accelerationist, safetyist, and skeptic perspectives
>
> Respond ONLY with JSON:
> {"reframed_topic": "the improved topic statement", "changes_made": "one sentence describing what was changed and why"}

---

### Reframing Rules

- The reframed topic replaces topic.final only if the LLM response parses correctly
- The original topic is preserved in topic.refined for traceability
- A transcript entry of type "system" is added: "Topic reframed for productive disagreement: {changes_made}"
- The wisdom_score is updated to include reframe_applied: true and the changes_made text
- Reframing runs at most once -- no iterative loop

---

## Part 4: Session Persistence

### Type changes in types.ts

Add to the topic object in DebateSession:

- wisdom_score: optional TopicWisdomScore object containing all 10 dimension scores, the total, diagnostics, and reframing metadata
- reframed: optional string -- the reframed topic text if reframing was applied

### CalibrationDataPoint extension

Add to CalibrationDataPoint in calibrationLogger.ts:

- topic_wisdom_total: optional number -- the composite wisdom score (0-20)
- topic_reframed: optional boolean -- whether reframing was applied
- topic_weakest: optional string array -- dimensions that scored 0

This closes the feedback loop: the calibration optimizer can correlate topic wisdom scores with debate quality outcomes and learn which topic properties predict wisdom generation.

---

## Part 5: Configuration

### New config options in DebateConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| enableWisdomEvaluation | boolean | true | Run topic wisdom scoring at setup |
| wisdomReframeThreshold | number | 12 | Score below which reframing triggers |
| wisdomAutoReframe | boolean | true | Auto-reframe or just log the score |

When enableWisdomEvaluation is false, the entire evaluation is skipped. When wisdomAutoReframe is false, the score is computed and persisted but no reframing occurs -- useful for A/B testing the evaluation itself.

---

## Part 6: Diagnostics and Observability

### Progress events

- this.progress('clarification', undefined, 'Evaluating topic wisdom') -- before scoring
- this.progress('clarification', undefined, 'Reframing topic for productive disagreement') -- before reframing

### Transcript entries

After evaluation, add a system transcript entry:

- If score >= threshold: "Topic wisdom score: {total}/20. No reframing needed."
- If reframed: "Topic wisdom score: {total}/20 (below {threshold}). Reframed: {changes_made}"
- If reframing failed: "Topic wisdom score: {total}/20 (below {threshold}). Reframing skipped: {error}"

### Calibration log

The extractCalibrationData function should read session.topic.wisdom_score and populate the new CalibrationDataPoint fields.

---

## Implementation Notes

1. The topic embedding for D1-D5 scoring needs to happen before embedResolutionAnchors (which currently computes the same embedding). To avoid double-computing, evaluateTopicWisdom should store the embedding on a local variable, and if reframing does NOT occur, pass it to embedResolutionAnchors to reuse. If reframing DOES occur, embedResolutionAnchors recomputes for the new topic.

2. The evidence index coverage check (D2) is a simple Set lookup -- iterate activated node IDs and check membership in Object.keys(sourceEvidenceIndex). No heavy computation.

3. The frame assessment LLM call (Part 2) uses the evaluator model, not the debate model. It should be a fast, cheap call -- the prompt is short and the response is small JSON.

4. The reframing LLM call (Part 3) also uses the evaluator model. It receives the diagnostic breakdown so it knows exactly what to fix.

5. For topics sourced from documents or URLs, the evaluation still runs but the reframing prompt should be adjusted to note that the topic is derived from a specific source -- it should reframe the question about the document, not replace the document reference.

---

## Validation Plan

1. **Retroactive scoring**: Score all 130 existing debates on the 5 deterministic dimensions. Correlate with crux_addressed_ratio and repetition_rate from calibration logs. This validates that the scoring dimensions actually predict debate quality.

2. **A/B testing**: Run 20 debates with wisdomAutoReframe=false (score only) and 20 with wisdomAutoReframe=true (score + reframe) on the same topic set. Compare quality metrics.

3. **Frame assessment calibration**: Manually score 20 topics on the 5 frame dimensions. Compare human scores to LLM scores. If agreement is below 70%, tune the prompt.

4. **Reframing quality**: For each reframed topic, verify the reframed version preserves core subject matter and is still debatable from all three perspectives.

---

*Drafted: 2026-05-21 | Computational Linguist | AI Triad Research*
*Implementation: Shared Lib. Review authority: Computational Linguist.*
