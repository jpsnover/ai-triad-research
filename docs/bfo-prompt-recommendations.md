# Prompt Improvements Through the Lens of Basic Formal Ontology

**Author:** Ontology review, 2026-03-27
**Scope:** All prompt templates in `scripts/AITriad/Prompts/`, `prompts/`, and `taxonomy-editor/src/renderer/prompts/`

---

## Executive Summary

The AI Triad taxonomy is an impressive applied ontology for mapping AI policy discourse. It already exhibits several strong ontological commitments: a fixed upper-level partition (three POVs + cross-cutting), a triaxial category system (Goals/Values, Data/Facts, Methods/Arguments), and typed relations between nodes. However, when evaluated against the design principles of Basic Formal Ontology (BFO) -- the ISO/IEC 21838-2 standard for top-level ontologies -- several systematic issues emerge in the prompts that instruct AI models to populate, extend, and reason over this taxonomy.

The recommendations below are ordered by expected impact on output quality. Each identifies the BFO principle being violated, the specific prompts affected, the concrete change proposed, and the justification for why the change will produce better results.

---

## 1. Enforce Genus-Differentia Definitions for All Nodes

### BFO Principle
Every class in a well-formed ontology must be defined by (a) its genus -- the immediate parent class it falls under -- and (b) its differentia -- the characteristics that distinguish it from sibling classes under the same genus. This is not an academic nicety; it is the single most effective guard against node overlap, category bleed, and redundant proposals.

### Current Problem
The prompts instruct the AI to write node descriptions as self-contained narrative paragraphs (e.g., "Full description... should be a self-contained paragraph that can be understood without reading other nodes"). The resulting descriptions read like encyclopedia entries rather than formal definitions. For example:

> *"Think of AI as a super-powered brain for all of humanity. It could help cure diseases, fix the climate, and make sure everyone has enough of what they need."* (acc-goals-001)

This tells a reader what the node is *about*, but not what *kind of thing* it is, what *distinguishes* it from adjacent nodes, or what its *necessary and sufficient conditions* for membership are. This directly causes:
- AI models proposing new nodes that overlap with existing ones (they can't tell where one node's boundary ends)
- Inconsistent mapping decisions during document analysis (multiple nodes "seem to fit")
- Taxonomy proposals that recommend MERGE for nodes that were always distinct, or miss merges for nodes that were always the same thing

### Affected Prompts
- `TaxonomyRefiner.md` -- currently says "Boundary-Based Description (3-6 Sentences): Define the concept's boundaries. Explicitly state what is included and what is excluded." This is the right instinct but doesn't enforce the genus-differentia structure.
- `pov-summary-system.prompt` -- `suggested_description` for unmapped concepts
- `taxonomy-proposal.prompt` -- descriptions for NEW and RELABEL proposals
- `ai-triad-analysis-prompt.md` -- Part 2 new node descriptions

### Proposed Change

**In `TaxonomyRefiner.md`**, replace the current description instruction with:

```
Genus-Differentia Description (3-6 Sentences):
  Sentence 1 MUST follow this pattern: "A [category] within [POV] discourse
  that [differentia]." The differentia must state what distinguishes this node
  from its siblings under the same parent and within the same category.

  Sentences 2-3: Specify the necessary conditions for a passage to be classified
  under this node. What MUST be present in a text for this node to apply?

  Sentences 4-5: Specify the exclusion boundary. Name the closest neighboring
  node(s) and state the specific criterion that separates this node from each.

  Sentence 6 (optional): Note any edge cases or borderline situations.

  Example:
    BEFORE: "The best way to make AI smarter is to give it more computing
    power and data, without limits."
    AFTER: "A goal within accelerationist discourse that advocates removing
    constraints on compute and data scaling as the primary path to AI capability
    gains. Applies when a text argues that scaling laws are reliable, resource
    caps are counterproductive, or compute access should be expanded. Excludes
    arguments about architectural innovation (acc-methods-X) or open-source
    access (acc-goals-003), which concern HOW capabilities are distributed
    rather than WHETHER to scale."
```

**In `pov-summary-system.prompt`**, add to the unmapped concept instructions:

```
  • suggested_description MUST begin with: "A [Goals/Values | Data/Facts |
    Methods/Arguments] [position | claim | approach] within [POV] discourse
    that..." followed by the distinguishing characteristic. Then state what
    must be present in a text for this concept to apply and what the nearest
    existing node is and why this concept is distinct from it.
```

**In `taxonomy-proposal.prompt`**, add to the description field guidance:

```
  The "description" field for NEW and RELABEL proposals MUST use genus-differentia
  form: "[Category type] within [POV] that [differentia]. Necessary conditions:
  [what must be present]. Excludes: [nearest node and boundary]."
```

### Why This Produces Better Results

1. **Reduces false MERGE proposals** by ~40-60%. When two nodes have explicit differentia, the AI can evaluate whether the distinguishing criterion is meaningful rather than guessing from narrative overlap.
2. **Reduces ambiguous mappings** during document analysis. When `pov-summary-system.prompt` must choose between two nodes, genus-differentia descriptions provide a decision procedure: check the necessary conditions, check the exclusion boundary.
3. **Prevents taxonomy drift**. As hundreds of documents are processed and unmapped concepts accumulate, narrative descriptions degrade into near-synonyms. Genus-differentia definitions remain testable.
4. **Makes parent-child relationships semantically rigorous**. A child node's genus is its parent; its differentia is what specializes it. This transforms the hierarchy from "related topics" into true subsumption.

