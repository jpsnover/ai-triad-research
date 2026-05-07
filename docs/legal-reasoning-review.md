# Legal Reasoning Review — Graph-Constrained LLM for Interpretable Reasoning

**Paper:** Where Has Legal Knowledge Gone: Constraining LLMs with Knowledge Graphs for Interpretable Reasoning
**Author:** Zarja Hude (London School of Economics)
**Year:** 2025
**Code:** https://github.com/hudetova/Gardner2025

**Authors:** Computational Linguist (sections A, C) · Technical Lead (sections B, D)

---

## A. What This Paper Validates About Our Approach

*Section authored by Computational Linguist*

### A1. Neural-Symbolic Architecture Produces Order-of-Magnitude Improvement

This is the strongest empirical case for our architectural approach in the review queue. Their system achieves **88.74% accuracy** on Gardner's contract formation benchmark vs **8.61%** for pure Gemini Pro 2.5 — a **10× improvement**. The pure LLM "collapsed complex decision trees into single most plausible narratives, missing 90% of required reasoning steps."

This failure mode — collapsing multi-path reasoning into a single narrative — is exactly what our QBAF + deterministic validation prevents. When our debate agents argue, the argument network preserves ALL claims, attacks, and supports as a formal graph. The pure-LLM alternative would be asking the LLM to summarize "who won the debate," which would compress the entire multi-dimensional disagreement into one paragraph. Their 10× result quantifies the cost of that compression.

### A2. Determinate/Indeterminate Boundary Is the Key Design Decision

Their most transferable contribution is the explicit decomposition of reasoning into:

- **Determinate rules** — one correct answer, encoded in the knowledge graph (Neo4j). Legal state transitions, hierarchical AND/OR requirement structures, actor role constraints.
- **Interpretive judgments** — multiple reasonable interpretations, delegated to LLM. "What counts as certain?", "Does this counteroffer imply rejection?", context-dependent evaluation.

They ground this in Hart's legal philosophy: the "penumbra" is where rules run out and judgment begins. LLMs exercise "rule-bounded discretion" — interpretive flexibility constrained by the graph structure.

**Our system does this but hasn't articulated it as clearly.** Our mapping:

| Determinate (symbolic) | Indeterminate (neural) |
|---|---|
| QBAF strength propagation (DF-QuAD) | Claim generation (DRAFT stage) |
| Phase transition predicates | Argumentation scheme classification |
| Convergence diagnostics (7 metrics) | BDI category disambiguation |
| Network garbage collection tiers | Concession detection |
| Commitment store consistency | Steelman validation |
| Turn validation (9 symbolic rules) | Turn quality assessment (neural) |
| Graph traversal for dialectic traces | Metaphor reframing |

Adopting their vocabulary — "determinate rules in the graph, interpretive judgments in the LLM, bounded by graph constraints" — would significantly strengthen Section 3 and Section 8.7 of our academic paper.

### A3. Graph Controls LLM Invocation Points

Their knowledge graph "controls when and how LLMs are invoked" — LLMs are called only at designated terminal nodes, receiving structured context (current state, prior events, legal definitions). The graph determines the reasoning structure; the LLM fills in the interpretive gaps.

Our debate engine implements the same principle through the 4-stage pipeline (BRIEF→PLAN→DRAFT→CITE) with deterministic JSON chaining between stages. The taxonomy graph determines what context agents receive. The argument network determines what claims need engagement. QBAF determines what's strong enough to matter. Each is a graph-controlled invocation of the LLM with bounded scope.

### A4. Path Branching for Competing Interpretations

When both an affirmative argument and a counter-argument are plausible, their system branches into parallel reasoning paths — one assuming the argument succeeds, one assuming it's defeated. Each path is explored systematically rather than the LLM choosing one.

This parallels our situation nodes: the same concept (e.g., "AI Governance") branches into three interpretation paths (accelerationist, safetyist, skeptic), each explored through its own BDI lens. Their formal branching could inform how we handle disagreement typing — branching at the point of divergence rather than classifying after the fact.

### A5. Error Traceability to Architecture, Not Stochastic Variation

Their error analysis categorizes 123 errors into 4 systematic types:
1. **Dynamic Role Assignment** (96/123, 78%) — architectural limitation, "perfectly consistent" across 12 runs
2. **Active/Passive Legal Effects** (19/123) — LLM conflation at 9 decision points
3. **Transaction Scoping** (4/123) — isolation failure
4. **Modification Misclassification** (4/123) — granularity error

Every error traces to a specific design decision, not random model behavior. They prove this by showing error consistency across runs (same 8 errors × 12 runs for type 1).

This methodology validates our approach of classifying prompt quality failures by root cause (prompt-level, parameter-level, architectural) but provides a more rigorous framework. Our Q-0 calibration journey informally followed this — discovering that Belief scoring failure is architectural (requires external verification, not solvable by prompt improvement). Their paper formalizes what we did intuitively.

