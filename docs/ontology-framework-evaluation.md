# Ontological Framework Evaluation for AI Triad

**Date:** 2026-03-28
**Context:** The BFO-based prompt improvement plan (`bfo-prompt-recommendations.md`) identified real problems in the taxonomy but the framework may be a poor fit. This document evaluates four candidate frameworks against the project's actual use cases.

**Priority use case:** The debate feature, where a proposition or document is analyzed by POV agents (Prometheus/accelerationist, Sentinel/safetyist, Cassandra/skeptic) who produce structured disagreements.

---

## What the Project Actually Does

Before comparing frameworks, we need to be precise about what the AI Triad system models. It is NOT modeling AI systems, policies, or the physical world. It is modeling **what people argue about AI** — a discourse ontology. The core entities are:

1. **Positions** — things a POV camp believes, values, or argues (taxonomy nodes)
2. **Arguments** — structured reasoning for or against positions (debate turns with premises, moves, taxonomy refs)
3. **Disagreements** — typed conflicts between positions (EMPIRICAL, VALUES, DEFINITIONAL)
4. **Evidence** — factual claims from source documents, with provenance
5. **Agents** — POV debaters with beliefs, values, reasoning priorities, and personality

The debate tool (`debate.ts`) is the most complete expression of this. Each agent:
- Has a **POV identity** with values and personality (BDI: desires + character)
- Is grounded in **taxonomy positions** it draws from (BDI: beliefs)
- Performs **dialectical moves** — CONCEDE, DISTINGUISH, REFRAME, COUNTEREXAMPLE, REDUCE, ESCALATE (AIF: argumentation schemes)
- Classifies its **disagreements** as EMPIRICAL, VALUES, or DEFINITIONAL (DOLCE D&S: perspectival classification)
- **Steelmans** opposing positions before attacking them (argumentation ethics)
- Produces structured output with **taxonomy_refs**, **move_types**, **disagreement_type** (metadata for analysis)

The synthesis then identifies **areas of agreement**, **areas of disagreement** (typed), **cruxes** (questions that would change minds), and **document claims** (accepted/challenged by whom).

This is a multi-agent argumentation system with perspectival reasoning, normative disagreement, and evidence-grounded discourse. No single traditional ontology was designed for this.

---

## Framework Comparison

### 1. BFO (Basic Formal Ontology)

**What it is:** ISO/IEC 21838-2 realist upper ontology. ~35 classes. Continuants (things that persist) vs. occurrents (things that happen). Designed for modeling mind-independent reality.

**Where it fits the project:**
- **Data/Facts nodes** map to BFO's quality/process hierarchy. "GPU compute doubled in 18 months" is a measurable process with quantities.
- **Source provenance** via IAO (Information Artifact Ontology, built on BFO) — documents, claims as information content entities.

**Where it fails:**
- **Perspectival disagreement.** BFO is ontologically monist — one reality. The entire AI Triad is built on the premise that three communities look at the same reality through different lenses and reach different conclusions. BFO has no apparatus for "Agent A's description of situation S vs. Agent B's description of situation S." You'd have to bolt on IAO for claims-as-objects, then build a perspectival indexing layer on top — essentially rebuilding what DOLCE D&S provides natively.
- **Values and norms.** BFO has no categories for ought-statements, preferences, or goals. "AI development should be regulated" has no natural home. The entire Goals/Values axis of the taxonomy is invisible to BFO.
- **Argumentation.** BFO doesn't model arguments, premises, rebuttals, or logical support relations. The debate tool's dialectical moves (CONCEDE, DISTINGUISH, REFRAME) have no representation.
- **Agent cognition.** BFO models agents as material entities with roles. "Prometheus believes scaling is safe" requires leaving BFO entirely.

**Verdict:** BFO is designed for representing what *exists*. The AI Triad represents what people *argue*. The mismatch is fundamental, not fixable by adding modules. The BFO-prompt-recommendations document's 10 proposals are largely correct about the *problems* they identify (node overlap, edge type confusion, stale predictions) but propose BFO-aligned *solutions* that fight the project's nature.

---

### 2. DOLCE (Descriptive Ontology for Linguistic and Cognitive Engineering)

**What it is:** Cognitively-oriented upper ontology from the Laboratory for Applied Ontology (LOA/ISTC-CNR). Unlike BFO's realism, DOLCE asks "what categories does human cognition use to organize experience?" Explicitly perspectival and multiplicative. Key module: **Descriptions and Situations (D&S)**.

**Where it fits the project:**

