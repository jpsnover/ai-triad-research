# Per-Phase Round-Count Experiment — Design of Record

**Ticket:** t/2192
**Author:** Computational Linguist (CL.Investigate1)
**Date:** 2026-08-06
**Status:** Design RE-VALIDATED (pilot re-run passed, 2026-08-07 — see §9b). §2 fencepost sweep is GO as written. Launch gated on two remaining preconditions: t/2219 (cal-log engine-path isolation) landing + owner budget GO.

## Goal

The per-phase round bounds in `lib/debate/phaseTransitions.ts` (`phase_bounds`, mirrored in
`lib/debate/calibration-config.json`) are **stipulated**:

- `min_confrontation_rounds: 1`, `max_confrontation_rounds: 2`
- `min_argumentation_rounds: 2`, `max_argumentation_rounds: 2`
- `min_concluding_rounds: 1`, `max_concluding_rounds: 1`
- `max_total_rounds_default: 10`

Produce an **evidence-backed** recommendation for how many rounds each phase should be allowed to
run, whether the optimum **varies by topic class**, and convert the bounds `stipulated → derived`
in `metric-provenance-register.md` — or, on a null result, record the sweep as evidence that the
current bounds are defensible and keep them stipulated with a pointer to this analysis (a null is a
publishable outcome, not a failure).

The deliverable is a **quality-per-cost frontier**, not raw maximum quality. More rounds cost more
API calls; the recommendation is the knee of the curve, not its ceiling.

---

## 0. What "rounds" means in this engine (read first — it governs the whole design)

Three subtleties in `phaseTransitions.ts` shape every cell below:

1. **Bounds are per-speaker-scaled.** `evaluatePhaseTransition` multiplies every phase bound by
   `s = active POV count` (`phaseTransitions.ts:537-546`). With 2 POVs, `max_argumentation_rounds: 2`
   in config = **4 turns** of allowed argumentation. The config number is a "round" (one turn each);
   the engine counts turns. We **fix POV count at 2** for the primary design so `s` is constant and a
   config delta maps cleanly to a turn delta. POV-count as a factor is deferred (§7).
2. **`maxTotalRounds` is a global backstop measured in the same turn units** as the per-phase
   accumulator (`total_rounds_elapsed`, incremented once per `advanceRound`). If it binds before a
   per-phase cap, it confounds the sweep. We pin it **generously above the sum of every cell's
   per-phase maxima** so the per-phase cap is always the binding constraint (§3).
3. **The `min` bounds are floors, not the knob most runs feel.** In practice the *max* bounds and the
   organic saturation/convergence thresholds decide phase length; `min` only bites when a phase would
   otherwise exit on turn 1. The primary sweep is therefore over **max** bounds (§2). Min bounds are a
   secondary, config-edit-only sweep run **only if** the max sweep shows a phase is floor-limited (§6).

---

## 1. The central methodological problem: the manipulation *is* the censoring knob

The CL censoring gate (R-4) says a convergence-metric delta is **not actionable** until the paired
`censoring_rate` is stable across the compared cells. But **tightening a round budget deliberately
raises the censoring rate** — more runs hit the cap instead of reaching a natural decision point.
Budget and censoring are not separable here; the manipulation moves the confounder by construction.

The resolution is to **stop treating `censoring_rate` as a nuisance to null out and elevate it to a
primary outcome.** Under a given budget, the quality signal is two-part:

- **(a) Reach rate** = `1 − censoring_rate` = P(run reaches a natural decision point within the
  budget). This is the primary budget→quality signal. A budget so tight that most runs are
  cap-terminated is a *bad* budget regardless of what the survivors score.
- **(b) Conditional convergence quality** among reach-rate runs — the un-pooled headline metrics
  (`computeConvergenceWithCensoring`, decision-point-reached only), reported **with `n_uncensored`**
  so a cell whose conditional metric rests on 2 survivors is flagged untrustworthy, per the gate.

R-4 is honored, not evaded: we never read a raw convergence delta between two different-censoring
cells as a "regression." We read the *reach-rate curve* and the *conditional* quality curve
separately, and the frontier trades both against cost. This reframing is the load-bearing idea of
the experiment and must survive review before any run.

---

