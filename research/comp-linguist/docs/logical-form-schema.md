# `logical_form` Schema — Neo-Davidsonian Event Frames on Claims

**Ticket:** t/3126 (T6). **Depends on:** t/3124 (entity_refs resolution, Done).
**Design of record:** `claims-entity-fol-recommendations.md` §7.2 (Phase 1), §7.3 (reification), §7.4 (ownership).
**Owner:** CL (schema + prompt); PowerShell implements the formalization pass. Mandatory-review surface.
**Status:** Landed — schema + prompt + golden seed (PR #1778); prompt sort-fix (`90ce0d3e`); pass built (t/3215, PR #1792/#1814). `about[]` adopted (TL p/571 / t/3126#6) and its superset convention **pinned by the D3b measurement** (`formalization_accuracy` = 0.803, n=10).

## Purpose

A derived, structured proposition layer on claims (`key_points` / `factual_claims` in the summaries
schema; lazily on node `canonical_proposition` equivalents). It is the prerequisite for the FOL track
(§7.2 Phase 1): TPTP export (t/3127) and edge verification (t/3128) consume it. It is produced by an
LLM formalization pass with its own golden set + calibration gate — nothing downstream trusts a
`logical_form` until `formalization_accuracy` is measured.

Design rule it inherits: **the prover is only as sound as the logical form** (§8.1). A wrong
formalization "proved inconsistent" against a correct claim is this system's characteristic failure
mode, so the schema is built to make errors auditable (every field carries provenance-relevant
structure; `formalization_confidence` and `status` gate consumption).

## Where it attaches

`logical_form` is a new derived object on each claim, a sibling of the fields t/3124 added. Observed
live claim shape (summaries, post-t/3124):

```
{ stance, taxonomy_node_id, category, point, verbatim, canonical_proposition,
  extraction_confidence, entity_refs[ {ref, surface, method, link_confidence, match_level, status} ],
  ... , logical_form { … } }        ← this spec
```

The formalization pass reads the proposition from `canonical_proposition` (register-normalized) for
BDI claims, and from `point`/`verbatim` for `factual_claims` (whose `canonical_proposition` is empty
for 100% of them — D3a); `category` for the attitude, the camp for the holder, and `entity_refs[]`
for both the argument bindings and the `about[]` projection. It never re-extracts entities.

## Schema

```json
{
  "predicate": "acquire",
  "event_ref": "e1",
  "args": [
    {"role": "agent",   "ref": "ent-034", "sort": "agentive-physical-object", "match_level": "exact"},
    {"role": "patient", "ref": "ent-055", "sort": "non-agentive-functional-artifact", "match_level": "exact"}
  ],
  "polarity": "positive",
  "modality": {"holder": "camp:acc", "attitude": "belief"},
  "temporal": {"type": "at", "value": "2025-02"},
  "about": [{"ref": "ent-055", "match_level": "exact"}],
  "formalization_confidence": 0.85,
  "status": "proposed"
}
```

### Field semantics + closed vocabularies

| Field | Type | Values / rule |
|---|---|---|
| `predicate` | string | Lemma of the event/relation the proposition asserts (the reified perdurant). Lowercase, verb/relation lemma. |
| `event_ref` | string | The Davidsonian event variable (`e1`, `e2`, …), unique within the `logical_form`. First-class so time + participants attach to it. |
| `args[]` | array | Participants in the event. |
| `args[].role` | enum | Thematic role: `agent \| patient \| theme \| recipient \| instrument \| location \| source \| goal \| beneficiary \| cause \| manner`. (Neo-Davidsonian participation predicates; extend only with CL sign-off + register note.) |
| `args[].ref` | string | **MUST be an `ent-*` id drawn from this claim's `entity_refs[].ref`** — never a re-invented id (t/2294). If the participant is not a registered entity, use a literal `lit:"…"` or an event var; record `sort` regardless. |
| `args[].sort` | enum | The entity's DOLCE-lite sort, **pinned to the register's `DolceCategory` closed set** (`lib/entities/types.ts`): `agentive-physical-object \| non-agentive-functional-artifact \| perdurant \| normative-description \| non-agentive-social-object`. Copied verbatim from the referenced entity's `dolce_category`; for a `lit:`/event arg, CL-assigned from the same 5-value set. Copy-not-judge (rule 2). |
| `args[].match_level` | enum | Copied verbatim from the entity_ref: `exact \| instance_of \| subclass \| superclass \| related`. Load-bearing for the prover — a claim about a superclass matched to an instance is a different assertion (§6, R4). |
| `about[]` | array | **Topical grounding (additive, optional):** `[{ref, match_level}]` — the `ent-*` ids the claim is *about* (its topical subject). **Superset convention (pinned, D3b):** `about[]` is the **complete** topical index — every resolved entity the claim is about, **including** those that also fill an `args[]` role (a participant that is topical appears in *both*). Same ids as the claim's `entity_refs[]` (a logical-form projection, **no new resolution**). Governed by the `about[]` conditions below. |
| `polarity` | enum | `positive \| negative`. Negation of the core predication (`¬acquire(e1)`), not attitude negation. |
| `modality` | object \| null | **`null` for `factual_claims`** (unattributed fact). Present for BDI/POV claims. |
| `modality.holder` | enum | `camp:acc \| camp:saf \| camp:skp` (the attributing camp). Derived from the claim's POV/`stance`. |
| `modality.attitude` | enum | `belief \| desire \| intention` — lowercased from the claim's `category` (Beliefs/Desires/Intentions). |
| `temporal` | object | `{type, value}`. |
| `temporal.type` | enum | `at \| before \| after \| during \| unspecified`. `unspecified` (not omission) when the claim carries no time. |
| `temporal.value` | string \| null | ISO-8601 or ISO interval; `null` when `type=unspecified`. Attaches to `event_ref` (`holdsAt(e1, t)`). |
| `formalization_confidence` | number | 0–1. The pass's self-rated confidence that the frame faithfully renders the proposition. The gate lever downstream consumers filter on. |
| `status` | enum | `proposed \| accepted \| rejected`. New forms land `proposed`; the golden-set/calibration pass (or human review) promotes to `accepted`; `rejected` is kept (not deleted) as negative signal, mirroring the entity-resolution status field. |

## Modality → FOL reification (§7.3)

The frame stays first-order. BDI attitudes are **not** modal operators in the exported logic; they
reify via `holds/3`:

```
holds(camp_acc, belief, p1) ∧ about(p1, ent_055) ∧ acquire(e1) ∧ agent(e1, ent_034)
  ∧ patient(e1, ent_055) ∧ holdsAt(e1, 2025_02)
```

- The proposition `p1` is a first-class object (DOLCE non-physical endurant / D&S description).
- `factual_claims` (`modality: null`) assert the frame directly, without the `holds(...)` wrapper.
- **No belief-closure axiom** — camps are deliberately not logically omniscient (that non-omniscience
  is half the research interest). The t/3127 axiom module must exclude closure and document the
  exclusion; this schema encodes nothing that presumes it.
- Cross-camp queries this enables: "which propositions does acc believe and saf reject?" =
  `holds(camp_acc, belief, p) ∧ holds(camp_saf, belief, q) ∧ p = ¬q` over the reified layer.

## Grounding + integrity rules (carried into the prompt, deliverable 2)

1. **Args reference resolved entities only.** Every `args[].ref` that is an `ent-*` id must appear in
   the claim's `entity_refs[]`. The pass never mints entity ids; unresolved participants become
   `lit:"…"` and are flagged, not invented (t/2294 / R6 symbol-is-identity).
2. **`match_level` and `sort` are copied, not judged.** They come from the entity_ref / the entity
   register's `dolce_category`; the pass does not re-derive DOLCE typing per claim (keeps one identity
   model across resolution, formalization, and the future re-merge — the §7.4/t/2946 one-identity rule).