---

## B. What We Should Adopt

*Section authored by Technical Lead*

### B1. Determinate/Indeterminate Vocabulary for Our Paper

**What they do:** Explicit Hart-grounded decomposition: determinate rules (one correct answer, in the graph) vs interpretive judgments (multiple reasonable answers, delegated to LLM with graph constraints).

**Current state:** Our paper describes this as "neural components generate content, symbolic components provide structure" — accurate but imprecise. We don't have a crisp vocabulary for articulating *why* certain operations are symbolic and others are neural.

**Adoption path:** This is a paper-writing improvement, not a code change. Update our academic paper:
- **Section 3:** Introduce determinate/indeterminate terminology with explicit table mapping (CL drafted this in A2 above — use directly)
- **Section 8.7:** Frame our neural-symbolic architecture as a principled boundary, not an engineering convenience
- Add Hart citation for the "penumbra" concept — gives our decomposition philosophical grounding

**Priority: HIGH** — This is the single most impactful framing improvement for the paper. Zero code effort.

**Effort: None (code) / Small (paper revision)**

### B2. Error Analysis Methodology (Architectural vs Stochastic)

**What they do:** Categorize every error by root cause, prove consistency across runs (same 8 errors × 12 runs), distinguish architectural limitations from stochastic model behavior.

**Current state:** Our Q-0 calibration informally did this — we discovered Belief scoring failure is architectural. But we haven't formalized the methodology or applied it systematically across all failure modes.

**Adoption path:**
1. Define error categories for our system:
   - **Architectural** — failures inherent to the decomposition (e.g., Belief scoring without external evidence, single-pass extraction missing multi-clause arguments)
   - **Prompt-level** — failures fixable by prompt improvement (e.g., BDI misclassification, edge type confusion)
   - **Parameter-level** — failures fixable by tuning (e.g., convergence thresholds, QBAF damping)
   - **Stochastic** — random model variation (run-to-run inconsistency)
2. For each known failure mode, run N-of-1 consistency analysis: does the same input produce the same error across runs? Consistent errors are architectural or prompt-level; inconsistent errors are stochastic.
3. Document in a `docs/error-taxonomy.md` or as part of our evaluation framework.

**Priority: MEDIUM** — Important for the paper's evaluation section and for prioritizing engineering work (architectural errors need redesign, not prompt tweaks).

**Effort: Medium** — analysis work, not code.

### B3. Graph-Controlled LLM Invocation Audit

**What they do:** The knowledge graph explicitly controls when and where LLMs are called — every invocation point is a designated terminal node.

**Current state:** Our BRIEF→PLAN→DRAFT→CITE pipeline is graph-controlled (taxonomy determines context, AN determines engagement targets, QBAF determines priorities), but we haven't documented this as a first-class architectural property.

**Adoption path:** Audit and document all LLM invocation points in our system, categorizing each as:
- What graph structure triggers the invocation
- What structured context the graph provides
- What constraints bound the LLM's response
- What validation runs on the output

This is documentation/audit work that strengthens our paper's architecture section.

**Priority: LOW** — Paper improvement, not functional.

**Effort: Small** — documentation pass.

---

## C. What Our System Does That They Don't

*Section authored by Computational Linguist*

### C1. Formal Argumentation (QBAF)

Their knowledge graph is a **state machine** (states, transitions, requirements) — it models legal procedure. Our argument network is an **argumentation framework** (claims, attacks, supports) — it models discourse. These are fundamentally different graph types solving different problems. Their system cannot compute argument strength, identify cruxes, or track convergence because it has no argumentation semantics. It answers "what is the legal state?" not "which arguments are strongest?"

### C2. Multi-Agent Adversarial Discourse

Their system analyzes a single negotiation transcript — it doesn't generate debate. Our system runs three AI agents with distinct worldviews against each other, with commitment tracking, convergence management, and phase transitions. Their "adversarial validation" step (re-evaluating requirements for counter-arguments) is a single-pass check; our debates sustain multi-turn adversarial engagement with formal tracking of who conceded what.

### C3. BDI-Aware Claim Decomposition

Their system processes legal events holistically — each event is one unit. Our system decomposes each turn into 3-6 claims classified by BDI category, each with independent scoring criteria. This granularity enables per-claim drift tracking, per-claim QBAF strength, and BDI-aware analysis that their system cannot achieve.

### C4. Dynamic Knowledge Evolution

Their knowledge graph is manually encoded and static — they explicitly chose this to isolate the reasoning architecture from knowledge acquisition. Our taxonomy evolves through document ingestion, debate reflections, concession harvesting, and gap analysis. The living taxonomy concept is architecturally absent from their system (deliberately, but still a limitation for real-world deployment).

### C5. Scale and Domain Breadth

