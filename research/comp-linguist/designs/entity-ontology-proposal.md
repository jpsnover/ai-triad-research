# Design Spike: DOLCE-Grounded Entity Ontology for Entity Linking

**Ticket:** t/1767 (data half; t/1766 is the rendering consumer)
**Author:** Computational Linguist
**Last updated:** 2026-07-27
**Status:** Proposal. Requires owner approval before any implementation.

## Verdict up front

Feasible and valuable, with one structural caution. Every layer this needs already exists for organizations and was approved as a pattern in `docs/hld-organization-relationship-graph.md`: a JSON entity file, a typed-edge file with a validated vocabulary, shared TypeScript types, curation cmdlets, a server index, a bridge method, and a detail pane. The extension is a generalization, not an invention.

The caution is duplication. Three entity classes are already first-class nodes in this project (organizations `org-*`, policy actions `pol-*`, taxonomy concepts and situations), and a fourth lives in the contested-vocabulary dictionary. The single biggest design risk is minting a parallel copy of any of them. The proposal below is therefore an extend-and-unify design. New entity kinds get new nodes. Existing kinds get linked, never re-modeled.

## 1. What exists today (verified against the data)

- **Organizations.** `organizations.json` holds rich records (id, name, short_name, pov_alignment, source_refs, status, timestamps) and `organization_edges.json` holds a 9-type validated vocabulary with `rationale`, `source_refs`, `status`, and `discovered_at`. Shared types live in `lib/organizations/types.ts`. Machine-proposes-human-disposes curation shipped for stance claims in t/1553.
- **Facts.** `source_evidence_index.json` (5.3 MB) is keyed by node id, each entry holding `{facts: [{claim, label, doc_id, specificity, temporal_bound}], keyPoints}`. Entity mentions live inside free text; nothing is structured today.
- **Reference detection precedent.** The vocabulary tool resolves colloquial terms per speaker at entry-add time and stores resolutions in entry metadata. t/1766 will detect ID-shaped references the same way.
- **DOLCE in production.** Situations are D&S descriptions with three POV interpretations; node descriptions follow genus-differentia; the project rule is ontological vocabulary in JSON, with no OWL/RDF.

## 2. Typology as DOLCE vocabulary tags

Each entity carries `entity_type` (the working label) and `dolce_category` (the upper-ontology tag that disciplines it). Proposed v1 set:

| entity_type | dolce_category | Examples | Notes |
|---|---|---|---|
| `person` | agentive-physical-object (APO) | Bengio, Altman | Already appear as untyped `key_figures[]` strings on orgs; this promotes them |
| `artifact` | non-agentive functional artifact | GPT-4, AlphaFold, all-MiniLM-L6-v2 | AI systems, models, named tools |
| `event` | perdurant | AI Safety Summit 2023, ChatGPT launch | Time-bounded occurrences; `temporal_bound` on facts is the natural anchor |
| `legislation` | normative description (D&S) | EU AI Act, EO 14110 | Sits naturally in the D&S machinery we already use for situations |
| `institution` | non-agentive social object | common law, peer review | A framework, distinct from an agentive organization that acts |

Three kinds are deliberately excluded from v1, and the boundary rules are the load-bearing part of this design:

- `organization` is already `org-*`. The mention layer links to org ids; `entities.json` never contains an organization.
- `policy` is already `pol-*`. Same rule.
- `theory/concept` is deferred. It carries the highest duplication risk in the whole design, because the BDI taxonomy is our concept model and the dictionary's standardized terms are our contested-concept senses. A concept entity class would compete with both. If it is ever admitted, an entity may be minted only when the concept is (a) not a taxonomy node, (b) not a dictionary standardized term, and (c) needed as a link target rather than as a position. Until that need is demonstrated, concept mentions resolve to taxonomy nodes via the existing attribution machinery.

There is also a mint gate against sprawl. A new `entity_type` value is an ontology change. Admitting one takes mandatory CL review, a genus-differentia definition, and at least 10 observed distinct instances in the facts corpus. This is the same discipline the AIF edge vocabulary follows.

### Vocabulary items are universals, not entities