## 2. Adaptive design: fencepost-screen → bisect → confirm (not a flat grid)

A flat sweep — every value × every topic class at n=10 — spends the overwhelming majority of its
~210 runs establishing *null* differences at high precision. That is the wrong instrument. Most of
the sweep values are interior fence panels we never need if the two **fenceposts** (the extremes)
already agree. The design is sequential, and the number of runs is **data-dependent**, driven by
observed sensitivity rather than fixed up front.

**The reconciliation with R-1 (the load-bearing rule):** adaptive/small-n sampling *locates* the
answer; a fixed **n≥10 distribution decides** it. Screening cells use small n only to *route the
search*; any cell whose reading is used to **write or defend a bound** is topped up to n≥10 and read
as a median+IQR+MAD distribution (R-1). We never peek-and-stop on the reported estimate — the
decision cells are pre-registered and freshly gated, so optional-stopping bias does not enter the
number we publish.

### Phase A — Fenceposts (screen each phase for sensitivity)

Run in the **highest-crux topic class (T3)** first — the class where round budget is most likely to
bite. For each of the 3 phases, hold the other two at baseline `(conf=2, arg=2, conc=1)` and run only
the two extremes of that phase's plausible range:

| Phase | Fenceposts (config "rounds", 2 POVs → ×2 turns) | Interior to fill only if sensitive |
|---|---|---|
| Confrontation max | {1, 3} | {2} |
| Argumentation max | {1, 4} | {2, 3} |
| Concluding max | {1, 2} | none (adjacent — the fencepost test *is* the decision) |

Screening n = **6** per fencepost. Per-phase verdict, pre-registered:
- **Insensitive** if the low and high fenceposts *tie*: IQRs overlap **and** |Δmedian reach rate| <
  0.10 **and** |Δmedian conditional convergence| < 0.05 (the MDE — the smallest effect worth paying
  rounds for). → recommend the **cheapest** bound for that phase; do not fill the interior.
- **Sensitive** otherwise → go to Phase B for that phase only.

Phase A ≈ 3 phases × 2 fenceposts × n6 = **~36 runs**.

### Phase B — Bisect to the knee (sensitive phases only)

Binary search the interval between the fenceposts: test the midpoint at n6, keep the half-interval
containing the quality transition, recurse to adjacent integers. Argumentation {1..4} needs ~1–2
midpoints; confrontation {1,3} needs 1; concluding has no interior. ≈ **0–18 runs** depending on how
many phases are sensitive.

### Phase C — Confirm at n≥10 and test topic-class dependence (sensitive phases only)

For each sensitive phase's located knee, top up the knee cell **and its cheaper neighbour** to
**n≥10** (reusing banked screening runs toward the 10), then run that pair at n≥10 in the other two
topic classes (T1, T2). A phase that was **insensitive** in T3 is spot-checked with a single n=4 cell
in one other class to confirm the insensitivity travels (monotonicity assumption, §7) — not paid at
full price. ≈ **0–60 runs** depending on how many phases are sensitive and topic-dependent.

### Total (data-dependent, vs the 210-run flat grid)

| Outcome | Runs (≈) | Meaning |
|---|---|---|
| All phases tie at fenceposts | **40–50** | Current bounds are defensible; recommend cheapest. Bounds → *derived* (null) or stipulated-with-pointer. |
| One phase sensitive | **90–110** | One knee located + topic-class-checked at n≥10. |
| All three sensitive & topic-dependent | ~180 | Approaches the flat grid — but every interior run is now *earned* by evidence that the interior matters. |

The pilot (§5) is Phase A's first two cells, so screening starts the moment D1 lands.

---

## 3. Fixed factors (pinned across every cell — vary only the round budget)

- **Evaluator model:** `gemini-3.5-flash-lite` v1 (t/1846 pin). Set via `evaluatorModel` in the batch
  config, matching `calibration-config.json` `evaluator`.
- **Debater model:** `gemini-3.5-flash-lite`.
- **POV count:** 2 opposed (`accelerationist`, `safetyist`) — constant `s=2` (§0).
- **`useAdaptiveStaging: true`**, `allowEarlyTermination: false` (so caps, not health-collapse, drive
  termination — we are measuring the caps).