Their evaluation covers one benchmark: a 341-word salt purchase negotiation with 91 reasoning steps across 10 paths. Our system operates across 170+ source documents, 565+ taxonomy nodes, 93+ debates, and multiple AI policy topics. While their controlled evaluation is methodologically sound, our system has been tested at significantly greater scale and domain breadth.

### C6. Confidence-Gated Extraction

Their event extraction is a single LLM pass (actor, action, date, content). Our FIRE system adds per-claim confidence assessment, iterative refinement, and hallucination detection. For their benchmark this is adequate (short, structured telegrams); for our domain (long academic papers with nuanced arguments) it would be insufficient.

---

## D. Specific Recommendations

*Section authored by Technical Lead*

### D1. Adopt Determinate/Indeterminate Framing in Paper (from B1)

Highest priority paper improvement from the entire review queue. Use CL's table from A2 directly in Section 3. Add a subsection:

> **3.X Determinate-Indeterminate Boundary.** Following Hart (1961) and Hude (2025), we decompose reasoning into determinate rules — operations with one correct answer encoded in the graph — and interpretive judgments where the LLM exercises bounded discretion. Table X maps each system component to this classification.

This gives reviewers a precise framework for evaluating our architecture rather than the vague "neural does content, symbolic does structure" framing.

### D2. Build Error Taxonomy Document (from B2)

Create `docs/error-taxonomy.md` cataloging known failure modes:

| Error | Category | Consistent? | Fix Path |
|-------|----------|-------------|----------|
| Belief scoring low correlation | Architectural | Yes | Evidence QBAF (t/384, done) |
| BDI misclassification | Prompt-level | Partial | Rubric refinement |
| Sycophancy drift | Architectural | Yes | Doctrinal boundaries (t/387, done) |
| Single-pass extraction misses | Architectural | Yes | FIRE iterative refinement |
| Edge type confusion | Prompt-level | Partial | Domain vocabulary (t/350) |
| Convergence false-positive | Parameter-level | No | Threshold calibration |

Run consistency analysis on 3-5 key failure modes: same input × 5 runs, measure error consistency. Consistent = architectural. This directly supports the paper's evaluation section.

### D3. Citation Integration (from CL's Citation Recommendations)

CL's 4 citation locations are correct. The recommended citation text is well-drafted. Additionally:

- In Section 5.3 (Why Beliefs Resist Automated Scoring), cite Hude's finding that 78% of errors traced to one architectural decision. Our parallel: Belief scoring failure is architectural (requires external evidence, not solvable by prompt improvement) — now addressed by the evidence QBAF pipeline (t/384).
- In the Related Work section, position Hude alongside ArgRAG: "Hude (2025) demonstrates the architecture's value for procedural reasoning; ArgRAG (Zhu et al., 2025) demonstrates it for evidence-based fact verification. Our system applies the same principle to multi-agent argumentative discourse."

### D4. No Code Changes Needed

Unlike the ArgRAG and HDE reviews, this paper's primary value is framing and methodology, not implementable features. All recommendations are paper-writing and evaluation improvements. The code already implements the architecture they validate — we just need to describe it more precisely.

---

## Citation Recommendations for Our Academic Paper

### Must-cite locations:

1. **Section 2.5 (LLM-as-Debater)** — Their 10× result as evidence that unconstrained LLMs "collapse complex decision trees into single narratives." Cite alongside Du et al. (2023) and Liang et al. (2023) to argue that neural-symbolic constraint is essential, not optional.

2. **Section 3 (System Architecture)** — Adopt their determinate/indeterminate terminology. Our current description ("neural components generate content, symbolic components provide structure") is correct but their framing is more precise: "determinate rules in the graph, interpretive judgments bounded by graph constraints."

3. **Section 8.7 (Neural-Symbolic Architecture for Explainable Argumentation)** — Their explainability properties (every decision traceable through explicit reasoning paths) and error analysis methodology (failures traceable to architectural decisions) strengthen our argument that neural-symbolic is not just a performance optimization but an explainability requirement.

4. **Section 5.3 (Why Beliefs Resist Automated Scoring)** — Their finding that 78% of errors come from one architectural limitation (dynamic role assignment) parallels our finding that Belief scoring failure is architectural (requires external verification). Both demonstrate that some failures are properties of the decomposition, not the model.

### Recommended citation format:

> Hude (2025) demonstrates a 10× improvement in legal reasoning accuracy when LLMs operate within a graph-constrained neurosymbolic architecture rather than unconstrained generation, with pure LLMs missing 90% of required reasoning steps by collapsing multi-path decision trees into single narratives. Error analysis reveals that system failures trace to specific architectural decisions rather than stochastic model behavior, validating the principle that structured knowledge representation enables traceable, improvable reasoning.

---

*Draft: 2026-05-06 · Computational Linguist & Technical Lead · AI Triad Research*
