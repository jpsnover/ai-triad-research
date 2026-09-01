# entity_link_precision gold sample

Gold labels for the `entity_link_precision` harness (t/3202, split from t/3125). Consumed by
`Test-ExtractionQuality` (PowerShell) to turn `link_confidence` from decoration into a measured
number (claims-entity-fol-recommendations.md §5/R3).

## Files
- `gold.json` — the labelled set.
  - `observed[]` — **real** claim-side `entity_refs` (from the t/3124 pass over `summaries/*.json`),
    each labelled `genuine`/`spurious` by checking the `surface` against its `claim_text` and the
    entity's name/aliases. These drive the precision number.
  - `constructed_negatives[]` — **synthetic** bad links (not from the corpus) encoding known failure
    modes. A detector-validation set only: the harness should flag each as `spurious`. **Never pool
    these into the observed precision** (observed-vs-constructed discipline).

## Method
Sampled the 302 claim-side `entity_refs` (246 exact / 56 alias), stratified over `method` and deduped
by `(surface, ref, kind)` → 22 observed cases spanning both methods and distinct entities. Each was
verified against its claim text. An adversarial false-positive hunt over the full 302 — ambiguous
surfaces (a surface mapping to >1 entity), ≤4-char tokens (BIRD/EWC/F-16/GDPR/H200/Marx/PPO), and
over-general aliases (`AI Action Plan`, `AI strategy memo`) — found **zero** false positives.

## Finding
**Observed precision = 1.00 (22/22).** This is the expected signature of precise-only surface/alias
resolution (§13.3, no entity-embedding rung): high precision by construction. The residual risk is
**latent**, not observed — over-general aliases (`AI Action Plan` → the specific Trump/US plan) and
short-token homonyms (`BIRD` the benchmark vs the animal; `Marx` → Karl vs Groucho) would mislink if
such text appeared. The three constructed negatives encode exactly those, so the harness can prove it
detects them.

## Provenance
Labels are **CL-agent** expert judgments (2026-09-01). PI/human relabelling upgrades the set to
`human-validated` (see `docs/metric-provenance-register.md`, the entity-link + `CON_TAU` rows — this
sample is their registered "path off stipulated"). Cadence: 10–20-claim audit per cycle; this seed
set is 22 observed + 3 constructed.