The contested-vocabulary dictionary (`dictionary/colloquial/`, 24 do-not-use-bare terms; `dictionary/standardized/`, 45 senses with per-camp defaults) sits right next to this design and must not be absorbed by it. The dividing test is the classical one. An **entity is a particular**: this person, this statute, this event, this model. A **vocabulary item is a universal**: a sense of a contested word ("risk", "alignment", "safe harbor") that many utterances instantiate. DOLCE keeps these apart (endurants/perdurants versus concepts), and so do we:

- **Standardized senses never become entities.** `risk_existential` is a sense with camp provenance, not a thing in the world. It stays in the dictionary, with its own detail rendering (the Vocabulary panel already provides one).
- **The test resolves the look-alikes.** "Safe harbor" as a legal mechanism is a universal, so it belongs to the dictionary (`safe_harbor_regulatory`, which already exists). "The EU AI Act" is a particular statute, so it is a `legislation` entity. "Frontier" the concept is a dictionary term (`capability_frontier`); "Frontier Model Forum" is an organization (`org-*`).
- **Extraction routes, in both directions.** Resolution-before-minting (Section 4) already rejects entity proposals that match dictionary terms. The reverse flow is new: when extraction repeatedly proposes a concept-like, contested abstract noun that is *not* in the dictionary, that is a signal to CL to consider a new dictionary entry, not an entity. The pipeline files those as a per-batch report to CL rather than dropping them silently.
- **One selection model for t/1766.** The mention layer's `entity_ref` admits a `term:` ref kind (carrying the colloquial term or `canonical_form`) alongside `ent-*`/`org-*`/`pol-*`/node ids. Selecting a vocabulary mention opens the sense breakdown; selecting an entity mention opens the entity record. The renderer gets one contract, and each ref kind keeps its own detail view.
- **Detection precedence.** The live vocabulary disambiguator and the entity mention detector scan the same statement text. Where matches overlap, the longest, most specific match wins. A multi-word proper-name entity alias ("Frontier Model Forum") beats a common-noun vocabulary term contained inside it ("frontier"). The two annotation streams stay in separate metadata fields (`vocabulary_resolutions` already exists; entity mentions get their own), so neither overwrites the other.

## 3. Storage mirrors the org pattern

- `taxonomy/Origin/entities.json` follows the org file shape (`_schema_version`, `_doc`, `entity_count`, `last_modified`, `entities[]`). An entity record carries `id` (`ent-NNN`), `name`, `aliases[]`, `entity_type`, `dolce_category`, `description` (genus-differentia, in the form *"A [type] that [differentia]..."*), `external_refs[]` (Wikipedia/Wikidata links that feed the t/1766 detail pane), `source_refs[]`, `status` (`proposed | approved | deprecated`), `merged_into?` for dedup, `discovered_by?` (UsageID and model), `confidence?`, and timestamps.
- `taxonomy/Origin/entity_edges.json` takes the same shape as `organization_edges.json`, including drop-on-unknown validation.
- Vectors. Each approved entity gets one embedding (name plus genus-differentia line, all-MiniLM-L6-v2) stored alongside the node vectors in `embeddings.json` under a distinct key space. Vectors serve linking and dedup, not debate relevance.
- Types. `lib/entities/types.ts` (Shared Lib) becomes the single source of truth for server and renderer, as a sibling of `lib/organizations/types.ts`. The org HLD documents what happens otherwise, when the hand-copied `Organization` type diverged and had to be reconciled.
- `organizations.json` stays a sibling and is not absorbed. There is no migration of a working feature. The unifying layer is the mention/link contract, not the storage.

## 4. Generation: facts first, confidence-gated, human-disposes

1. **Extraction.** A batch LLM pass runs over the fact claims in `source_evidence_index.json` (a bounded corpus), via a config-driven UsageID (ADR-006). For each fact it proposes entities (name, type, alias candidates, supporting quote) with per-item confidence. Items below the gate are dropped; near-gate items are flagged. The gate is a stipulated threshold registered in the provenance register at PR time.
2. **Resolution before minting.** Each proposal is matched against existing entities and against the excluded classes (org names and short_names, pol titles, taxonomy labels, dictionary terms), first by exact/alias match, then by embedding cosine. Matches become links. Only unmatched proposals become `status: proposed` entities.
3. **Curation.** The owner reviews proposed entities in the same machine-proposes-human-disposes flow as org stance claims (t/1553), with rejections kept as telemetry. Only `approved` entities are linkable in the UI.
4. **Later passes.** POV summaries, debate transcripts, and chat go through the same pipeline once the facts pass proves its yield.