3. **`attitude` follows `category`; `holder` follows POV** — mechanical, not re-judged from prose.
4. **`unspecified`/`null`/`proposed` are first-class**, never silent omissions — an absent field is a
   formalization bug; an explicit `unspecified` is a valid reading (the same "timeout is a result"
   discipline §7.2 Phase 2 applies to the prover).

5. **`about[]` is topical projection, not a dumping bucket.** Populate `about[]` with the `ent-*` ids
   the claim is *about*, reusing the claim's already-resolved `entity_refs[]` ids (no new resolution).

### `about[]` conditions (TL adopt + CL review, p/571 / t/3126#6)

- **(a) Additive + optional.** Pure §7.2 delta; existing consumers ignore it, no migration.
- **(b) Crisp boundary + superset (pinned D3b).** `about[]` = the topical subject the claim is *about*;
  `args[]` = entities filling a formal predicate-argument role. `about[]` is the **complete** topical index:
  a resolved entity that is topical **AND** fills an arg role appears in **both** (superset), not `args[]`
  alone. A ref may also appear in `about[]` only (topical non-participant). It is **never a
  "couldn't-formalize" dumping bucket.** *(Pinned by the D3b measurement: leaving participants out of
  `about[]` was an unpinned-convention ambiguity that deflated scored agreement by ~0.12 with no semantic
  content — see `analyses/logical-form-golden/D3b-findings.md`.)*