- **`pacing`**: fixed at **`moderate`** so the pacing preset's `argumentationExit`/`concludingExit`
  thresholds are constant; the round budget is the only thing that moves. (Pacing bundles
  thresholds *and* `maxTotalRounds` — we override `maxTotalRounds` explicitly below so the preset's
  value does not leak in.)
- **`maxTotalRounds: 18`** — above every Stage A cell's per-phase max sum (worst case
  `conf3+arg4+conc2 = 9 rounds → 18 turns`), so the per-phase cap always binds first, never the global
  backstop. Verified in the pilot (§5). (Note: `validateAdaptiveConfig` warns >20; 18 is inside.)
- **Situation-injection config:** fixed per the run recipe (`useAdaptiveStaging` + situation nodes
  loaded). Identical across cells.

---

## 4. Topic stratification (≥3 classes)

Stratify by **expected crux density × framing**, the two dimensions most likely to interact with
optimal phase length. Three classes, 2–3 topics each, drawn from the existing calibration/breadth
corpora (`calibration-batch.json`, `sit-breadth-batch-t2164.json`) so topics are known-runnable:

| Class | Definition | Example topics (final selection is a pre-run step) |
|---|---|---|
| **T1 — narrow / empirical** | Single dominant crux, largely empirical framing | "Are current AI capability evaluations sufficient to inform regulatory decisions?" |
| **T2 — broad / normative** | Multiple cruxes, value-laden framing | "Will open-source AI accelerate or hinder catastrophic risk?" |
| **T3 — mixed / high-crux** | Several cruxes spanning empirical and normative | "Should compute thresholds be the primary lever for governing frontier AI?" |

Class membership is a **pre-registered assignment** (assigned before runs, from the topic text and a
CL read of expected crux count), not read back from results — otherwise the stratification launders
the outcome. Each class carries ≥2 topics so a per-class result is not a single-topic artifact; the
n=10 per cell is **pooled across the class's topics** (topic is a nuisance within class, class is the
reported unit).

---

## 5. Pilot gate (MANDATORY before the full run)

Two failure modes make a blind full run worthless; the pilot exists to catch both:

1. **Override plumbing (D1).** `phaseBoundsOverride` is defined in `types/phase.ts` and consumed in
   `phaseTransitions.ts`, but is **not threaded through the CLI/batch config** (`CLIConfig` in
   `cli.ts:30` accepts `pacing`/`maxTotalRounds`, not phase bounds). **The sweep cannot run until D1
   lands** — see Dependencies. The pilot's first job is to confirm, on the D1 build, that a config
   with `phaseBoundsOverride.maxArgumentationRounds: 4` actually produces longer argumentation phases
   than baseline (inspect `signal_telemetry` phase lengths).
2. **Metric population.** As recently as t/2153, the un-pooled fields
   (`convergence_score_at_termination`, `censoring_rate`, and the neutral-eval crux suite) were
   `0/25`-populated on real runs — the extractor was not firing. That defect's fix landed
   (`79ae6b2e`). The pilot **must confirm** these fields are non-null on the pilot runs before
   committing 210 runs; otherwise the experiment produces nulls at scale.

**Pilot = the first Phase-A fencepost pair, not a throwaway.** Run the argumentation fenceposts
`(2,1,1)` and `(2,4,1)` on the T3 topic at n=3 = 6 runs. Gate to proceed: (a) argumentation phase
length responds to the override (`(2,4,1)` runs longer than `(2,1,1)`); (b)
`convergence_score_at_termination`, `censoring_rate`, and `crux_addressed_ratio` are non-null on
≥80% of pilot runs; (c) `maxTotalRounds:18` does not bind (`termination_reason ≠ max_iterations`
where a per-phase cap should have fired). Any gate failing → fix before proceeding. If all gates
pass, these 6 runs **bank toward** the argumentation fencepost cells (topped to n=6 screening, then
n≥10 only if that phase reaches Phase C) — the pilot is not discarded.

---

## 6. Outcome metrics

**Primary (frontier axes):**

