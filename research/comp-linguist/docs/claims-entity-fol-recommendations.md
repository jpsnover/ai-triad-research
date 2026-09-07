# Claims → BDI Pipeline: Entity Grounding and First-Order Logic Evaluation

**Author:** Computational Linguist
**Date:** 2026-08-31
**Status:** Implemented. Phase 1 landed on `main`; the formalization calibration gate is met (see Implementation status below).
**Scope:** Analysis of five pipeline concerns raised 2026-08-31, with recommendations grounded in a full survey of both repos as of this date.

## Implementation status (updated 2026-09-03)

The five concerns and the R1–R7 recommendations below were adopted; Phase 1 is on `main`:

- **R2 / R3 / R4, entity grounding on claims (t/3124, landed).** Claims now carry `entity_refs[]` (`ref`, `surface`, `method`, `link_confidence`, `match_level`, `status`). The resolution ladder and registered thresholds are recorded in the metric-provenance register.
- **R1 / R5 Phase 1, the `logical_form` layer (t/3126, landed).** A neo-Davidsonian event-frame schema on claims (`docs/logical-form-schema.md`), an LLM formalization prompt (`scripts/AITriad/Prompts/logical-form-formalization.prompt`), and a golden set plus per-component scorer (`analyses/logical-form-golden/`). BDI attitudes reify first-order via `holds/3` (no belief-closure); `about[]` carries topical grounding, and `args[].sort` is pinned to the register's 5-value `DolceCategory` set (each participant inherits its entity's `dolce_category`, R1's "DOLCE typing for free").
- **The formalization pass (t/3215, landed).** PowerShell `Invoke-LogicalFormPass` runs the schema + prompt over claims after entity resolution.
- **Prompt hardening (t/3227) and scorer diagnostics (t/3228).** The meta-descriptive rule now also strips the attitude-attribution clause (the predicate is the content proposition, not the stance verb); the scorer adds diagnostic `predicate_syn` and `args_participant` components.
- **Calibration gate met (t/3229), then re-baselined on the current prompt (t/3239).** `formalization_accuracy` is a **derived** metric. The paper-canonical figure is the **v2 census on the current production prompt** `a9c93103` (stance-strip strengthened): **strict 0.778 / lenient 0.978 (n=45)**, a stratified holistic claim-level verdict (`research/comp-linguist/analyses/lf-golden-v2/`). The earlier n=31 = 0.802 (per-component mean, superseded prompt `1103ed06`) is retained in the provenance register as the prior-prompt/prior-definition measurement. Recorded honest caveats: single-annotator reference, and `match_level` is `exact`-only in practice because the resolver hardcodes it (t/3238), so non-exact coverage is constructed-only until a hierarchical resolver exists.
- **vocabulary-over-formalism honored.** All formal machinery stays in derived, regenerable sidecars; the source JSON stays prose plus typed references.

The recommendation sections below are retained as the design of record. FOL export (TPTP, t/3127) and edge verification (t/3128) remain the downstream Phase-2/3 sidecar work.

---

## 1. Executive summary

All five concerns are valid. The good news is that four of them are gaps in wiring, not missing infrastructure. The project already has a DOLCE-typed entity register (`entities.json`, 78 `ent-*` records), a mention index with character offsets, a resolution ladder (exact match, then alias, then embedding cosine), a policy-registry precedent for canonical-ID references, and an established confidence vocabulary. What is missing is the connection between these pieces and the claims themselves. Claims carry no entity references at all, the entity mention index covers only taxonomy-node text, and `entity_embeddings.json` is empty.

The fifth concern asks whether first-order logic evaluation makes sense. It does, in a bounded form. FOL is the right tool for consistency and well-formedness checking over the knowledge structure (sorts, temporal claims, subsumption). It is the wrong semantics for evaluating debate arguments, which are defeasible and enthymematic. The project's existing argumentation machinery (QBAF, Dung AAA, AIF attack types, NLI polarity) is the correct formalism for arguments and should remain primary. The recommendation is a structured proposition layer on claims as the single enabling investment, with FOL export as a downstream evaluation sidecar rather than a rewrite of the source-of-truth JSON.

One design constraint governs everything below. The project's standing principle is **vocabulary over formalism** (no OWL/RDF in the data files). The recommendations honor it by keeping all formal machinery in derived, regenerable sidecar artifacts, the same category `embeddings.json` and `entity_mentions.json` occupy today. The source files stay human-readable prose plus typed references.

| # | Concern | Verdict | Recommendation |
|---|---------|---------|----------------|
| 1 | BDI statements don't identify DOLCE Particulars/Endurants/Perdurants/Qualities/Abstracts | Valid; by design today | R1: typed claim frames + entity-register grounding, not per-node retyping |
| 2 | Entities are text, unmapped to the register | Valid; register exists but unwired | R2: extend mention index to claims; add `entity_refs` to claim schema; populate entity vectors |
| 3 | Entity mapping needs confidence | Valid | R3: per-link confidence + method provenance, registered thresholds |
| 4 | Claims reference sub/superclasses of registered entities | Valid; register is flat | R4: `instance_of` / `subclass_of` relations + `match_level` on links |
| 5 | Enable FOL evaluation of arguments | Makes sense, bounded | R5: three-phase plan; FOL for structure-checking, argumentation semantics for arguments |

## 2. Current state (survey findings, condensed)

What exists:

- **Claims** (`ai-triad-data/summaries/<doc-id>.json`). Two kinds: `key_points` (POV-lensed, mapped to a `taxonomy_node_id`) and `factual_claims` (POV-independent, `linked_taxonomy_nodes[]`). Rich confidence fields already present: `extraction_confidence`, `fire_confidence`, `retrieval_confidence`, `taxonomy_node_candidates[].score`, `mechanism5_flag`.
- **BDI nodes** (`taxonomy/Origin/*.json`). Free text (genus-differentia `description`) plus flat tags (`category`, `assumes[]`, `graph_attributes`). No DOLCE typing, no entity references, no predicate/argument structure.
- **Entity register** (`taxonomy/Origin/entities.json` + `lib/entities/types.ts`). `Entity{id, name, aliases, entity_type, dolce_category, status, confidence, …}` with a frozen `entity_type → dolce_category` map covering 5 DOLCE leaf categories. `EntityRef` is a discriminated union over `node|situation|policy|entity|organization|term` with a strict parser.
- **Mention index** (`entity_mentions.json`). Per-container mentions with `quote`, `offset`, `discovered_by`. But containers are `node:*` only; claims are not indexed.
- **Resolution ladder** (`Invoke-EntityExtraction.ps1`). Exact/alias match, then cosine ≥ 0.60 against entity vectors, then dedup, then advisory near-variant surfacing. Gate at `ConfidenceThreshold 0.6`.
- **Policy-registry precedent** (`policy_actions.json`). Canonical text once under a `pol-*` ID, with POV-specific framing at each reference site. This is the pattern to replicate for entities-in-claims.

What does not exist: entity references on claims or on nodes; entity vectors (`entity_embeddings.json` is empty); DOLCE typing on claims or nodes; any predicate-argument or logical-form representation; any FOL/TPTP/prover/OWL tooling in either repo; character-offset provenance on claims (only a `verbatim` string).

## 3. Concern 1: BDI statements don't explicitly identify DOLCE categories

**Analysis.** Correct, and today it is deliberate. DOLCE lives in prompts and documentation as vocabulary, and the only enforcement is genus-differentia string-shape linting (`dolceCompliance.ts`, `Test-OntologyCompliance.ps1`). The one place DOLCE is a real typed field is the entity register's `dolce_category`. The pipeline's ontological commitments are therefore carried by prose conventions, and a machine cannot check prose conventions beyond regexes.

The right response is not to hand-annotate 4,144 nodes with sort labels, and not to move the corpus to OWL. It is to observe that a BDI statement has a stable logical shape we can exploit:

> A BDI statement is an **attitude report**: *the {POV} camp holds attitude {Belief|Desire|Intention} toward proposition P*, where P mentions entities, qualities, and events.

The camp is an agentive social object. The attitude type is already captured by `category`. All the DOLCE work lives inside P, and the entities inside P are what the entity register types. **Grounding claims and node descriptions in the register (R2) therefore delivers most of the DOLCE typing for free**, because each resolved mention inherits its entity's `dolce_category` (perdurant, agentive-physical-object, normative-description, …).

**R1: typed claim frames, derived not authored.**

1. Add an optional, machine-generated `frame` block to key_points (sidecar or in-file, see R5 Phase 1) capturing the attitude holder (POV camp), the attitude type (from `category`), and the proposition's participants as entity-register references with inherited DOLCE sorts.
2. Where a proposition's participant is not a register entity (a kind term like "frontier models", say), route it through the existing dictionary (`term:*`) rather than inventing a parallel vocabulary.
3. Extend `dolce_category` coverage only if extraction shows systematic gaps. Today's 5 leaf categories cover objects, events, and norms but have no quality/abstract slot, and claims about attributes ("capability", "risk") will likely need one. Any addition goes through `lib/entities/types.ts` and the frozen map together.
4. Frames carry `status: proposed|approved` and confidence, mirroring the taxonomy-proposal approval flow. They are never auto-applied to source files.

Explicitly rejected: re-authoring node `description` fields into formal syntax. The genus-differentia prose is the human-facing and embedding-facing surface; formalization is a derived layer.

## 4. Concern 2: entities are text and don't map to the register

**Analysis.** Confirmed, and this is the highest-payoff gap. The register, the mention-index machinery, and the resolution ladder all exist; they have simply never been pointed at claims. In addition, `entity_embeddings.json` has the right header (`all-MiniLM-L6-v2`, 384-dim) and an empty `vectors:{}`, so the embedding rung of the resolution ladder is currently a no-op even for its existing node-text use.

**R2: wire claims into the entity layer.**

1. **Populate entity vectors.** Extend the embedding batch job to fill `entity_embeddings.json` (name + aliases + description per entity). This is a prerequisite for every fuzzy-resolution step below, and a bug-adjacent gap worth fixing regardless of the rest of this document.
2. **Extend the mention index to claims.** Add container kinds alongside `node:*` (e.g. `summary:<doc-id>#kp-<n>` and `summary:<doc-id>#fc-<n>`), reusing the existing `{entity_ref, quote, offset, discovered_by}` mention record. `Update-EntityMentionIndex.ps1` already owns rebuild semantics, so this is an extension rather than a new subsystem.
3. **Add `entity_refs[]` to the claim schema** (key_points and factual_claims), following the policy-actions precedent. The claim keeps its prose; each ref is `{ref: "ent-NNN", surface: "GDPR", …}`, with the full link-record shape defined in R3/R4. The refs are written by a post-extraction resolution pass in the same architectural slot as `Invoke-RetrievalConfidencePass.ps1`. Do not ask the extraction LLM to emit register IDs it cannot reliably know.
4. **Unresolved mentions propose entities.** A claim mention that fails resolution becomes a `status: proposed` entity candidate through the existing `Invoke-EntityExtraction.ps1` gate, the same discipline as unmapped-concept handling. The claim pipeline must never silently mint approved entities.

## 5. Concern 3: the mapping needs a confidence level