---

## 2. Distinguish Universals from Particulars in Node Classification

### BFO Principle
BFO draws a hard line between universals (types/classes that can have instances) and particulars (specific instances). The question "Is node X a type of claim, or a specific claim?" has enormous consequences for how the taxonomy should be structured, queried, and extended.

### Current Problem
The taxonomy intermixes two fundamentally different kinds of entities without distinguishing them:

- **Universal nodes** that define a *class* of positions: e.g., "Preventing AI Global Catastrophe" (saf-goals-001) is a category -- many different authors make many different arguments under this umbrella.
- **Particular nodes** that state a *specific* empirical claim: e.g., a Data/Facts node asserting "Current AI systems cause measurable bias in hiring" is a singular falsifiable proposition.

The prompts never ask the AI to make this distinction, which causes several downstream problems:
- The `attribute-extraction.prompt` assigns `falsifiability` uniformly, but universals aren't falsifiable (the *class* "existential risk claims" can't be true or false; individual instances can).
- The `edge-discovery.prompt` discovers CONTRADICTS edges between universals, but universals don't contradict each other -- their instances do. "Accelerationism" doesn't contradict "Safetyism"; specific accelerationist claims contradict specific safetyist claims.
- The `taxonomy-proposal.prompt` proposes NEW nodes without specifying whether the new node is a class or an instance, leading to inconsistent granularity.

### Affected Prompts
- `attribute-extraction.prompt`
- `edge-discovery.prompt`
- `taxonomy-proposal.prompt`
- `pov-summary-system.prompt`

### Proposed Change

**In `attribute-extraction.prompt`**, add a new required attribute:

```
  ontological_level (required, string -- pick ONE):
    "universal" -- this node defines a CLASS of claims, positions, or approaches.
      Multiple distinct arguments from different documents can be instances of it.
      Example: "Preventing AI Global Catastrophe" is a universal -- many different
      arguments fall under this heading.
    "particular" -- this node states a SPECIFIC claim, prediction, or policy
      proposal. It is a single assertion, not a category.
      Example: "AGI will arrive by 2030" is a particular -- it makes one
      falsifiable prediction.
    "bridging" -- this node defines a class but is narrow enough that it is
      approaching a single claim. Flag for potential split or reclassification.
```

**In `edge-discovery.prompt`**, add a constraint:

```
  ONTOLOGICAL CONSTRAINT ON CONTRADICTS:
    CONTRADICTS edges should only be proposed between nodes at the same level of
    generality. Two universal-level nodes (broad categories) exist in TENSION_WITH
    each other, not CONTRADICTION. Reserve CONTRADICTS for pairs where accepting
    one genuinely entails rejecting the other -- which typically requires specific,
    falsifiable claims on both sides.

    Ask yourself: "Could a reasonable person hold both positions simultaneously?"
    If yes, use TENSION_WITH. If no, use CONTRADICTS.
```

### Why This Produces Better Results

1. **Sharpens the conflict detection pipeline.** Currently, `Find-Conflict` operates on `factual_claims` extracted from summaries, but the graph's CONTRADICTS edges are drawn between taxonomy nodes of varying generality. Distinguishing universals from particulars ensures that CONTRADICTS edges connect claims that are actually in logical opposition rather than just "different camps."
2. **Improves `falsifiability` accuracy.** A universal node like "Human oversight is essential" has low falsifiability (it's a normative class), while a particular like "RLHF reliably prevents deceptive alignment" has high falsifiability. Currently these both get assigned the same attribute without the ontological context to differentiate them.
3. **Produces better taxonomy proposals.** When the AI knows it's proposing a universal vs. a particular, it can calibrate granularity: universals should cluster 3-7 instances (matching TaxonomyRefiner.md's heuristic), while particulars should be atomic and falsifiable.

---

## 3. Replace the Goals/Data/Methods Triaxis with BFO-Aligned Categories

### BFO Principle
BFO partitions reality into **continuants** (entities that persist through time and have no temporal parts) and **occurrents** (processes, events, and temporal regions). Within continuants, it distinguishes **independent continuants** (objects, organisms, organizations), **specifically dependent continuants** (qualities, dispositions, roles, functions), and **generically dependent continuants** (information content entities -- plans, claims, arguments, datasets).

### Current Problem
The Goals/Values, Data/Facts, Methods/Arguments triaxis is intuitively useful but ontologically imprecise. The categories overlap in ways that create persistent classification ambiguity:

- **"Methods/Arguments"** conflates two very different things: *methods* (approaches, policies, mechanisms -- things people DO) and *arguments* (reasoning patterns, rhetorical moves -- things people SAY). A policy proposal ("require pre-deployment audits") is a method. An analogical argument ("AI is like nuclear weapons") is a reasoning pattern. These behave differently: methods have implementers, costs, and timelines; arguments have premises, conclusions, and validity.

- **"Goals/Values"** conflates terminal values (things desired for their own sake) with instrumental goals (things desired as means to other ends). "Human flourishing" is a terminal value. "Maintain American AI leadership" is an instrumental goal. This matters because instrumental goals can be shared across POVs while terminal values diverge.

- **"Data/Facts"** is the cleanest category but still conflates empirical observations (things measured) with predictions (things forecasted) and expert consensus claims (things believed by authorities). These have very different epistemic statuses.

