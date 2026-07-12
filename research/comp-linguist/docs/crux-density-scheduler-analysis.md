# Crux-Discovery-Density as a Scheduler-Importance Signal

**Ticket:** t/1534
**Date:** 2026-07-12
**Author:** Computational Linguist
**Method:** t/1275-style — crux-linkage counts from `aggregated-cruxes.json`, cross-referenced
against the `corroboration-design.md` §Program scheduler-importance formula. Reproducible:
`research/comp-linguist/analyses/crux_density_scheduler.py`.

## Question

External review of the Debate-Tested proposal (t/1523) asked why build a testing-history
tier ladder rather than a straightforward "crux discovery density" heat-map. The design
already answered *substitution* (crux-density cannot distinguish Untested from Cited — both
show near-zero crux involvement — which is the exact distinction the tier ladder preserves).
This analysis answers the remaining, narrower question: is crux-density a useful
**complementary input to the severe-test scheduler's `importance` term**, and should its
computation be shared with the existing `corpusCoverage.ts` crux-linkage lever?

Current importance formula (`corroboration-design.md` §Program, all weights stipulated):

```
importance = 0.35·degree_centrality + 0.25·policy_linkage
           + 0.20·doctrinal_anchor + 0.20·usage_frequency
```

## Data

Source: `taxonomy/Origin/aggregated-cruxes.json` — 586 cruxes over 107 source debates,
generated 2026-05-08, dedup threshold 0.8.

| Measure | Value |
|---|---|
| Cruxes with ≥1 `linked_node_ids` | 498 / 586 (85.0%) |
| Distinct nodes carrying crux-density | 421 (by crux count) / 329 (present in current node set, 27.5% of 1,198) |
| Density max / mean / median (linked nodes) | 46 / 5.25 / 3 |
| Cruxes with any `irreducible` state | 12; `active` 490 |
| Crux `frequency` distribution | 584 appear once, 1 twice, 1 four times |

**Coverage is adequate to use now** (85% of cruxes linked; 27.5% of all nodes carry the
signal — better coverage than `usage_frequency`, see below), but it reflects a **single
2026-05-08 harvest generation**: near-zero dedup merging (584/586 cruxes are single-debate)
means density will grow and shift as the corpus grows. It should be recomputed on the same
cadence as the testing tier, not frozen.

## Complementary vs. redundant (Spearman ρ over all 1,198 nodes)

| Pair | ρ | Reading |
|---|---:|---|
| crux_density ~ **degree_centrality** | **+0.525** | Moderately related, **not** redundant — ~72% of variance unexplained by degree. |
| crux_density ~ **usage_frequency** | −0.100 | Essentially independent. |
| crux_density ~ **policy_linkage** | +0.158 | Weak. |
| (ref) degree ~ usage_frequency | −0.200 | — |

**Coverage of the existing terms:** `policy_actions` populated on 901/1,198 nodes (75%);
`debate_refs` (the `usage_frequency` source) on only **134/1,198 (11%)**. `usage_frequency`
is therefore the weakest, sparsest term in the current formula.

**Interpretation.**
1. Crux-density is a genuine **complementary** signal, not a restatement of the existing
   proxies: near-orthogonal to `usage_frequency`, weakly related to `policy_linkage`, only
   moderately overlapping `degree_centrality`.
2. The *marginal ranking* gain over `degree_centrality` alone is modest — only **3 nodes**
   are high-crux (≥5) yet at-or-below median degree (41), so degree already surfaces most
   disagreement hubs. Crux-density will not dramatically reorder the top of the queue.
3. The real payoff is **construct validity**, not reordering. `degree_centrality` counts
   *all* edges — SUPPORTS as well as attacks — so a node embedded in a dense web of agreement
   scores as "important" without being contested at all. Crux-density measures
   *contestation specifically*, which is exactly what "spend debate budget where real
   disagreement lives" wants. It is a more honest operationalization of the scheduler's own
   stated intent than the degree proxy it partly overlaps.

## Recommendation

### 1. Fold crux-density into `importance` — as a partial substitute for degree, not an add-on

Because crux-density correlates +0.525 with `degree_centrality`, adding it *on top* at full
weight double-counts structural centrality. Reallocate instead — take weight from the term it
overlaps (degree) and from the sparse, weak term (usage_frequency):

```
importance = 0.25·degree_centrality + 0.15·crux_density_norm + 0.25·policy_linkage
           + 0.20·doctrinal_anchor + 0.15·usage_frequency
```

(`crux_density_norm` = per-node crux count normalized 0–1, min-max or saturating, same
treatment as the other terms.) This is a **stipulated** reweighting — no evidence pointer
promotes it past that class; it moves 0.10 off degree and 0.05 off usage_frequency to the new
term. It belongs in the corroboration §Provenance Declarations table and the
metric-provenance-register when Phase 3 lands. Priority: **fold in**, but it is Phase 3
scheduler scope (blocked on the scheduler existing at all), so it is a design recommendation,
not immediate code.

### 2. Shared crux-linkage utility — warranted, route to DebateTool

`corpusCoverage.ts` **already** computes exactly this: `loadCruxLinksFromAggregated(dataRoot)`
reads `aggregated-cruxes.json` and returns `Map<nodeId, cruxCount>`, using `FAULT_LINE_CRUX_MIN
= 2` to classify fault-line vs. re-tread nodes (t/1438). The corroboration scheduler's
importance term would need the identical map. Per the **Shared Utility Rule**, the two levers
must not each recompute crux linkage independently.

Recommendation: extract `loadCruxLinksFromAggregated` into a shared `lib/debate/cruxLinkage.ts`
that both `corpusCoverage.ts` and the Phase 3 scheduler import. Both files are `lib/debate/`
scope → owner is **DebateTool**. This is not urgent extraction-for-its-own-sake: the second
consumer (the scheduler) does not exist yet, so the Shared Utility Rule's "2+ consumers"
trigger fires **at Phase 3**, not now. The correct sequencing is to make the shared utility a
**prerequisite of corroboration Phase 3**, so the scheduler is built against the shared module
rather than adding a second copy. Filed as a DebateTool ticket blocking Phase 3.

### 3. No standalone code changes now (AC #4)

No cheap win justifies immediate code: the reweighting and the utility extraction both live at
corroboration Phase 3, which is itself gated behind the Phase 0 data model and the pilot
validation gate. This analysis is the design input for that phase.

## Caveats

- Single-generation snapshot (2026-05-08). Recompute as the corpus grows; the +0.525/−0.10
  correlations may shift.
- `crux_density_norm` weight (0.15) and the degree/usage reallocation are stipulated design
  judgments, not tuned — they must never be tuned against a debate-quality score that also
  serves as a guardrail (framing-paper autotuning boundary).
- Crux-density measures *where contestation was discovered*, which is partly a function of
  what has already been debated — it under-counts genuinely contentious nodes that simply
  have not been debated yet. That is the same "absence of testing ≠ absence of importance"
  gap the testing tier's `deficit` term handles; the two terms are meant to compose, not
  substitute (importance × deficit).
