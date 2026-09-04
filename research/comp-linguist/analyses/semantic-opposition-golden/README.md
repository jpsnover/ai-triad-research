# Semantic-opposition validation golden (t/3302 Fork-B)

The gate for Fork-B: an opt-in pass in `enrich_conflicts_qbaf.py` that reads pairs of within-conflict
instance assertions and emits **attack** edges on contradiction (and support edges on entailment), so
single-claim evidence clusters gain the adversarial structure their stance labels never carried. A false
attack wrongly lowers a node's strength, so the gate is **two-sided**: the pass must raise testedness
(recall) **and** keep false attacks bounded (precision).

This golden is the fixed reference the detector is scored against.

## What a pair is

One pair = two `assertion` texts drawn from the **same** conflict in `conflicts.json`. The CL label is
the relation between them, authored from the assertions alone:

- `contradict` — the two cannot both be true (incl. conflicting numbers/dates for the *same* quantity) → an **attack** edge
- `entail` — one asserts / paraphrases / strongly implies the other, same direction → a **support** edge
- `neutral` — different aspects; both can hold; no logical relation → **no** edge

## Blind authoring (load-bearing)

Every label was authored **blind** — from the assertion texts only, **before any classifier output was
seen**. The detector under test was built independently, so scoring it here is not circular. Labels were
never derived from a contradiction classifier (which would grade like-with-like). Provenance:
`human-validated` (CL-authored blind); PI spot-confirm available on request.

## Pools

| pool | n | role |
|---|---|---|
| `REP` | 80 | Representative sample (deterministic stride over all within-conflict pairs). Carries the **true base rate** (~6% contradict) and the hard-negative **precision traps** (coincidental equal numbers, expectation-vs-actual, subset relations, different-benchmark). |
| `ENR` | 33 | Candidate-**enriched** positives — cross-stance (supports×disputes) and "X vs Y" pairs, higher contradiction yield. Candidate *selection* ≠ label; labels are still the blind read. Used to give **recall** enough positives; **never** part of the precision denominator. |
| `CONSTRUCTED` | 9 | Author-constructed numeric/temporal cases to validate the **deterministic** complement detector fires on clear conflicting numbers/dates (C1–C6) and does not false-fire on coincidental/subset numbers (C7–C9). Detector-validation only — **excluded from all observed metrics**. |

Observed total: 113 pairs — 24 `contradict` / 60 `entail` / 29 `neutral`.

## Split protocol (TL t/3302#7)

Blind labels first, then a deterministic stratified split (`tune` / `held_out`, ~50/50 within each
`(pool, label, stratum)` stratum):

- **Threshold** is derived on `TUNE` (REP-tune ∪ ENR-tune; 14 contradict positives).
- **Precision** — the gating hazard — is reported on **`REP` `held_out` only** (n=37), which preserves
  the true ~6% base rate, so precision is not optimistically inflated by enrichment.
- **Recall** is reported on **all** `held_out` contradicts (10), pooling ENR positives — recall is
  base-rate-insensitive, so pooling is valid and tightens the estimate.

Same-pairs tune-and-report would overfit; the split prevents it.

## Acceptance bar (provisional — CL t/3302#6, TL-approved)

- **Precision ≥ 0.85** on produced attack edges (false-attack rate ≤ 15%) at the chosen threshold — the gating bound.
- **Recall ≥ 0.50** on labeled contradict pairs — the lift must be real.
- Deliverable is the **precision/recall curve** across the detector's threshold, so the operating point is chosen from data.

Provisional: at these counts the confidence intervals are wide (esp. the deterministic subset — only 2
*observed* numeric/temporal contradicts; the constructed cases validate the mechanism, not real-world
recall). v1 is a first defensible bar; `qbaf.testedness` (#1935) monitors the before/after tier shift on
the full corpus.

## Scoring a detector against this golden

Map each pair to the detector's input (`assertion_a` → first prop, `assertion_b` → second). Read its
verdict (e.g. `opposes` → predicted `contradict`; `agrees` → `entail`; `unrelated`/`unresolved` → none).
Then:

- **precision** = (predicted-`contradict` that are truly `contradict`) / (predicted-`contradict`), over `REP` `held_out`.
- **recall** = (true `contradict` predicted `contradict`) / (true `contradict`), over all `held_out`.
- Sweep the detector's threshold (or its raw contradiction probability) to trace the P/R curve.
- Score the `CONSTRUCTED` pool separately as a deterministic-detector sanity check.

## Reproduce

```
python build_golden.py            # deterministic; reads $AI_TRIAD_DATA_ROOT/conflicts/conflicts.json
```

Sampling is deterministic (sorted ids + even stride, no RNG); the labels are embedded in `build_golden.py`
as the authored record, so the JSON regenerates identically.