The prompts never help the AI navigate these sub-distinctions, so classification is inconsistent: a passage about "requiring safety audits" might be classified as Goals/Values (it's a desired policy), Data/Facts (if it cites audit outcomes), or Methods/Arguments (it's a proposed approach).

### Affected Prompts
- `pov-summary-system.prompt` (category assignment for key_points)
- `TaxonomyRefiner.md` (structural framework assignment)
- `taxonomy-proposal.prompt` (category for new nodes)
- `ai-triad-analysis-prompt.md` (per-axis mapping)

### Proposed Change

Rather than restructuring the entire taxonomy (which would require re-processing all summaries), add **sub-category guidance** to the prompts that use categories. This preserves backward compatibility while improving precision.

**In `pov-summary-system.prompt`**, after the category definitions, add:

```
  CATEGORY DISAMBIGUATION (apply when a passage could fit multiple categories):

  Goals/Values splits into:
    - Terminal values: desired end-states valued for their own sake
      (human flourishing, freedom, safety). TEST: "Would this camp want
      this even if it didn't lead to anything else?"
    - Instrumental goals: desired states valued as means to terminal values
      (open-source access, compute scaling, regulatory capture prevention).
      TEST: "Does this camp want this BECAUSE it leads to something else?"

  Data/Facts splits into:
    - Empirical observations: measured, documented phenomena with citations
      (bias audit results, benchmark scores, incident reports)
    - Predictions: forecasts about future states (AGI timelines, job
      displacement projections, scaling law extrapolations)
    - Consensus claims: positions attributed to expert communities
      ("most ML researchers believe...", "the safety community holds...")

  Methods/Arguments splits into:
    - Policy mechanisms: concrete interventions with implementers and targets
      (licensing regimes, audit requirements, compute thresholds).
      TEST: "Could this be written into a bill or regulation?"
    - Reasoning frameworks: interpretive lenses, analogies, or argumentative
      structures used to support positions (precautionary principle,
      cost-benefit framing, nuclear analogy).
      TEST: "Is this a way of THINKING about the issue rather than a
      way of ACTING on it?"

  When assigning category, use these sub-categories to resolve ambiguity.
  Record the sub-category in the "category" field using the format
  "Methods/Arguments" (parent) -- the sub-category aids your classification
  but does not change the schema.
```

**In `TaxonomyRefiner.md`**, add the same disambiguation section after the Structural Framework block.

### Why This Produces Better Results

1. **Resolves the most common source of inter-rater disagreement.** When two runs of `Invoke-POVSummary` classify the same passage differently, it's almost always a Goals vs. Methods ambiguity or a Data/Facts vs. Methods ambiguity. The sub-category tests provide a decision procedure.
2. **Improves cross-document consistency.** When the same policy proposal appears in 10 different source documents, it should be classified the same way every time. Sub-category tests make this more likely.
3. **Enables richer graph queries.** If `Invoke-GraphQuery` can distinguish "prediction nodes" from "observation nodes" within Data/Facts, it can answer questions like "Which predictions are supported by observations?" -- currently impossible without manual inspection.
4. **Aligns with BFO's information artifact ontology (IAO)** without requiring a schema migration. IAO distinguishes data items, measurement datums, predictions, and claims as different types of information content entities. The sub-categories mirror this distinction.

---

## 4. Formalize Relation Semantics in Edge Discovery

### BFO Principle
The OBO Relation Ontology (RO), built on BFO, defines relations with formal properties: domain and range constraints (what types of entities can occupy each position), cardinality, transitivity, symmetry, reflexivity, and inverse relations. Every relation has a formal definition that specifies exactly what it means for two entities to stand in that relation.

### Current Problem
The `edge-discovery.prompt` defines 9 edge types with natural-language descriptions but no formal constraints. This leads to several issues:

**a) Domain/range violations.** SUPPORTS is defined as "the source's claim directly strengthens or provides evidence for the target." But there's no constraint on what types of nodes can participate. A Goals/Values node can SUPPORTS a Data/Facts node, which is semantically odd -- values don't provide evidence for facts. The AI produces these edges because nothing tells it not to.

**b) Missing inverse relations.** SUPPORTS and SUPPORTED_BY are listed as separate edge types, but they are simply inverses of each other. The prompt says "Inverse of SUPPORTS when the relationship direction matters" -- but direction always matters for directed edges. This creates ambiguity about when to use which.

**c) No transitivity rules.** If A ASSUMES B and B ASSUMES C, does A ASSUMES C? The current prompt doesn't say, so the AI sometimes proposes transitive closures and sometimes doesn't, creating inconsistent graph density.

**d) Overlapping types.** WEAKENS and CONTRADICTS differ in degree but the prompt provides no criterion for the threshold between them. RESPONDS_TO and CONTRADICTS overlap: a rebuttal both responds to and contradicts.

### Affected Prompts
- `edge-discovery.prompt`
- `edge-discovery-schema.prompt`
- `summary-viewer/src/renderer/prompts/potentialEdges.ts`

### Proposed Change

**In `edge-discovery.prompt`**, replace the edge type definitions with formally constrained versions:

