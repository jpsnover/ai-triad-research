# t/3391 Option-C phase-2 migration — dry-run 0-collateral proof (staged, write HELD)

Phase-1 complete (all 4 ports green: Python #2078, Zod #2096, parity #2097, PS #2101). This is the phase-2
`/data-mutation` corpus write, **staged and dry-run-proven** — HELD for recorded PI authorization + TL
second-agent verification before `--apply`.

## Transform (signed-off, c-design.md #2/#4)
Per frozen node: move `logical_form.about[]` `term:` refs → `topical_candidates.refs`; retain `ent-` in `about[]`.
`topical_candidates = {validated:false, generator:"formalize_node_lf.py", golden_ref:"t/3381", blind_golden_precision:0.54, refs:[{ref,match_level}]}`.
Pure MOVE — `match_level` preserved, not re-derived. `generator` = the origin generator (these refs were produced by `formalize_node_lf.py`), not a migration marker.

## Frozen list (element 1 — committed, not re-derived at apply time)
`t3391-frozen.json` — **618 target nodes** (every node whose `about[]` holds ≥1 `term:` ref). By POV: acc 126, saf 265, skp 227. The tool reads this id list; it never re-scans the corpus for the target SET.

## Dry-run result (element 6 — 0-collateral proof)
```
618 nodes migrated, 1560 term: refs moved (acc 294 / saf 754 / skp 512)
0-collateral proof: PASS
```
- **1560** matches the design's expected population exactly.
- **Byte-identical serializer** — `json.dumps(indent=2, ensure_ascii=False)+"\n"` round-trips each live POV file byte-for-byte, so `--apply` writes a pure insertion diff (no reflow).
- **Node order/count intact** across all 3 files.
- **All non-target nodes deep-equal** (23 logical_form nodes with no term: refs + all non-LF nodes untouched).
- **Per-target pure-move verified**: `about[]` = original `ent-` refs only; `topical_candidates.refs` = exactly the original `term:` refs (order preserved); the provenance block equals the signed-off constant; the rest of each node deep-equal.
- **0 nodes had pre-existing topical_candidates** → no merge/collision.
- **#2052 frame-count floors untouched** — frames persist; only `about[]` contents move within them (node count unchanged, asserted).

## Remaining /data-mutation gates before `--apply` (NOT yet cleared)
- **Element 2 — recorded PI authorization** (corpus-wide `ai-triad-data` write). ← the decision gate.
- **Element 3 — TL second-agent verification** on the committed tree (re-count 1560/618).
- **Element 7 — app-quiesce** (Electron editor closed; zero processes) so harvest-on-save can't re-clobber.
- **Sequencing** — no overlap with the pending 432-demotion `conflicts.json` write (t/3352 incident class).
- **Then** phase-3 (Zod tighten `about[].ref`→`^ent-`) → Shared Lib, after this verifies.

## Files
- `t3391-frozen.json` — the frozen 618-node target list.
- `migrate_t3391.py` — the migration tool (dry-run default; `--apply` writes; guards A/B/C = serializer/structural/per-target).