**Analysis.** Yes, and the project already has the vocabulary discipline for this. The FIRE header comment makes the load-bearing distinction (extraction reliability is not argument quality), and the same separation is needed here. Link confidence ("is this surface string really `ent-071`?") is a different quantity from `extraction_confidence` ("is this claim faithful to the source?") and must not be pooled with it.

**R3: confidence with method provenance on every entity link.**

Each entry in `entity_refs[]` carries:

```json
{
  "ref": "ent-071",
  "surface": "GDPR",
  "offset": 579,
  "method": "alias",            // exact | alias | embedding | llm
  "link_confidence": 1.0,       // method-dependent: 1.0 for exact/alias; cosine for embedding; self-report for llm
  "match_level": "exact"        // see R4
}
```

Rules:

1. **Confidence is method-conditioned.** Exact/alias matches are deterministic (1.0). Embedding matches record the cosine. LLM adjudications, needed only for genuinely ambiguous surfaces, record model self-report and are flagged for the audit sample.
2. **Thresholds are provenance-registered.** The embedding acceptance threshold (start at the existing 0.60 from the resolution ladder) and any low-confidence band enter `metric-provenance-register.md` as **stipulated** on day one, with a ticket to derive them from a labeled sample. Every other threshold in this project has followed the same trajectory. Per the review-deliverable rule, no evidence pointer means stipulated by definition.
3. **Calibration hook.** Add an `entity_link_precision` check to the extraction-quality harness (`Test-ExtractionQuality.ps1` / `calibration/extraction-metrics.json`), with a 10–20-claim audit sample per cycle mirroring the situation-audit cadence. Without a measured precision, link confidence is decoration.

## 6. Concern 4: claims discuss sub/superclasses of registered entities

**Analysis.** Correct, and the flat register makes this invisible today. A claim about "EU AI regulation" and the register's "EU AI Act" entity will either false-match (embedding cosine is blind to the subsumption direction) or fail to match, with nothing recording why. There is also a classic DOLCE distinction hiding here that the design must not blur. Instance-of ("GPT-4" is an instance of the kind "large language model") is not subclass-of ("frontier model" is a subkind of "large language model"). Conflating them is the modeling error DOLCE exists to prevent.

**R4: a shallow subsumption layer on the register, and match-level on links.**

1. **Entity relations.** Add optional `relations[]` to entity records: `{type: "instance_of" | "subclass_of" | "part_of", target: "ent-NNN" | "term:<slug>"}`. Kinds and classes live primarily in the dictionary (`term:*`); named particulars live in the register; the `instance_of` bridge crosses between them. This yields a shallow DAG, not an ontology, and the node schema's `parent_id` is in-project precedent for a lightweight hierarchy of this kind.
2. **Match-level on links.** Each `entity_refs[]` entry records `match_level: exact | instance_of | subclass | superclass | related`, with at most 1–2 hops traversed during resolution. A claim about a superclass matched to a specific instance is a different assertion than an exact match, and downstream consumers (conflict detection, FOL export) must be able to tell.
3. **Depth guard.** Cap hierarchy depth (suggest ≤ 3) and audit it in the situation/entity audit cycle. The failure mode to prevent is the register quietly growing into a full ontology. That is the "vocabulary over formalism" scope creep this role is chartered to block, from the inside this time.

## 7. Concern 5: first-order logic evaluation of arguments

### 7.1 Does it make sense?

Yes, with a scoping distinction that determines the whole design. Two different ambitions hide in "FOL evaluation of arguments."

**(a) Checking the knowledge structure.** Sort discipline (no endurant participating in another endurant as if it were an event), temporal consistency of factual claims (`temporal_bound` versus claimed event ordering), subsumption sanity (no cycles, no entity that is both instance and superclass of the same thing), and entailment spot-checks ("does claim A, as formalized, actually contradict claim B, as the `attacks` relation asserts?"). FOL fits this superbly. The queries are small, the axiom sets bounded, and semi-decidability is managed with prover timeouts. A timeout is itself a reportable result ("not provable within budget"), not a failure.

**(b) Evaluating debate arguments.** Here classical FOL is the wrong semantics, for three reasons grounded in what this corpus actually is:

1. **The arguments are defeasible.** An AIF `undercut` does not assert `P ∧ ¬P`; it attacks an inference link. Classical entailment has no notion of an attacked-but-not-refuted inference. Dung semantics and QBAF gradual semantics were invented for that gap, and the project already runs both.
2. **The statements are attitude reports.** "The accelerationist camp believes P" and "the safetyist camp believes ¬P" are jointly consistent in FOL. They have to be, or the entire taxonomy is one big contradiction. The interesting logic is inside and across the belief contexts, which pure `FOL⁼` does not natively give you (§7.3 covers the standard first-order workaround).
3. **Real arguments are enthymematic.** Formalizing a debate turn into a valid deduction requires inventing the missing premises, and the invented premises, not the prover, then carry all the epistemic weight.

So the recommendation is FOL as the substrate and the auditor, with argumentation semantics as the evaluator. FOL's highest-value contribution to argument evaluation is checking the edges. It supplies an NLI-independent verification that claims labeled `attacks/rebut` are actually formally incompatible, and that claims labeled `supports` are at least consistent. That feeds better-grounded attack graphs into QBAF/Dung. It does not replace them.

### 7.2 How: three phases

**Phase 1: structured proposition layer (the prerequisite for everything).**

Add a derived `logical_form` to claims (and, lazily, to node `canonical_proposition` equivalents), produced by an LLM formalization pass with its own golden test set and calibration gate. This is prompt-production code and falls under this role's gating discipline:

