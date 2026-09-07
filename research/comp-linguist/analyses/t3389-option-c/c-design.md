# Option C design — `logical_form.about[]` ref-vocabulary (t/3389)

**Status:** DRAFT for SO+TL sign-off (t/3361 mandatory consult — schema/data-model change). Do not execute until signed off.
**Context:** t/3381 re-measure missed the pre-committed floor (concept-anchored about[]-component 0.6357 < 0.80; overall 0.778 ≥ 0.753 passed). Per the ratified rule (e/145), Option A falls back to **C**. SO+TL cleared the design pass (e/145#9/#10/#11) with two binding inputs, addressed in §3 and §5 below.

## 1. Decision recap

C keeps `about[].ref ∈ {ent-*}` — reverting to the exact §109 definition the ent-only golden validated — and homes the 1560 `term:` concept refs in a **separate, quality-marked** field. Nothing is deleted. Because `about[]` reverts to its pre-drift shape, **the frozen ent-only golden (0.803 / v2 0.778) still describes `about[]` as-is — no `about[]` re-measure is needed.**

Production today (`ai-triad-data`): `about[]` carries 1560 `term:` + 31 `ent-` refs (Python `formalize_node_lf.py` drift). Under C the 31 `ent-` stay; the 1560 `term:` move.

## 2. Field shape

`about[]` — unchanged §109 semantics: `[{ref: ent-*, match_level}]`, the complete ent topical projection (superset of `args[]` participants). Zod restricts `ref` to `^ent-`.

New sibling field on `logical_form` (**recommended shape — object, so the quality status is unmissable from the data alone**):

```jsonc
"topical_candidates": {
  "validated": false,
  "generator": "formalize_node_lf.py",
  "golden_ref": "t/3381",
  "blind_golden_precision": 0.54,   // micro P vs the t/3381 blind golden (F1 0.64)
  "refs": [ {"ref": "term:liability_strict", "match_level": "exact"}, ... ]
}
```

- The field **name** says "candidates," not "index."
- The **`validated:false` + provenance block** means any consumer that opens the node sees the quality status without reading the register — satisfying the §5 hard requirement three ways at once (name + flag + provenance).
- `refs[]` accepts `term:*` or `ent:*` (candidate layer is not vocabulary-restricted); `match_level` retained for structural parity but is **not** load-bearing here (it was the t/3379 enum-leak axis).

**Alternative shape (for the group to weigh):** a bare `topical_candidates: [{ref, match_level, validated:false}]` array with a per-entry flag. Lighter, but repeats the flag and has no field-level provenance; I recommend the object.

## 3. In-artifact quality marking — the hard requirement (SO e/145#9 input 1, TL #11)

The migrating refs carry ~46% false attachments (P=0.537 vs blind golden: excluded-foil attachment, `safety_existential` thematic halo, lexical false-matches like "Scale AI"-the-verb). A clean-named trusted-looking field would launder unvalidated output into an authoritative home — the original sin one field over. The recommended object shape carries `validated:false` + `blind_golden_precision:0.54` **in the data**, so a future consumer can tell from the artifact alone that this is a raw candidate layer scoring 0.54, not a curated index. This is a **gate**, not a nicety: no clean-named field.

## 4. Migration (corpus-wide → /data-mutation discipline)

Per node with `logical_form.about[]` containing `term:` refs: move `term:` refs → `topical_candidates.refs`; retain `ent-` refs in `about[]`. Corpus-wide write to `ai-triad-data` → run under **/data-mutation** (frozen id list + recorded authorization + second-agent verification + clean-tree funnel + 0-collateral proof). The frozen list is exactly the nodes whose `about[]` currently holds ≥1 `term:` ref (~the 1560-ref population; enumerate + freeze at execution).

## 5. C as fallback-in-effect, NOT endpoint (SO #9 input 2, TL #10)

The three failure classes are fixable generator defects (t/3390). Design + register record: **a repaired generator re-measured ≥0.80 on the SAME locked blind-golden methodology (t/3381) reopens Option A as a new decision.** C must not ossify into "the convention"; it is the contingency that preserves metric integrity while the generator's precision problem stands. The frozen golden + versioned metric make A revisitable.

## 6. 4-port encoding + ownership routing

| Port | Change | Owner |
|------|--------|-------|
| Zod (`taxonomy-editor` schema) | `about[].ref` → `^ent-` only; add `topical_candidates` object | **Rosetta** (route) |
| PS generator (`LogicalFormPass.ps1`) | write `term:` topical refs to `topical_candidates`, keep `about[]` ent-only | **PowerShell** (route) |
| Python generator (`formalize_node_lf.py`) | same split; already enum-clamps match_level (t/3379 #5) | **CL (me)** |
| Schema doc §109 (`logical-form-schema.md`) | document C shape + the fallback-in-effect note | **CL (me)** |

Both-arms tests per port. The PS↔TS parity fixture (condition 3) asserts identical `about[]` + `topical_candidates` split on the same input. Conditions 2 (ref-format enforcement) + 3 (parity) remain **unconditional** and are unaffected by the A→C outcome.

## 7. Sign-off ask

SO + TL: (a) object vs bare-array shape for `topical_candidates`; (b) field name (`topical_candidates` vs alternative); (c) that the object shape satisfies the in-artifact-marking gate; (d) any migration-scope concern before the /data-mutation run. On sign-off I file the execution sub-tickets and route the Zod/PS halves.
