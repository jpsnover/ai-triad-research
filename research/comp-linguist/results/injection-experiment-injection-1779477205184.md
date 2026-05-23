# Taxonomy Injection Dose-Response Experiment

**Date:** 2026-05-22T21:17:39.059Z
**Topic:** Will narrow AI automation cause structural unemployment that governments are unprepared for, or will new industries absorb displaced workers as they have in previous technological transitions?
**Model:** gemini-2.5-flash | **Pacing:** tight | **Reps:** 1

## Results

| maxTotal | n | Utilization | Primary Util | Crux Addressed | Tax Mapped | Relevance Var | API Calls | Errors |
|----------|---|-------------|-------------|----------------|------------|---------------|-----------|--------|
| 10 | 1 | 56.6% ±0.0% | 56.6% ±0.0% | 0.0% ±0.0% | 100.0% ±0.0% | 0.0008 | 94 ±0 | 0 |
| 20 | 1 | 59.6% ±0.0% | 59.6% ±0.0% | 0.0% ±0.0% | 100.0% ±0.0% | 0.0008 | 100 ±0 | 0 |
| 35 | 0 | 0.0% ±0.0% | 0.0% ±0.0% | 0.0% ±0.0% | 0.0% ±0.0% | 0.0000 | 0 ±0 | 1 |

## BDI Distribution (avg nodes per turn)

| maxTotal | Beliefs | Desires | Intentions | B:D:I Ratio |
|----------|---------|---------|------------|-------------|
| 10 | 3.0 | 3.0 | 3.0 | 33:33:33 |
| 20 | 3.0 | 3.0 | 3.0 | 33:33:33 |
| 35 | 0.0 | 0.0 | 0.0 | — |

## Analysis

### Utilization Curve
Utilization **declines** from 56.6% (maxTotal=10) to 0.0% (maxTotal=35), a drop of 56.6%. This suggests diminishing returns — the LLM ignores a growing fraction of injected nodes as the list grows.

### Quality Impact
Crux addressed ratio is **stable** across levels. Injection count does not significantly affect debate substance quality.

### Recommendation
Based on the composite of utilization × crux quality ÷ relevance variance, **maxTotal = 20** appears optimal for this topic and model.
The current default (35) may be overshooting. Consider reducing to 20 and monitoring calibration metrics for regression.

### Caveats
- Results are specific to this topic and model. Repeat with diverse topics before generalizing.
- Small N per level — treat as directional signal, not definitive proof.
- Stochastic LLM output means individual runs vary. Focus on trends across levels, not single points.
- Utilization measures citation frequency, not attention. An uncited node may still influence reasoning.

## Per-Run Data

| Level | Rep | Rounds | Util | Primary | Crux | Mapped | API | Duration |
|-------|-----|--------|------|---------|------|--------|-----|----------|
| 10 | 1 | 11 | 56.6% | 56.6% | — | 100.0% | 94 | 4288s |
| 20 | 1 | 11 | 59.6% | 59.6% | — | 100.0% | 100 | 2915s |
| 35 | 1 | ERROR | — | — | — | — | — | 241s |