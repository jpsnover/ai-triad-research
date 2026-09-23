# Grounding-coverage calibration metric (t/3597)

**Owner:** Computational Linguist · **Provenance:** `derived` · **Threshold:** none (report distribution first)

Makes the belief→primary-source coverage gap a tracked, re-runnable calibration
signal. Nothing in the pipeline recorded it, so the provenance audit (p/314) had
to compute it ad hoc; this script is the standing instrument.

## Run

```
python compute_grounding_coverage.py            # writes grounding-coverage-baseline.json
python compute_grounding_coverage.py --quiet
```

Roots resolve as: explicit `--data-root`/`--sources-root` > `AI_TRIAD_DATA_ROOT`/
`AI_TRIAD_SOURCES_ROOT` env > `.aitriad.json` > monorepo sibling. Sources is
derived as a sibling of the resolved data root so the script is correct when run
from inside a git worktree (a worktree-relative `../ai-triad-sources` would
otherwise mis-point to `.worktrees/ai-triad-sources`).

## What it measures

| Field | Definition |
|---|---|
| `grounding_coverage_rate` | % of live BDI nodes with ≥1 **resolvable** primary-source citation, per POV + overall. |
| `sources_per_covered_node` | Distribution (median/mean/max/quartiles) over **live covered nodes only**. |
| `synthetic_only` | Nodes with zero factual_claim/key_point links, grounded solely by the synthetic `graph_attributes` fields (`debate_grounding` / `attribution_text` / `intellectual_lineage`). |

**Universe = all 959 live BDI nodes** (Beliefs 540 + Intentions 333 + Desires 86),
matching the audit's 959; "belief nodes" in the ticket means the belief *graph*,
not the Beliefs category alone.

**Source model (v1):** the node-side source index does not exist yet (t/3596), so
coverage is computed by **inverting the summaries** that already carry the links —
`pov_summaries[pov].key_points[].taxonomy_node_id` (1 node) and
`factual_claims[].linked_taxonomy_nodes[]` (0..n nodes) — crediting each linked
node to the summary's `doc_id`. A source counts only if it resolves to
`<sources_root>/<doc_id>/metadata.json`. When t/3596 lands, flip
`READ_FROM_NODE_INDEX` to read `graph_attributes.sources[]` directly; the report
shape is unchanged so the series stays comparable.

## Reproduced baseline (2026-09-23, this instrument)

| | acc | saf | skp | overall |
|---|---|---|---|---|
| **coverage** | 165/217 = 76.0% | 322/374 = 86.1% | 301/368 = 81.8% | **788/959 = 82.2%** |

- `sources_per_covered_node` (live): **median 5, mean 11.47, max 150**.
- `synthetic_only`: **171 (17.8%)**; truly ungrounded (no source *and* no synthetic field): **0**.
- 337 stale linked node-ids (linked by summaries, absent from the live taxonomy) — excluded from coverage by construction; companion cleanup is t/3596.
- 845 summaries scanned.

## Two empirical corrections to the p/314 audit baseline

The CL "reproduce a fixture before asserting its ground truth" rule (t/2294)
surfaced two facts the ad-hoc audit did not:

1. **The audit's sources-per-node distribution (median 4, mean 9.8, max 151) was
   computed over *all 1124 linked node-ids including ~337 stale/dead ones*, which
   pulls the centre down.** This instrument reproduces that stale-polluted view
   exactly under `diagnostics.sources_per_ALL_linked_id_incl_stale` (median 4.0,
   mean 9.66). The **authoritative** metric — resolvable sources per *live covered*
   node — is **median 5, mean 11.47**. (`max` is 150 not 151 because the metric
   counts only resolvable sources; one source of the top node does not resolve.)

2. **Coverage recomputes to 788, not the audit's 792** (Δ4, 0.4%). Per-POV rates
   match the audit's reported 76/86/82 exactly; the recomputed 788 is the
   authoritative value going forward. `synthetic_only` (171) is the exact
   complement of coverage, and **every** uncovered node carries ≥1 synthetic
   grounding field — the corpus has no truly ungrounded nodes.

## Caveats encoded (never suppressed)

- **`extraction_confidence` is not reliability.** It is LLM-self-reported and
  saturated near ceiling (mean 0.96, median 0.97, 96.8% ≥ 0.9). A saturated signal
  cannot discriminate reliability; the script reports the saturation so the
  false-precision is a visible, countable property. Never present it as reliability.
- **No pass/fail threshold.** Per the ticket and the CL provenance rule, this is a
  `derived` distribution metric with no stipulated cut. Do not attach one until it
  is chosen deliberately; a `synthetic_only` or coverage floor would be a separate,
  evidence-backed decision.
- **`source_refs` is out of scope.** Nodes carry a separate authored `source_refs`
  field (379 populated). Unioning it lifts coverage to 839/87.5% — that is a
  *different* instrument and is deliberately excluded; this metric measures
  summary-derived primary-source traceability only.
