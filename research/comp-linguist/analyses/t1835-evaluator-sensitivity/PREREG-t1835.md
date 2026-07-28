# Preregistration: Evaluator-Model Sensitivity Probe

**Last updated:** 2026-07-28
**Author:** CL.Investigate1 (Computational Linguist)
**Ticket:** t/1835 (from the RA judgment on t/1832; MAD review AC#3, `docs/mad-liang-2024-review.md`, t/1611)
**Status:** Preregistered. No results read at time of writing. The decision band in §6 is frozen; changing it after any result is read voids the probe.

## 1. Question

Does the single-model neutral evaluator (`neutralEvaluator.ts:260`, one `model` string) produce model-family-correlated output on the evaluator-derived metrics that feed the calibration optimizer? If swapping the evaluator to a disjoint model family moves those metrics beyond a preregistered band, "anonymization is sufficient" is falsified as a stipulation and the risk on t/1832 escalates from stipulated to measured. If deltas stay within band, "anonymization suffices" promotes from stipulated to derived and t/1832 closes with evidence.

This measures a **necessary condition** for the stylistic-affinity bias RA flagged: if the evaluator's judgments do not move when the model family changes, there is no channel for same-family favoritism to enter the metrics. It is not by itself proof of *same-family* favoritism, because the committed default `stage_model_overrides.enabled: false` means we cannot currently stand up heterogeneous same-family debater/evaluator pairings without enabling the opt-in. That limitation is recorded in §7.

## 2. Scope: the four metrics that feed the optimizer objective

Per RA's code verification (t/1832#1), only these evaluator-derived metrics feed `computeQualityScore` / the calibration path; the per-turn quality axes do NOT (they are `PROCESS_REWARD_WEIGHTS`, not evaluator-scored):

1. `crux_addressed_ratio` (→ `computeQualityScore`, `qualityScore.ts:31`), from the evaluator's per-crux `status`.
2. `situation_crux_alignment` (→ `computeQualityScore`, `qualityScore.ts:33`).
3. `crux_resolution_divergence_rate` (`calibrationLogger.ts:1154`), evaluator crux status scored against the engine crux tracker as reference.
4. `engaging_real_disagreement` (boolean, `calibrationLogger.ts:432`, from `overall_assessment.debate_is_engaging_real_disagreement`).

Per-claim `neutral_assessment` (well_supported/refuted) is display-only, not consumed by calibration; excluded from the primary readout.

## 3. Design: paired, same-transcript, model-family-swapped

The archived neutral evaluations are unusable as the "primary" arm: a survey of the 8 fleet-wide archived debates found `neutral_evaluations[].cruxes` near-empty (0 cruxes on 4 of 5 exp-1438 debates, 2 on the fifth), because those runs extracted few evaluator cruxes. So the probe **re-runs both arms fresh** rather than reading one arm from the archive. This also makes the comparison strictly paired: identical transcript, identical speaker mapping, identical checkpoint and prompt; the *only* thing that changes is the evaluator model family.

- **Arm A (primary family):** `gemini-2.5-flash`, the model the archived debates actually evaluated under (`stage_models.evaluator` on every exp-1438 debate).
- **Arm B (disjoint family):** a Claude model (Anthropic), a different vendor family. Exact model id fixed in §5 before the run.
- **Held constant across arms per debate:** the reconstructed `runNeutralEvaluation` inputs (topic, transcript, `activePovers`), the `SpeakerMapping` (built once per debate and reused for both arms, so anonymization is identical), the checkpoint (`final`), and the engine `crux_tracker` (read from the archive; the reference for metric 3).

## 4. Sample

- **N = all 8 fleet-wide archived debate JSONs** with a substantive transcript (`lib/debate/exp-1438-results/*-debate.json` and any `*debate*.json` under `lib/debate`/`research/comp-linguist` excluding diagnostics/harvest sidecars). Selection is census, not sampling; the corpus is small enough to use whole.
- **Exclusion:** any debate whose transcript has fewer than 6 turns (degenerate/smoke), recorded before the run and reported.
- N ≤ 8 is a hard limitation on statistical power; see §7. The probe is a *screening* measurement, not a powered study. A large in-band result is weak evidence of no-effect, whereas a large out-of-band result is strong evidence of an effect.

## 5. Harness (to be built after this doc is committed)

A standalone CL measurement script under this directory (`run_probe.ts` / node via `tsx`) that imports from `lib/debate`:
- `runNeutralEvaluation`, `buildSpeakerMapping`, the `AIAdapter` construction used in production.
- For each debate: load JSON (BOM-tolerant), reconstruct `NeutralEvaluatorConfig` for the `final` checkpoint, build one `SpeakerMapping`, run arm A then arm B with that same mapping, and record both `NeutralEvaluation` objects verbatim to `raw/<debate-id>.{A,B}.json`.
- Metric extraction re-uses the production computations where reachable (crux status → `crux_addressed_ratio`; situation refs → `situation_crux_alignment`; crux-status-vs-tracker → `crux_resolution_divergence_rate`; `overall_assessment` → engaging), computed identically for both arms so any delta is attributable to the evaluator model alone.
- **Exact arm-B model id, adapter wiring, temperature (match production evaluator temperature), and any ret/backoff are fixed in the committed harness before the first evaluation runs.** The harness is committed alongside its first output so the run is reproducible.

Keys required: `GEMINI_API_KEY` (arm A) and `ANTHROPIC_API_KEY` (arm B). Both are present in the run environment. Cost is bounded: ≤ 8 debates × 2 arms = ≤ 16 evaluator calls, one checkpoint each.

## 6. Frozen decision band and rule

For each of the four metrics, compute the per-debate arm-A-vs-arm-B delta, then the corpus summary:
- Continuous metrics (`crux_addressed_ratio`, `situation_crux_alignment`, `crux_resolution_divergence_rate`): **mean absolute delta** `MAD_m = mean_d |A_{m,d} − B_{m,d}|` over debates where the metric is defined in both arms.
- Boolean metric (`engaging_real_disagreement`): **disagreement rate** `DR = fraction of debates where A ≠ B`.

**Decision (frozen):**

| Outcome | Condition | Disposition |
|---|---|---|
| **WITHIN BAND** | every continuous `MAD_m ≤ 0.10` AND `DR ≤ 0.20` | Evaluator output is model-family-stable at screening power. Report to t/1832: promote "anonymization suffices" stipulated → **derived**, close t/1832 without a pin. Still recommend the near-zero-cost config-time overlap warning (§8) as defense-in-depth. |
| **BORDERLINE** | any continuous `MAD_m` in (0.10, 0.20] OR `DR` in (0.20, 0.35] | Sensitivity is non-trivial but not decisive at N ≤ 8. Metric stays **stipulated**. Recommend the config-time overlap warning AND a larger confirmatory run (more debates and/or a third family) before deciding a pin. |
| **OUT OF BAND** | any continuous `MAD_m > 0.20` OR `DR > 0.35` | Evaluator output is materially model-dependent. Escalate on t/1832: recommend guard (a) pin the evaluator to a family disjoint from all debater backends, and/or rotation/ensemble; metric stays stipulated with a measured defect pointer. |

Rationale for the thresholds (set before results): 0.10 is the tolerance below which a shift in a `[0,1]` calibration metric is within the optimizer's own `[0.35, 0.60]` value bounds and 5-debate averaging noise; 0.20 is the point past which a systematic shift would plausibly move `computeQualityScore` enough to change an optimizer recommendation. `DR` bands mirror the same low/medium/high split for a binary signal. These are stipulated screening thresholds, not derived; they are deliberately loose because N is small and the cost of a false "out of band" (an unnecessary confirmatory run) is lower than a false "within band" (declaring safety that is not there).

## 7. Limitations (preregistered)

- **N ≤ 8, low power.** A within-band result is weak evidence of no effect. This is why the within-band disposition still keeps the cheap defense-in-depth warning and the borderline/out-of-band dispositions ask for confirmation rather than acting hard on one screen.
- **Two families, one pair.** Arm B is a single disjoint family (Claude). A true family sweep (Groq/Llama, etc.) is deferred to a confirmatory run if this screen is borderline or out of band.
- **Screens sensitivity, not same-family favoritism directly.** With `stage_model_overrides.enabled: false` we cannot cheaply construct a debater-shares-evaluator-family pairing. This probe measures the upstream necessary condition (does evaluator output depend on model family at all). If output is family-stable, the same-family favoritism channel is closed regardless of overrides.
- **Thin archived crux extraction** may make the crux-based metrics low-power on some debates; the engaging boolean and `crux_addressed_ratio` are expected to be the highest-signal readouts. Debates where a metric is undefined in either arm are excluded from that metric's `MAD_m` and the exclusion count is reported.

## 8. Optional defense-in-depth (RA suggestion, independent of the probe result)

A config-time warning when `stage_model_overrides` is enabled with a debater model family overlapping the evaluator model family. Near-zero cost, closes the latent same-family gap without pinning. Recommended in every outcome above except a decisive out-of-band (where a pin supersedes it). If adopted, it is a small CL-scoped change to the config-load path; spun as its own ticket, not folded into this measurement.

## 9. Reporting

On completion: a Results addendum to this file (arm-A/arm-B per-metric table, the four summary statistics, exclusions, and the §6 verdict), the raw per-debate evaluation pairs under `raw/`, and a report back to t/1832 (and t/1611 if the AC#3 disposition changes). Provenance of `crux_undecided`-style caution applies: the verdict is whatever the numbers say, not what is convenient; a within-band result is only reported as "derived" if the band is actually met.

---

## Results (2026-07-28)

**Run:** `run_probe.ts`, 5 archived exp-1438 debates × 2 arms = 10 evaluations. Raw evaluations in `raw/`, machine summary in `results.json`, both committed with this doc.

**Deviations from the frozen protocol (§5), disclosed:**
- Arm A is `gemini-3.5-flash-lite`, not `gemini-2.5-flash` (the archived evaluator model is no longer in `ai-models.json`). The probe tests model-family sensitivity with both arms re-run fresh, so the archived model identity never enters the comparison; a current Gemini-family model is the faithful primary. Arm B is `claude-haiku-4-5`.
- N = 5. Only the 5 exp-1438 `*-debate.json` files carried a substantive (≥6-turn) transcript; the fleet-8 estimate in §4 counted sidecars. This is within the preregistered "N ≤ 8, screening power" envelope.
- One Arm-B run (debate `6eaa3c75`) hit the model's 8192 completion-token ceiling and returned truncated output, so 0 cruxes parsed. It is excluded from all three continuous metrics (values null), just as the "undefined in either arm" rule prescribes; its engaging boolean is retained. This is a token-budget artifact of the harness, not an evaluator disagreement.

**Per-debate (A = gemini-3.5-flash-lite, B = claude-haiku-4-5):**

| debate | A car | B car | A cdr | B cdr | A sca | B sca | A/B eng | A nCruxes | B nCruxes |
|---|---|---|---|---|---|---|---|---|---|
| 6eaa3c75 | 0.25 | (capped) | 0.25 | (capped) | 1.0 | (capped) | true/true | 4 | 0 |
| add43b5e | 1.00 | 0.20 | 1.00 | 0.20 | 1.0 | 1.0 | true/true | 3 | 5 |
| e63ad484 | 1.00 | 0.40 | 1.00 | 0.40 | 1.0 | 1.0 | true/true | 3 | 5 |
| f67680e6 | 1.00 | 0.20 | 1.00 | 0.20 | 0.0 | 1.0 | true/true | 2 | 5 |
| a0db5a32 | 0.50 | 0.20 | 0.50 | 0.20 | 1.0 | 1.0 | true/true | 2 | 5 |

**Summary statistics (§6):**

| Metric | n | Statistic | Band | Result |
|---|---|---|---|---|
| `crux_addressed_ratio` | 4 | MAD = 0.625 | ≤ 0.10 | OUT (6.25×) |
| `crux_resolution_divergence_rate` | 4 | MAD = 0.625 | ≤ 0.10 | OUT |
| `situation_crux_alignment` | 4 | MAD = 0.25 | ≤ 0.10 | OUT |
| `engaging_real_disagreement` | 5 | DR = 0.00 | ≤ 0.20 | within |

**Verdict per the frozen §6 rule: OUT OF BAND.** Three of the four metrics exceed the 0.20 escalation threshold, two of them by more than 3×. The effect is systematic and single-direction on every debate: the Gemini arm extracts few cruxes (2 to 4) and labels most "addressed" (0.5 to 1.0), while the Claude arm extracts more cruxes (5) and labels few "addressed" (0.2 to 0.4). `crux_resolution_divergence_rate` tracks `crux_addressed_ratio` almost one-to-one because the engine cruxes are seldom in a resolved/addressed state, so divergence reduces to the evaluator's addressed fraction.

**Interpretation (careful).** This measures that the calibration-feeding crux metrics are strongly *evaluator-model-dependent*, which was the preregistered necessary condition. It does not isolate *same-family favoritism*, the sharper bias RA framed: the gap is driven by two models of differing capability disagreeing on how many cruxes exist and when one is "addressed", not by a debater sharing the evaluator's family. The consequence for the optimizer is the same and is now measured rather than stipulated. `crux_addressed_ratio` and `situation_crux_alignment` feed `computeQualityScore`, so the optimizer's objective on the crux axis moves by roughly 0.6 purely as a function of which evaluator model is configured, well past what the bounded auto-tuner's 5-debate averaging and value bounds absorb. The `engaging_real_disagreement` boolean was stable (DR = 0), but both arms returned `true` on all 5 debates, so it is an uninformative signal here, not evidence of stability.

**Escalation (updates the t/1832 disposition):**
1. The three crux-based evaluator metrics are **evaluator-model-relative**. Any change of the evaluator model is a hard cutover for these fields, the same treatment `crux_addressed_ratio` already carries for evaluator-*prompt* changes (t/1670). This belongs in `metric-provenance-register.md`.
2. Pin and version the evaluator model as a fixed instrument parameter, record it on every calibration run (already logged via `stage_models`), and never compare these metrics across evaluator-model revisions.
3. "Anonymization suffices" does NOT promote to derived. The probe did not clear the band; it failed it decisively. The metric stays **stipulated** with a measured evaluator-model-sensitivity defect pointer to this file.
4. RA's guard (a), pinning the evaluator disjoint from debater backends, is necessary but insufficient: the issue is not only same-family favoritism but that the metric's absolute level depends on the evaluator model. Pinning fixes cross-run comparability without making the metric a model-invariant measurement. A stronger fix (calibration against a fixed reference evaluator, or ensembling the evaluator) is the real path off stipulated.

**Confidence.** N = 5 is small, but the effect is 3 to 6× the band and single-direction on every debate, so the out-of-band conclusion holds despite the sample size: a within-band result at N = 5 would have needed caution, an out-of-band result of this magnitude does not. A confirmatory run at larger N and a third family would sharpen the effect size but is not needed to act. Follow-up worth filing: raise the evaluator's completion-token ceiling so the `6eaa3c75` truncation does not recur, and add the register cutover note from escalation item 1.