```json
{
  "predicate": "acquire",
  "event_ref": "e1",
  "args": [
    {"role": "agent",  "ref": "ent-034", "sort": "agentive-social-object", "match_level": "exact"},
    {"role": "patient","ref": "ent-055", "sort": "agentive-social-object", "match_level": "exact"}
  ],
  "polarity": "positive",
  "modality": {"holder": "camp:acc", "attitude": "belief"},   // null for factual_claims
  "temporal": {"type": "at", "value": "2025-02"},
  "formalization_confidence": 0.85,
  "status": "proposed"
}
```

This is a neo-Davidsonian event frame. The event is reified as a first-class variable, participants attach via role predicates, and time attaches to the event. That choice is not stylistic. It is what makes the DOLCE mapping direct (the event variable is a perdurant; participants are endurants in the `PC(x, e, t)` participation relation) and it keeps everything first-order.

**Phase 2: TPTP export plus a small DOLCE-lite axiom module.**

Build a generator (Python, in `research/comp-linguist/tools/`, alongside the existing audit scripts) that emits a TPTP corpus from three inputs. First, a hand-written, version-controlled axiom module of perhaps 30–60 formulas: sort disjointness, temporal indexing on endurant relations, participation typing, subsumption from R4's relations, with constitution left out until a use case demands it. Second, ground facts from `entities.json` plus relations. Third, formalized claims from Phase 1. Run Vampire or E over generated conjectures (the §7.1(a) check families) with per-query timeouts; every check emits `proved | disproved | timeout`, and timeout is a first-class result. An SMT alternative (Z3) is worth benchmarking for the temporal-arithmetic checks, where it will likely dominate. TPTP remains the interchange format either way.

The axiom module is the one artifact where the background note's formal layers land in this project: multi-sorted universe as unary predicates with disjointness axioms, time-indexed endurant relations, at-temporal perdurant relations. What we do not import: full CEM with strong supplementation, quality spaces, and constitution theory. Import axioms when a check needs them, not before. Every axiom is attack surface for spurious inconsistency in LLM-formalized content.

**Phase 3 (contingent on Phase 2 signal): edge verification feeding QBAF.**

For claim pairs already related by `claim_relations` or conflict detection, generate the incompatibility conjecture and prove or refute it. Disagreements between the prover and the NLI polarity gate are the gold. Each one is either a formalization bug, an NLI failure, or a mislabeled edge, and all three are things this role wants surfaced. Results annotate edges and never auto-modify them, consistent with the Mechanism-5 surface-only precedent.

### 7.3 The BDI/modality question, answered honestly

Belief, desire, and intention are modal operators, and quantifying into modal contexts is beyond `FOL⁼`. The standard first-order move, and the one that fits DOLCE D&S like a glove, is **reification**: `holds(camp_acc, belief, p1) ∧ about(p1, ent_055) ∧ …`, treating propositions as first-class objects (DOLCE non-physical endurants / D&S descriptions). This keeps the corpus in FOL and makes cross-camp queries expressible ("which propositions does acc believe and saf reject?"). The cost is logical omniscience within belief contexts, a price worth paying since we never wanted the prover closing camps' beliefs under entailment anyway. Camps are not logically omniscient; that is half the research interest. The Phase 2 axiom module must therefore not include a belief-closure axiom, and the module header should document the exclusion.

### 7.4 Where it lives

| Artifact | Location | Owner |
|----------|----------|-------|
| `logical_form` schema + formalization prompt + golden set | `scripts/AITriad/Prompts/` + summaries schema | CL (prompt + schema review); PowerShell role implements the pass |
| Entity link records, relations, `match_level` | `lib/entities/types.ts`, `entities.json` schema | Shared Lib implements; CL reviews (DOLCE-typed data → mandatory review) |
| Mention-index extension, resolution pass, entity vectors | `scripts/AITriad/{Public,Private}/`, embedding batch job | PowerShell role; CL reviews thresholds |
| DOLCE-lite axiom module + TPTP generator + prover harness | `research/comp-linguist/tools/` | CL (research tooling; graduates to `lib/` only if it becomes a production gate) |
| Calibration additions (`entity_link_precision`, `formalization_accuracy`) | `calibration/`, provenance register | CL |

Prover binaries are a research-tool dependency only. They become neither a CI gate nor a production dependency until Phase 2 demonstrates stable signal, and any gate proposal routes to Main (TL) for both-arms Gate Verification per the standing rule.

## 8. Risks and guardrails

1. **Formalization error dominates prover soundness.** The prover is only as good as the LLM's logical forms. Mitigation: a golden test set before any downstream consumer trusts `logical_form`, `formalization_confidence` gating, and an audit sample per cycle. A wrong formalization "proved inconsistent" against a correct claim is this system's characteristic failure mode.
2. **Ontology scope creep.** R4's relations and Phase 2's axioms are both slippery slopes toward the heavyweight formalism the project explicitly rejected. Guardrails: the depth cap, the axiom-on-demand rule, formal artifacts kept derived and regenerable, and source JSON that never contains logic syntax.
3. **Confidence-field proliferation.** The pipeline now has five confidence quantities (`extraction`, `fire`, `retrieval`, `link`, `formalization`). Each must stay documented in the provenance register as measuring a distinct thing, or a future consumer will pool them. Precedent: the FIRE ≠ QBAF `base_strength` header note.
4. **Stale documentation.** `docs/document-processing-pipeline.md` §5 already misdescribes the mapping flow (it predates RAG/rerank/NLI-gate). Any implementation here must update it in the same PR, and the survey finding is worth a small fix ticket regardless.

## 9. Ticket breakdown (filed 2026-08-31, human-approved)

