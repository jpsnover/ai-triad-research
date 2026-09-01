# logical_form Golden Set (t/3126 D3a) — with input-substrate findings

Reference set + scorer for the `logical_form` formalization pass (schema: `docs/logical-form-schema.md`;
prompt: `scripts/AITriad/Prompts/logical-form-formalization.prompt`). Empirically grounded in the live
summaries corpus per t/2294 — every observed row is a real claim with its real `entity_refs`; the
reference `logical_form` is CL-authored.

## Finding: the pass's input substrate largely does not match the schema's assumption

Inventory of all `entity_refs`-bearing claims (n=472 across 229 summaries; regenerate with
`_inventory.py`):

| Signal | Measured | Consequence |
|---|---|---|
| Empty `canonical_proposition` | **253/472 (54%)** — and **100% of factual_claims** (0/219 BDI, 253/253 factual) | The factual arm has **no input field**. Factual content lives in `point`/`verbatim`, not `canonical_proposition`. The pass must read those for factual claims, or factual formalization is out of scope until the input exists. |
| Meta-descriptive BDI props ("The document discusses…") | **155/219 (71% of non-empty)** | Formalize to a useless `discuss(document, …)` frame, not the substantive claim. The pass needs an explicit rule (extract the embedded assertion, or skip+flag), or — better — the upstream extraction should emit atomic `canonical_proposition`s. |
| Single `entity_ref` per claim | **417/472 (88%)**; only 55 have ≥2 | Multi-argument entity-grounded frames (the schema's `acquire(agent, patient)` shape) are the minority. Most participants resolve to `lit:` non-entities. |
| Entity_ref is topical, not a participant | qualitative (CHIPS Act / Claude / GDPR ref'd by props that aren't *about those entities as agents/patients*) | **Schema gap:** the schema has only participant `args[]`; a topical ref has nowhere valid to attach, though §7.3 uses `about(p, ent)`. → recommend an `about[]` field (see below). |
| `match_level` | **exact for all 540 refs** | Non-exact levels (instance_of/subclass/superclass/related) are **absent from the live corpus** — those strata can only be covered by *constructed* cases. |

Net: only **~64/472 (13.5%)** are cleanly formalizable as-is (non-empty, non-meta). The full golden
set + the D3b `formalization_accuracy` measurement should be built against the **resolved** input
(factual→point/verbatim; meta-descriptive handled), not the current field as-is — otherwise the
reference formalizes the wrong text.

## Reshape recommendations (feed back into D1/D2 + the FOL track)

1. **Schema amendment (D1):** add `about: [{ref, match_level}]` for topical entity_refs distinct from
   participant `args[]` — mirrors §7.3's `about(p, ent)`. Without it, 88%-single-ref topical mentions
   are forced into a participant role they don't fill. (Encoded in the seed rows below as `about`.)
2. **Prompt amendment (D2):** a meta-descriptive guard — if the proposition is "The document …",
   formalize the *embedded* assertion, and if none is recoverable, emit `status:"rejected"` with low
   `formalization_confidence` rather than `discuss(document,…)`.
3. **Factual arm:** the pass reads `point`/`verbatim` for `factual_claims` (canonical_proposition is
   empty for 100% of them).
4. **Upstream (Collaborator/PS extraction):** emit atomic `canonical_proposition`s, not "The
   document…" summaries — the single highest-leverage fix; it moves the 71% meta share toward
   formalizable.

## What this seed contains

A small hand-formalized **seed** (not the full N≥30 golden set — that waits on the input resolution
above so the reference isn't built against the wrong field):
- **observed** rows — real clean claims (with camp), formalized per the schema + the `about[]`
  amendment, showing the participant-vs-topical distinction on real data.
- **constructed** rows — the strata the live corpus lacks: a non-exact `match_level`, a negated
  polarity, an explicit temporal, a multi-participant frame, and a factual (modality:null) case.
  Labelled `constructed` (t/2294 — never let a constructed case masquerade as observed evidence).

`score_golden.py` scores a candidate `logical_form` set against these references **per component**
(predicate / args+roles / polarity / modality / temporal / about) → `formalization_accuracy`, so the
D3b measurement (when the PS pass exists) shows *which* component the pass gets wrong.

## Status

D3a seed + findings: here. **D3b** (`formalization_accuracy` on the real pass output) is gated on
PowerShell building the pass. The **full** golden set is gated on resolving the input-substrate
questions above (recommendations 1–4) so it targets the corrected input.