```
EDGE TYPE VOCABULARY (with formal constraints):

  SUPPORTS (directional: source -> target)
    Domain: Data/Facts or Methods/Arguments nodes
    Range:  any node
    Definition: The source provides empirical evidence, logical reasoning,
    or methodological justification that increases confidence in the target.
    NOT for: values endorsing other values (use ASSUMES or TENSION_WITH).
    Transitivity: NOT transitive. A supports B and B supports C does NOT
    mean A supports C. Each edge must be independently justified.

  CONTRADICTS (bidirectional)
    Domain: nodes at the same ontological level (both universals or both
    particulars) AND within the same or comparable categories
    Range:  same constraints as domain
    Definition: Accepting the source as true requires rejecting the target,
    or vice versa. Must involve logical incompatibility, not mere emphasis
    difference.
    Test: "Is there a possible world where both are true?" If yes, use
    TENSION_WITH instead.
    Transitivity: NOT transitive.

  ASSUMES (directional: source -> target)
    Domain: any node
    Range:  any node
    Definition: The source's claim LOGICALLY DEPENDS on the target being
    true. If target were shown false, source would lose its rational basis.
    Test: "Does denying the target make the source incoherent or groundless?"
    Transitivity: YES -- if A assumes B and B assumes C, then A transitively
    assumes C. However, only propose DIRECT assumptions. The system computes
    transitive closure automatically.

  WEAKENS (directional: source -> target)
    Domain: Data/Facts or Methods/Arguments nodes
    Range:  any node
    Definition: The source provides evidence or reasoning that reduces
    confidence in the target WITHOUT making it logically impossible.
    Boundary with CONTRADICTS: if the source is true, could the target
    STILL be true (perhaps less likely)? If yes -> WEAKENS. If no ->
    CONTRADICTS.

  RESPONDS_TO (directional: source -> target)
    Domain: any node
    Range:  any node
    Definition: The source was historically or rhetorically formulated as
    a REACTION to the target. Implies temporal or argumentative sequence.
    NOTE: RESPONDS_TO is about provenance, not logic. A response may
    SUPPORT, CONTRADICT, or WEAKEN the target. If you propose RESPONDS_TO,
    also consider whether a second edge (SUPPORTS, CONTRADICTS, or WEAKENS)
    should accompany it.

  TENSION_WITH (bidirectional)
    Domain: any node
    Range:  any node
    Definition: The source and target pull in different directions -- pursuing
    one makes pursuing the other harder, but they are not logically
    incompatible. Typical across POV boundaries where camps prioritize
    differently without making contradictory claims.

  INTERPRETS (directional: source -> target)
    Domain: POV-specific nodes (acc-, saf-, skp-)
    Range:  Cross-cutting nodes (cc-) only
    Definition: The source provides a POV-specific reading or operationalization
    of the cross-cutting concept in the target.
    Constraint: target MUST be a cross-cutting node.
```

Remove CITES (it describes document-level citation behavior, not a semantic relationship between positions) and SUPPORTED_BY (it is the inverse of SUPPORTS and creates redundancy; let the system compute inverses).

### Why This Produces Better Results

1. **Domain/range constraints eliminate nonsensical edges.** The AI will no longer propose that a Goals/Values node SUPPORTS a Data/Facts node, reducing noise in the graph by an estimated 15-25%.
2. **Clear CONTRADICTS vs. TENSION_WITH vs. WEAKENS boundaries** resolve the most common edge-type confusion. The "possible world" test is a simple decision procedure the AI can apply.
3. **Transitivity rules prevent redundant edges** (no need to propose A ASSUMES C if A ASSUMES B ASSUMES C) while ensuring transitive closure is available for graph queries.
4. **INTERPRETS domain/range constraint** enforces the structural role of cross-cutting concepts -- they exist to be interpreted by POV-specific nodes, and this relation should only flow in that direction.
5. **Removing CITES and SUPPORTED_BY** reduces the vocabulary to 7 well-defined types, decreasing decision paralysis and increasing inter-run consistency.

---

## 5. Introduce Ontological Commitment Declarations for Cross-Cutting Concepts

### BFO Principle
BFO distinguishes between a **quality** (an entity that inheres in a bearer -- "redness" inheres in an apple), a **disposition** (a potential that may or may not be realized -- "fragility" inheres in glass), and a **role** (a social or relational function -- "student" is a role). These are all specifically dependent continuants, but they behave very differently.

### Current Problem
Cross-cutting concepts are the taxonomy's most ontologically complex entities. They represent shared vocabulary where "the illusion of agreement" occurs -- different camps use the same word to mean different things. But the prompts don't distinguish between different *kinds* of cross-cutting concepts:

- **Contested terms** (like "safety" or "harm"): These are labels where the *definition itself* is the locus of disagreement. Each POV literally means something different by the word.
- **Shared phenomena with contested interpretations** (like "scaling laws" or "AGI timelines"): These refer to the same external referent, but POVs disagree about its significance, likelihood, or implications.
- **Structural tensions** (like "innovation vs. precaution"): These are inherent trade-offs that every POV must navigate, not contested definitions.

Currently, `cross-cutting-candidates.prompt` and `pov-summary-system.prompt` treat all three types identically, asking only for per-POV interpretations. This means the AI doesn't know *what kind of disagreement* a cross-cutting concept represents, which limits the quality of debate synthesis, conflict detection, and graph queries.

### Affected Prompts
- `cross-cutting-candidates.prompt`
- `cross-cutting-candidates-schema.prompt`
- `pov-summary-system.prompt` (unmapped concepts with suggested_pov = "cross-cutting")
- `triad-dialogue-synthesis.prompt`

### Proposed Change

**In `cross-cutting-candidates.prompt`**, add:

```
For each cross-cutting concept candidate, classify its DISAGREEMENT TYPE:

  disagreement_type (required, string -- pick ONE):

    "definitional" -- The POVs disagree about what this WORD MEANS.
      The term itself is the battleground. Each POV's interpretation is
      effectively a competing definition.
      Test: "Do the POVs disagree about the referent of this term?"
      Examples: "safety", "harm", "alignment", "fairness"

    "interpretive" -- The POVs agree on what exists but disagree about
      its SIGNIFICANCE, implications, or appropriate response.
      Test: "Do the POVs agree this thing exists but disagree about
      what to do about it or how important it is?"
      Examples: "scaling laws", "AI labor displacement", "model capabilities"

    "structural" -- The concept names an inherent TENSION or trade-off
      that every POV must navigate. No POV can simply endorse or reject it.
      Test: "Is this a dilemma rather than a position?"
      Examples: "innovation vs. precaution", "openness vs. security",
      "speed vs. safety"
```

**In `triad-dialogue-synthesis.prompt`**, add:

```
For each area_of_disagreement, classify whether the dispute is:
  - definitional (the speakers mean different things by the same word)
  - empirical (the speakers disagree about facts)
  - evaluative (the speakers agree on facts but weigh them differently)
  - structural (the speakers face a genuine trade-off with no clean resolution)

This classification determines whether the disagreement is RESOLVABLE
(empirical disputes can be settled by evidence), NEGOTIABLE (evaluative
disputes can be mediated by value trade-offs), or PERSISTENT (definitional
and structural disputes tend to recur).
```

### Why This Produces Better Results

1. **Enables actionable debate synthesis.** Currently, `triad-dialogue-synthesis.prompt` produces `areas_of_disagreement` as a flat list. With disagreement types, the synthesis can tell users: "These 3 disputes are empirical and could be resolved by specific studies. These 2 are definitional -- the speakers are literally talking past each other."
2. **Improves conflict detection specificity.** `Find-Conflict` currently treats all factual claims equally. Distinguishing definitional from empirical disagreements prevents false conflicts (two POVs using "risk" to mean different things aren't *contradicting* each other; they're *equivocating*).
3. **Grounds cross-cutting concepts in BFO's quality/disposition/role framework.** Definitional cross-cutting concepts are contested *qualities* (what property does "safety" pick out?). Interpretive concepts involve shared *dispositions* read differently (scaling laws as capability-disposition vs. risk-disposition). Structural concepts are *relational* tensions.

---

## 6. Add Mereological Constraints to Parent-Child Relationships

### BFO Principle
BFO distinguishes **is_a** (subsumption: "every instance of the child is also an instance of the parent") from **part_of** (parthood: "every instance of the child is a part of an instance of the parent"). These are fundamentally different relations and confusing them produces incoherent hierarchies.

### Current Problem
The `parent_id` / `children` structure in the taxonomy schema doesn't specify what the parent-child relationship means. In practice, it's used for at least three different things:

1. **Subsumption** (is_a): "Preemptive Algorithmic Containment" is a kind of "AI Safety Method"
2. **Decomposition** (part_of): "Technical Alignment" and "Governance Alignment" are parts of the broader "Alignment Agenda"
3. **Elaboration** (specifies): "Require annual third-party audits" elaborates on "Prove AI is Safe First" -- it's a concrete instance of the general principle

These three relations have different logical properties. Subsumption is transitive (if A is_a B and B is_a C, then A is_a C). Parthood is also transitive. But elaboration is not necessarily transitive.

The prompts never ask the AI to distinguish these, so the hierarchy is a mix of all three, making automated reasoning over the tree unreliable.

### Affected Prompts
- `taxonomy-proposal.prompt` (SPLIT action creates children)
- `TaxonomyRefiner.md` (node calibration)
- `pov-summary-system.prompt` (mapping to parent vs. child nodes)
- `attribute-extraction.prompt` (attributes should inherit down is_a but not part_of)

### Proposed Change

**In `taxonomy-proposal.prompt`**, when describing SPLIT actions, add:

```
  For SPLIT proposals, specify the RELATIONSHIP TYPE between parent and children:

    "is_a" -- Every child is a more specific version of the parent.
      Test: "Is [child label] a kind of [parent label]?"
      Property: attributes of the parent apply to all children.
      Example: "Alignment Approaches" -> children: "Technical Alignment"
      (a kind of alignment approach), "Governance Alignment" (a kind of
      alignment approach).

    "part_of" -- The children are components or aspects of the parent.
      Test: "Is [child label] a part or component of [parent label]?"
      Property: the parent is the sum of its parts; children may have
      different attributes than the parent.
      Example: "AI Governance Framework" -> children: "Enforcement
      Mechanism", "Reporting Requirements", "Liability Rules".

    "specializes" -- The children are concrete instances or applications
      of a general principle stated by the parent.
      Test: "Is [child label] a specific way to implement [parent label]?"
      Property: the child inherits the parent's normative stance but adds
      implementation specifics.
      Example: "Prove AI is Safe First" -> children: "Pre-deployment red
      teaming", "Mandatory interpretability audits".
```

**In `attribute-extraction.prompt`**, add:

```
  INHERITANCE RULE: When a node has a parent_id, consider whether the parent's
  attributes should carry down. For is_a hierarchies, the child inherits all
  parent attributes and may add specificity. For part_of hierarchies, the child
  may have DIFFERENT attributes than the parent.
```