| # | Ticket | Title | Depends on | Size |
|---|--------|-------|-----------|------|
| T1 | t/3121 | Populate `entity_embeddings.json` (batch job extension) | T10 | S |
| T2 | t/3122 | Extend `entity_mentions.json` containers to summaries/claims | T1 | M |
| T3 | t/3124 | `entity_refs[]` on claim schema + resolution pass (link confidence, method, match_level) | T1, T2 | M |
| T4 | t/3119 | Entity `relations[]` (`instance_of`/`subclass_of`/`part_of`) + register/audit updates | — | M |
| T5 | t/3125 | Provenance-register entries + `entity_link_precision` calibration check | T3 | S |
| T6 | t/3126 | `logical_form` formalization pass: schema, prompt, golden set | T3 | L |
| T7 | t/3127 | DOLCE-lite axiom module + TPTP generator + prover harness (research tooling) | T6 | L |
| T8 | t/3128 | Edge-verification pilot: prover vs. NLI polarity gate on existing `claim_relations` | T7 | M |
| T9 | t/3120 | Fix stale `document-processing-pipeline.md` §5 | — | XS |
| T10 | t/3118 | Curation + approval pass on the 78 proposed entities (§11) | — | S |
| T11 | t/3123 | Scaled Phase 1 extraction over remaining ~380 evidence-index nodes (§11) | T10, T1 | M |

Sequencing intent: T1–T3 are the entity-grounding core and carry value independent of the FOL track. T6–T8 are the FOL track, strictly staged, with each phase's continuation contingent on the previous phase's measured signal. T4 can proceed in parallel. Suggested first PR: T1 + T9.

## 10. Addendum: should DOLCE entities be grounded tensors (label + embedding)?

Question raised 2026-08-31 after the initial draft. The answer is yes to the dual representation, with one firm rule about which half carries identity.

**R6: every register entity is a symbol-vector pair; the symbol is the identity, the vector is a grounding.**