- **(c) Non-substitute.** A cleanly-formalizable claim still populates `args[]`; `about[]` is never an
  excuse to skip formalization.
- **(d) Earns its place on the non-formalizable majority.** With 54% of claims carrying an empty
  `canonical_proposition` (100% of factual) and 71% of BDI props meta-descriptive (D3a), `about[]`
  MUST be populated there — that is its whole value. Empty-there = not earning the field.
- **(e) Reconciles with the `summary:*` entity_mention layer (t/3160).** `about[]` is the *logical-form
  projection of the claim's already-resolved `entity_refs[]`* — same `ent-` ids, no new resolution —
  so it does NOT double-ground what the mention-index layer captures. Different layer (LF topical
  grounding vs mention occurrences), same identities.

## Calibration + provenance (deliverable 3 preview)

- **Metric:** `formalization_accuracy` — golden-set agreement between the pass's `logical_form` and the
  CL-labelled reference, scored per component (predicate / args+roles / polarity / modality / temporal)
  so a partial-credit profile shows *which* component the pass gets wrong (predicate vs role vs
  temporal have different downstream costs).
- **Golden set:** labelled claim→logical_form pairs, **empirically reproduced** by running the actual
  pass on real claims (t/2294) — not authored from the doc example. Stratified across `category`
  (B/D/I + factual) and `match_level` so accuracy is readable where it matters (superclass/related
  args are where formalization error concentrates).
- **Provenance:** register entry class **stipulated → measured (seed, D3b)**: `formalization_accuracy` =
  **0.803** (n=10, convention-pinned; 0.686 as-first-authored pre-`about[]`-pin) on the t/3215 batch
  (`ai-triad-data` `853b2938`). Mechanical fields (polarity/modality/temporal/about) = 1.00; residual weak
  axis is `predicate` = 0.50, concentrated on multi-clause meta-descriptive BDI. Not yet `derived` — needs
  n≥30 with match_level diversity and the bias-free D3a rows. `formalization_confidence` is a pass self-rating
  (stipulated) until correlated with golden-set correctness. Full analysis:
  `analyses/logical-form-golden/D3b-findings.md`.

## Open items (post-review)

- [x] `args[].sort` enum pinned to the live register `DolceCategory` set (`lib/entities/types.ts`) — the 5 values above.
- [x] `about[]` adopted as a first-class field with conditions (a)–(e) (TL p/571 / t/3126#6; CL review #1778 issue 2).
- [ ] **PowerShell contract** (handed off): persistence slot (derived field on the claim objects, same pass-slot family as `Invoke-RetrievalConfidencePass`); `{{ENTITY_REFS}}` must join `dolce_category`→`sort`; the factual arm reads `point`/`verbatim`.
- [ ] `event_ref` scope (per-claim vs per-summary) — reconcile with the t/3127 TPTP generator.
- [ ] `holds/3` cross-role interface question deferred to t/3127 (TPTP export), per CL review.
