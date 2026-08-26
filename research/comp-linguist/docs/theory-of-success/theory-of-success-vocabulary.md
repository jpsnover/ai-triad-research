# Theory of Success: Vocabulary

**Author:** Computational Linguist (AI Triad Research). **Ticket:** t/3044. **Date:** 2026-08-26.

## What the Vocabulary is

The Vocabulary is the controlled dictionary of canonical concept terms that keeps the whole system speaking one language. Each entry is a canonical `snake_case` key with a human-readable gloss and a camp association: `accountability_algorithmic` ("accountability (algorithmic)"), `accountability_institutional`, `accountability_market`, `autonomy_human` / `autonomy_individual` / `autonomy_machine`, `bias_systemic` / `bias_technical`, `capabilities_scaling`, `capability_frontier`. It is the concrete expression of the project's guiding principle: meaning is carried by a controlled term list in prompts and JSON, not by OWL/RDF triples. Vocabulary over formalism.

The Vocabulary view has three parts:
- **Dictionary** (about 45 terms): the canonical terms.
- **Colloquial** (about 24): informal phrasings mapped to their canonical term.
- **Lint**: a check that flags content using off-vocabulary language.

## The theory of success

Without a controlled vocabulary, "accountability" means whatever each node, claim, and debate turn happens to call it, and the system loses the ability to retrieve, aggregate, or cross-reference reliably. The Vocabulary fixes the referent: it pins which accountability (algorithmic versus institutional versus market), so that everything downstream can group and compare on a stable key.

**The Vocabulary succeeds when every concept the system reasons about has exactly one canonical term, informal variants resolve to it, and content across the corpus uses the canonical terms consistently, with the granularity to distinguish genuine senses without proliferating redundant near-synonyms.** It is the load-bearing normalization layer under Situations, Cruxes, Entities, and the taxonomy nodes.

Success criteria, each checkable:
1. **Canonicalization.** One term per concept-sense, with genuine senses disambiguated by the qualifier pattern (`accountability_algorithmic` versus `_institutional` versus `_market`).
2. **Colloquial coverage.** Informal phrasings in real content resolve to a canonical term rather than drifting off-vocabulary.
3. **Lint compliance.** Content uses canonical vocabulary, and the Lint check surfaces violations for cleanup.
4. **Camp awareness.** Terms carry camp association where a concept is camp-inflected, while the dictionary itself stays shared across camps.
5. **Right granularity.** The dictionary distinguishes real senses without minting redundant duplicates.

Failure modes:
- **Drift**: one concept referred to by several un-normalized strings, which quietly defeats retrieval and aggregation.
- **Wrong granularity**: too many near-synonyms, or a single term conflating two distinct senses.
- **Colloquial gaps**: informal text that never maps to a canonical term.
- **Lint debt**: off-vocabulary content that accumulates un-flagged.
- **Formalism creep**: expanding the vocabulary into a heavyweight ontology, against the vocabulary-over-formalism guard.

## How the Vocabulary is generated

- **Curated dictionary.** Canonical terms (key, gloss, camp) are curated and grown as new concepts appear in the taxonomy and debates.
- **Colloquial mapping.** Informal phrasings observed in content are collected and mapped to their canonical term, so the system can normalize natural language onto the controlled set.
- **Lint.** An automated check compares content against the dictionary and flags off-vocabulary usage, turning vocabulary compliance into a reviewable signal rather than an aspiration.

## How the Vocabulary is used

- **Normalization.** Nodes, claims, situations, and cruxes reference canonical terms, so the same concept reads the same way everywhere.
- **Retrieval and aggregation.** Shared canonical keys let the system group and compare content that would otherwise be split across synonyms.
- **Prompts and JSON.** The controlled vocabulary is used directly in prompt templates and data files, which is how the project encodes ontological meaning without formal logic.
- **Lint enforcement.** The Lint pass keeps new content aligned to the vocabulary.
- **Camp filtering.** Terms can be filtered by camp for camp-specific analysis.

## Success metrics and current gaps

- **Coverage:** the fraction of corpus concepts that have a canonical term, and of informal phrasings that resolve via the Colloquial map.
- **Compliance:** the Lint violation rate across content, trending down.
- **Open items:** granularity decisions (sense splits versus merges) are curator judgment and are not yet validated against a labeled disambiguation set; the guard against formalism creep is a standing editorial discipline rather than a metric.
