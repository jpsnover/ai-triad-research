# Theory of Success: Situations

**Author:** Computational Linguist (AI Triad Research). **Ticket:** t/3041. **Date:** 2026-08-26.

## What a Situation is

A Situation is a DOLCE-typed concept node (`sit-NNN`) representing a concrete real-world scenario or state of affairs relevant to AI policy: "A Government 'Manhattan Project' for AI," "Internal Deployment Scope Expansion," "Democratic Failure to Curb Digital Corporate Power." It occupies the middle layer between the abstract four-camp taxonomy and a live debate. A camp holds beliefs in the abstract; a Situation is the specific circumstance those beliefs get tested against.

Schema (in `ai-triad-data/taxonomy/Origin/situations.json`):
- `label`, `description` with genus-differentia `Encompasses:` / `Excludes:` boundaries.
- `interpretations`: per-POV (accelerationist / safetyist / skeptic), each a decomposed `{belief, desire, intention, summary}` that states how that camp reads the situation.
- `linked_nodes`: the per-POV taxonomy nodes that serve as supporting evidence.
- `situation_refs`: reverse links to debates that substantively engaged the situation.
- `conflict_ids`, `source_refs`, `parent_id` / `parent_relationship` (an `is_a` hierarchy), plus a per-situation embedding (`sit-` prefix, all-MiniLM-L6-v2).

## The theory of success

A Situation exists to turn an abstract, camp-level disagreement into a concrete scenario the debate engine can reason about. Argument over "should we regulate internal AI deployments" is sharper when anchored to a specific situation than argued in the abstract, because a situation forces each camp to take a concrete stance and supplies real-world texture the debate can grip.

**A Situation succeeds when, injected into a debate, it measurably shapes the substance of the argument rather than decorating it; each camp's interpretation is genuine and distinct; and it carries real per-POV supporting evidence tying it to the taxonomy.** The corpus succeeds when it is curated, ontologically grounded, non-degenerate, non-redundant, and broad enough to cover the policy space.

Success criteria, each measurable:
1. **Substance-shaping.** `situation_crux_alignment` is high: injected situations shift what the debate actually argues about, verified by sampling transcripts (do injected situations shape substance or just decorate?).
2. **Interpretive integrity.** Every non-deprecated situation carries non-degenerate per-POV belief, desire, and intention, enforced by the BDI-decomposition compliance gate.
3. **Grounded evidence.** Each situation links to genuine per-POV supporting nodes rather than an empty evidence panel.
4. **Provenance clarity.** Machine-generated content is marked and not read back as authoritative fact.
5. **Coverage without redundancy.** The corpus spans the policy space without near-duplicate situations.

Failure modes, each an active concern:
- **Decoration, not shaping** (low crux alignment): the central situation-injection quality risk.
- **Degenerate interpretations** (literal `"null"` or empty belief/desire/intention): found and fixed under t/3018, with the compliance check hardened to reject null-sentinels.
- **Empty supporting evidence**: 97% of situations showed no per-POV evidence, which motivated the WS-B evidence-link work (t/2990).
- **Pipeline-emitted, un-decomposed**: the generation pipeline emits flat-string interpretations that red the compliance baseline until backfilled (recurring; tracked as t/3011).
- **Lost-in-the-Middle**: a genuinely relevant situation buried by injection order.
- **Provenance laundering**: machine-proposed evidence read back into a prompt as established fact (the risk named in the tool-result-authority review, arXiv 2608.14992).

## How Situations are generated

- **Sources.** Automated pipeline sync ("sync pipeline outputs" commits, e.g. sit-476/477), earlier workflow-app batches (sit-448–470), and hand-authored curation.
- **BDI decomposition.** New situations often arrive with flat-string or empty per-POV interpretations. The `enrichment.situation-bdi-decomposition` step (CL authors or signs off) turns each POV into a distinct `{belief, desire, intention}`, where belief is what the camp holds true, desire is the state it wants, and intention is how it will act or argue.
- **Compliance gate.** `Test-SituationBdiDecomposition` requires each non-deprecated situation to carry non-empty per-POV belief, desire, and intention, hardened under t/3018 to reject null-sentinels (`null` / `none` / `n/a` / `tbd` / `-`). A `[DEPRECATED]` description prefix exempts a situation from the count.
- **Embedding.** Each situation is embedded (all-MiniLM-L6-v2, description-based) for retrieval and injection scoring.

## How Situations are used

- **Debate injection.** `situationScoring.ts` ranks situations before a debate (a wisdom-potential score over relevance, diversity, freshness, BDI entropy, and conflict openness) and re-scores them mid-debate for context injection as cruxes emerge, weighting relevance more heavily mid-debate. A cap (`situation_max_nodes`) bounds how many are injected, and injection order is managed against Lost-in-the-Middle.
- **Framing.** Each camp's interpretation (belief, desire, intention) frames how that camp argues the situation, so the injected context is not neutral background but a per-camp reading.
- **Supporting-evidence surface.** The per-POV `linked_nodes` render in the Situations detail view as each camp's supporting evidence. WS-B (t/2990) auto-proposes embedding-ranked situation-to-node links, provenance-stamped, at precision@3 ≈ 0.63, with a read-time score filter as the quality lever.
- **Post-debate feedback.** `situationRefs.ts` (t/193) extracts which situations a completed debate substantively engaged and writes them back as `situation_refs`, closing the loop between debate and taxonomy.
- **Conflict analysis.** `conflict_ids` tie situations into the QBAF conflict graph.

## Success metrics and current gaps

- **Primary effectiveness metric:** `situation_crux_alignment` (do injected situations shape debate substance).
- **Interpretive integrity:** the BDI-decomposition compliance baseline (currently 442/442 non-deprecated, hardened against null-sentinels).
- **Open gaps:** empty supporting evidence pending the WS-B batch apply (not yet live on data); the recurring pipeline-un-decomposed emit (t/3011); and the standing provenance-laundering caution for any machine content fed back into generation.