1. **Dual representation, asymmetric roles.** Each `ent-*` record keeps its symbolic form (ID, label, aliases, `dolce_category`, relations) as the source of truth, and gains one or more vectors in `entity_embeddings.json` as its sub-symbolic grounding. The vector is regenerable and model-versioned (the file header already records `model` and `dim`); the symbol survives re-embedding. A model upgrade that re-embeds the register must not change any entity's identity, relations, or approval status. This is the same sidecar discipline `embeddings.json` already follows for nodes.
2. **The two halves do different work, and neither substitutes for the other.** The vector powers resolution and similarity (the `embedding` rung of the ladder, R3's cosine-valued `link_confidence`). The symbol powers everything logical: FOL export, subsumption, sort checking. Cosine is symmetric and subsumption is not, so no tensor can encode that "EU AI Act" `instance_of` "AI regulation" while the reverse fails; that structure lives in R4's `relations[]`. Conversely, no symbol table resolves the surface "the Brussels privacy regime" to `ent-071`; that is the vector's job. The prover never consumes tensors, and the resolver never trusts labels alone.
3. **DOLCE already has a home for the tensor, and it is not the entity.** In DOLCE terms the embedding is best read as a quale: a position in an abstract conceptual space (a 384-dimensional region, category Abstract), related to the entity the way a quality's value relates to its bearer via `ql(q, r)`. The entity is an endurant or perdurant; its embedding is a region in a quality space that the entity maps to under a particular model. This is not pedantry. It is why re-embedding is safe (the region moves, the bearer persists), why one entity can have several vectors, and why "the entity *is* its tensor" would be a category error of exactly the kind the register exists to prevent.
4. **Plan for more than one vector per entity.** Name-form matching ("GDPR" against aliases) and concept matching (a paraphrase against the description) are different retrieval problems and embed differently. Recommend a `name_vector` (label + aliases) and a `description_vector` per entity, with the resolution ladder consulting the name vector first. The node-side `exclusion_vector` is in-project precedent for deliberate multi-vector records.
5. **Use the DOLCE sort as a hard filter before cosine.** A mention whose frame slot is an event should only be resolved against perdurant entities; an institution mention should never match a perdurant however high the cosine. Sort-filtering the candidate set before similarity is the cheapest place the symbolic half improves the tensor half, and it turns `dolce_category` from documentation into a working constraint. This slots into the R2 resolution pass and costs one predicate check per candidate.

Practical effect on the ticket table: T1 absorbs the multi-vector layout (name + description vectors, model-versioned); the sort-filter lands in T3's resolution pass. No new tickets required.

## 11. Addendum: why the register holds only 78 entities

Question raised 2026-08-31. Diagnosis from the live data files and the cmdlet source, not recalled.

**Root cause: the extraction was a single capped pilot that was never scaled, and its output was never curated.** Four stacked facts, each verified:

1. **One run, one day, one slice.** `entity_extraction_log.json` records exactly 50 processed nodes, all `acc-beliefs-*`, all timestamped 2026-07-28, model `claude-sonnet-4-6`. The cmdlet's default is every node in `source_evidence_index.json` with facts and its `-MaxNodes` cap takes the first N alphabetically, which is what a `-MaxNodes 50` pilot produces (acc-beliefs sorts first). The corpus offered **430 nodes with facts (2,446 facts)**; 380 nodes were never processed. The idempotence sidecar is healthy and will skip the done 50 on a re-run, so scaling is an invocation away, not an engineering task.
2. **The gate is not the culprit.** Of 87 proposals across the 50 nodes, exactly **1** was dropped below the 0.6 confidence gate. Extraction yield was ~1.6 minted entities per node. Extrapolated over the 430-node corpus, the register should hold roughly **600–700 entities** from evidence facts alone, before any claim-side extraction.
3. **Everything is stuck at `proposed`.** All 78 records have `status: proposed` and empty descriptions (Phase 1 deliberately mints no descriptions, and `Import-Entity` blocks approving a person without a human-authored one). No curation pass ever ran. This matters beyond hygiene, because of fact 4.
4. **The approval freeze silently disabled fuzzy resolution.** `entity_embeddings.json` populates from **approved entities only** (Import-Entity §3). Zero approvals means zero vectors, which means the resolution ladder's cosine rung has been a no-op since day one. The pipeline is in a quiet deadlock: extraction waits on nothing, but its dedup quality degrades the longer approval waits, because only exact/alias matching protects against near-variant duplicates ("EU AI Act" vs "the AI Act") across runs.

Also structural, beyond the pilot-never-scaled story: the extraction corpus is per-node evidence facts, which exist for only 556 of 4,144 nodes, and the 805 document summaries with their thousands of claims are not an entity source at all today. Even a fully-scaled Phase 1 reads a narrow slice of the project's text. The long-run size driver for the register is claim-side extraction, which is R2/T2–T3 of this document.

**R7: unfreeze in order, then curate, vectorize, and scale.**

1. **Curation pass on the existing 78** (human or human-approved batch): author or LLM-draft-then-approve descriptions, approve the sound records, merge obvious variants. This is the blocking step for everything else and is a bounded effort.
2. **Populate `entity_embeddings.json` from the approved set** (T1 as already proposed, now with an explicit trigger). Consider extending vectors to `proposed` records under a status tag so within-run and cross-run near-variant surfacing both work; the R6 rule (symbol is identity, vector is grounding) makes this safe.
3. **Scale the Phase 1 run over the remaining 380 nodes**, in POV-sized batches (`-MaxNodes` per batch, idempotence log carrying progress), with the dedup-advisory (`possible_duplicates[]`) reviewed between batches. Do not run all 380 before step 1–2 land, or near-variant duplicates will accumulate with no cosine rung to catch them.
4. **Then widen the corpus to claims** per R2/T2–T3, which turns the register's growth from a per-node evidence trickle into the document pipeline's natural byproduct.
5. **Add a register-liveness check to the calibration cycle**: register size, extraction coverage (nodes processed / nodes with facts), approval ratio, and days-since-last-mint. A register that sits untouched for a month while 805 documents flow past is exactly the silent-stall class this project keeps rediscovering; make it a scanned number instead of a surprise.

Ticket impact: adds two tickets to §9. T10/t/3118 (curation + approval pass on existing 78, precedes T1) and T11/t/3123 (scaled Phase 1 run over remaining corpus, follows T1); T1's description gains the approved-set trigger; the liveness check folds into T5/t/3125.

## 12. Addendum: entities vs concepts, and the reuse-gate discipline (decision 2026-08-31)

Question raised 2026-08-31, after the human read the register's coverage of the BDI corpus: should concepts become first-class entities, so that one register maps every BDI element under a common vocabulary instead of inventing per-node terms? Decision after discussion: **no.** Concepts and entities keep distinct *types*; they gain *unified addressing*, not a unified type. This confirms the split already assumed in R1.2 and R4.1 (kinds and classes live in the dictionary `term:*`; named particulars live in the register `ent-*`) and hardens it against a merge that was actively considered and rejected.

### 12.1 Why the types stay distinct

Entities are DOLCE particulars (endurants and perdurants: this OpenAI, that Manhattan Project, this 2025 export-control event). Concepts are universals (kinds, properties, and predicates: "frontier model", "liability shield", "safety audit"). The bridge between them is `instance_of`, exactly R4's relation. Merging the two into one register type erases that boundary, and the boundary is load-bearing in three places already built or planned:

1. **FOL sort-checking (§7).** The neo-Davidsonian frame types an argument slot as an endurant, a perdurant, or a universal. A prover that cannot tell "GPT-4" (particular) from "large language model" (kind) cannot sort-check a single conjecture.
2. **Subsumption is directional; cosine is not (R6.2).** "EU AI Act" `instance_of` "AI regulation" holds one way only. That structure lives in symbolic `relations[]`, and it only makes sense if instances and kinds are distinguishable node types.
3. **Resolution has two different jobs.** Resolving a named particular ("the Brussels privacy regime" -> `ent-071`) and resolving a kind term ("frontier models" -> `term:frontier-model`) are different retrieval problems against different candidate sets. Unified addressing lets a claim reference either from the same `*_refs[]` slot; distinct types keep the two candidate pools, and their two approval disciplines, apart.

Unified addressing delivers the human's actual goal (map every BDI element with common terms, stop inventing per-node vocabulary) without the category error: a BDI statement's participants resolve to `ent-*` when they are particulars and `term:*` when they are universals, and both are first-class referents.

### 12.2 Evidence: three probes on the live BDI corpus

The decision is not taken on principle alone. Three probes over the full BDI corpus (all POV node descriptions plus all situation belief/desire/intention text, 4,882 statements) measured what actually populates these statements.

1. **Register coverage.** Of the 78 register entities, only **3** appear in the BDI corpus. The register was extracted from per-node evidence facts (§11), a different text surface. Consequence: the register is not the vehicle for grounding BDI statements. The BDI corpus is concept-dense, not entity-dense, so its grounding routes primarily to the concept dictionary (`term:*`), with named particulars the minority case. This redirects the BDI-grounding effort, and it is why curating the 78 (T10) does not by itself ground the debate corpus.
2. **Reuse distribution.** A heuristic surface extractor (multiword TitleCase, acronyms, model tokens) over the 4,882 statements found 302 candidate surfaces. **56.6% are hapax** (one statement only); **43.4% (131) recur in >=2 distinct statements**, 69 in >=3, 25 in >=5, 3 in >=10. The reused core is concept-dominated. This is the empirical basis for a reuse gate: most surfaces are singletons that should stay raw mentions, and a minority genuinely recur and earn a node.
3. **Hidden reuse under synonymy.** Because exact-surface counting over-states the hapax rate whenever one meaning wears several spellings, a synonym-collapse probe embedded all surfaces and re-counted reuse per near-synonym cluster. Result: only **11 to 14 of the 171 hapaxes (about 8%)** join a reused cluster once collapsed; the true hapax rate falls from 56.6% to roughly 48 to 52%, not further. The collapses are almost all trivial morphological variants ("Manhattan Project" / "Manhattan-Project", "Liability Shield" / "Liability Shielding", "First Amendment" / "Current First Amendment"), foldable by deterministic normalization. Genuine "different words, same meaning" is rare, and where the embedding reached for it, it also over-merged ("Safety Audits" / "Safety Checks" / "Safety Warnings" are three different things) and false-merged ("TTL" / "TTP"). Cosine proposes; it cannot dispose.

### 12.3 The reuse-gate and two-stage resolution

The register and the concept dictionary both take a **surface earns a node only at reuse >=2** gate, applied to *resolved* surfaces, not raw strings. Resolution runs in two stages, and only the first is automatic:

1. **Deterministic normalization** folds trivial variants (case, hyphenation, plural, leading article, redundant modifier). Cheap, safe, and it captures essentially all of the real hidden reuse the synonymy question was worried about (probe 3).
2. **Embedding proposes deeper synonym candidates; a human confirms.** Never an auto-merge. The same probe run that correctly folds "Manhattan-Project" also wrongly fuses "Safety Audits" with "Safety Warnings", so cosine output is a proposal queue, not a commit. This is the propose-then-confirm discipline already used at the WS-B polarity gate and the resolution ladder's advisory near-variant surfacing.

The gate runs after stage 1. A surface below threshold stays a raw mention with offsets, never a minted `ent-*` or `term:*` node, which is what keeps the space small and structured (the human's stated goal) instead of an infinite dictionary of never-reused terms. The DOLCE sort/type filter before cosine (R6.5) applies unchanged: an event-slot mention resolves only against perdurants, a kind mention only against `term:*`.

### 12.4 Ticket impact

- **T10/t/3118 (curate the 78):** premise corrected. The 78 are not a BDI-grounding set (probe 1), so curation targets the register's *own* soundness, not debate coverage: author person descriptions (the approval hard-block), merge the obvious variant (ent-076 -> ent-049), and approve sound records so the embedding rung lights up. Do not scale entity extraction expecting BDI coverage from it.
- **BDI-concept grounding routes to the dictionary.** The high-payoff BDI-grounding work is concept extraction into `term:*` under the reuse gate, parallel to (not merged with) entity resolution. This is a re-scope of the R2/T3 resolution pass to run two gated ladders sharing the stage-1 normalizer, and it warrants its own ticket rather than riding entity extraction.
- **T2/t/3122, T3/t/3124:** the mention-index extension and resolution pass gain the two-stage normalizer and the reuse gate as explicit steps; `match_level` already carries the instance/kind distinction from R4.
- No change to the FOL track (T6 to T8) or to R6's symbol-is-identity rule.

## 13. Addendum: BDI ↔ {Entity, Concept} bidirectional grounding (2026-08-31)

Owner observation: there is no mapping between BDI statements and entities, and concepts should be first-class alongside entities, with a bidirectional BDI ↔ {entity, concept} mapping. Confirmed, scoped, and measured.

### 13.1 Current state (measured, not recalled)

Resolved all 904 acc/saf/skp BDI node descriptions against the 72 approved entities and the 54 concept terms (surface + embedding), no writes (`scratchpad/resolve_bdi_grounding.py`):

- **Entities are an island.** 0 of 904 nodes carry an entity ref. Resolution yield is 61/904 (6.7%) union, but only **3 by precise surface/alias match**; the other 58 are cosine >= 0.60 embedding matches dominated by semantic-proximity noise (for example "Marc Andreessen" cosine-matches 45 accelerationist nodes it does not mention). Real entity grounding is a precise handful, and entities add only 2 nodes beyond concepts.
- **Concepts are the dense workhorse.** 779/904 (86%) ground to at least one concept: 80% by characteristic-phrase surface match, 35% already latent in the terms' `used_by_nodes`. But the FORWARD field (node to concept ref) does not exist; only the reverse (`term.used_by_nodes`) is partly populated.
- **Overall:** 86.4% of nodes ground to a concept or entity; 13.6% (123) have none.

This is the particulars-vs-universals prediction of §12 confirmed empirically: BDI argues in kinds, names few particulars.

### 13.2 The model

Each BDI node gains two forward ref slots (unified addressing, distinct types per §12): `concept_refs[]` (`term:*`, dense) and `entity_refs[]` (`ent:*`, sparse and precise). Reverse maps stay consistent: `term.used_by_nodes[]` (exists) and entity `node:*` mentions in `entity_mentions.json`.

### 13.3 The passes (§12 resolution discipline carries over)

- **Concept forward-linking (high yield, mostly automatic).** Characteristic-phrase surface match writes `concept_refs[]` (80% coverage, high precision because the phrases are curated). Embedding proposes for the remainder under human/threshold confirm. The same pass refreshes `term.used_by_nodes[]`.
- **Entity forward-linking (sparse, precise-only).** Name/alias surface match writes `entity_refs[]`. Embedding is **propose-only, never an auto-link**: the Andreessen-45 result is the proof that raw cosine over-links a particular onto semantically-near abstract nodes.
- **Bidirectional consistency.** One pass writes node-to-refs and ref-to-nodes together.

### 13.4 The 13.6% ungrounded

The 123 nodes that ground to nothing are the genuine vocabulary gaps. Route them to the t/3130 concept proposer as its next extraction target, or confirm they are irreducibly abstract.

### 13.5 FOL payoff

With `concept_refs`/`entity_refs` on nodes, the neo-Davidsonian frames (R1, §7) become populatable over the BDI corpus: a node proposition's participants resolve to typed referents (kind vs particular), which is exactly what the sort-checker needs.

### 13.6 Ticket breakdown

| # | Work | Scope |
|---|------|-------|
| G1 | Node schema: add `concept_refs[]` + `entity_refs[]` to the BDI node type | Shared Lib (types) |
| G2 | Concept forward-linking pass (surface-primary, embedding-propose) + refresh `used_by_nodes` | CL + data |
| G3 | Entity forward-linking pass (surface/alias precise, embedding propose-only) | CL + data; PowerShell resolution |
| G4 | Reverse-map consistency (`term.used_by_nodes`, entity `node:*` mentions) | CL + data |
| G5 | Ungrounded-node sweep feeds the t/3130 concept proposer | CL |
| G6 | Populate FOL frames (R1) over the new node refs | CL + Shared Lib |

Suggested first step: **G2** (concept forward-linking), 80% coverage, high precision, mostly latent already. G3 (entities) is a precise handful. G1 (schema) precedes any write.

## 14. Addendum: keeping the grounding fresh under BDI mutation (2026-08-31)

Owner point: BDI is updated through live paths (debate reflection and others); those updates add, remove, or rewrite nodes and thereby change which concepts/entities are mentioned. The grounding is a derived artifact and must stay current, not be a one-time batch.

### 14.1 The mutation surfaces (measured)

Every path that changes a node's `label`/`description`/`graph_attributes` or adds/removes a node:

- **Interactive: debate reflection** (`debateReflectionSlice.ts`: `add` / `edit_existing` / `propose_new` / node enrichment). All funnel through the server route `PUT /api/taxonomy/:pov` (`taxonomy.ts:60`) to `writeTaxonomyFile` (`fileIO.ts:336`).
- **PowerShell: `Invoke-ProposalApply.ps1`** (ADD / RELABEL / MERGE / remove / reparent).
- **Batch: research/comp-linguist enrichers** (`batch_enrich_nodes.py`, `autofix-graph-attributes.py`, `llm-reclassify-attributes.py`) which rewrite node text/attributes directly.

**Critical finding: none of these refresh the grounding.** No writer invalidates `entity_mentions.json` or `used_by_nodes`. The refresh is entirely manual today (`Update-EntityMentionIndex` full scan; `relinkVocabulary` on demand). So grounding would go stale on the first BDI update.

### 14.2 The incremental primitive already exists (it just is not triggered)

`Update-EntityMentionIndex.ps1` is already **content-hash-gated per node** (`text_sha256` over `label`+`description`): it skips unchanged nodes, re-resolves only changed/new ones, and supersedes stale mentions on text change. That is exactly the incremental primitive needed. The only gaps are that no write path triggers it, and it covers entity mentions but not `concept_refs`/`used_by_nodes`.

### 14.3 The design: one hash-gated reconciler, path-agnostic

Wiring a refresh hook into each of the N writers is fragile (the Python enrichers bypass the server entirely). Instead use ONE idempotent, content-hash reconciler that compares each node's stored `text_sha256` against its current text and refreshes only what changed, regardless of which path mutated it:

- **Unify the artifacts it maintains:** entity mentions (`node:*`), node `entity_refs`/`concept_refs` (forward), `term.used_by_nodes` (reverse). One pass, kept mutually consistent.
- **Trigger it two ways.** (1) **Inline after the interactive write** (post-`writeTaxonomyFile`) for the single changed node: cheap (one node is a surface match plus a few cosines), keeps the UI fresh. (2) **Scheduled/CI sweep** as the path-agnostic backstop that catches batch/PowerShell/Python writes bypassing the server. Hash-gated, so a no-change sweep is a near-no-op.
- **Node lifecycle:** add/edit (hash change) re-resolves the node and updates the reverse maps; **remove** purges the node id from all reverse maps (`used_by_nodes`, mentions).

### 14.4 Vocabulary churn from updates (the add/remove-concepts point)

- **An update that introduces new vocabulary** (text mentioning a concept/entity not yet registered) surfaces it as a PROPOSAL through the reuse-gate/proposer (§12, t/3130), never a silent mint. Updates grow the vocabulary through the same propose-then-confirm gate.
- **An update that removes the last mention** of a concept/entity shrinks its `used_by_nodes`; the register-liveness check (R7.5) flags terms/entities that fall to zero usage as deprecate-candidates. The vocabulary does not silently rot.

### 14.5 Ticket additions

| # | Work | Scope |
|---|------|-------|
| G7 | Extend `Update-EntityMentionIndex` into a unified grounding reconciler (mentions + `entity_refs`/`concept_refs` + `used_by_nodes`), hash-gated | CL + PowerShell |
| G8 | Trigger it: inline after `PUT /api/taxonomy/:pov` write (Taxonomy Editor) + a scheduled sweep backstop (DevOps). The scheduled job is gate-adjacent, so route to Main (TL) | Taxonomy Editor + DevOps + TL |
| G9 | Node-removal purge + new-vocabulary-to-proposer + liveness deprecate wiring | CL + data |

---

*Survey basis: full-repo exploration 2026-08-31 (claim schemas in `summaries/`, `entities.json`/`entity_mentions.json`/`entity_embeddings.json`, `lib/entities/types.ts`, extraction cmdlets and passes in `scripts/AITriad/`, `embeddings.json` header, ontology docs). Facts stated in §2 were verified against the live files, not recalled.*