| Axis | Field / source | Notes |
|---|---|---|
| Reach rate | `1 − censoring_rate` (`computeConvergenceWithCensoring`) | Primary budget→quality signal (§1). |
| Conditional convergence | `convergence_score_at_termination`, un-pooled | Reported with `n_uncensored`; a cell where `n_unknown` dominates is flagged, not interpreted. |
| Cost | `total_api_calls`, `total_rounds_elapsed` | Denominator of the frontier. |

**Corroborating-only (do NOT decide a bound alone):** `crux_addressed_ratio`,
`crux_resolution_divergence_rate`, `situation_crux_alignment`. These are in the `CRUX_AXIS_PARAMS`
zero-weight gate — unvalidated against a reference anchor (t/1847) and evaluator-sensitive
(`crux_addressed_ratio` MAD 0.553, t/1855). They may **support** a frontier read but never be the
sole basis for changing a bound. State this at every citation.

**Guardrails (a bound that wins on convergence but trips a guardrail is rejected):**
`repetition_rate`, `claims_forgotten_rate`. Longer budgets risk circling/dropping claims; these catch
a "quality" gain that is really just more turns of the same argument.

---

## 7. Statistical plan

- **R-1 replication gate:** n≥10 clean-tree replications per cell, same provenance triple
  (`config_revision | prompt_version | model`). Each metric read as a **distribution** (median + IQR +
  MAD), never a single draw. Cells reported as distributions, differences judged on non-overlap of
  IQRs plus effect size, not point deltas.
- **R-4 censoring gate:** applied as reframed in §1 — reach rate is a primary axis; conditional
  metrics are read un-pooled with `n_uncensored`; cells with dominant `n_unknown` are flagged
  untrustworthy and excluded from the conditional read.
- **Frontier construction:** per topic class, plot median conditional convergence and reach rate
  against median cost across the sweep values; the recommended bound is the **knee** — the smallest
  budget past which quality gains flatten relative to cost. Report per class; report the pooled
  recommendation only if the per-class knees agree.
- **Deferred factors (documented, not silently dropped):** POV count (`s`), pacing preset, `min`
  bounds. Min bounds get a Stage C config-edit sweep **only if** Stage A shows a phase is
  floor-limited (a phase whose exits cluster at `min`).

---

## 8. Deliverables & provenance

1. This design doc (committed). ✔
2. Run harness + raw results: batch configs under `lib/debate/` (one per sweep), raw session +
   calibration output at **isolated scratch paths** per the run recipe (never the main cal log).
3. Analysis write-up: `research/comp-linguist/docs/per-phase-round-count-analysis.md` — per-phase and
   per-class recommendation on the quality/cost frontier.
4. `metric-provenance-register.md`: a **§8 design-stage row** is added now (bounds stay stipulated,
   path-to-derived = this experiment); on analysis completion the row moves to §1 as **derived** with
   an evidence pointer — or stays stipulated-with-pointer on a null.
5. If any bound changes: a follow-up implementation ticket to edit `calibration-config.json` **and**
   the hardcoded fallback in `phaseTransitions.ts` (byte-parity gated by `phaseTransitions.test.ts`,
   t/2186).

---

## 9. Dependencies & cost

- **D1 (blocking, cross-scope):** thread `phaseBoundsOverride` from the CLI/batch config
  (`CLIConfig`) into the engine `PhaseTransitionConfig`. This is a `lib/debate` change (Shared-Lib
  owned) — route via ticket/email, do not edit directly. Without D1 the only alternative is editing
  `calibration-config.json` per cell (rebuild + parity gate per cell, no co-running cells) — far
  heavier; D1 is the right unblock.
- **Compute:** Stage A = 210 runs (+18 pilot). At `thorough`-scale debates this is many hours of
  wall-clock even on the free-tier flash-lite. **Needs an owner budget GO before launch.**
- **Confound pins:** evaluator + situation config fixed (§3); only the round budget varies.

---

## 9a. Pilot results & diagnosis (2026-08-06) — DESIGN INVALIDATED as written

Ran the argumentation-fencepost pilot (arg-max=1) on the T3 topic, origin/main worktree post-D1
(`398f3b0`). One run completed before I halted the batch. Findings:

- **Override plumbing works** — the argumentation phase exited with reason `Max exploration turns
  (1 rounds × 2 speakers)`, i.e. the `maxArgumentationRounds:1` override reached the engine. D1 is good.
