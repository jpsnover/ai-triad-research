# FOL cross-camp modality analytics (B1, t/3398)

> **Maturity marking (read this first).** This artifact reports distributional
> patterns over the **mechanical axes only** of `node.logical_form`. It **gates
> nothing**, writes nothing, and derives no argument structure. Axes consumed &
> their measured reliability: modality (holder/attitude) & polarity ~1.00 (copied from POV/category, not judged); temporal.type ~0.94. NOT consumed: predicate ~0.50-0.68, args ~0.30, about[]/match_level/formalization_confidence (B5 not-safe list).
>
> Provenance: descriptive / indicative (single-draw over one corpus snapshot). Reporting-treatment:
> `single-draw`. Data snapshot (ai-triad-data):
> `f19d160e`. Regenerate with `tools/fol_modality_analytics.py`.

## Coverage

| Camp | Nodes | With `logical_form` | Coverage | BDI frames | Factual |
|---|---:|---:|---:|---:|---:|
| acc | 201 | 133 | 66.2% | 133 | 0 |
| saf | 351 | 274 | 78.1% | 274 | 0 |
| skp | 357 | 234 | 65.5% | 234 | 0 |

## Attitude mix per camp (`modality.attitude`)

| Camp | belief | desire | intention | dominant |
|---|---:|---:|---:|---|
| acc | 58 (43.6%) | 15 (11.3%) | 60 (45.1%) | intention |
| saf | 126 (46.0%) | 24 (8.8%) | 124 (45.3%) | belief |
| skp | 156 (66.7%) | 22 (9.4%) | 56 (23.9%) | belief |

## Polarity balance (`polarity`)

| Camp | positive | negative | negative % |
|---|---:|---:|---:|
| acc | 132 | 1 | 0.8% |
| saf | 260 | 14 | 5.1% |
| skp | 221 | 13 | 5.6% |

## Temporal-type spread (`temporal.type`)

| Camp | temporal.type distribution |
|---|---|
| acc | unspecified: 133 |
| saf | unspecified: 269, before: 2, during: 2, at: 1 |
| skp | unspecified: 232, before: 1, during: 1 |

## Reading (descriptive — patterns, not verdicts)

- **Attitude signature differs by camp** — see the dominant column above; this is
  the cross-camp modality contrast the reification (`holds(camp, attitude, p)`) was
  built to make queryable, and it rests only on the ~1.00 mechanical axes.
- **Polarity** is overwhelmingly positive across camps; negation is a small minority.
- **Temporal** is near-degenerate (`unspecified` dominates): the BDI corpus is
  atemporal by construction — a finding in itself, not a gap in this tool.

_Provenance sanity: `modality.holder` matched the file camp on all frames (0 mismatches)._