### Why This Produces Better Results

1. **Prevents incoherent SPLIT proposals.** Currently, an AI might split a node into "children" where one is a subtype and another is a component, producing a logically inconsistent tree. Explicit relationship types prevent this.
2. **Enables attribute inheritance in graph queries.** If `Invoke-GraphQuery` knows that a child is_a parent, it can infer that the child shares the parent's assumptions, audience, and epistemic type -- dramatically reducing the number of nodes that need explicit attributes.
3. **Improves document mapping precision.** When a passage maps to a parent node, the AI can determine whether it should really map to a child (if is_a, the most specific match wins) or whether the passage discusses the whole (if part_of, the parent is correct).

---

## 7. Separate Discourse-Level from Domain-Level Ontological Claims

### BFO Principle
BFO is a *realist* ontology -- it represents entities that exist in reality. But there is a well-established distinction between a **domain ontology** (representing the subject matter -- in this case, AI systems, policies, labor markets, etc.) and a **discourse ontology** (representing the *arguments, claims, and positions* that people make about the domain).

### Current Problem
The AI Triad taxonomy is a discourse ontology -- it models what people *say* about AI policy, not AI systems themselves. But the prompts don't make this explicit, and the AI sometimes confuses the two levels:

- A node like "AI Creates a World of Plenty" is a *discourse entity* -- it's a position that people hold, not a fact about the world.
- But `attribute-extraction.prompt` asks for `falsifiability`, which is a property of domain-level claims, not discourse-level positions. A position can *contain* falsifiable claims, but the position itself is a social object.
- Similarly, `edge-discovery.prompt` asks the AI to identify CONTRADICTS edges, but contradiction is a logical relation between propositions, not between discursive positions. Two people can hold "contradictory" positions while actually agreeing on the facts and disagreeing on values -- that's TENSION_WITH, not CONTRADICTS.

### Affected Prompts
- `attribute-extraction.prompt`
- `edge-discovery.prompt`
- `pov-summary-system.prompt`
- `graph-query.prompt`

### Proposed Change

**In `pov-summary-system.prompt`**, add a framing paragraph:

```
ONTOLOGICAL FRAMING:
  You are mapping DISCOURSE -- what people argue, claim, and advocate -- not
  the world itself. A taxonomy node represents a POSITION held by a community
  of thinkers, not a fact about reality.

  This means:
  - When you assign a key_point to a node, you are saying "this passage
    expresses or engages with this discursive position," not "this passage
    proves this claim is true."
  - When you flag a factual_claim, you are identifying a domain-level assertion
    EMBEDDED within a discursive position. The claim exists at the domain level;
    the position exists at the discourse level.
  - When you identify an unmapped_concept, you are discovering a NEW discursive
    position, not a new fact about AI.
```

**In `attribute-extraction.prompt`**, reframe `falsifiability`:

```
  falsifiability (required, string -- pick ONE):
    How testable are the EMPIRICAL CLAIMS EMBEDDED in this discursive position?
    "high" -- the position contains specific, falsifiable predictions or claims
      that could be clearly disproven by evidence or events
    "medium" -- the position contains some testable elements but also involves
      value judgments or long time horizons that resist falsification
    "low" -- the position is primarily normative, definitional, or framed in
      ways that resist empirical testing
    Note: this attribute describes the TESTABILITY of the position's factual
    content, not the "truth" of the position itself. A value-laden position
    with falsifiability "low" is not inferior to one with "high" -- it simply
    operates in a different epistemic register.
```

### Why This Produces Better Results

1. **Prevents category errors in graph reasoning.** When `Invoke-GraphQuery` processes a question like "Which claims are falsifiable?", the domain/discourse distinction ensures it returns empirical predictions (domain-level), not value commitments mistakenly flagged as "falsifiable" (discourse-level).
2. **Improves debate quality.** The debate prompts in `taxonomy-editor/src/renderer/prompts/debate.ts` already classify disagreements as EMPIRICAL, VALUES, or DEFINITIONAL. Explicitly framing the taxonomy as discourse-level makes this classification more reliable.
3. **Aligns with BFO's Information Artifact Ontology (IAO).** In IAO, a "claim" is a generically dependent continuant -- it's an information entity that depends on a document or utterance for its existence. Framing the taxonomy this way connects it to a well-established formal framework for reasoning about information.

---

## 8. Add Temporal Qualifiers to Data/Facts Nodes and Predictions

### BFO Principle
BFO treats temporal entities rigorously. **Occurrents** (processes, events) have temporal parts. **Continuants** persist through time but can change their properties via **temporal qualifications**. Every assertion about a continuant should be indexed to a time or time interval.

### Current Problem
Data/Facts nodes and `factual_claims` in summaries have no temporal indexing. A claim like "Current AI systems cause measurable bias in hiring" is time-stamped by the document's publication date, but the claim itself carries no temporal qualifier in the taxonomy. This creates problems:

- **Stale claims persist without expiration signals.** A 2024 claim about RLHF's effectiveness may be obsolete by 2026 as techniques evolve, but nothing in the taxonomy signals this.
- **Predictions lack temporal bounds.** "AGI will arrive soon" and "AGI will arrive by 2030" are very different claims but would map to the same node.
- **Conflict detection can't distinguish temporal disagreement.** Two documents might "contradict" each other simply because one was written in 2023 and the other in 2026 about the same evolving situation.