## 5. Mention-to-entity linking (the t/1766 contract)

Two tiers, both mirroring machinery that already works:

- **Curated index (batch).** `entity_mentions.json` maps a container id (fact, node, or debate) to its mentions, each `{entity_ref, quote, offset?}`. The `entity_ref` may be any of `ent-*`, `org-*`, `pol-*`, a taxonomy node id, or a `term:` ref into the vocabulary dictionary (Section 2). The mention layer is the unifier across all five stores.
- **Live detection (debate/chat).** An alias-table match runs at entry-add time and stores resolutions in entry metadata, which is the vocabulary tool's `disambiguateTerms` pattern in the same place in the store with the same render hook. When an alias collides across entities, embedding similarity breaks the tie; a mention that is still ambiguous is left unlinked rather than guessed. That refusal discipline comes from the vocabulary tool's `translation_ambiguous_when`.

The renderer contract for t/1766 reduces to a detected `entity_ref` plus a `getEntity(ref)` bridge/REST lookup that returns the record for the right-hand pane, regardless of which store holds it. A `term:` ref returns the dictionary sense breakdown instead of an entity record; the pane picks its detail view by ref kind.

## 6. Edges generalize the org vocabulary, minimally

`EntityEdgeType` keeps the 9 `OrganizationEdgeType` values with unchanged semantics and adds the smallest set the new types need:

- `AFFILIATED_WITH` (person to org), `DEVELOPED` (org or person to artifact), `PARTICIPATED_IN` (agent to event), `ENACTED` (org to legislation), `SUPERSEDES` (legislation to legislation).
- Entity-to-node: `MENTIONED_IN` (machine-generated, from the mention index) and `RELEVANT_TO` (curated).

Each edge type carries genus-differentia in the validator doc, and new edge types face the same mint gate as entity types. Org edges stay in `organization_edges.json`; `entity_edges.json` covers edges with at least one `ent-*` endpoint. The shipped feature is not rewritten.

## 7. Maintenance

- **Dedup/merge.** `merged_into` plus alias absorption, with an embedding-cosine near-duplicate report per import batch (the synthetic-corpus pruning pattern).
- **Drift.** When a doc's facts are re-extracted, its mention entries are regenerated. Entities orphaned by drift (zero mentions) surface in a maintenance report; they are not auto-deleted.
- **Provenance.** The extraction confidence gate and the linking cosine threshold are stipulated at introduction and registered in `metric-provenance-register.md` in the implementing PR. They move to derived once curation accept-rates per confidence band exist, the same path the org-stance threshold took.
- **Review gating.** `entities.json`, `entity_edges.json`, and the extraction prompt are DOLCE-typed and prompt-bearing, so they enter `docs/owned-files.md` (CL mandatory review) in the same PR that creates them.

## 8. Phasing and go/no-go

- **Phase 0 (spike validation, cheap).** Run the extraction prompt over the facts of roughly 20 nodes; hand-score yield and precision; confirm the excluded-class resolution catches org/pol/taxonomy collisions. This is the go/no-go before any schema ships.
- **Phase 1.** Schema, shared types, the facts-pass extraction, and curation cmdlets (`Get-Entity`/`Import-Entity`, mirroring the org cmdlets).
- **Phase 2.** Mention index, alias table, and the `getEntity` lookup. This unblocks t/1766.
- **Phase 3.** Entity edges, the POV/debate/chat passes, and maintenance reports.

TL should sanity-check blast radius per layer, which mirrors the org HLD's layer table nearly one-to-one. Requirements should confirm the value ordering (facts first, concepts deferred) matches the owner's intent for t/1766.

## 9. Open questions for the owner

1. **Concepts in or out of v1?** I recommend out, per the Section 2 boundary rule. Revisit when a concrete detail-pane need appears that taxonomy attribution cannot serve.
2. **Curation budget.** The facts pass will propose entities in the low hundreds, against 25 orgs from a much smaller corpus. Is owner review at that scale acceptable, or should Phase 1 cap proposals per batch the way the org-stance pattern did (20 per batch)?
3. **Person sensitivity.** Person entities name real living people. Descriptions must stay strictly biographical and positional, with no inferred views. Is that guard sufficient, or should person entities be curated-only, with no LLM-drafted descriptions?
