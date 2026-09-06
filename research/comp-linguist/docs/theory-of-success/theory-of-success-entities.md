# Theory of Success: Entities

**Author:** Computational Linguist (AI Triad Research). **Ticket:** t/3043. **Date:** 2026-08-26.

## What an Entity is

An Entity is a named real-world referent that the literature actually talks about: a person, an institution, an event, a piece of legislation, or an artifact. "AI Action Plan" (legislation, also known as "Trump AI Action Plan"), "AI Impact Summit" (event), "Apollo Project" (event, also "Apollo Program"). Where Situations are scenarios and Cruxes are disagreements, Entities are the concrete actors, laws, events, and objects those scenarios and disagreements are about.

Structure (as seen in the Entities view):
- **Type:** person, artifact, event, legislation, or institution. Current counts are roughly person 9, artifact 43, event 12, legislation 5, institution 9, for 78 total.
- **Canonical name** plus **aliases** (the "also:" variants), so "Trump AI Action Plan" resolves to the one canonical "AI Action Plan."
- **Status lifecycle:** proposed, approved, deprecated. At present all 78 are proposed and none are approved, which is the single most important fact about the current state.

## The theory of success

Entities ground abstract claims in reality. A debate about "a government Manhattan Project for AI" is anchored when it can point to the actual AI Action Plan, the actual AI Impact Summit, the actual institutions involved. Entities are what let the system connect a claim or situation to the real actors and instruments being discussed, resolve the same referent across many documents, and build an intellectual lineage.

**An Entity succeeds when it unambiguously identifies one real referent, with the correct type, a canonical name, and aliases that fold in the variant spellings; when it is deduplicated against the rest of the set; and when it has passed curation from proposed to approved so only vetted entities are treated as canonical.** The corpus succeeds when it covers the referents the literature discusses, resolves coreference across documents, and does not proliferate near-duplicates or unvetted noise.

Success criteria, each checkable:
1. **Correct typing.** The person / artifact / event / legislation / institution tag matches the referent.
2. **Canonicalization and alias resolution.** One entity per real referent, with variant names captured as aliases rather than spawning duplicate entities.
3. **Curation lifecycle.** Proposed entities are reviewed and promoted to approved; the approved gate keeps unvetted extractions out of the canonical set.
4. **Grounding and linkage.** Entities connect claims, situations, debates, and source documents, and feed the Intellectual Lineage.
5. **Coverage.** The entities the corpus actually discusses are represented.

Failure modes, each an active concern:
- **Duplicate or unresolved aliases**: the same referent living as two entities because a variant name was not folded in.
- **Mistyping**: an event tagged as an artifact, which breaks type-filtered retrieval.
- **The approval gap**: 78 proposed and 0 approved means the entire set is currently unvetted. Nothing has passed the curation gate, so downstream consumers cannot yet trust "approved" as a signal. Clearing this backlog is the first success milestone.
- **Extraction noise**: spurious entities pulled from documents by the extractor.
- **Cross-document coreference failure**: the same person or law not recognized as the same entity across sources.

## How Entities are generated

- **Extraction from documents.** Entities are pulled from the source corpus by the entity-extraction pipeline (the first live batch landed under t/1826), which identifies candidate persons, institutions, events, legislation, and artifacts, along with their alias variants.
- **Schema.** The entity types and fields follow the entity-ontology proposal (`research/comp-linguist/designs/entity-ontology-proposal.md`).
- **Proposed on extraction.** New entities enter as proposed; human curation promotes them to approved or marks them deprecated. This is the same propose-then-confirm discipline used elsewhere in the project, and it is the reason "0 approved" is a backlog signal rather than a bug.

## How Entities are used

- **Grounding.** Entities anchor claims, situations, and debates to concrete real-world referents, so an argument is about the actual law or actor rather than an abstraction.
- **Claim grounding + logical forms (t/3124 / t/3126, landed 2026-09).** Claims now carry explicit `entity_refs[]` resolved against this register, closing the earlier gap where claims referenced entities only as free text. Each resolved reference also feeds the claim's `logical_form` layer: the entity's `dolce_category` becomes the participant's `sort` in the neo-Davidsonian frame, so grounding a claim in the register delivers its DOLCE typing for free. The faithfulness of that formalization is now a derived metric, `formalization_accuracy` (0.802, n=31) — see `claims-entity-fol-recommendations.md`. One consequence surfaced by that work (t/3238): the resolver emits `match_level: "exact"` for every reference (540/540), so the register's subclass/superclass/instance_of vocabulary is aspirational until a hierarchical resolver exists.
- **Cross-document linkage.** The same entity recognized across multiple sources ties otherwise separate documents together.
- **Intellectual Lineage.** Entities feed the lineage view that traces which actors, works, and events shaped a position.
- **Search and filter.** The Entities view supports search by name, alias, and type, and filtering by the proposed / approved / deprecated status.

## Success metrics and current gaps

- **Curation coverage:** the fraction of entities promoted from proposed to approved, currently 0 of 78. This is the headline gap.
- **Alias / dedup quality:** the rate of unresolved duplicate referents (candidate for a dedup audit, analogous to the situation and crux dedup concerns).
- **Typing accuracy and extraction precision:** currently stipulated by the extractor, not validated against an adjudicated set.