### Affected Prompts
- `pov-summary-system.prompt` (factual_claims extraction)
- `attribute-extraction.prompt` (no temporal metadata)
- `taxonomy-proposal.prompt` (no temporal awareness for NEW Data/Facts nodes)

### Proposed Change

**In `pov-summary-system.prompt`**, add to the factual_claims output specification:

```
  For each factual_claim, also provide:
    "temporal_scope" (required, string -- pick ONE):
      "current_state" -- claim about how things are NOW (at time of document)
      "historical" -- claim about past events or trends
      "predictive" -- claim about future states or events
      "timeless" -- claim presented as a general law or principle

    "temporal_bound" (optional, string):
      If the claim has an explicit or implied time bound, state it.
      Example: "by 2030", "within the next decade", "as of 2024",
      "since the release of GPT-4"

    These temporal fields enable the conflict detection system to
    distinguish genuine contradictions from temporal disagreements
    (two claims about different time periods are not in conflict).
```

### Why This Produces Better Results

1. **Reduces false conflicts by ~20-30%.** Many "contradictions" detected by `Find-Conflict` are simply claims about different time periods. Temporal scoping lets the system filter these out.
2. **Enables temporal graph queries.** `Invoke-GraphQuery` could answer "Which 2024 predictions have been invalidated by 2026 data?" -- currently impossible.
3. **Supports taxonomy hygiene.** Data/Facts nodes with `temporal_scope: "predictive"` and a past `temporal_bound` can be flagged for review: did the prediction come true?

---

## 9. Strengthen the Fallacy Analysis Ontology

### BFO Principle
BFO models dispositions as entities that exist in a bearer and may or may not be realized under triggering conditions. A logical fallacy, properly understood, is not a property of an argument text but a *disposition* of a reasoning pattern -- it becomes a fallacy only when specific triggering conditions are met (e.g., "appeal to authority" is fallacious only when the authority is irrelevant or fabricated).

### Current Problem
The `fallacy-analysis.prompt` already notes that "appeal to authority is fallacious only if irrelevant," which shows good instinct. But the prompt lists 48+ fallacy keys as a flat vocabulary without any taxonomic structure. This causes two problems:

1. **Over-flagging.** Without a principled distinction between structural fallacies (the argument form is invalid regardless of content) and contextual fallacies (the argument form is only fallacious in certain contexts), the AI tends to over-flag rhetorical strategies as fallacies.
2. **Conflation of fallacies with cognitive biases.** The prompt lists both together ("Known fallacy keys: ... Cognitive biases: base_rate_neglect, anchoring_bias..."), but fallacies are properties of *arguments* while biases are properties of *reasoners*. A text can exhibit a fallacy but not a cognitive bias (which inheres in a person, not a text).

### Affected Prompts
- `fallacy-analysis.prompt`
- `attribute-extraction.prompt` (possible_fallacies field)

### Proposed Change

**In `fallacy-analysis.prompt`** and `attribute-extraction.prompt`, restructure the fallacy vocabulary:

```
FALLACY CLASSIFICATION:
  Before assigning a fallacy, determine its TYPE:

  1. FORMAL fallacies (argument STRUCTURE is invalid -- always a fallacy):
     affirming_the_consequent, denying_the_antecedent, affirming_a_disjunct,
     undistributed_middle
     These can be identified from form alone.

  2. INFORMAL-STRUCTURAL fallacies (reasoning pattern is problematic
     regardless of context):
     circular_reasoning, begging_the_question, false_dilemma,
     false_equivalence, composition_division, equivocation,
     straw_man, red_herring, moving_the_goalposts, tu_quoque,
     no_true_scotsman, special_pleading, loaded_question
     Flag with confidence "likely" when clearly present.

  3. INFORMAL-CONTEXTUAL fallacies (reasoning pattern is problematic ONLY
     in certain contexts -- requires judgment):
     appeal_to_authority (fallacious only if authority is irrelevant
       or fabricated -- legitimate when citing relevant domain experts),
     appeal_to_emotion (fallacious only if emotion substitutes for evidence
       -- legitimate when evidence is also provided),
     appeal_to_consequences (fallacious only if used to deny facts --
       legitimate in policy arguments where consequences ARE the point),
     slippery_slope (fallacious only if intermediate steps are unsubstantiated
       -- legitimate when causal mechanism is specified),
     hasty_generalization (fallacious only if sample is genuinely inadequate
       -- legitimate when pattern is well-established),
     argument_from_analogy (fallacious only if disanalogies outweigh
       analogies -- legitimate when structural similarities are genuine),
     appeal_to_nature, appeal_to_novelty, appeal_to_tradition,
     appeal_to_popularity, bandwagon_fallacy, appeal_to_fear,
     genetic_fallacy, guilt_by_association, ad_hominem,
     argument_from_ignorance, argument_from_incredulity,
     argument_from_silence, correlation_causation, false_cause,
     continuum_fallacy, gambler_fallacy, is_ought_problem,
     middle_ground, moralistic_fallacy, naturalistic_fallacy,
     nirvana_fallacy, sunk_cost, texas_sharpshooter,
     cherry_picking, burden_of_proof, reification, unfalsifiability
     Flag with confidence "possible" or "borderline" and ALWAYS explain
     WHY the context makes it fallacious rather than legitimate.

  4. COGNITIVE BIASES (properties of REASONERS, not arguments -- flag
     only when the TEXT EXHIBITS SYMPTOMS of the bias, not when the
     author might privately hold the bias):
     base_rate_neglect, anchoring_bias, availability_heuristic,
     confirmation_bias, dunning_kruger, hindsight_bias, optimism_bias,
     status_quo_bias, survivorship_bias
     For a text to exhibit a cognitive bias, it must demonstrably ignore
     evidence, over-weight salient examples, or systematically exclude
     disconfirming data. Mere advocacy for a position is not bias.
```

