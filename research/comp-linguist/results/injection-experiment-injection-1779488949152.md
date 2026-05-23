# Taxonomy Injection Dose-Response Experiment

**Date:** 2026-05-23T01:20:34.581Z
**Topic:** Will narrow AI automation cause structural unemployment that governments are unprepared for, or will new industries absorb displaced workers as they have in previous technological transitions?
**Model:** gemini-2.5-flash | **Pacing:** tight | **Reps:** 1
**Grid:** maxTotal × minPerBdi = 20,25 × 3,5,7

## Results

| maxTotal | minBDI | n | Utilization | Primary Util | Crux Addressed | Tax Mapped | Relevance Var | API Calls | Errors |
|----------|--------|---|-------------|-------------|----------------|------------|---------------|-----------|--------|
| 20 | 3 | 1 | 57.6% ±0.0% | 57.6% ±0.0% | 0.0% ±0.0% | 92.2% ±0.0% | 0.0003 | 101 ±0 | 0 |
| 20 | 5 | 1 | 38.2% ±0.0% | 38.2% ±0.0% | 0.0% ±0.0% | 100.0% ±0.0% | 0.0007 | 100 ±0 | 0 |
| 25 | 3 | 1 | 61.6% ±0.0% | 61.6% ±0.0% | 0.0% ±0.0% | 100.0% ±0.0% | 0.0007 | 97 ±0 | 0 |
| 25 | 5 | 0 | 0.0% ±0.0% | 0.0% ±0.0% | 0.0% ±0.0% | 0.0% ±0.0% | 0.0000 | 0 ±0 | 1 |
| 25 | 7 | 0 | 0.0% ±0.0% | 0.0% ±0.0% | 0.0% ±0.0% | 0.0% ±0.0% | 0.0000 | 0 ±0 | 1 |

## BDI Distribution (avg nodes per turn)

| maxTotal | minBDI | Beliefs | Desires | Intentions | B:D:I Ratio |
|----------|--------|---------|---------|------------|-------------|
| 20 | 3 | 3.0 | 3.0 | 3.0 | 33:33:33 |
| 20 | 5 | 5.0 | 5.0 | 5.0 | 33:33:33 |
| 25 | 3 | 3.0 | 3.0 | 3.0 | 33:33:33 |
| 25 | 5 | 0.0 | 0.0 | 0.0 | — |
| 25 | 7 | 0.0 | 0.0 | 0.0 | — |

## Analysis

### Utilization Curve
Utilization **declines** from 57.6% (maxTotal=20) to 0.0% (maxTotal=25), a drop of 57.6%. This suggests diminishing returns — the LLM ignores a growing fraction of injected nodes as the list grows.

### Quality Impact
Crux addressed ratio is **stable** across levels. Injection count does not significantly affect debate substance quality.

### Recommendation
Based on the composite of utilization × crux quality ÷ relevance variance, **maxTotal = 25** appears optimal for this topic and model.

### Caveats
- Results are specific to this topic and model. Repeat with diverse topics before generalizing.
- Small N per level — treat as directional signal, not definitive proof.
- Stochastic LLM output means individual runs vary. Focus on trends across levels, not single points.
- Utilization measures citation frequency, not attention. An uncited node may still influence reasoning.

## Per-Run Data

| Level | Floor | Rep | Rounds | Util | Primary | Crux | Mapped | API | Duration |
|-------|-------|-----|--------|------|---------|------|--------|-----|----------|
| 20 | 3 | 1 | 11 | 57.6% | 57.6% | — | 92.2% | 101 | 3126s |
| 20 | 5 | 1 | 11 | 38.2% | 38.2% | — | 100.0% | 100 | 2668s |
| 25 | 3 | 1 | 11 | 61.6% | 61.6% | — | 100.0% | 97 | 3444s |
| 25 | 5 | 1 | ERROR | — | — | — | — | — | 132s |
| 25 | 7 | 1 | ERROR | — | — | — | — | — | 896s |