- **Perspectival disagreement (D&S).** This is DOLCE's signature capability. A `Description` is a non-physical entity (a worldview, theoretical framework, policy position) that "defines" a `Situation` (a state of affairs as categorized from that description). The AI Triad's three POVs are literally three Descriptions classifying the same Situations differently. This is not something you bolt onto DOLCE — it IS DOLCE's core design.

  The current taxonomy structure maps cleanly:
  - Each POV file (accelerationist.json, safetyist.json, skeptic.json) = a DOLCE `Description`
  - Cross-cutting nodes = `Situations` that all three Descriptions classify differently (with per-POV `interpretations`)
  - A key_point mapping a document passage to a taxonomy node = a Description classifying a Situation

- **Social objects.** "The NIST AI Safety Standard", "the accelerationist movement", "a regulatory proposal" — these are social constructs, not physical objects. DOLCE has first-class categories for them (`social-object`, `non-physical-endurant`). BFO shoehorns them into `generically dependent continuants` via IAO.

- **Information objects.** Documents, claims, arguments as entities that "express" concepts and "are about" situations. The summaries pipeline (document → snapshot → key_points → taxonomy mapping) is an information-flow chain that DOLCE can represent natively.

**Where it's weaker:**

- **Argumentation microstructure.** DOLCE can represent that an argument exists (as an information object), but not the internal structure — premises, conclusions, attack/support, inference schemes. The debate tool's CONCEDE/DISTINGUISH/REFRAME moves have no native representation. You still need AIF or equivalent.
- **Agent deliberation.** DOLCE models agents as participants in situations, holding descriptions. But it has no plan library, no means-end reasoning, no intention stack. "Prometheus is formulating a counterargument" is a process DOLCE can describe but not drive.
- **Deontic reasoning.** DOLCE can represent that a normative claim exists, but provides no formal operators for obligation, permission, or prohibition. The Goals/Values axis is representable but not formally reasoned over.

**Verdict:** DOLCE D&S is the strongest single ontology for the core problem — perspectival multiplicity over shared situations. It provides the upper-level framework the project needs. But it needs supplementation for argumentation structure and agent reasoning.

---

### 3. BDI (Belief-Desire-Intention)

**What it is:** Agent architecture from Bratman's philosophy of practical reasoning (1987), formalized by Rao & Georgeff (1991). Models agents through Beliefs (information about the world), Desires (goal states), and Intentions (committed plans). Key insight: intentions are stable commitments that resist casual revision.

**Where it fits the project:**

- **Agent characterization.** The debate agents are already informally BDI:
  - **Beliefs:** Each agent's `taxonomyContext` — the taxonomy nodes it draws from, the empirical claims it accepts
  - **Desires:** Each agent's POV values — Prometheus desires rapid progress, Sentinel desires safety-first, Cassandra desires accountability
  - **Intentions:** Each agent's dialectical strategy — CONCEDE on shared ground, DISTINGUISH where the opponent's evidence doesn't apply, COUNTEREXAMPLE with specific cases

  The `openingStatementPrompt` already asks agents to "state 1-2 key assumptions your position depends on" and describe "how your position would change if that assumption were wrong" — this is belief revision under uncertainty, a core BDI concept.

- **Disagreement as belief divergence.** The `DISAGREEMENT_TYPING` in `debate.ts` already classifies: EMPIRICAL (different beliefs about facts), VALUES (different desires/priorities), DEFINITIONAL (different conceptual frameworks). This maps directly onto BDI:
  - EMPIRICAL = agents have different Beliefs
  - VALUES = agents have different Desires
  - DEFINITIONAL = agents have different conceptual Beliefs that make their Desires non-comparable

- **Steelmanning as perspective-taking.** The steelman instruction ("Before critiquing an opposing position, briefly state the strongest version of that position") requires an agent to temporarily adopt another agent's BDI profile — believe what they believe, want what they want — and construct the best argument from THAT profile. This is BDI cross-agent modeling.

**Where it's weaker:**

- **No world model.** BDI models what agents think about the world, not the world itself. The taxonomy nodes, source documents, conflict data — these exist independently of any agent's beliefs. BDI has no place for them.
- **No argumentation structure.** BDI can represent the intention to argue, but not the logical structure of the argument. Premises, inference schemes, attack relations are outside its scope.
- **Individualist.** BDI models single agents. The AI Triad's POVs are communities, not individuals. "The accelerationist movement believes X" isn't a single agent's belief — it's a shared description (which is what DOLCE D&S models).
- **Procedural, not declarative.** BDI is an execution architecture (Jason, JACK, Jadex). It's great for building agent runtimes but awkward for representing knowledge *about* agents. The project needs to represent "what does the accelerationist perspective believe?" not "execute an accelerationist agent."

