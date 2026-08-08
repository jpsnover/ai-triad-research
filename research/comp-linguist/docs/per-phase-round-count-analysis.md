# Per-Phase Round-Count Experiment — Analysis (Phase A)

**Ticket:** t/2192
**Author:** Computational Linguist (CL.Investigate1)
**Date:** 2026-08-08
**Design of record:** [`per-phase-round-count-experiment-design.md`](per-phase-round-count-experiment-design.md)
**Result:** **NULL — round budget does not detectably affect convergence in any phase.** Current phase bounds are defensible; the cost-optimal setting is the floor. No Phase-B bisect warranted.

---

## 1. What was run

Phase-A fencepost screen from the design of record (§2), n=6 per fencepost, all confounds
pinned (§3): 2 POVs (accelerationist/safetyist), T3 topic ("Should compute thresholds be
the primary lever for governing frontier AI?"), `gemini-3.5-flash-lite` debater + evaluator,
`pacing: moderate`, `maxTotalRounds: 18`, `allowEarlyTermination: false`. Only the per-phase
round cap varied. Each phase held the other two at baseline `(conf=2, arg=2, conc=1)`.

- **36 debates total:** 6 fenceposts × n=6 (the argumentation cells reuse the 6 banked §5
  pilot runs; 30 new runs executed 2026-08-07).
- **Engine prerequisites, both landed and verified on the running tree (`7b35c96c`):**
  t/2208 (confidence-gate wiring — makes the per-phase cap actually control phase length),
  and t/2228 (brief/plan parse retries 1→3 + plan-stage retry guard — without which debates
  aborted mid-run on free-tier JSON truncation).
- **Cal-log isolation verified on live data (t/2219 / PR #531):** all 36 runs wrote to an
  isolated `outputDir`; a final debate_id-membership sweep confirmed **0 of the batch's
  debate_ids reached the main calibration logs.** (A raw line-count check is unreliable on
  this shared machine — other agents' debates write concurrently — so isolation is verified
  by debate_id membership, not line count.)

**The caps bind deterministically** (the precise reversal of the pre-t/2208 §9a failure):
manipulated-phase length = `cap × activePovsCount` (2 speakers) in every cell —
confrontation cap 1→2 rounds / cap 3→6; argumentation cap 1→2 / cap 4→8; concluding cap
1→2 / cap 2→4. All 36 runs terminated `situation_cap` (the intended per-phase cap), never
`max_iterations`; the 18-round global backstop never bound.

---

## 2. Results

Convergence read as `convergence_score_at_termination` (primary), un-pooled; cost as
`total_api_calls`. Distributions are median [IQR] over n=6.

| Fencepost | phase rounds | convergence median [IQR] | MAD | cost (API calls) median |
|---|---|---|---|---|
| Confrontation cap **1** | 2 | 0.239 [0.218, 0.246] | 0.014 | 110 |
| Confrontation cap **3** | 6 | 0.241 [0.235, 0.245] | 0.005 | 154 |
| Argumentation cap **1** | 2 | 0.241 [0.238, 0.246] | 0.004 | 112 |
| Argumentation cap **4** | 8 | 0.289 [0.239, 0.332] | 0.044 | 178 |
| Concluding cap **1** | 2 | 0.242 [0.237, 0.246] | 0.004 | 134 |
| Concluding cap **2** | 4 | 0.244 [0.236, 0.315] | 0.008 | 144 |

**Corroborating (CRUX_AXIS zero-weight gate — support only, never decisive):**
`crux_addressed_ratio` median 1.0 and `situation_crux_alignment` median 1.0 in every cell.
**Guardrails (clean everywhere):** `repetition_rate` median 0.0 (more rounds do not cause
circling); `claims_forgotten_rate` stable ~0.33–0.37 across all budgets (no degradation).

### Per-phase sensitivity verdict (pre-registered rule, design §2)

A phase is **INSENSITIVE** if its low/high fenceposts tie: convergence IQRs overlap **and**
|Δmedian convergence| < 0.05 (the MDE).

| Phase | Δmedian convergence | IQRs overlap | cost Δ | Verdict |
|---|---|---|---|---|
| Confrontation (1 vs 3) | **+0.001** | yes | +44 calls | **INSENSITIVE** |
| Argumentation (1 vs 4) | **+0.048** | yes | +67 calls | **INSENSITIVE** (borderline) |
| Concluding (1 vs 2) | **+0.002** | yes | +10 calls | **INSENSITIVE** |

All three phases tie. No phase clears the bar for a Phase-B bisect.

---

## 3. Interpretation

**Round budget does not buy convergence.** Convergence sits at ~0.24 across every cell,
independent of a 2×–4× swing in phase length. More rounds cost real API calls (up to +67 per
debate) for no measurable convergence gain, and no guardrail cost either way. The
quality-per-cost frontier is therefore **flat**, and its knee is the **floor**.

**Two honest caveats bound the strength of this null:**

1. **Argumentation is the one borderline signal.** Its high fencepost (8 rounds) showed a
   hint of higher convergence (+0.048, just under the 0.05 MDE) with markedly wider spread
   (MAD 0.044 vs ~0.004 elsewhere; range up to 0.333). By the pre-registered rule it is
   insensitive, but it is the *only* phase where more rounds gave any reason to look again. If
   Phase-B compute is ever spent, argumentation is the sole candidate.
2. **The convergence metric never moved off ~0.24 in any condition.** This flatness is the
   result, but it also means we cannot fully separate *"rounds don't help"* from *"the metric
   can't detect help on this topic/evaluator."* Consistent with the crux-metric zero-weight
   caution, we therefore record a **defensible null** (bounds are fine as-is) rather than
   deriving a new, tighter bound value from a signal we cannot independently confirm is live.

---

## 3a. Stronger-model probe (attempted, INFEASIBLE under run constraints — 2026-08-08)

To test caveat (2) — "is the flat null real, or is `gemini-3.5-flash-lite` just too weak to
*use* extra argumentation rounds?" — a one-variable probe was attempted: **swap only the
debater model to a stronger tier, keep the evaluator pinned at `gemini-3.5-flash-lite`**
(t/1846, so the measuring instrument and thus comparability to §2 are preserved), on the
argumentation fenceposts (arg1 vs arg4, n=3 each). Owner-approved.

**Outcome: no usable data — the probe is infeasible on this run harness, for two compounding
reasons, one of which is itself a finding:**

1. **Wall-clock.** Both `claude-opus-4-8` and `claude-sonnet-4-6` produce far longer debates
   than flash-lite — long turns (~4.5k chars) and many more rounds. flash-lite's arg1 cell
   finalized in ~500s; sonnet's arg1 reached **32 turns and had not finalized at the 2400s
   timeout** (~75s/turn). Opus was similar-or-worse. Debates this long do not complete inside
   the background-task survival window on the shared machine (the same reaping that dogged the
   §2 batch), so neither model banked a clean pair. opus completed 1 arg1 run; sonnet 0.
2. **Possible confound (the finding).** flash-lite debates terminated early on the **per-phase
   `situation_cap`** (the manipulated knob). The sonnet arg1 partial reached ~16 rounds —
   approaching the global `maxTotalRounds:18` backstop — suggesting a stronger model may run to
   the **global round budget rather than the per-phase cap**, in which case arg1 and arg4 would
   both run ~18 rounds and the fencepost manipulation would not bind. If so, the §2 design would
   need the global backstop raised (and cost re-scoped) before a strong-model round sweep could
   even be *run*, let alone interpreted.

**Disposition (owner decision, 2026-08-08): stop the probe; the flash-lite NULL stands as the
recommendation.** The stronger-model question is therefore **open, not answered** — the §2 null
is established for `gemini-3.5-flash-lite` (the pinned production debater for this work) and is
the correct basis for the current recommendation, but it has **not** been shown to generalize to
stronger debaters. Re-opening it would require a run environment where 30–45-min debates
complete reliably, plus a design fix for the cap-vs-backstop binding (raise `maxTotalRounds` so
the per-phase cap is provably the binding constraint under a strong model, as §3/§0 require).
Probe scripts retained: `experiments/t2192-round-count/` (`t2192_opus_probe.py`,
`t2192_sonnet_probe.py`).

## 4. Recommendation

**No phase benefits from more rounds than the current bounds.** Concretely (cap units;
rounds = cap × 2 speakers at 2 POVs):

| Phase | Current cap | Empirically-optimal cap | Recommendation |
|---|---|---|---|
| Confrontation | 2 | **1** (ties with 3) | Safe to tighten 2→1 for cost; or leave at 2 |
| Argumentation | 2 | **1** (ties with 4), but borderline | **Keep at 2** — do not raise; the borderline hint argues against cutting the deepest phase |
| Concluding | 1 | **1** | Keep at 1 |

- **Recommended (conservative): `conf 1 / arg 2 / conc 1`** — tighten only confrontation
  (the clearest tie, cheapest bound), leave argumentation and concluding as-is.
- **Maximally cost-cheap: `1 / 1 / 1`** — defensible on the data, but drops argumentation to
  its floor despite the borderline signal; only adopt if cost is the dominant concern.

Either way, **do not raise any bound** and **do not run Phase B/C** — the round-count axis is
exhausted for this topic class at n=6.

---

## 5. Provenance & deliverables

- **Provenance:** phase bounds remain **stipulated**, now **with an evidence pointer to this
  analysis** (a defensible null) — *not* reclassified to `derived`, because the recommendation
  does not change a bound to a new empirically-derived value and rests on a flat metric we
  cannot confirm is discriminating. Registered in
  [`metric-provenance-register.md`](metric-provenance-register.md).
- **Reproducibility:** run harness (`t2192_phaseA_run.py`), analysis (`t2192_phaseA_analysis.py`),
  and per-fencepost aggregates are archived under `experiments/t2192-round-count/`. Raw session
  + isolated calibration output live at scratch paths per the run recipe (never the main
  cal log); they are large and not committed.
- **Follow-up tickets:** none for implementation (null → no bound change). If cost reduction
  is later prioritized, a bound-tightening ticket (`calibration-config.json` +
  `phaseTransitions.ts` hardcoded fallback, parity-gated by `phaseTransitions.test.ts`, t/2186)
  would implement `conf 2→1`.

## 6. Cross-references

- t/2192 (this experiment) · t/2208, t/2228, t/2219/#531 (engine prerequisites) · t/2186
  (phase-bound byte-parity gate) · t/1846 (evaluator pin) · R-1 (t/1668) · R-4 (t/1671).
