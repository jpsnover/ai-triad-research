# Taxonomy Ontology Guide: DOLCE, BDI, and AIF

This document explains the three ontological frameworks underpinning the AI Triad taxonomy, how they work together, and how to ensure that existing and new taxonomy items comply with them.

## What This Project Models

The AI Triad does **not** model AI systems, policies, or the physical world. It models **what people argue about AI** — a discourse ontology. The core entities are:

- **Positions** — things a POV camp believes, values, or argues (taxonomy nodes)
- **Arguments** — structured reasoning for or against positions (debate turns)
- **Disagreements** — typed conflicts between positions
- **Evidence** — factual claims from source documents
- **Agents** — POV debaters with beliefs, values, and reasoning priorities

Three communities (accelerationist, safetyist, skeptic) look at the same reality through different lenses and reach different conclusions. No single traditional ontology was designed for this, which is why we use a layered composite of three frameworks.

---

## The Three Frameworks

### Layer 1: DOLCE D&S (Descriptions & Situations)

**What it is:** DOLCE (Descriptive Ontology for Linguistic and Cognitive Engineering) is a cognitively-oriented upper ontology from the Laboratory for Applied Ontology. Unlike realist ontologies that model "what exists," DOLCE asks "what categories does human cognition use to organize experience?" Its key module is **Descriptions and Situations (D&S)** — a formal apparatus for representing how different agents or communities describe the same state of affairs differently.

**Why we use it:** The entire AI Triad is built on perspectival multiplicity — three communities classifying the same phenomena differently. DOLCE D&S was literally designed for this. A `Description` is a non-physical entity (a worldview, framework, or policy position) that classifies a `Situation` (a shared state of affairs) from a particular perspective.

**How it maps to our taxonomy:**

| DOLCE Concept | Taxonomy Implementation |
|---|---|
| **Description** | Each POV file — `accelerationist.json`, `safetyist.json`, `skeptic.json`. Each represents a coherent worldview that classifies AI-related phenomena. |
| **Situation** | Situation nodes in `situations.json`. These are contested concepts where all three Descriptions classify the same phenomenon differently. The `interpretations` field (with `accelerationist`, `safetyist`, `skeptic` sub-fields) IS the D&S mechanism — three Descriptions of one Situation. |
| **Information Object** | Source documents, snapshots, summaries. The pipeline (document -> snapshot -> key_points -> taxonomy mapping) is a DOLCE information flow chain. |
| **Social Object** | Policies, institutions, movements referenced in the taxonomy ("the NIST AI Safety Standard", "the accelerationist movement"). These are non-physical endurants — social constructs that DOLCE provides first-class categories for. |

**What DOLCE does NOT provide:** It cannot represent the internal structure of arguments (premises, conclusions, attack/support relations) or how agents deliberate. That's what AIF and BDI are for.

---

### Layer 2: BDI (Belief-Desire-Intention)

**What it is:** BDI is an agent architecture from Bratman's philosophy of practical reasoning (1987), formalized by Rao & Georgeff (1991). It models agents through three mental attitudes:

- **Beliefs** — information the agent takes as true about the world
- **Desires** — goal states the agent wants to achieve
- **Intentions** — committed plans the agent is executing to achieve its desires

The key insight: intentions are stable commitments that resist casual revision. An agent doesn't constantly reconsider everything — it commits to a course of action and follows through unless something forces reconsideration.

**Why we use it:** The debate agents (Prometheus/accelerationist, Sentinel/safetyist, Cassandra/skeptic) are already informally BDI agents. BDI gives us a structured vocabulary for their internal reasoning, which makes their output more coherent and their disagreements more precisely classifiable.

**How it maps to our taxonomy:**

The three taxonomy node categories map directly to BDI layers:

| BDI Layer | Taxonomy Category | What It Contains | Example |
|---|---|---|---|
| **Beliefs** | `Beliefs` | Empirical claims the agent takes as true | "GPU compute has doubled every 18 months" |
| **Desires** | `Desires` | Normative commitments and priorities | "AI development should prioritize safety over speed" |
| **Intentions** | `Intentions` | Argumentative strategies and reasoning patterns | "Cost-benefit analysis applied to AI regulation" |

**How BDI structures debate prompts:**

When a debate agent receives its taxonomy context, the nodes are organized into BDI sections:

```
=== YOUR BELIEFS (what you take as empirically true) ===
[Beliefs nodes for this POV]

=== YOUR VALUES (what you prioritize and why) ===
[Desires nodes for this POV]

=== YOUR REASONING APPROACH (how you argue) ===
[Intentions nodes for this POV]
```

This structure tells the agent: "Here is what you believe to be factually true, here is what you care about, and here is how you argue." The strongest arguments connect beliefs to values through reasoning — agents are instructed to reference nodes from all three BDI sections.

**BDI and disagreement classification:**

When debaters disagree, BDI tells us *where* the disagreement lives:

