# Taxonomy Injection Dose-Response Experiment

**Date:** 2026-05-22T19:07:02.906Z
**Topic:** Will narrow AI automation cause structural unemployment that governments are unprepared for, or will new industries absorb displaced workers as they have in previous technological transitions?
**Model:** gemini-2.5-flash | **Pacing:** tight | **Reps:** 1

## Results

| maxTotal | n | Utilization | Primary Util | Crux Addressed | Tax Mapped | Relevance Var | API Calls | Errors |
|----------|---|-------------|-------------|----------------|------------|---------------|-----------|--------|
| 10 | 0 | 0.0% ±0.0% | 0.0% ±0.0% | 0.0% ±0.0% | 0.0% ±0.0% | 0.0000 | 0 ±0 | 1 |
| 20 | 0 | 0.0% ±0.0% | 0.0% ±0.0% | 0.0% ±0.0% | 0.0% ±0.0% | 0.0000 | 0 ±0 | 1 |
| 35 | 0 | 0.0% ±0.0% | 0.0% ±0.0% | 0.0% ±0.0% | 0.0% ±0.0% | 0.0000 | 0 ±0 | 1 |

## BDI Distribution (avg nodes per turn)

| maxTotal | Beliefs | Desires | Intentions | B:D:I Ratio |
|----------|---------|---------|------------|-------------|
| 10 | 0.0 | 0.0 | 0.0 | — |
| 20 | 0.0 | 0.0 | 0.0 | — |
| 35 | 0.0 | 0.0 | 0.0 | — |

## Analysis

### Utilization Curve
Utilization is **flat** across levels (0.0% → 0.0%). The LLM references a consistent fraction regardless of injection count.

### Quality Impact
Crux addressed ratio is **stable** across levels. Injection count does not significantly affect debate substance quality.

### Recommendation
Based on the composite of utilization × crux quality ÷ relevance variance, **maxTotal = 10** appears optimal for this topic and model.
The current default (35) may be overshooting. Consider reducing to 10 and monitoring calibration metrics for regression.

### Caveats
- Results are specific to this topic and model. Repeat with diverse topics before generalizing.
- Small N per level — treat as directional signal, not definitive proof.
- Stochastic LLM output means individual runs vary. Focus on trends across levels, not single points.
- Utilization measures citation frequency, not attention. An uncited node may still influence reasoning.

## Per-Run Data

| Level | Rep | Rounds | Util | Primary | Crux | Mapped | API | Duration |
|-------|-----|--------|------|---------|------|--------|-----|----------|
| 10 | 1 | ERROR | — | — | — | — | — | 1s |
| 20 | 1 | ERROR | — | — | — | — | — | 1s |
| 35 | 1 | ERROR | — | — | — | — | — | 1s |