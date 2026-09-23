# t/3595 — stale summary→node citation links: provenance worksheet

Frozen classification of the **184 orphaned belief-node citations** (2,053 occurrences on
committed taxonomy **v3.4.0**) referenced by `summaries/*.json` but absent from the live
taxonomy. This is the **frozen input list** for the corpus-wide repoint/removal write
(gated separately under `/data-mutation`).

## Method (grounded in recorded lineage — no text adjudication, per t/2294)

1. **Live set** — all node ids from `taxonomy/Origin/{accelerationist,safetyist,skeptic}.json` at committed HEAD v3.4.0 (959 belief-node ids).
2. **Orphans** — belief-node ids (`^(acc|saf|skp)-`) referenced by summaries in `pov_summaries.{pov}.key_points[].taxonomy_node_id` or `factual_claims[].linked_taxonomy_nodes[]` that are not in the live set → **184 distinct, 2,053 occurrences**.
3. **Lineage** — the successor of a churned node is recorded **in the data**, not in commit messages or `_id_migration_manifest.json` (that manifest is a 0-replacement run). Live successor nodes carry provenance in `confidence_history[].reason` / `operationality_history[].reason` as `"Merged from: <old-ids>"` / `"Split from …"`. Predecessor→successor edges were extracted from every node across HEAD + all provenance-bearing snapshots (7 total), then **transitively closed** through dead intermediates to the live terminal(s).

## Tiers

| Tier | Orphans | Occ | Meaning | Resolution |
|------|--------:|----:|---------|------------|
| **A** | 54 | 1027 | exactly one live descendant (incl. transitive) | repoint the link in place → successor |
| **B** | 0 | 0 | genuine 1:many split, ≥2 live descendants | (none — split children were merged onward to single successors) |
| **C** | 130 | 1026 | no live descendant anywhere in history | remove the dead link (Tier-C resolution per t/3595#6) |

- Tier-C confirmed genuine, not a parse gap: **0 of 130** appear in any live node's JSON in any field/phrasing.
- Coverage loss is ~50% by occurrence (1026/2053) — feeds the grounding-coverage metric (t/3597), which must be recomputed on live links post-fix.
- Tier-C skews to **intentions** (skp 42, acc 27, saf 26 vs beliefs 21, desires 14).

## Removal mechanic (t/3595#7/#8) — values-only, non-destructive

- `factual_claims[].linked_taxonomy_nodes[]` (200 occ): drop the dead id from the array.
- `key_points[].taxonomy_node_id` (826 occ): set to `null`. The type is `string | null`
  (`summary-viewer/src/renderer/types/types.ts`), so this is **not** a shape change — the
  extracted `point` + `verbatim` quote are preserved; the inverter (t/3596) skips null-id points.

## `worksheet.json`

One entry per orphan: `orphan`, `occurrences`, `n_files`, `tier`, `live_descendants`
(the repoint target for Tier A), `lineage_edges` (the predecessor→successor chain). It is
the authoritative frozen list the write script reads — **never re-derived at apply time**.

## Audit record

Per t/3595#6, the drop is recorded at the **artifact level** (this worksheet + the write
PR's git history), so the live summary arrays stay clean and authoritative for the
inverter (t/3596) and integrity gate (t/3598).

Produced by PowerShell (Main); co-signed by Computational Linguist (provenance owner).