| Disagreement Type | BDI Layer | Meaning | Resolvability |
|---|---|---|---|
| `EMPIRICAL` | Beliefs | Agents disagree about what's factually true | Resolvable by evidence |
| `VALUES` | Desires | Agents disagree about what matters | Negotiable via tradeoffs |
| `DEFINITIONAL` | Beliefs (conceptual) | Agents use the same terms to mean different things | Requires term clarification |

This classification appears in debate synthesis output as `bdi_layer` and `resolvability` fields.

**BDI and steelmanning:**

The steelman instruction ("Before critiquing an opposing position, state the strongest version of that position") requires an agent to temporarily adopt another agent's BDI profile — believe what they believe, want what they want — and construct the best argument from THAT perspective. This is BDI cross-agent perspective-taking.

---

### Layer 3: AIF (Argument Interchange Format)

**What it is:** AIF is the dominant standard for computational argumentation, developed at the University of Dundee. It provides a structured vocabulary for representing arguments as networks of nodes and edges. The key node types are:

| AIF Node Type | Full Name | What It Represents | Our Implementation |
|---|---|---|---|
| **I-node** | Information Node | A claim, assertion, or piece of evidence | Taxonomy nodes, `factual_claims`, argument network nodes (`AN-1`, `D-1`) |
| **S-node** | Scheme Node | An argumentation pattern or rule of inference | Dialectical moves: CONCEDE, DISTINGUISH, REFRAME, COUNTEREXAMPLE, REDUCE, ESCALATE |
| **RA-node** | Rule of Inference Application | "This evidence supports this conclusion" | `supports` edges in the argument network, with `warrant` explaining the reasoning |
| **CA-node** | Conflict Application | "This claim attacks this other claim" | `attacks` edges in the argument network |
| **PA-node** | Preference Application | "This argument is preferred over that one" | `preferences` in debate synthesis — which argument prevails and why |

**Why we use it:** DOLCE tells us that perspectives exist. BDI tells us how agents reason. AIF tells us how their arguments are structured — which claims support or attack which other claims, by what reasoning pattern, and which arguments ultimately prevail.

**How AIF maps to our system:**

**Attack types** — AIF defines three ways a claim can attack another:

| Attack Type | Meaning | Example |
|---|---|---|
| **Rebut** | Directly contradicts the conclusion | "AGI by 2030 is not just unlikely, it's physically impossible given current hardware trajectories" |
| **Undercut** | Denies the inference (the reasoning is flawed, even if the premises are true) | "Your cost-benefit analysis assumes we can quantify existential risk, but we can't" |
| **Undermine** | Attacks a premise (the evidence is wrong or unreliable) | "That study you cited has been retracted" |

**Argumentation schemes** — these are the dialectical moves agents use:

| Scheme | What It Does |
|---|---|
| CONCEDE | Accepts a point from the opponent |
| DISTINGUISH | Draws a boundary — "that applies in case X but not in case Y" |
| REFRAME | Recasts the issue in different terms |
| COUNTEREXAMPLE | Provides a specific case that disproves the generalization |
| REDUCE | Shows the opponent's position leads to absurd consequences |
| ESCALATE | Raises the stakes or broadens the scope |

**The argument network:**

During debates, an incremental argument network is built. After each debater's turn, an AI call extracts claims and maps their relationships to prior claims. The network accumulates:

- **Nodes**: Each claim gets an ID (`AN-1`, `AN-2`, etc., or `D-1`, `D-2` for document-sourced claims). Each node records the claim text, speaker, and which taxonomy nodes informed it.
- **Edges**: Each relationship between claims records whether it's support or attack, the attack type if applicable, the scheme used, and a warrant explaining why.
- **Commitment stores**: Per-debater tracking of which claims they've asserted, conceded, or challenged.

**`node_scope` on taxonomy nodes:**

Taxonomy nodes can be classified by their AIF role:

| Scope | Meaning | Typical Category |
|---|---|---|
| `claim` | A specific testable assertion | Usually `Beliefs` |
| `scheme` | An argumentative strategy or reasoning pattern | Usually `Intentions` |
| `bridging` | Connects claims to schemes | Rare, intermediate nodes |

This field is populated organically by the attribute extraction process, not batch-assigned.

**Canonical edge types:**

The taxonomy uses 7 AIF-aligned edge types for relationships between nodes:

`SUPPORTS`, `CONTRADICTS`, `ASSUMES`, `WEAKENS`, `RESPONDS_TO`, `TENSION_WITH`, `INTERPRETS`

---

## How the Three Frameworks Work Together

```
DOLCE D&S          BDI                    AIF
(What exists)      (How agents think)     (How arguments work)
    |                   |                      |
    v                   v                      v
Three POVs are    Each POV's nodes      Debates produce
DOLCE             are organized as      structured argument
Descriptions      Beliefs/Desires/      networks with
                  Intentions            I-nodes, CA-nodes,
Situation nodes                         RA-nodes, PA-nodes
nodes are         Disagreements are
DOLCE Situations  classified by         Attack types and
with three        BDI layer             schemes classify
competing         (belief/value/        HOW arguments
interpretations   conceptual)           interact
```

