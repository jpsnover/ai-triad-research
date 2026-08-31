# Instrument-Integrity Checklist

**Owner:** Computational Linguist. **Applies to:** any new (or materially changed) metric, LLM judge, or verdict grammar before its output is cited as a disposition rather than an indicative sample.

A scalar or verdict is an instrument. Before it counts as evidence, it must pass the six checks below. The first four are the protocol from the instrument-effects paper (arXiv 2607.14399 §5.3, four-check integrity protocol, retrieved verbatim); checks 5–6 are this project's standing additions. Each check names how we already enforce it, or flags the gap.

## The checks

**1. Taxonomy saturation.** *Can the outcome grammar express the weaker claim (a calibrated "incomplete"/"undecidable"/equivalent)? Add the missing verdict and measure what it absorbs.*
- Enforcement: ad hoc today. The t/3097 audit found the model-facing crux grammar (`addressed | partially_addressed | unaddressed`) FAILS this: it lacks the `undecidable` option its structural twin (`CruxResolutionState.undecided`) has, so structurally-undecided cruxes are absorbed into `unaddressed`/`partially_addressed`, shaping `crux_addressed_rate`. Any new verdict grammar must include an explicit not-yet-decidable option and report what it absorbs. Follow-up A/B: t/3144.

**2. Criterion disclosure.** *Run a disclosed-criterion arm. If "false" verdicts collapse when the judging criterion is made explicit, the hidden criterion was manufacturing them, and the instrument was measuring criterion opacity, not the construct.*
- Enforcement: **NOT enforced. This is the gap.** We have no disclosed-criterion arm for any judge. New LLM judges must ship with a disclosed-criterion control run before their verdict rates are trusted. (Distinct from the provenance-laundering framing lever, t/3098: that is about how content is presented; this is about whether the *judge's* criterion is hidden.)

**3. Censoring analysis.** *Condition verdict rates on reaching a decision point, and check whether resource budgets censor which verdicts can be observed at all.*
- Enforcement: **enforced** via the censoring gate (t/1671): headline convergence metrics read un-pooled via `computeConvergenceWithCensoring` (decision-point-reached runs only); `CENSORED_REASONS = {max_iterations, situation_cap, api_ceiling}`; `n_unknown` excluded from the denominator. A metric shift is not actionable until its paired `censoring_rate` is stable across the compared windows.

**4. Distribution replication.** *Re-run fixed configurations (n ≥ 10 per instance) and report verdict distributions, not single draws.*
- Enforcement: **enforced for regression decisions** (replication gate, t/1668: n ≥ 10 clean-tree draws, read the metric as a distribution). Extending to *reporting* (t/3096): any headline cited as a disposition carries a distribution over n re-runs, not a point. Distinguish estimation-uncertainty (bootstrap of one draw) from run-instability (n re-runs); only the latter answers run-drift.

**5. Provenance + reporting-treatment registration.** Every scalar carries a provenance class (`stipulated | derived | human-validated`) AND a reporting-treatment tag (`single-draw | n-draw distribution`) in `metric-provenance-register.md`. No evidence pointer = stipulated by definition. A grammar/threshold/weight change is a provenance event and requires a register update in the same PR.

**6. Reproduce before assert (t/2294).** Before asserting a metric's ground truth, error class, or "correct" value, run the actual pipeline/retrieval that produced the observed behavior. Never infer from node/description text alone. Label constructed cases `constructed`, observed cases `observed`.

## Truthfulness vs honesty (register caveat)

Our behavioral honesty/consistency metrics (and the RepE-style probes, arXiv 2310.01405) measure whether a model **asserts claims consistently with its own reasoning**, not whether those claims correspond to external ground truth. Per the instrument-effects paper, the true-positive cell can be unpopulatable by construction, so such metrics measure false-positive behavior only. Any honesty/consistency metric in the register must state this truthfulness-vs-honesty limit so a consumer does not read it as a truth measure.

## How to use

- New/changed metric, judge, or verdict grammar → walk checks 1–6, record the outcome in the provenance register. Checks 1–4 that cannot be satisfied yet are declared open (with a follow-up ticket), not silently skipped.
- **Gate-touching** application (wiring any check into CI as a blocking gate) routes to Main (TL) for both-arms Gate Verification. This checklist itself is advisory discipline, not a CI gate, until a specific check is proposed as one.

*Sources: arXiv 2607.14399 §5.3 (four-check protocol, retrieved 2026-08-31); project gates t/1668, t/1671, t/2294; audit findings t/3096, t/3097, t/3098.*
