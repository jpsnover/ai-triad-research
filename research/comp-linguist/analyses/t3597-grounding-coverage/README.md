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
| `grounding_strength_split` (t/3610) | Of the **covered** nodes: `factual_claim_backed` (strongest — verbatim claim + `doc_position` + `evidence_level`) vs `key_point_only` (weaker — topical link, no position/evidence), per POV + overall. Per-node precedence: factual_claim > key_point. Includes a `reconciliation` block (index vs inversion). |

**Universe = all 959 live BDI nodes** (Beliefs 540 + Intentions 333 + Desires 86),
matching the audit's 959; "belief nodes" in the ticket means the belief *graph*,
not the Beliefs category alone.

**Source model:** coverage (metrics 1-3) is computed by **inverting the summaries**
that already carry the links — `pov_summaries[pov].key_points[].taxonomy_node_id`
(1 node) and `factual_claims[].linked_taxonomy_nodes[]` (0..n nodes) — crediting
each linked node to the summary's `doc_id`. A source counts only if it resolves to
`<sources_root>/<doc_id>/metadata.json`. The **strength split** (metric 4) reads the
per-entry `link_source` discriminator from the authoritative node-side index t/3596
materialized (`taxonomy/Origin/source_index.json` = the deduped belief→source
inversion, SoT); if that file is absent the split falls back to computing the same
discriminator from inversion and emits a WARN. NB t/3596 shipped a *separate* index
file, not the `graph_attributes.sources[]` shape v1 anticipated, so `READ_FROM_NODE_INDEX`
stays off and coverage keeps inverting summaries — the series stays comparable.

## Reproduced baseline (2026-09-23, this instrument)

| | acc | saf | skp | overall |
|---|---|---|---|---|
| **coverage** | 165/217 = 76.0% | 322/374 = 86.1% | 301/368 = 81.8% | **788/959 = 82.2%** |

- `sources_per_covered_node` (live): **median 5, mean 11.47, max 150**.
- `synthetic_only`: **171 (17.8%)**; truly ungrounded (no source *and* no synthetic field): **0**.
- 337 stale linked node-ids (linked by summaries, absent from the live taxonomy) — excluded from coverage by construction; companion cleanup is t/3596.
- 845 summaries scanned.

## Strength split baseline (2026-09-25, from `source_index.json` SoT; t/3610)

Of the 788 covered nodes, how many rest on a **factual_claim** (strongest) vs only a **key_point** (weaker):

| | acc | saf | skp | overall |
|---|---|---|---|---|
| **factual_claim_backed** | 129 | 230 | 190 | **549** (57.2% of all; 69.7% of covered) |
| **key_point_only** | 36 | 92 | 111 | **239** (24.9% of all) |
| **uncovered** | 52 | 52 | 67 | **171** (17.8%) |
| fc as % of *that camp's* covered | 78.2% | 71.4% | 63.1% | 69.7% |

- **skp is the weakest-grounded camp** — nearly 37% of its covered nodes rest on a key_point only, vs 22% for acc.
- **Reconciliation:** index and inversion agree on covered/uncovered (both 788 / 171, matching `grounding_coverage_rate`); they differ on exactly **1** covered node's tier (index `factual_claim` vs inversion `key_point`), resolved to the index as SoT. 0 unrecognized `link_source` values. The `reconciliation` block in the JSON records this every run, so a future index/inversion divergence is a visible, countable property rather than a silent one.
- Note the 2026-09-23 coverage baseline above held exactly (788/959) on the 2026-09-25 rerun; only the source-count distribution and the stale-id count moved with the corpus (real evolution, not a metric change).

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
