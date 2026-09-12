# Synthetic-phrase stores: converge or keep? (decision doc, t/3432)

**Author:** Computational Linguist · **Status:** for TL architecture review + PI review · **Ticket:** t/3432 (PI-directed, p/548#107) · **Fix ticket (blocked on this):** t/3433

## Summary

Two live stores hold "synthetic phrases," plus one legacy artifact. They were built four days apart for different consumers and never reconciled. The node-level store (`graph_attributes.synthetic_phrases`, 83 nodes) is the younger, thinner layer; its only debate-engine consumer is a default-off experiment covering 9% of nodes. The sidecar corpus (`synthetic/corpus_*.json`, 8,416 entries) is richer on every provenance axis and is the store the Phrases tab and retrieval already use.

The decision is **contingent on t/3366** (the first-person `debate_grounding` field), because t/3366 is being built to replace exactly what the node store feeds the debate engine. Per TL (p/349#260), this doc scores the options under both worlds and holds the Second Opinion + committed decision until t/3366's fate is a landed fact, not a forecast.

## 1. Inventory

| Store | Size | Schema | Writer | Consumers |
|---|---|---|---|---|
| `node.graph_attributes.synthetic_phrases` | **83 nodes** (9% of 912 POV nodes) | plain string list, no metadata | `batch_enrich_nodes.py` (added 2026-06-16) | debate engine (`taxonomyContext.ts`) via `useSyntheticPhraseGrounding` flag; debateReflectionSlice; analysis prompts |
| `taxonomy/Origin/synthetic/corpus_{acc,saf,skp}.json` (+ `.npy`) | **8,416 entries** | archetype-tagged: statement / archetype / audience / model / rationale / pruned + provenance; embedding sidecars | `New-/Update-SyntheticCorpus` (added 2026-06-12) | Phrases tab; retrieval embeddings |
| `comp-linguist/debate_claims_corpus.json` | legacy | claim pairs | (legacy) | Phrases panel can read it (legacy path) |

## 2. History

The order is the opposite of what the "which is the legacy layer?" framing suggests:

- **2026-06-12** — the **sidecar corpus** lands first (`New-SyntheticCorpus`, t/549/t/550, "Phase 0 gating cmdlets + synthetic corpus pipeline"). It was designed as a provenance-bearing, archetype-tagged corpus for retrieval + the Phrases tab.
- **2026-06-16** — the **node lists** land four days later (`batch_enrich_nodes.py`, CL research scripts), as a lightweight per-node enrichment during the enrichment era.

No convergence was ever designed. The node lists were a separate, later, thinner enrichment that put a few paraphrases directly on nodes for quick debate-context feeding, independent of the already-existing sidecar. There is no evidence the two were meant to be one store; they accreted.

## 3. Consumer analysis

- **Sidecar → Phrases tab + retrieval.** The tab browses archetype-tagged phrases; retrieval uses the `.npy` embeddings. Both genuinely need the sidecar's structure (archetype, audience, embeddings). No substitute.
- **Node lists → debate engine, and *only* through a default-off flag.** The debate engine reads `n.graph_attributes.synthetic_phrases` at `taxonomyContext.ts:485-513`, but *only* when `useSyntheticPhraseGrounding` is on (t/3367, **default-off**). When on, it cosine-selects the phrase nearest the node's description embedding and renders it in the grounding line; when a node has no phrases (91% of them) it emits a WARN and falls back to the description. So the node store's debate-engine value today is: an off-by-default experiment, active on 9% of nodes, degrading to description everywhere else.

The question the ticket poses — would the sidecar serve the debate engine as well or better than the 83-node lists? — answers itself on coverage alone: the sidecar covers the corpus; the node lists cover 9%. The sidecar also carries archetype/audience tags the debate engine could select on. The only thing the node lists have that the sidecar lacks is *co-location on the node*, which is a lookup convenience, not a capability.

## 4. Quality / provenance comparison

| Axis | node lists | sidecar |
|---|---|---|
| Provenance (model, rationale) | none | yes |
| Archetype / audience tags | none | yes |
| Pruning / quality marking | none | yes (`pruned`) |
| Embeddings | none (debate engine embeds on the fly) | yes (`.npy`) |
| Coverage | 9% | full corpus |

The node layer is **strictly dominated** on quality and provenance. It has no metadata a consumer could trust or filter on, and no coverage. Its sole advantage is node co-location.

## 5. Options (scored under both worlds, per TL p/349#260)

The pivot is **t/3366** (`debate_grounding`, first-person). t/3366 is being built to give the debate engine a purpose-built, first-person "what you take as true" grounding line — which is exactly the job the node `synthetic_phrases` currently do (badly, third-person, 9% coverage) via the t/3367 flag.

### World A — `debate_grounding` (t/3366) lands
The node store loses its only debate-engine consumer (the grounding line moves to `debate_grounding`). Nothing else reads the node lists. **Recommendation: CONVERGE — retire `graph_attributes.synthetic_phrases`.** The sidecar remains for the Phrases tab + retrieval; the debate engine uses `debate_grounding`; the node field is deleted (a data-file shape change → Second Opinion). Migration cost is low: the field is additive and 9%-populated, no consumer breaks once `debate_grounding` is wired and the t/3367 flag is retired.

### World B — `debate_grounding` does not land / stalls
The node store keeps its debate-engine role (the t/3367 grounding experiment). The recommendation then rests on the quality/coverage comparison alone: even here, the **sidecar is the better debate-engine source** (full coverage + archetype tags vs 9% plain strings), so the recommendation is **CONVERGE via a different path — migrate the debate engine's grounding-phrase lookup to the sidecar and retire the node field**, rather than backfill 829 more node lists that duplicate what the sidecar already holds. The backfill (the original t/3366 framing) is the option this analysis most clearly argues against: it would invest in growing the dominated layer.

**Both worlds point to retiring the node field.** They differ only in what replaces its debate-engine role: `debate_grounding` (World A) or a sidecar lookup (World B). Neither world recommends keeping or backfilling the node lists.

### Hybrid (documented keep) — not recommended
Keeping both, documented as distinct purposes, is defensible only if the node lists gain a consumer the sidecar cannot serve. No such consumer exists today.

## 6. Coverage gap

Why only 83 nodes? Because `batch_enrich_nodes.py` was a partial enrichment pass, not a corpus-wide backfill, and no cmdlet exists to complete it (unlike `plain_description`, which has `Invoke-VernacularBatch`). The 9% is an abandoned partial pass, not a designed coverage target. This is further reason not to invest in completing it.

## 7. Recommendation + gate

**Recommendation: converge — retire `graph_attributes.synthetic_phrases`; keep the sidecar as the single synthetic-phrase store; do not backfill the node lists.** The replacement for the debate-engine grounding role is `debate_grounding` (World A, preferred) or a sidecar lookup (World B fallback).

**Gate (held per TL):** retiring the node field is a data-file **shape change** → **t/3361 mandatory Second Opinion** at the decision. Per TL's sequencing, the SO consult and the committed decision **wait until t/3366's fate is a landed fact** — a retire-recommendation resting on "its primary consumer is about to disappear" must cite a landed `debate_grounding`, not a forecast. If t/3366 lands, World A's recommendation commits; if it stalls, World B's does. Implementation is t/3433, blocked on the committed decision.

## Open items
- Confirm the legacy `debate_claims_corpus.json` has no live consumer beyond the Phrases panel's legacy read before including it in any retirement.
- The 15 fork-B verified conflict edges and the 432-demotion are unrelated to this store; no interaction.