- **But the per-phase cap does NOT control phase length.** The run terminated at `rounds:18`,
  `termination_reason:max_iterations` (censored), convergence stuck 0.30, 219 API calls, 13.8 min.
  `adaptive_staging_diagnostics.phases`: confrontation, argumentation, concluding each ran **6 rounds**
  (3 × 6 = 18 = `maxTotalRounds`); `regressions: []` (zero).
- **Root cause — confidence-deferral dominates.** `signal_telemetry` shows the same pattern every
  phase: cold-start (r1), then **"Confidence deferred (0.20 < 0.40)"** for ~4 rounds, then the phase
  force-transitions the moment deferral clears via floor-escalation — by which point `rounds_in_phase`
  already exceeds the cap. In `evaluatePhaseTransition` the confidence gate returns `stay` **before**
  the phase-specific hard-cap check, so while global confidence sits at 0.20 (below the 0.40 floor,
  escalating to 0.30) the cap is never even evaluated. Every phase burns ~6 rounds regardless of its
  cap (1, 2, or 4).

**Consequence:** the per-phase-max fencepost sweep is **not viable** under this regime — arg=1 and
arg=4 would both run ~6 rounds because confidence-deferral, not the cap, sets phase length. The
effective length/cost levers are the **confidence floor + escalation schedule** and **`maxTotalRounds`**,
not the per-phase max bounds.

**Two harness issues also surfaced (pilot did its job):**
1. `outputDir` isolates the debate files but **NOT the calibration log** — runs append to the main
   data-root `calibration-log.jsonl` (both `core/` and `users/local/`). Pilot's one entry was removed
   surgically (backed up); **future runs need a real cal-log redirect** (env var or config — likely a
   DebateTool change) before any batch, or every synthetic run pollutes CL metric windows.
2. The CLI console "Round N" counter is a global step counter, not `rounds_in_phase` — do not read
   phase length from it; use `adaptive_staging_diagnostics.phases[].rounds` / `signal_telemetry`.

**Root cause — RESOLVED (degenerate, filed t/2208).** `extraction_conf` is pinned at **exactly
0.200** every round, all phases (`stability_conf` varies genuinely; `global_conf = min(...)` tracks
extraction). 0.200 is the all-defaults output of `computeExtractionConfidence` = `0.5·statusScore +
0.3·min(1,claims/2) + 0.2·ratio` with `status∉{ok,truncated,parse_error}` (→0), `claimsAccepted=0`
(→0), `ratio=1` (→0.2). But the run **accepted 53 claims**, so `SignalContext.extraction` is **not
being populated** from the real extraction pipeline in the engine's adaptive path — a wiring bug, not
a real low-confidence read. Reproduced n=2. Filed **t/2208** (DebateTool, high, blocks this).

**Implication for the redesign (important):** this is NOT a reason to abandon the per-phase-round axis
— it's the reason it *looked* dead. Once t/2208 is fixed and confidence reflects real extraction,
phases should exit on saturation/convergence/caps rather than the escalation ladder, and the
**original fencepost design (§2) likely becomes viable as written**. Sequence: (1) t/2208 fix; (2)
re-run the §5 pilot to confirm caps/signals bind; (3) if they do, proceed with the §2 per-phase-max
sweep; only if caps *still* don't dominate length do we repurpose the factors to the confidence
floor/escalation + `maxTotalRounds`. Do not rewrite §2 until the pilot re-run says so.

## 9b. Pilot RE-RUN (2026-08-07) — DESIGN RE-VALIDATED; §9a verdict REVERSED

t/2208 landed and fixed the `extraction_conf`-pinned-0.200 wiring bug that §9a root-caused. The §5
pilot was re-run on the post-t/2208 build (6/6 clean, T3 topic, isolated `outputDir`). **All three §5
gates pass, deterministically** — full table on t/2192#8:

| gate | result |
|---|---|
| (a) per-phase cap controls phase length | **PASS.** arg1 group → **2** argumentation rounds (all 3), arg4 group → **8** (all 3). Binds exactly as `cap × activePovsCount` (s=2): argMax 1→2, 4→8. This is the precise reversal of §9a, where argMax 1 and 4 both ran ~6 rounds under confidence-domination. |
| (b) metrics non-null | **PASS.** `convergence_score_at_termination`, `crux_addressed_ratio`, `termination_reason` all 6/6 non-null. (`censoring_rate` is a cross-run computation, not a per-row field.) |
| (c) `maxTotalRounds:18` does not bind | **PASS.** 0/6 terminated `max_iterations` — all 6 hit `situation_cap` before the 18-turn budget (arg1 total 8 turns, arg4 total 14). |

Per §9a's own sequence step 3 ("if caps bind, proceed with the §2 per-phase-max sweep"), the
condition is met: **the confidence gate no longer pre-empts the cap check, phases exit on the
per-phase cap, and §2 is viable as written.** §9a's "DESIGN INVALIDATED" verdict is superseded. No
rewrite of §2 is needed. The 6 pilot runs bank toward the argumentation fencepost cells (arg1/arg4 at
n=3 each; screening wants n=6).

**Cell-definition note carried into §2 (already consistent with §0.1 + the §2 table header):** phase
length = `cap × activePovsCount`. The primary sweep pins POV=2 (§3), so all T1/T2/T3 cells share s=2
and remain cross-comparable; "argumentation max = 4" means an 8-round phase throughout. The ×s
scaling only becomes a comparability hazard for the **deferred** POV-count factor (§7) — not the
primary sweep.

**Harness blocker — §9a issue #1 is NOT fixed, re-filed as t/2219 (replaces the old note).** §9a said
`outputDir` doesn't isolate the cal log; t/2216/PR #518 was meant to fix that but fixed **only the CLI
writer** (`cli.ts:631`). The **debate engine writes a second cal-log row** (`debateEngine.ts:662`)
using the resolved main `dataRoot`, ignoring `outputDir`. So each isolated pilot run wrote its row
twice — once isolated (CLI, correct), once to the main log (engine, leak); all 6 leaked and were
scrubbed by debate_id (backed up, 0 residual). **t/2219 (DebateTool, high) must land before the §2
sweep** — otherwise every one of the 40–180 Phase-A/B/C cells silently contaminates the main CL metric
windows and needs a manual scrub. This supersedes §9's "harness prerequisite (D1)" as the active
blocker (D1 itself landed at `398f3b0`, confirmed by the re-run's clean override plumbing).

**§2 go/no-go (CL.Investigate1, 2026-08-07): GO on the design. Launch of Phase A gated on two
preconditions — (1) t/2219 landed + regression-tested (AC1–3), and (2) owner budget GO per §9
(Phase A is 40–180 data-dependent runs at thorough-scale, many hours of wall-clock).** Neither is a
design defect; both are execution gates. Do not launch a single Phase-A cell until both clear.

**Precondition status (2026-08-07):**
- **(1) CLEARED — t/2219 landed (PR #531, CI green).** Engine now calls `appendCalibrationLog` with
  `config.calibrationDataRoot` when set; `cli.ts` wires it from `outputDir`. **Empirical isolation
  check is folded into the first Phase-A cell** (not paid as a separate run): capture the main
  cal-log line count (`core/` + `users/local/`) immediately before and after cell 1; if it moves, the
  batch halts and the leak is re-filed before any further cell. Justified by the t/2216→t/2219
  incomplete-fix precedent — trust the land, but verify isolation once, cheaply, on live data.
- **(2) PENDING — owner budget GO requested.** Ask scoped to **Phase A only** (~30 runs beyond the 6
  banked pilot runs); Phases B/C escalate only if screening shows a phase is sensitive, and I report
  back at each phase boundary before spending B/C compute. Least-commitment, most-informative ask.

## 10. Cross-references

- t/2192 — this experiment. t/2186 — phase-bound byte-parity gate. t/1846 — evaluator pin.
- R-1 (t/1668) replication gate; R-4 (t/1671) censoring gate — CL `AGENTS.md`.
- `metric-provenance-register.md` — `CRUX_AXIS_PARAMS` zero-weight gate, evaluator-sensitivity rows.
- Run recipe: `reference_situation_injection_debate_run_recipe` (worktree + junction + `AI_TRIAD_DATA_ROOT`).