**The flow in a debate:**

1. **DOLCE provides the world model.** Three POV files represent three Descriptions. Situation nodes represent Situations that all three classify differently.

2. **BDI structures what agents know and want.** When a debate agent is prompted, its taxonomy context is organized into Beliefs (Beliefs), Values (Desires), and Reasoning Approach (Intentions). The agent knows what it believes, what it cares about, and how it argues.

3. **AIF structures what agents produce.** As agents argue, their output is parsed into an argument network: claims (I-nodes), support relations (RA-nodes), attacks (CA-nodes) with typed attack relations, and warrants (S-nodes). After synthesis, preference applications (PA-nodes) determine which arguments prevail.

4. **The layers feed back into each other.** Debate findings can be "harvested" back into the taxonomy — new conflicts, steelman refinements, debate references. This is the D&S cycle: Descriptions (POVs) classify Situations, agents reason about them (BDI), produce structured arguments (AIF), and the results update the Descriptions.

---

## Compliance: Ensuring New Items Fit the Frameworks

### When Adding or Editing a Taxonomy Node

**DOLCE compliance:**

- The node belongs to exactly one POV (accelerationist, safetyist, or skeptic) or to situations. This is the Description it lives in.
- The description uses **genus-differentia format**:
  - POV nodes: `"A Belief / A Desire / An Intention within [POV] discourse that [differentia]. Encompasses: ... Excludes: ..."`
  - Situation nodes: `"A situation that [differentia]. Encompasses: ... Excludes: ..."`
- Parent-child relationships use DOLCE-aligned terms: `is_a`, `part_of`, or `specializes`.
- If the node represents a concept that other POVs also address, consider whether it should be a Situation with per-POV interpretations instead of (or in addition to) a POV-specific node.

**BDI compliance:**

- The node has exactly one category: `Beliefs`, `Desires`, or `Intentions`.
- The category must match the node's actual content:
  - `Beliefs` — empirical claims, observable phenomena, measurable trends. Ask: "Is this something that could be verified or falsified with evidence?"
  - `Desires` — normative commitments, priorities, principles. Ask: "Is this about what *should* happen or what *matters*?"
  - `Intentions` — reasoning strategies, analytical frameworks, argumentative approaches. Ask: "Is this about *how* to think about something?"
- If a node seems to span categories (e.g., "AI safety metrics" could be Data or Methods), choose based on how the POV *uses* it in arguments. If it's cited as evidence, it's Beliefs. If it's cited as a way to evaluate claims, it's Intentions.

**AIF compliance:**

- If the node has a `node_scope`, verify it matches:
  - `claim` — a specific assertion that could be attacked or supported
  - `scheme` — an argumentative pattern or reasoning method
  - `bridging` — connects claims to schemes (rare)
- If the node has `possible_fallacies`, each must have a `type` field (one of: `formal`, `informal_structural`, `informal_contextual`, `cognitive_bias`) and a `confidence` level (`likely`, `possible`, `borderline`).
- Edge types connecting this node to others must be one of the 7 canonical types.

### When Adding a Situation Node

- It must have `interpretations` with entries for all three POVs — this IS the D&S mechanism (three Descriptions of one Situation).
- Optionally, it should have a `disagreement_type`: `definitional` (POVs define the concept differently), `interpretive` (POVs agree on the definition but disagree on implications), or `structural` (POVs frame the issue differently at a foundational level).

### When Reviewing Debate Output

- Argument network nodes should have properly typed edges (supports/attacks with attack_type and scheme).
- Synthesis should classify disagreements by `bdi_layer` (belief/value/conceptual) and `resolvability`.
- Preference entries should identify which argument prevails and by what criterion (`empirical_evidence`, `logical_validity`, `source_authority`, `specificity`, `scope`).

---

## Key Principle: Vocabulary Over Formalism

The project adopts DOLCE/AIF/BDI **vocabulary** in prompts and JSON data structures. It does NOT use formal OWL/RDF triples, SPARQL queries, or ontology reasoners. The data lives in JSON files. The frameworks provide the conceptual structure and naming conventions, not a formal logic layer. When in doubt, ask: "Does this term/structure help an AI agent or human analyst reason about the taxonomy more clearly?" If yes, use it. If it's just formalism for formalism's sake, skip it.

## Reference Documents

- `docs/ontology-framework-evaluation.md` — Full comparison of BFO, DOLCE, BDI, and AIF with rationale for the composite approach
- `docs/dolce-aif-bdi-implementation-plan.md` — Phased implementation plan with validation criteria
- `docs/aif-debate-tool-analysis.md` — Detailed AIF gap analysis for the debate feature
- `taxonomy/schemas/pov-taxonomy.schema.json` — JSON schema enforcing DOLCE/BDI/AIF constraints
