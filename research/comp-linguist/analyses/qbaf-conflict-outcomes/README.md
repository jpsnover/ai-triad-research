# QBAF conflict-outcome gold set (t/3152)

Independent CL adjudication of consolidated conflicts, gating the Potyka-2021 conflict-module pilot
and the `attack_weights` gradient-learning validation path (t/3023, t/3100).

## Files
- `gold.json` — `rows[]` (23), each: conflict id, both assertions (`supports`/`disputes`), description,
  linked nodes, and the CL `verdict` + `prevailing_stance` + `confidence` + `rationale` + `flags`.

## Method (independence is load-bearing)
Sampled 23 clean two-sided conflicts (5 curated `conflict-*.json` + a stratified draw from the 1240
in `conflicts.json`). Each was judged **on the merits of the two assertions + description**, NOT read
from any QBAF/machine verdict — the set exists to *validate* the resolver, so labelling from its own
output would be circular. `verdict` vocab mirrors the t/3151/t/3185 resolution schema:
- `prevail` (+ `prevailing_stance`) — one side demonstrably stronger (factual/logical overclaim or a
  documented mechanism on the other side).
- `tie` — comparably grounded.
- `undecided` — **irreducible value/framing disagreement (no empirical resolver)** or insufficient
  basis. Mirrors the t/3151 margin-floor explicit-undecided verdict.

## Finding
The corpus is **value-disagreement-dominated**: 15/21 trainable cases are `undecided`, only 6 are
cleanly decidable (`prevail`), 0 clean ties, + 2 malformed non-opposing pairs excluded. Two
implications:
1. **Validates the t/3151 explicit-undecided verdict** — a resolver that forced `prevail` on these
   value conflicts would be wrong; `undecided` is the correct output for most.
2. **Decidable signal is scarce here** — 6 `prevail` cases is thin for gradient-learning
   `attack_weights`. A targeted decidable-conflict draw (or synthesized decidable cases) is likely
   needed before that training path has enough gradient. Flag this to whoever picks up the
   Potyka/attack_weights downstream.

## Data-quality flags
Two consolidation artifacts (`flags: [malformed-pair]`) where the two `instances` are non-opposing
(one restates the other, or they're different propositions) — excluded from the trainable subset;
worth surfacing to whoever owns conflict consolidation.

## Provenance
CL-agent labels (2026-09-01). PI/human relabel → human-validated. Registered path for `attack_weights`
off stipulated (`docs/metric-provenance-register.md`).
