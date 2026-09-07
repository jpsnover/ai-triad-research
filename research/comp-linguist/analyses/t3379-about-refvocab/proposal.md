# Proposal: resolve the `logical_form.about[]` ref-vocabulary convention

**Author:** Computational Linguist (schema owner) · **For:** t/3361 mandatory Second Opinion (data-model/shape decision)
**Refs:** t/3379 (recurrence that surfaced it), `docs/logical-form-schema.md` §109 + about[] conditions, D3b (`analyses/logical-form-golden/`)
**Status:** DRAFT for SO. The tactical fleet-unblock (the one out-of-enum `match_level`) already landed (t/3379#5); this decides the *systemic* convention. Nothing systemic ships until the SO rules.

## 1. The decision

What ref vocabulary is valid in `logical_form.about[]`? Today four sources disagree, and the disagreement has been latent since the field shipped (the Zod never enforced ref format, so out-of-convention data passed and only surfaced via the `match_level="universal"` enum defect).

| Source | `about[].ref` convention | Authority |
|---|---|---|
| Schema §109 + condition (e) | `ent-*` only (projection of `entity_refs[]`) | schema-of-record |
| Golden set (`golden_set*.json`) | `ent-*` only (0 `term:`; the set that scored `formalization_accuracy`=0.803) | **validated reference** |
| PS `LogicalFormPass.ps1` (shipped pass) | `ent-*` only (drops `term:`/lit) | canonical generator |
| **Production data** (acc/saf/skp Origin) | **1560 `term:` + 31 `ent-`** (concept-dominant) | de-facto corpus |

The production corpus was written by `research/comp-linguist/tools/formalize_node_lf.py` (the t/3162 PI-directed populate), which keeps `term:` concept refs — a divergence from the schema/golden/PS. So this is **not** "the doc is stale and production is right": three of four authorities (including the *measured* one) are ent-only. But production has 1560 concept refs that a naive ent-only enforcement would delete.

## 2. Why it's genuinely contested (the semantic tension)

`about[]` condition (d) is explicit: the field must **"earn its place on the non-formalizable majority."** D3a found 71% of BDI propositions are meta-descriptive and entity-light. On those claims:
- **ent-only `about[]` is near-empty** — there are few/no `ent-*` entities to project, so `about[]` carries little topical signal exactly where condition (d) says it must carry the most.
- **`term:` concept refs** (e.g. `term:regulation_precautionary`) are what capture the claim's topical subject on entity-light BDI claims.

So the ent-only convention that the golden validated may itself **under-test** `about[]`'s intended value — the golden's ent-only rows don't exercise the concept-anchored majority. That is a golden **coverage gap**, not proof that ent-only is semantically sufficient.

## 3. Options

### Option A — Amend §109 to `about[].ref ∈ {ent-*, term:*}` (+ re-validate)
Bless the mixed topical index (concept-anchored default + entity minority). Non-destructive: keeps the 1560 concept refs.
- **Requires:** rewrite §109/(e); PS generator changed to KEEP `term:` about-refs (currently drops them); Python generator keeps both + enum-clamps `match_level` (the actual leak); Zod/TS + all 4 ports encode `{ent-*|term:*}`; **expand the golden to cover concept about-refs and re-measure `formalization_accuracy` on the mixed convention** (the current 0.803 is an ent-only measurement — cannot be cited for the mixed convention without a fresh golden, per the distribution-bounded-validation rule, register t/3342).
- **Pro:** preserves real topical signal on the meta-descriptive majority (condition d); matches how the corpus is actually populated. **Con:** invalidates the current metric baseline until re-measured; blesses output that was never validated.

### Option B — Regenerate `about[]` to ent-only via the PS pass
Enforce the schema/golden/PS convention; regenerate the layer, dropping the 1560 `term:` refs.
- **Pro:** aligns data with the *validated* reference and the canonical generator; no metric re-baselining. **Con:** `about[]` goes near-empty on the 71% meta-descriptive majority — directly undercuts condition (d); discards concept topical signal; a corpus-wide regenerate (cost + a data write under the current messy tree).

### Option C — Two fields: keep `about[]` ent-only, add a concept-topical field
Reserve `about[]` for `ent-*` (grounded-entity topical projection, unchanged/validated) and formalize the concept-topical layer as a separate field (e.g. `about_concepts[]` of `term:` refs).
- **Pro:** doesn't overload one field with two identity vocabularies; keeps the validated ent-only metric intact; captures concept topicality explicitly. **Con:** new field = schema + 4-port + generator + golden work anyway; migration of the 1560 refs into the new field; more surface than A.

## 4. Recommendation (CL, held for SO)

**Lean A**, *conditional on the re-validation*: the condition-(d) semantic argument is load-bearing — an ent-only `about[]` that is empty on 71% of claims is not serving its stated purpose, and the corpus already committed to concept-anchoring. But A is only sound if we **re-establish the metric baseline** (expand golden to the mixed convention + re-measure) rather than inheriting the ent-only 0.803. If the SO weights "align to the validated reference / don't bless unvalidated output" higher, **C** is the principled middle (no overloading, metric intact). **B** I rank last — it's the only option that makes `about[]` worse at its documented job.

## 5. What's at stake / reversibility
- **Data:** 1560 concept refs (keep under A/C, delete under B). B's deletion is a destructive corpus write; A/C are additive/non-destructive.
- **Metric:** `formalization_accuracy` 0.803 is an **ent-only** measurement; A and C-with-migration both require a fresh golden before the number can be cited for the new shape (t/3342).
- **Ports:** whichever wins must be encoded in all 4 validators (Zod/TS, PS, Python, schema doc) — the missing Zod enforcement is why this drifted silently.
- **Reversibility:** A/C reversible (additive); B not (regeneration discards the concept refs). Favor the reversible options under uncertainty.

## 6. Time constraint
Not urgent — the fleet-blocking enum defect is already fixed (t/3379#5). This is a correctness/consistency decision; take the time to rule well. The generator fix, §109 amendment, and 4-port encoding all wait on this ruling.
