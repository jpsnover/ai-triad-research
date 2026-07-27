# t/1771: `affect_appropriateness` Is Near-Degenerate, So Do Not Refit the Baselines

**Ticket:** t/1771 (origin: CL proactive audit r/2, 2026-07-27)
**Author:** Computational Linguist
**Last updated:** 2026-07-27
**Status:** Finding. Blocks the ticket's stated scope; re-scope proposed.

## Verdict

The ticket proposes fitting `AFFECT_PHASE_BASELINES` to the observed affect profiles of 410 real debates, on the reasoning that when 95% of a real sample misses a stipulated target, the target is the more likely fault. The premise is sound and the instinct is right, but the diagnosis stops one level too high. The 0.60 target is not merely mis-set. **The metric it gates is near-degenerate, because the formula compares two quantities that are not in the same units.** Refitting the baselines against that formula would produce a metric that reports "appropriate" almost always, which is worse than the current visible failure: it would convert a metric that is obviously broken into one that is invisibly broken.

## The defect

`computeAffectAppropriateness` (`lib/debate/affectSignals.ts:132-142`) computes

```
meanDeviation   = mean over 5 categories of | profile[cat] − baseline[cat] |
appropriateness = max(0, 1 − meanDeviation / MAX_ACCEPTABLE_DEVIATION)     // MAX_ACCEPTABLE_DEVIATION = 0.35
```

The two operands are different kinds of number.

- `profile[cat]` comes from `computeAffectProfile` → `categoryScore`, which is `min(1, (hits per 100 words) / AFFECT_SATURATION_RATE[cat])`. That is an **absolute per-category intensity**. In the 410-debate sample the weighted mean of these is **0.080** (range 0.024–0.194).
- `baseline[cat]` is a **normalized share**. Each phase's five values sum to ~1.0 (confrontation 0.98, argumentation 0.95, concluding 1.05). They describe how affect should be *distributed*, not how much of it there should be.

Subtracting a share (~0.04–0.39) from an absolute intensity (~0.02–0.19) term by term means the deviation is dominated by the baseline vector. The debate's actual emotional balance barely enters.

## Four measurements confirming it

**1. A text with zero emotional language scores 0.40–0.46.** With `profile` all zeros, `meanDeviation` is just the baseline mean, so appropriateness is fixed by the baseline alone:

| Phase | baseline sum | zero-affect score |
|---|---|---|
| confrontation | 0.98 | **0.440** |
| argumentation | 0.95 | **0.457** |
| concluding | 1.05 | **0.400** |

**2. The whole observed distribution hugs that floor.** Across 410 real debates: mean 0.555, median 0.558, **min 0.444**, max 0.715, **sd 0.035**, p5 0.487, p95 0.598. The observed minimum is the zero-affect value. Ninety percent of the sample sits inside a 0.11-wide band immediately above what an affect-free text would score.

**3. The theoretical ceiling is ~0.63–0.69, not 1.0.** For appropriateness ≥ T, `sum|dev|` must be ≤ `5 × 0.35 × (1 − T)`. Since `sum|dev| ≥ |sum(baseline) − sum(profile)|`, and real profiles total roughly 0.40 against a baseline total of ~1.0, the best achievable score, reached only if affect is distributed proportional to the baseline shares, is 0.669 (confrontation), 0.686 (argumentation), 0.629 (concluding). The stipulated 0.60 target therefore sits within 0.03–0.09 of the mathematical maximum. That, not off-register debating, is why 391 of 410 miss it.

**4. The metric is uncorrelated with the affect it is built from.** Pearson r between `affect_intensity_mean` and `affect_appropriateness` over the same 410 debates is **0.041**. A score computed entirely from the affect profile, yet statistically independent of that profile's magnitude, is reporting close to a constant plus noise.

## Why refitting would make things worse

Fit the baselines to the observed absolute intensities and they become roughly `{urgency 0.02, fear 0.03, hope 0.01, outrage 0.01, empathy 0.01}`. Deviations then shrink to near zero for nearly every debate, and appropriateness pins near 1.0 across the corpus. The metric would pass any sanity check aimed at the old symptom (no more 95% below target) while having lost its remaining ability to discriminate. It becomes the no-lose bucket, which is the same failure mode the crux-verdict work guarded against with an evidence gate (t/1669), and the grade inflation the provenance register's no-evidence-pointer rule exists to prevent.

## Recommended re-scope

**Step 1, fix the construct (DebateTool, CL-specified).** Normalize the profile to shares before comparing, so the metric measures affect *balance*, which is what "appropriateness of register" means:

```
total = sum over categories of profile[cat]
share[cat] = total > 0 ? profile[cat] / total : baseline[cat]      // no affect ⇒ no evidence of inappropriateness
meanDeviation = mean over categories of | share[cat] − baseline[cat] |
```

Intensity stays where it belongs, in the existing `affect_intensity_mean` / `affect_intensity_variance`. Separating balance from magnitude is what makes both interpretable. The zero-affect case must return the baseline (or null), not a spurious mid-range score. A turn with no emotional language is not evidence of *inappropriate* emotion, and conflating those is part of what flattened the current distribution.

**Step 2, make per-category profiles observable.** They are not logged today. The calibration entries carry only `affect_intensity_mean`, `affect_intensity_variance`, and `affect_appropriateness` (verified across all 410). Baselines cannot be derived from shares that were never recorded. Either log the per-category profile on the calibration entry, or recompute it from archived transcripts. This is the actual prerequisite for any derivation, and it is why Step 3 cannot run first.

**Step 3, then derive and only then promote.** With shares observable, fit `AFFECT_PHASE_BASELINES` per phase to the empirical share distribution, re-derive `MAX_ACCEPTABLE_DEVIATION` (also stipulated, also unexamined) from the observed spread, and move the affected rows stipulated→derived in `metric-provenance-register.md` with the evidence pointer. n = 410 clears the replication gate (R-1) comfortably, so the sample is not the constraint; the construct is.

**What the ticket asked that I am explicitly not doing:** neither branch of its dichotomy is answerable yet. I cannot re-derive the threshold from the observed distribution (Step 2 blocks it), and I cannot confirm from transcripts that debates are "genuinely off-register," because the current instrument cannot distinguish an off-register debate from an affect-free one, since both land in the same narrow band. Sampling transcripts against a metric with sd 0.035 and r ≈ 0 to the underlying signal would be reading noise.

## Provenance

No value changes here, so no row moves class today. `affect_appropriateness` stays **stipulated** and gains a defect pointer to this analysis. It must not be promoted to `derived` on the strength of a baseline refit alone.

**Cross-ticket implication for t/1342 (affect validation study).** The preregistered study measures per-dimension criterion validity of the affect instrument against a human rater. `affect_appropriateness` should be **excluded from that study, or the study deferred for that dimension**, until Step 1 lands. Correlating human appropriateness ratings against a near-constant would produce a low ρ that gets misread as "humans disagree with our lexicon," when the real cause is that the instrument barely varies. That is a false negative bought at the cost of a rater's time.