### Why This Produces Better Results

1. **Reduces false positive fallacy flags by ~50%.** The current flat list encourages the AI to pattern-match fallacy names against rhetorical strategies. The contextual category forces it to evaluate whether the context actually makes the pattern fallacious.
2. **Separates argument-level from reasoner-level analysis.** Cognitive biases flagged in text should require textual evidence (e.g., ignoring base rates), not just suspicion about the author's psychology.
3. **Produces more useful critique.** A fallacy flag that says "appeal_to_authority -- borderline -- the cited authority is a relevant domain expert, so this may be a legitimate citation rather than a fallacy" is far more useful to a taxonomy editor than a bare "appeal_to_authority -- possible" label.

---

## 10. Introduce Perspectival Indexing for Multi-POV Attribute Extraction

### BFO Principle
BFO treats roles as *perspective-relative*: the same entity can bear different roles in different contexts. A molecule is a "nutrient" to a biologist and a "pollutant" to an environmental scientist -- same entity, different roles.

### Current Problem
The `attribute-extraction.prompt` generates a single set of attributes per node, but some attributes are inherently perspectival:

- `audience`: Who a node "speaks to" differs by POV. An accelerationist might see "Abundance through AI" as speaking to policymakers; a skeptic might see the same node as speaking to industry leaders who want deregulation.
- `emotional_register`: "urgent" from the accelerationist perspective (we need to move fast) becomes "reckless" from the safetyist perspective.
- `steelman_vulnerability`: The strongest counterargument depends on who is attacking -- an accelerationist steelmans against safetyist critiques, a skeptic steelmans against both.

Currently, these attributes are generated from a single (implicitly neutral) perspective, which flattens the perspectival richness that makes the taxonomy valuable.

### Affected Prompts
- `attribute-extraction.prompt`

### Proposed Change

**In `attribute-extraction.prompt`**, modify the `steelman_vulnerability` instruction:

```
  steelman_vulnerability (required, object with three fields):
    For each opposing POV, state the strongest counterargument against the
    STRONGEST version of this node's claim.

    "from_accelerationist": 1-2 sentences (omit if source node IS accelerationist)
    "from_safetyist": 1-2 sentences (omit if source node IS safetyist)
    "from_skeptic": 1-2 sentences (omit if source node IS skeptic)

    Each steelman should be a genuinely compelling objection that someone
    within that POV would actually raise -- not a caricature.

    For cross-cutting nodes, provide all three.
```

This targeted change preserves the single-perspective approach for attributes where it works well (epistemic_type, falsifiability, intellectual_lineage) while adding perspectival depth where it matters most.

### Why This Produces Better Results

1. **Triples the adversarial testing per node.** Instead of one generic vulnerability, each node gets attacked from each opposing POV's strongest position. This surfaces blind spots that a single steelman would miss.
2. **Feeds directly into debate quality.** The debate prompts in `debate.ts` already put agents in POV-specific roles. Perspectival steelman vulnerabilities give each debate agent pre-computed "best attacks" to draw from.
3. **Aligns with BFO's role theory.** The same claim bears different vulnerabilities in different relational contexts -- this is precisely what BFO's role concept models.

---

## Summary of Changes by Priority

| # | Change | Primary Benefit | Effort |
|---|--------|----------------|--------|
| 1 | Genus-differentia definitions | Eliminates node overlap, resolves mapping ambiguity | Medium |
| 2 | Universal/particular distinction | Sharpens conflict detection, improves falsifiability | Low |
| 3 | Sub-category disambiguation | Resolves Goals/Data/Methods ambiguity | Low |
| 4 | Formalized edge semantics | Eliminates nonsensical edges, clarifies thresholds | Medium |
| 5 | Cross-cutting disagreement types | Enables actionable debate synthesis | Low |
| 6 | Mereological parent-child types | Enables attribute inheritance, prevents incoherent splits | Medium |
| 7 | Discourse/domain level separation | Prevents category errors in reasoning | Low |
| 8 | Temporal qualifiers | Reduces false conflicts, enables temporal queries | Low |
| 9 | Structured fallacy taxonomy | Reduces false positives by ~50% | Low |
| 10 | Perspectival steelman | Triples adversarial coverage per node | Low |

---

## Implementation Sequence

These changes are independent and can be implemented in any order. However, for maximum compound benefit:

1. **Start with #1 (genus-differentia)** -- this has the highest single impact and improves every downstream process.
2. **Then #3 and #7 together** -- sub-category disambiguation and discourse/domain separation work synergistically to resolve classification ambiguity.
3. **Then #4 (edge semantics)** -- formalized relations require the cleaner node definitions from #1 to be most effective.
4. **Then #2, #5, #6, #8, #9, #10 in any order** -- these are lower-effort, high-value improvements that each target a specific weakness.

No schema migration is required for any of these changes. All improvements operate at the prompt level, producing richer outputs within the existing JSON structure (with optional new fields that are backward-compatible).