**Verdict:** BDI perfectly characterizes the debate agents' internal reasoning. The prompts already use BDI concepts (beliefs, values, assumption-dependent reasoning, perspective-taking). But BDI provides nothing for the taxonomy structure, source provenance, or argument representation. It's the right vocabulary for agent internals, not for the knowledge model.

---

### 4. Composite: Normative Frameworks + OWL

**What it is:** Purpose-built stack combining:
- **AIF (Argumentation Interchange Format)** for argument structure
- **PROV-O** or **IAO** for provenance and information artifacts
- **Deontic logic / LKIF-Core** for normative claims
- **OWL** as integration substrate

**Where it fits the project:**

- **Argumentation structure (AIF).** AIF is the dominant standard for computational argumentation, developed at the University of Dundee. It models:
  - **I-nodes** (information/claims) — map to taxonomy nodes and factual_claims
  - **S-nodes** (schemes) — map to argumentation patterns (the debate tool's CONCEDE, DISTINGUISH, REFRAME, etc.)
  - **RA-nodes** (inference) — "this evidence supports this conclusion"
  - **CA-nodes** (conflict) — "this claim attacks this other claim" — map to `Find-Conflict` output
  - **PA-nodes** (preference) — "this argument is preferred over that one"

  The debate synthesis output (`areas_of_agreement`, `areas_of_disagreement`, `cruxes`) is already an informal AIF structure. Formalizing it would enable computational reasoning over debate output.

- **Provenance (PROV-O).** The existing pipeline is a provenance chain: source document → snapshot → AI extraction → key_points → taxonomy mapping → conflict detection. PROV-O formalizes: who (AI model) derived what (key_points) from what (document) when (generated_at) using what method (prompt + model + temperature). The `summary.json` format already captures most of this informally.

- **Normative claims (deontic layer).** The Goals/Values axis represents normative positions: "AI development SHOULD be regulated" (obligation), "Companies MAY deploy without pre-testing" (permission), "States MUST NOT suppress safety research" (prohibition). A deontic module makes these formally representable and comparable. Currently they're just strings.

**Where it's weaker:**

- **No upper ontology.** Without DOLCE or BFO as a grounding layer, the composite has no shared top-level categories. "What kind of thing is a policy proposal?" "What kind of thing is a POV?" These need an upper ontology to answer.
- **No agent reasoning model.** The composite represents the *products* of reasoning (arguments, claims, evidence chains) but not the *process*. Prometheus's deliberation about which dialectical move to use has no representation.
- **Integration tax.** Aligning AIF I-nodes with PROV-O entities with IAO information content entities with deontic operators requires careful bridging. Each pair introduces alignment decisions. With 3-4 vocabularies, that's 6+ alignment surfaces.

**Verdict:** The composite approach offers the richest coverage of the argumentation and evidence requirements. AIF alone handles more of the debate use case than any single upper ontology. But it lacks the perspectival upper-level framework (which DOLCE provides) and the agent reasoning model (which BDI provides).

---

## Summary Matrix

| Capability | BFO | DOLCE | BDI | Composite | **What the Project Needs** |
|---|---|---|---|---|---|
| Perspectival disagreement | Poor | **Strong** | Strong | Strong | **Critical** — three POVs classifying same reality differently |
| Argumentation structure | Absent | Partial | Weak | **Excellent** | **Critical** — debate moves, premises, attack/support |
| Normative claims (values, goals) | Absent | Moderate | Moderate | **Strong** | **High** — Goals/Values is 1/3 of taxonomy |
| Empirical claims + provenance | **Strong** | Good | Weak | **Strong** | **High** — Data/Facts, source tracking |
| Agent reasoning (beliefs, values, plans) | Minimal | Moderate | **Excellent** | Weak | **High** — debate agents need coherent worldviews |
| Social/institutional objects | Via IAO | **Strong** | Absent | Via PROV-O | **Medium** — policies, institutions, movements |
| OWL/tooling maturity | Excellent | Good | Poor | Good | **Medium** — future interoperability |
| Integration complexity | Low | Low | Medium | High | Prefer lower |

---

## Recommendation: DOLCE D&S + AIF + BDI Vocabulary

No single framework covers the requirements. The recommended architecture is a **layered composite with DOLCE as the upper ontology**, not a bolt-everything-together-in-OWL approach:

### Layer 1 — Upper Ontology: DOLCE D&S (Descriptions & Situations)

**Role:** Provides the perspectival multiplicity framework that IS the project's core data model.

**Mapping to existing structures:**
- Accelerationist POV = a DOLCE `Description`
- Safetyist POV = a DOLCE `Description`
- Skeptic POV = a DOLCE `Description`
- Cross-cutting node = a `Situation` with three competing Description-classifications
- key_point mapping = a Description classifying a Situation with a stance

**Why DOLCE over BFO:** The AI Triad doesn't model reality — it models how three communities *describe* reality differently. DOLCE was literally designed for this. BFO's realist monism means you'd need to build the perspectival layer from scratch on top of it, reconstructing what DOLCE provides natively.

### Layer 2 — Argumentation: AIF (vocabulary, not full formalism)

**Role:** Provides structured representation for debate output.

**Mapping to existing structures:**
- Taxonomy node = AIF I-node (information node)
- `factual_claims` = AIF I-nodes with provenance metadata
- Debate dialectical moves (CONCEDE, DISTINGUISH, REFRAME, etc.) = AIF S-nodes (scheme nodes) — these are argumentation schemes
- `areas_of_disagreement` in synthesis = AIF CA-nodes (conflict nodes)
- `areas_of_agreement` = AIF RA-nodes (inference/support nodes)
- Edge types (SUPPORTS, CONTRADICTS, WEAKENS, etc.) = AIF edge relations

**Practical implication:** The project doesn't need a full AIF triplestore. It needs AIF *vocabulary* in the prompts and data structures — so that the debate tool's output is structured in a way that's compatible with argumentation analysis, even if stored as JSON.

### Layer 3 — Agent Characterization: BDI (vocabulary, not runtime)

**Role:** Provides coherent structure for POV agent internals.

**Mapping to existing structures:**
- Agent's `taxonomyContext` = BDI Beliefs (what the agent takes as given)
- Agent's POV values and personality = BDI Desires (what the agent wants)
- Agent's dialectical strategy = BDI Intentions (what the agent plans to argue)
- `disagreement_type: EMPIRICAL` = belief divergence
- `disagreement_type: VALUES` = desire divergence
- `disagreement_type: DEFINITIONAL` = conceptual-belief divergence
- `key_assumptions` + `if_wrong` = belief revision conditions (crucial for crux identification)
- Steelmanning = cross-agent BDI perspective-taking

**Practical implication:** The debate prompts already use BDI concepts informally. Formalizing them means: (a) structuring the `taxonomyContext` explicitly as beliefs/values/reasoning-priorities rather than a flat node dump, (b) giving the synthesis prompt BDI vocabulary to classify disagreement sources more precisely, (c) making crux identification more reliable by explicitly mapping which beliefs would need to change.

### Layer 4 — Provenance: PROV-O / IAO (lightweight)

**Role:** Formalizes the source → summary → claim → conflict chain.

**Mapping to existing structures:**
- `sources/{doc-id}/metadata.json` = PROV-O Entity with attribution
- `summaries/{doc-id}.json` = PROV-O Entity derived from source, attributed to AI model
- `generated_at`, `ai_model`, `temperature` = PROV-O Activity metadata
- `factual_claims[].linked_taxonomy_nodes` = PROV-O derivation chain

**Practical implication:** The existing JSON format already captures this. No immediate migration needed — just align vocabulary in prompts and documentation so the concepts are consistent.

### What NOT to Include

- **Full OWL formalization.** The project uses JSON, not RDF. Converting to OWL triples would impose massive tooling overhead for unclear benefit. Use the ontological *vocabulary* and *design patterns* without the serialization format.
- **BFO.** Not needed. DOLCE covers the upper-ontology role better for discourse. The one BFO-aligned piece worth borrowing is IAO's information artifact categories, which are compatible with DOLCE.
- **Full deontic logic.** The Goals/Values axis benefits from deontic *vocabulary* (obligation, permission, prohibition) but not a formal deontic reasoner. Add deontic terms to prompts as a sub-category refinement per BFO recommendation #3.

---

## What This Means for the BFO-Prompt-Recommendations Plan

The 10 recommendations in `bfo-prompt-recommendations.md` identify real problems. Most of the proposed solutions are valid regardless of which upper ontology frames them. Here's how each recommendation maps to the DOLCE+AIF+BDI framework:

| # | Recommendation | BFO Framing | DOLCE+AIF+BDI Framing | Change Needed? |
|---|---|---|---|---|
| 1 | Genus-differentia definitions | BFO class definitions | DOLCE concept boundaries within Descriptions | Keep — genus-differentia is good practice regardless of framework |
| 2 | Universal/particular | BFO ontological level | AIF I-node granularity (scheme vs. instance) | Keep — rename to "scheme-level vs. claim-level" |
| 3 | Sub-category disambiguation | BFO continuant types | Deontic vocabulary for Goals/Values; AIF scheme types for Methods/Arguments | Keep and strengthen — use AIF scheme vocabulary |
| 4 | Edge semantics | BFO relation ontology | AIF relation types (RA, CA, PA) already align with the 7 canonical types | Keep — AIF provides formal grounding for the same type vocabulary |
| 5 | Cross-cutting disagreement types | BFO quality/disposition/role | DOLCE D&S Description-conflict types (definitional, interpretive, structural) | Keep — DOLCE provides native support |
| 6 | Mereological parent-child | BFO is_a/part_of | Same distinction exists in any ontology | Keep as-is |
| 7 | Discourse/domain separation | BFO realist vs. IAO | DOLCE's core design — descriptions OF situations, not the situations themselves | **Reframe** — this is DOLCE's native contribution, not a patch on BFO |
| 8 | Temporal qualifiers | BFO temporal entities | PROV-O temporal metadata | Keep — PROV-O provides richer temporal vocabulary |
| 9 | Fallacy structure | BFO dispositions | AIF scheme-level analysis (valid vs. invalid schemes) | **Reframe** — AIF's scheme nodes distinguish valid from invalid inferences natively |
| 10 | Perspectival steelman | BFO roles | BDI cross-agent perspective-taking | **Reframe** — BDI makes this explicit: "adopt Agent B's beliefs and desires, construct best argument" |

**Bottom line:** Most implementation work stays the same. The ontological vocabulary in the prompts shifts from BFO terms (continuants, occurrents, dispositions) to DOLCE+AIF+BDI terms (descriptions, situations, I-nodes, schemes, beliefs, desires). The practical changes to data structures, prompts, and code are nearly identical.

---

## Immediate Next Steps

1. **Update `bfo-prompt-recommendations.md`** — reframe using DOLCE+AIF+BDI vocabulary. The phases, consumer audit, and baseline measurements are valid regardless of framework.

2. **Restructure debate agent context as explicit BDI.** Currently `taxonomyContext` is a flat dump of node labels/descriptions. Restructure into:
   ```
   === YOUR BELIEFS (what you take as given) ===
   [Data/Facts nodes for this POV]

   === YOUR VALUES (what you prioritize) ===
   [Goals/Values nodes for this POV]

   === YOUR REASONING APPROACH (how you argue) ===
   [Methods/Arguments nodes for this POV]

   === YOUR KNOWN VULNERABILITIES ===
   [steelman_vulnerability, possible_fallacies for your nodes]
   ```
   This is a prompt-only change with no schema migration. Test on 3-5 debates and compare synthesis quality.

3. **Add AIF vocabulary to debate synthesis output.** The synthesis prompt already produces `areas_of_agreement`, `areas_of_disagreement`, `cruxes`. Add AIF-aligned fields:
   - `inference_schemes_used` — which dialectical moves led to which conclusions
   - `attack_relations` — which specific claims are in conflict (not just "the debaters disagree about X" but "Prometheus's claim C1 attacks Sentinel's claim C2 by undermining premise P3")
   - `preference_ordering` — which arguments were conceded as stronger

4. **Phase 1 (genus-differentia) proceeds as planned** — it's framework-neutral. Good definitions help regardless of upper ontology.

---

## References

- DOLCE: Masolo et al., "WonderWeb Deliverable D18: Ontology Library" (2003). DUL (DOLCE+DnS Ultralite): http://www.ontologydesignpatterns.org/ont/dul/DUL.owl
- AIF: Chesnevar et al., "Towards an Argument Interchange Format" (2006). Reed & Rowe, "Araucaria" (2004). AIF OWL: http://www.arg.dundee.ac.uk/aif
- BDI: Bratman, "Intention, Plans, and Practical Reason" (1987). Rao & Georgeff, "Modeling Rational Agents within a BDI-Architecture" (1991).
- PROV-O: W3C Recommendation, https://www.w3.org/TR/prov-o/
- IAO: https://github.com/information-artifact-ontology/IAO
- LKIF-Core: Hoekstra et al., "LKIF Core: Principled Ontology Development for the Legal Domain" (2007)
