# Option C design — `logical_form.about[]` ref-vocabulary (t/3389)

**Status:** SIGNED OFF (SO + TL, e/145#13–#16, 2026-09-07). Execution clear under the §6 canonical land order; sub-tickets Quality-routed (no further Main/SO pass).
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
- `refs[].ref` matches **`^(term:|ent-)`** — concepts are colon-prefixed (`term:liability_strict`), entities are **hyphenated** (`ent-360`), NOT `ent:*` (SO e/145#14 (d)2: a colon-vs-hyphen typo would make every port reject real entity refs). Specify this exact pattern in each port's test fixtures. `match_level` retained for structural parity but is **not** load-bearing here (it was the t/3379 enum-leak axis).

**Alternative shape (for the group to weigh):** a bare `topical_candidates: [{ref, match_level, validated:false}]` array with a per-entry flag. Lighter, but repeats the flag and has no field-level provenance; I recommend the object.

## 3. In-artifact quality marking — the hard requirement (SO e/145#9 input 1, TL #11)

The migrating refs carry ~46% false attachments (P=0.537 vs blind golden: excluded-foil attachment, `safety_existential` thematic halo, lexical false-matches like "Scale AI"-the-verb). A clean-named trusted-looking field would launder unvalidated output into an authoritative home — the original sin one field over. The recommended object shape carries `validated:false` + `blind_golden_precision:0.54` **in the data**, so a future consumer can tell from the artifact alone that this is a raw candidate layer scoring 0.54, not a curated index. This is a **gate**, not a nicety: no clean-named field.

**Provenance lifecycle (SO e/145#14 (c), TL #16) — the marking cuts both ways.** When the repaired generator (t/3390) regenerates a node's topical refs, exactly one of two things must happen, never a third: **either** the refs revalidate ≥0.80 and **move to `about[]`** (A reopens for that population), **or** the provenance block **updates in lockstep** with the new output (`generator`, `golden_ref`, `blind_golden_precision` reflect the new measurement). What must **never** happen is a repaired generator writing fresh refs under stale `0.54` metadata — wrong-in-either-direction metadata defeats the marking gate as surely as no marking at all. The t/3390 fix and any batch re-validation must update or move, never overwrite-refs-only.

## 4. Migration (corpus-wide → /data-mutation discipline)

Per node with `logical_form.about[]` containing `term:` refs: move `term:` refs → `topical_candidates.refs`; retain `ent-` refs in `about[]`. Corpus-wide write to `ai-triad-data` → run under **/data-mutation** (frozen id list + recorded authorization + second-agent verification + clean-tree funnel + 0-collateral proof). The frozen list is exactly the nodes whose `about[]` currently holds ≥1 `term:` ref (~the 1560-ref population; enumerate + freeze at execution).

## 5. C as fallback-in-effect, NOT endpoint (SO #9 input 2, TL #10)

The three failure classes are fixable generator defects (t/3390). Design + register record: **a repaired generator re-measured ≥0.80 on the SAME locked blind-golden methodology (t/3381) reopens Option A as a new decision.** C must not ossify into "the convention"; it is the contingency that preserves metric integrity while the generator's precision problem stands. The frozen golden + versioned metric make A revisitable.

## 6. Canonical land order (SO e/145#15 + TL #16 — implement the composition, not either half)

**Never enforcement-before-data; never data-before-additive-schema.** Three phases:

1. **Additive schema first.** All four ports *accept* `topical_candidates`, with `about[]` still **tolerant** of `term:` refs. Land + green **before any data moves.** (Prevents the t/3375 frame-strip class and the t/3352/t/3379 fleet-red class on the not-yet-migrated corpus.)
2. **Data second.** The /data-mutation corpus write moves the 1560 `term:` refs `about[]`→`topical_candidates`. Dry-run **asserts the #2052 frame-count floors are untouched** (frames persist; only about[]'s contents move within them) and **0 collateral**. TL is the /data-mutation element-3 second-agent verifier on the push.
3. **Enforcement last.** Only after the migration verifies, tighten `about[].ref` to `^ent-` (or land it atomically with the migration). Enforcement-before-data would red the 1560 not-yet-moved refs fleet-wide.

### Port table

| Port | Phase-1 (additive) | Phase-3 (enforce) | Owner |
|------|--------|--------|-------|
| Zod (`taxonomy-editor` schema) | add `topical_candidates` object; `about[]` still tolerant | tighten `about[].ref` → `^ent-` | **Rosetta** (route) |
| PS generator (`LogicalFormPass.ps1`) | write `term:` topical refs to `topical_candidates`, keep `about[]` ent-only | — | **PowerShell** (route) |
| Python generator (`formalize_node_lf.py`) | same split; already enum-clamps match_level (t/3379 #5) | — | **CL (me)** |
| Schema doc §109 (`logical-form-schema.md`) | document C shape + fallback-in-effect + provenance-lifecycle (§3) | — | **CL (me)** |

Both-arms tests per port; each fixture uses the exact `^(term:|ent-)` candidate pattern (§2). The PS↔TS parity fixture (condition 3) asserts identical `about[]` + `topical_candidates` split on the same input. Conditions 2 (ref-format enforcement) + 3 (parity) remain **unconditional**.

## 7. Sign-off — CLOSED (SO + TL approved, e/145#13–#16)

Object shape ✓ · `topical_candidates` name ✓ · marking gate satisfied ✓ · migration under /data-mutation ✓. Two ordering conditions + the §2 vocab-pattern fix + the §3 provenance-lifecycle rule folded in above. Sub-tickets are **playbook-covered implementation of a signed-off design → Quality-routed per `docs/review-routing.md`, no further Main/SO pass** unless one deviates; the migration write still runs /data-mutation with TL as second-agent verifier.
