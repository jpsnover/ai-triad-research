# AIF B5 build spec: crux-from-AIF + 2-signal convergence_score (t/3588)

**Author:** Computational Linguist (metric-definition authority). **Implementer:** DebateTool (`lib/debate/`, convergence signals + crux tracking are their scope). **Status:** build spec for handoff. **All B5 outputs are PROVISIONAL and anchor no threshold (AC6).**

CL owns the metric definitions + calibration validation (AC4); DebateTool owns the pipeline/schema wiring. This doc is the handoff. Dependencies B3 (cross-agent CA extraction, `extractCrossAgentOppositions`, PR #2337) and B4 (AIF data-model, PRs #2330/#2337) are landed; B1 (t/3611) closed applicability-only (below).

## Standing posture (both binding, from the B4a Second Opinion via t/3588#2)

- **AC5, metric-definition versioning.** Every persisted B5 metric number carries its definition version (or the schema-basis it was computed against). The AIF graph is recomputable (no one-way door); the persisted *numbers* are the one-way door, so a cross-time comparison must never silently mix definitions. Emit `metric_def_version` (or `schema_basis`) alongside each B5 value in the calibration log.
- **AC6, provisional / gates nothing.** B5 rests on `concession` / `retained_hold`, which are **stipulated / LLM-applicability-only**, the B1.5 human reliability step (t/3611) was **waived by PI** (register §14). So B5 is **permanently provisional under current evidence**: it anchors no threshold, changes no behavior, and ships shadow/observability only. The exemption lapses only if human validation is ever revived (then re-triggers the t/3361 Second Opinion before B5 gates anything).

## 1. crux-from-AIF (crux identification from AIF structure)

**Definition:** a **crux** is a *sustained, cross-agent CA-node*, a conflict (CA) node between two agents' I-nodes that is **returned to across ≥2 rounds**. Built on the landed `extractCrossAgentOppositions` seam (B3). Read **aggregate over the crux set, not single-crux** (t/3587 over-determination constraint: a single turn is over-determined, so per-crux claims are unreliable; the aggregate is robust).

- Input: the AIF graph's CA-nodes with speaker + round attribution (B4 data-model).
- A CA-node is a crux iff its two endpoints are cross-agent AND it recurs in ≥2 distinct rounds (sustained).
- Output: `crux_set` (the sustained cross-agent CA-nodes) + `crux_count`. Provisional.

## 2. convergence_score, re-specified on TWO signals

Re-spec `convergence_score` on the two surviving reliable-move signals ONLY (t/3355#5); the third signal ("latent CA conditions approaching satisfaction") is **DROPPED**, the defeater-condition proved unmeasurable in over-determined debate prose (t/3587 v2–v4; B4 v1 ships no `condition` field).

- **Signal A, concession accumulation:** monotonic count/rate of `concession` moves across rounds (a debater yielding a point).
- **Signal B, retained-hold reduction:** decline in `retained_hold` moves across rounds (a debater restating a position without yielding; fewer over time = positions narrowing).
- `convergence_score` = a normalized combination of A (rising) and B (falling). **The exact weighting is stipulated** (no evidence to derive it; declare it stipulated in the register with the value) and carries `metric_def_version` per AC5.
- Both signals inherit the concession/retained_hold provenance: **stipulated, applicability-only** (register §14). `convergence_score` is therefore provisional and gates nothing.
- `crux_addressed_rate` is **reused unchanged** (aggregate CA-engagement; robust to over-determination, not re-specified).

## 3. Correlation eval, RESCOPED given the t/3354 no-go (CL judgment)

**AC3 as originally specified (correlate AIF-crux structure vs crux_addressed_rate/convergence_score, metric = residual paraphrase-FN rate) is NOT run as a value-gate.** Rationale: the FOL-on-debate correlation (t/3354 §12, this session) already measured the same family and returned **NO-GO**, contradiction/opposition counts were volume-driven (rho 0.904 vs clause count), did not track `crux_addressed_rate` (rho −0.369), and found 0/9 cross-summary contradictions. Re-running an equivalent paraphrase-FN correlation would very likely reproduce that null at additional cost.

**Rescoped eval:** report the crux-from-AIF signal as **observability only**, alongside the existing metrics, and record a **one-shot descriptive comparison** (does `crux_count` / the 2-signal `convergence_score` move with `crux_addressed_rate` on the existing corpus?) as a *diagnostic, not a value-gate*, explicitly cross-referencing the t/3354 no-go as the prior. Do NOT invest in the paraphrase-FN normalization eval for B5 unless t/3354 is revisited with the n≥10 top-up + double-annotation it flagged. This is a deviation from AC3 as written, flagged here per the Deviation rule; the driver is the t/3354 evidence, and it reduces wasted work.

## Handoff to DebateTool

- Implement crux-from-AIF (§1) + the 2-signal `convergence_score` (§2) as calibration-log fields, each carrying `metric_def_version` (AC5), marked provisional (AC6), gating nothing.
- **AC4: no live metric change lands without CL calibration validation**, since these are shadow/provisional, "validation" here = CL confirms the field definitions match this spec and the values are sane on a sample; it does NOT become a trusted/gating metric (that needs the waived human reliability + t/3361 SO).
- CL reviews the implementation against this spec. Register entry for the 2-signal `convergence_score` (stipulated, versioned) lands with the implementation PR, cross-referencing §14 (the concession/retained_hold provenance it inherits).
