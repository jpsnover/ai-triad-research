# BDI-Grounded Argumentation for Multi-Perspective AI Policy Analysis: Integrating QBAF, FIRE, and Ontological Framing in a Living Taxonomy

**Jeffrey Snover**

## Abstract

AI policy discourse involves competing empirical claims, normative commitments, and strategic reasoning that existing NLP tools compress into lossy single-label representations. I present an integrated system for multi-perspective discourse analysis built on a **neural-symbolic architecture** that pairs LLM-based content generation with symbolic validation, formal computation, and deterministic explanation. The system combines three layers: (1) **ontological grounding** using DOLCE D&S for perspectival multiplicity, BDI (Belief-Desire-Intention) for agent characterization, and AIF for argumentation structure — adopted as vocabulary in JSON structures rather than formal OWL/RDF reasoning; (2) **formal argumentation** via Quantitative Bipolar Argumentation Frameworks (QBAFs) with DF-QuAD gradual semantics and a novel BDI-aware base score calibration; and (3) **confidence-gated iterative extraction** (FIRE) that replaces single-shot summarization with a per-claim verification loop. The system organizes AI policy literature through a 565-node taxonomy spanning four perspectives (accelerationist, safetyist, skeptic, and shared situations), supports multi-agent debates with ontology-grounded context injection, deploys an active moderator with a 14-move intervention taxonomy, and feeds debate findings back into the taxonomy through concession harvesting and post-debate reflections. All convergence diagnostics and debate outcome explanations are computed deterministically from the argument network without LLM calls. BDI-aware calibration reveals a fundamental asymmetry: AI reliably scores normative (Desires, r=0.65) and strategic (Intentions, r=0.71) claims but not empirical Beliefs — an asymmetry traceable to the self-contained versus externally-verifiable nature of different claim types. The system is evaluated across 100+ debates with empirical findings on relevance threshold calibration, embedding model selection, and per-claim sycophancy detection.

## 1. Introduction

The rapid development of AI systems has produced a complex policy discourse involving multiple stakeholder communities with fundamentally different analytical frameworks. Accelerationists emphasize scaling and capability growth; safetyists prioritize alignment and existential risk mitigation; skeptics focus on immediate, measurable harms like bias and labor displacement. These communities frequently disagree not because they have different information, but because they operate from different normative commitments, define key terms differently, and employ different reasoning strategies.

Current NLP tools for discourse analysis — stance detection, topic modeling, sentiment analysis — struggle with this multi-dimensional complexity. They project what are fundamentally different kinds of disagreement (empirical vs. values-based vs. definitional) onto flat, single-label representations that lose the structure needed to make policy disagreements tractable.

### 1.1 The Projection Problem in Stance Detection

Consider a claim like "AI regulation should be based on demonstrated harm, not hypothetical risk." Standard stance detection classifies this as either *Favor* or *Against* AI regulation. But this classification compresses at least three independent dimensions: (1) a factual belief about how regulation works best (empirical), (2) a normative commitment to proportionality over precaution (values), and (3) a strategic preference for reactive over proactive governance (methodology). Two annotators who agree on all three dimensions but weight them differently will produce different labels, generating spurious inter-annotator disagreement.

This projection problem (Ebrahimi et al., 2022) is not a labeling error — it is a structural limitation of binary stance representations applied to multi-dimensional policy opinions. When LLMs are used for stance classification, they inherit the same compression artifact, producing systematically unreliable labels on exactly the claims where nuance matters most.

### 1.2 Contributions

I present a system that addresses the projection problem through three integrated layers:

1. **Ontological grounding.** A composite ontology using DOLCE D&S for perspectival multiplicity (multiple descriptions of shared situations), BDI for agent characterization (separating empirical beliefs from normative desires and strategic intentions), and AIF for argumentation structure (typed attack/support relationships with formal scheme vocabulary). I adopt ontological *vocabulary* in JSON structures rather than OWL/RDF formal reasoning — a design choice I term "vocabulary over formalism."

2. **Formal argumentation with BDI-aware scoring.** A QBAF implementation using DF-QuAD gradual semantics (Rago et al., 2016) with a novel BDI-aware base score calibration. Through iterative calibration (Q-0), I discovered that different BDI layers require fundamentally different scoring approaches: normative and strategic claims can be AI-scored via decomposed evidence criteria, while empirical claims require human judgment — a finding I attribute to the self-contained vs. externally-verifiable nature of different claim types.

3. **Confidence-gated iterative extraction (FIRE).** A replacement for single-shot claim extraction that assesses per-claim confidence through evidence criteria heuristics and iteratively refines uncertain claims through targeted follow-up queries. FIRE addresses three identified failure modes of single-shot extraction: specificity collapse, warrant deficit, and claim clustering.

4. **Per-claim sycophancy detection.** A novel mechanism for detecting sycophantic position drift in multi-agent debate that decomposes opening positions into individual claims and tracks maintained/refined/abandoned status with concession exemption — distinguishing legitimate intellectual progress from accommodation at the granularity of individual arguments.

5. **Adaptive convergence management.** A multi-signal phase transition system with six weighted saturation signals, three-layer confidence gating with escalation, and seven deterministic convergence diagnostics — all computed from the argument network without LLM calls — that manages debate pacing based on argumentative substance rather than fixed round counts.

6. **Automated parameter calibration.** A 16-parameter calibration framework with three distinct objective functions (debate quality via neutral evaluator, utilization via context injection instrumentation, and error rate via turn validation), including a closed-loop adaptive threshold for the most impactful parameter.

7. **Process-level debate evaluation.** Per-turn process reward scores composing engagement, novelty, consistency, grounding, and move quality dimensions, providing step-level quality signals analogous to process reward models (Lightman et al., 2023) that enable fine-grained identification of where debate quality degrades.

The system is deployed and actively used for AI policy research, operating on 173 source documents, 565 taxonomy nodes (v3.1.0), ~1,500 conflict instances, and ~25 structured debate sessions.

## 2. Related Work

### 2.1 Argument Mining and Claim Extraction

Argument mining has progressed from identifying argumentative discourse units (Stab and Gurevych, 2017) to end-to-end claim extraction and relation classification (Lauscher et al., 2022; Mayer et al., 2020). Recent work leverages LLMs for claim extraction (Törnberg, 2024), achieving strong performance on standard benchmarks. However, most argument mining pipelines stop at extraction — they identify claims and classify attack/support relationships but do not compute formal argument strength or propagate that strength through an argument network.

This system extends the extraction pipeline with two innovations: (1) FIRE adds confidence-gated verification to the extraction step, distinguishing reliably extracted claims from potential hallucinations; and (2) QBAF integration propagates base scores through the extracted argument network via DF-QuAD gradual semantics, producing computed strength values that reflect the full attack/support context rather than isolated claim quality.

### 2.2 Stance Detection and Multi-Dimensional Opinion

Binary stance detection (Mohammad et al., 2016; ALDayel and Magdy, 2021) classifies text as Favor/Against a target. While effective for simple targets, binary classification fails on complex policy topics where opinions span multiple independent dimensions. Recent work acknowledges this limitation: Li et al. (2023) propose multi-dimensional stance analysis, and Luo et al. (2024) decompose stance into sub-components. However, these approaches use ad-hoc dimensional decompositions without principled grounding in argumentation theory or cognitive science.

I propose BDI decomposition (Bratman, 1987; Rao and Georgeff, 1991) as a principled alternative. BDI originates in philosophy of mind and was formalized for agent-based systems. Applied to discourse analysis, it separates empirical claims (Beliefs), normative commitments (Desires), and strategic reasoning (Intentions). This decomposition is not ad-hoc — each category has a disambiguation test: "Could this be proven true or false with evidence?" (Belief), "Is this about what ought to happen?" (Desire), "Is this about how to achieve a goal?" (Intention). The categories are exhaustive for policy discourse and mutually exclusive when disambiguation tests are applied.

### 2.3 Computational Argumentation Frameworks

Abstract argumentation frameworks (Dung, 1995) compute argument acceptability from attack relationships. Bipolar frameworks (Cayrol and Lagasquie-Schiex, 2005) add support relationships. Quantitative extensions assign numerical strength to arguments: QBAFs (Baroni et al., 2019) combine base scores with gradual semantics to propagate strength through attack/support networks. DF-QuAD (Rago et al., 2016) provides a specific gradual semantics that is discontinuity-free and guarantees convergence.

The Argument Interchange Format (AIF, Chesnevar et al., 2006; Rahwan et al., 2007) provides a standardized vocabulary for representing arguments: I-nodes (information — claims), S-nodes (scheme — reasoning patterns), and CA-nodes (conflict — attacks). Tools like OVA (Janier and Reed, 2014) and AIFdb (Lawrence et al., 2012) implement AIF for manual and semi-automated annotation.

My contribution is twofold: (1) I apply QBAF to real policy discourse at scale with calibrated base scores (existing QBAF work primarily uses synthetic data or small-scale experiments), and (2) I discover and address a BDI-layer-dependent asymmetry in base score calibration that has not been reported in prior work. The decision to compute QBAF strengths algorithmically rather than delegating evaluation to LLMs is supported by Sanayei et al. (2025), who demonstrate that LLMs achieve only moderate alignment with QuAD-family gradual semantics on naturalistic debate corpora, with performance degrading as input length increases and discourse structure is disrupted — precisely the conditions that characterize multi-turn policy debates.

### 2.4 Ontology-Grounded NLP

Ontologies have been used in NLP for knowledge representation (Guarino et al., 2009), entity typing (Ling and Weld, 2012), and domain-specific information extraction (Jonnalagadda et al., 2012). DOLCE (Masolo et al., 2003) has been applied to discourse analysis through its Descriptions and Situations (D&S) extension, which models how the same situation can receive different descriptions from different perspectives. BFO (Smith et al., 2015) dominates biomedical ontology but assumes a mind-independent reality that is ill-suited to perspectival discourse analysis.

I adopt a composite ontology: DOLCE D&S provides the perspectival framework (three POV "descriptions" of shared "situations"), BDI provides agent characterization (structuring each perspective's internal reasoning), and AIF provides argumentation vocabulary (formalizing how perspectives interact). Critically, I adopt ontological *vocabulary* — naming conventions, category tests, and description patterns — rather than formal OWL/RDF triples. This "vocabulary over formalism" approach provides sufficient grounding for discourse analysis without the engineering overhead of formal ontology reasoning.

The BDI categories used here align with formal DOLCE-grounded BDI semantics (BDI Ontology, arXiv:2511.17162): our Beliefs map to `Belief ⊑ CognitiveEntity ⊑ MentalState` in DOLCE-UltraLite, our `assumes` field corresponds to `Justification ⊑ dul:Description` (the rationale underlying a mental state), and our BDI causal chain (Beliefs ground Desires which motivate Intentions) matches their axioms `Belief ⊑ ∃motivates.Desire` and `Intention ⊑ ∃fulfils.Desire`. The formal ontology (288 axioms, 22 classes, 71 properties in OWL 2) validates our category choices while our vocabulary approach trades inferential power for engineering pragmatism at deployment scale.

### 2.5 LLM-as-Debater and Multi-Agent Argumentation

Multi-agent debate using LLMs has been explored for factual accuracy improvement (Du et al., 2023), reasoning enhancement (Liang et al., 2023), and deliberative alignment (Chan et al., 2024). These systems typically assign agents fixed positions and evaluate debate outcomes on factual benchmarks. Critically, pure LLM approaches to structured reasoning systematically collapse multi-path decision processes into single narratives: Hude (2025) demonstrates a 10× accuracy improvement (88.74% vs 8.61%) when LLMs operate within a graph-constrained neurosymbolic architecture rather than unconstrained generation, with the pure LLM missing 90% of required reasoning steps by selecting the most plausible interpretation rather than exploring alternatives. This finding generalizes beyond legal reasoning — any domain requiring systematic exploration of competing interpretations (including multi-perspective policy analysis) benefits from explicit structural constraint on LLM reasoning.

A persistent problem in multi-agent debate is *rhetorical rigidity*: agents defend assigned stances without genuine concession, producing repetitive exchanges that fail to converge on shared understanding. Khan et al. (2024) show that allowing agents to self-select positions improves factual accuracy. My system addresses rhetorical rigidity through four mechanisms: (1) a dialectical move taxonomy with diversity enforcement (preventing repetitive CONCEDE-DISTINGUISH cycling), (2) per-debater commitment tracking that prevents silent self-contradiction, (3) concession harvesting that propagates genuine concessions back to the taxonomy, closing the loop between argumentation output and ontology evolution, and (4) metaphor reframing that introduces novel conceptual frames during rhetorical stalls, drawing on research in analogical reasoning (Gentner and Markman, 1997) and conceptual blending (Fauconnier and Turner, 2002). Crucially, unlike prior multi-agent debate systems that treat LLM outputs as final, this system applies a neural-symbolic architecture: each debate turn passes through a 4-stage pipeline with deterministic JSON chaining, two-stage validation (9 symbolic rules + neural quality assessment), and produces outcomes explainable through deterministic graph traversal rather than further neural inference.

Beyond rhetorical rigidity, LLM-based debate agents exhibit failure modes absent in human debate: sycophantic position drift (accommodating opponents without argued concession), hallucinated evidence (fabricating citations or statistics), steelman fabrication (misrepresenting opponent positions while appearing to steelman), and compression-window blindness (forgetting early claims as context is compressed). My system introduces five targeted interventions for these LLM-specific failures, each non-blocking and designed for graceful degradation when required capabilities (web search, NLI, embeddings) are unavailable. Additionally, a persona-free neutral evaluator independently assesses claims with speaker identities stripped, providing a bias-detection layer analogous to blinded peer review.

### 2.6 Metaphor and Analogical Reasoning in Argumentation

Conceptual metaphor theory (Lakoff and Johnson, 1980) demonstrates that metaphors are not mere rhetorical decoration but foundational cognitive structures that shape reasoning about abstract domains. In policy discourse, competing metaphors ("AI as tool" vs. "AI as agent" vs. "AI as infrastructure") frame the problem space differently and license different conclusions. Thibodeau and Boroditsky (2011) show that even brief metaphorical framing significantly shifts policy preferences in experimental settings.

Analogical reasoning has been studied as a mechanism for creative problem-solving (Gentner and Markman, 1997) and for bridging conceptual gaps in multi-agent negotiation (Holyoak and Thagard, 1995). I build on this literature by introducing curated metaphors into multi-agent debate at moments of convergence stall, providing novel conceptual frames that can break repetitive argumentation patterns.

## 3. System Architecture

The system implements a **neural-symbolic architecture** in which every neural component (LLM-based content generation, soft judgment, scheme classification) is paired with a symbolic counterpart (deterministic validation, QBAF strength propagation, BFS graph traversal, move-edge classification) that constrains, verifies, or explains the neural output. This dual architecture is not incidental — it is the central design principle that enables both the creativity of LLM-based argumentation and the auditability required for policy analysis tools. Neural components generate argumentative content, classify reasoning patterns, and assess soft qualities like argument advancement. Symbolic components enforce structural constraints (move type validity, node existence, statement length), propagate formal argument strength (DF-QuAD gradual semantics), compute convergence diagnostics from the argument network, and produce deterministic explanations of debate outcomes through graph traversal. Every LLM output passes through symbolic validation before entering the argument network, and every outcome is explainable through deterministic computation over that network.

The system implements a five-stage pipeline: **ingest** (document conversion and metadata extraction), **extract** (claim identification with confidence assessment), **argue** (multi-agent debate with ontology-grounded context), **synthesize** (argument mapping, preference resolution, disagreement typing), and **evolve** (taxonomy updates via debate harvest, concession accumulation, reflections, and health analysis). This pipeline instantiates a "Triples-to-Beliefs-to-Triples" cycle (cf. BDI Ontology, arXiv:2511.17162): structured taxonomy knowledge is injected into agents as BDI-organized worldviews (T→B), agents reason and debate within that structure, and their evolved mental states — captured through reflections, concession harvesting, and gap analysis — project back as taxonomy updates (B→T). The taxonomy is not a static resource consumed by the debate; it is a living structure that the debate refines.

### 3.0 The Determinate-Indeterminate Boundary

Following Hart (1961) and Hude (2025), we decompose reasoning into **determinate operations** — tasks with one correct answer, encoded in the graph — and **interpretive judgments** where the LLM exercises bounded discretion within constraints set by the graph structure. This boundary is not an engineering convenience but a principled design decision grounded in Hart's concept of the "penumbra": where rules run out and context-dependent judgment begins.

| Determinate (symbolic) | Indeterminate (neural) |
|---|---|
| QBAF strength propagation (DF-QuAD gradual semantics) | Claim generation (DRAFT stage content) |
| Phase transition predicates (6-signal composite) | Argumentation scheme classification |
| Convergence diagnostics (7 deterministic metrics) | BDI category disambiguation |
| Network garbage collection (tiered pruning rules) | Concession detection |
| Commitment store consistency checking | Steelman validation |
| Turn validation (9 symbolic rules) | Turn quality assessment |
| Graph traversal for dialectic traces | Metaphor reframing |

The graph structure controls when and where LLMs are invoked: the taxonomy determines what context agents receive, the argument network determines what claims need engagement, and QBAF strengths determine what is strong enough to warrant response. LLMs exercise interpretive judgment only at designated points — content generation, scheme classification, quality assessment — always bounded by the graph's structural constraints. This ensures that every LLM invocation receives structured context, operates within defined boundaries, and produces output that is validated against deterministic rules before entering the argument network. Notably, argument strength computation is kept entirely symbolic: Sanayei et al. (2025) show that LLMs achieve only moderate alignment with QuAD-family gradual semantics and degrade on longer, structurally disrupted inputs — precisely the conditions of multi-turn debate. Our DF-QuAD computation avoids this limitation by design.

The practical consequence is that system failures are traceable to specific architectural decisions rather than stochastic model variation. Following Hude's error analysis methodology, we categorize failures as *architectural* (inherent to the decomposition — e.g., Belief scoring requires external verification unavailable to the LLM), *prompt-level* (fixable by instruction improvement — e.g., BDI misclassification), *parameter-level* (fixable by calibration — e.g., convergence thresholds), or *stochastic* (random model variation). This classification determines the appropriate fix path: architectural failures need redesign, not prompt tweaking.

### 3.1 Ontological Grounding Layer

The composite ontology layers three frameworks, each addressing a distinct aspect of multi-perspective discourse:

**DOLCE D&S (perspectival multiplicity).** Situation nodes represent contested concepts that all three POVs engage with but interpret differently. Each situation node carries three interpretation fields — one per POV — describing how that perspective understands the concept. For example, "AI Governance" is interpreted by accelerationists as a potential innovation bottleneck, by safetyists as essential gating for high-risk systems, and by skeptics as a capture risk requiring independent oversight. This structure forces debate agents to engage with how other perspectives see the same concept, preventing agents from talking past each other.

I extend the D&S mechanism with **BDI-decomposed interpretations**: each POV's interpretation is structured into its empirical claim (Belief), normative commitment (Desire), and strategic reasoning (Intention) components, plus a summary for display. For example, the accelerationist interpretation of "AGI Timelines" decomposes into: *Belief* — "AGI is likely arriving within the next decade"; *Desire* — "the priority must be building it fast"; *Intention* — "ensuring democratic nations lead through speed, not caution." This decomposition enables debate agents to target specific BDI layers within an interpretation ("I challenge your empirical timeline claim, but share your desire for democratic leadership") rather than treating each interpretation as an undifferentiated paragraph. All 133 situation nodes have been migrated to the BDI-decomposed format via an AI-assisted batch migration process with human review.

**BDI (agent characterization).** Each POV's taxonomy nodes are classified into three BDI categories using explicit disambiguation tests:
- **Beliefs** (empirical grounding): "Could this be proven true or false with evidence?" Claims about how the world is.
- **Desires** (normative commitments): "Is this about what ought to happen?" Claims about what matters.
- **Intentions** (reasoning approach): "Is this about how to achieve a goal or how to reason about the issue?" Claims about strategy and methodology.

When taxonomy context is injected into debate agents, nodes are grouped by BDI category with explicit framing headers: "YOUR EMPIRICAL GROUNDING (what you take as true)," "YOUR NORMATIVE COMMITMENTS (what you argue should happen)," and "YOUR REASONING APPROACH (how you construct arguments)." This BDI-structured presentation teaches the AI its worldview structure rather than presenting a flat list of positions.

**AIF (argumentation vocabulary).** Seven canonical, AIF-aligned edge types formalize relationships between taxonomy nodes: SUPPORTS, CONTRADICTS, ASSUMES, WEAKENS, RESPONDS_TO, TENSION_WITH, and INTERPRETS. Attack types follow Pollock's tripartite classification: *rebut* (contradicts the conclusion), *undercut* (denies the inference), and *undermine* (attacks premise credibility). This vocabulary is used consistently across extraction, debate, and synthesis.

### 3.2 Taxonomy Structure

The taxonomy contains 565 nodes (v3.1.0) organized into four POVs:
- **Accelerationist** (prefix `acc-`): positions emphasizing AI capability growth, scaling, and transformative potential
- **Safetyist** (prefix `saf-`): positions emphasizing alignment, existential risk, and deployment caution
- **Skeptic** (prefix `skp-`): positions emphasizing immediate harms, bias, labor displacement, and institutional accountability
- **Situations** (prefix `sit-`): shared concepts that all three POVs engage with, carrying three BDI-decomposed interpretation fields

Node descriptions follow a DOLCE-derived genus-differentia format: "A [Belief|Desire|Intention] within [POV] discourse that [differentia]. Encompasses: [what it covers]. Excludes: [boundaries]." This format enforces semantic precision — the genus (BDI category + POV) classifies the node, the differentia distinguishes it from neighbors, and the Encompasses/Excludes clauses define boundaries.

Each node carries optional graph attributes populated organically through AI-assisted extraction: `epistemic_type` (normative_prescription, empirical_claim, etc.), `rhetorical_strategy`, `node_scope` (claim/scheme/bridging, per AIF), `steelman_vulnerability` (per-POV strongest counterargument), and `possible_fallacies` (with four-tier classification: formal, informal_structural, informal_contextual, cognitive_bias).

### 3.3 BDI-Structured Context Injection

A critical design choice is how taxonomy context is presented to AI debate agents. Flat injection — dumping all relevant nodes as a list — causes attention dilution: the model treats all nodes equally, and instruction-following degrades as context length increases.

The `formatTaxonomyContext` function implements three strategies to combat attention dilution:

1. **BDI grouping.** Nodes are organized into three sections with framing headers that teach the agent what each category means and how to use it. This structure prevents the agent from treating empirical facts and normative commitments interchangeably.

2. **Relevance tiering.** When embedding-based relevance scores are available (via cosine similarity against the debate topic using all-MiniLM-L6-v2 embeddings), a dual-threshold system controls node admission: the primary embedding threshold (0.48) gates cosine similarity, while a lexical fallback threshold (0.22) admits nodes that match on tokenized query-label overlap when no embedding adapter is available. The top-5 nodes per BDI category are marked as primary (★) with explicit instruction to prioritize them. Supporting nodes provide broader context but should not dominate the response. The embedding threshold was empirically calibrated: analysis of pairwise similarity distributions across 565 nodes showed the original threshold (0.3) admitted 93.3% of all node pairs — effectively no filtering. At 0.48, approximately 65% of pairs pass, providing meaningful filtering while preserving diversity through the `minPerCategory=3` floor. The embedding threshold now self-tunes via adaptive post-debate write-back (Section 8.9). Notably, the embedding model discriminates by POV (intra-POV mean similarity 0.58 vs cross-POV 0.47) but weakly by BDI category (0.54 vs 0.49), indicating that BDI-aware relevance must be enforced at the prompt level rather than the embedding level. An ablation study over node embedding fields determined the optimal field weights: (0.611, 0.389, 0, 0, 0) — only `description` and `assumes` contribute, with `lineage` and all other fields zeroed. The `assumes` field provides a 14% MRR (mean reciprocal rank) boost by capturing the inferential structure underlying each node. Surprisingly, including the `lineage` field *hurts* cluster separation by 9.4% with no retrieval benefit — its taxonomic path information introduces noise that pulls semantically distinct nodes closer. Naive field concatenation (equal-weight all fields) degrades retrieval quality by 26% relative to the optimized weights, confirming that selective field weighting is essential.

3. **CHESS dynamic branch injection.** For large taxonomies, only nodes within relevant taxonomy branches are injected at full depth; other branches contribute only top-level nodes as a "safety margin." This bounds context size while preserving coverage.

In later rounds (round 4 onward), cross-POV node IDs drawn from shared policy actions and cross-cutting concerns are injected into the CITE stage prompt, enabling debaters to cite opposing taxonomy when engaging directly with opponents' claims. This mechanism complements the mid-debate gap injection (Section 6.18) in addressing the "fixed roles narrow the argument space" limitation (Section 8.8), because it equips agents with the vocabulary to engage across POV boundaries rather than relying solely on external gap-filling interventions.

Additionally, variable content (taxonomy context, document analysis, debate transcript) is positioned to avoid the "lost in the middle" effect (Liu et al., 2023), with a RECALL section near the end of each prompt recapping starred nodes and phase priorities. This placement exploits the U-shaped attention curve observed in long-context LLMs, where recall is strongest at the beginning and end of the context window, ensuring that the most decision-relevant information occupies high-attention positions rather than being buried in the middle of the injected context.

**Per-turn retrieval with recency diversification.** Retrieval is recomputed every turn against a query string composed of the debate topic plus the most recent transcript window, so the injected context tracks the actual trajectory of the exchange rather than freezing at opening. A naive per-turn embedding retrieval, however, exhibits a second pathology: *citation lock-in*. The same small cluster of nodes scores highest turn after turn, producing repetitive `taxonomy_refs` across a speaker's consecutive responses. A novelty validator (rule: "at least one taxonomy_ref must be a node not cited across the speaker's last two turns") initially surfaced the problem but could not repair it at the prompt level alone, because the high-scoring nodes that the speaker actually wanted to cite remained identical across turns.

The fix is a lightweight diversification lever applied in the score map before top-K selection: each node cited by the current speaker in their last two turns has its similarity score multiplied by 0.55. Recently-cited nodes are not banned — they remain eligible — but they must outscore alternatives by roughly 45% to be reselected. This preserves continuity of argument while forcing exploration of adjacent taxonomy territory as the debate progresses. A lexical fallback (tokenized query ↔ label+description overlap normalized by the geometric mean of token-set sizes) ensures the retrieval path degrades gracefully when no embedding adapter is available rather than collapsing to a static list.

**Node caps.** To prevent context bloat, the system enforces hard caps on injected context: a maximum of 35 POV nodes and 15 situation nodes per debate agent. These caps were introduced after observing that uncapped injection could inject 130+ situation nodes, overwhelming the agent's attention budget. The caps are applied after relevance scoring, ensuring that the most relevant nodes are retained.

**Cross-POV edge selection.** In parallel with node retrieval, each turn injects a filtered slice of the taxonomy's typed edge graph, conveying the *structural* oppositions between POVs rather than only their content. Four filters apply in sequence. First, edge type is restricted to the dialectical relations `CONTRADICTS`, `TENSION_WITH`, and `WEAKENS` for debaters; the moderator additionally receives `RESPONDS_TO`. Support relations are excluded because the debate context is organized around productive conflict, and injecting agreement edges would dilute the steering signal. Second, a quality gate admits only edges with `status = approved` or `confidence ≥ 0.75`, suppressing low-confidence unreviewed edges that would otherwise point debaters toward spurious tensions. Third, a directionality filter retains only edges where one endpoint carries the speaker's POV prefix (`acc-` / `saf-` / `skp-`) and the other endpoint belongs to a distinct POV — intra-POV refinement edges are filtered out because they do not bear on cross-perspective exchange. Fourth, the surviving set is sorted by confidence and capped at the top 15. The result is a compact tension map that localizes the current speaker within the broader adversarial structure of the taxonomy without recapitulating the entire graph.

**Argument-network layering.** Three additional per-turn layers complement the node and edge retrieval. (1) A *commitment store* records each debater's asserted, conceded, and challenged claims across the debate, so agents cannot silently abandon prior positions; (2) *established points* surface recent opponent claims to the current speaker so that novel argumentation does not degenerate into paraphrase of what has already been said; (3) the *QBAF strongest-unaddressed* layer computes the top 5 claims by current DF-QuAD strength that no opponent has attacked, and injects them into the moderator's cross-respond selection prompt to prioritize engagements that are both strong and under-contested. Together with the node and edge layers, this produces a per-turn context package organized along three orthogonal axes — content (nodes), structural opposition (edges), and dialectical history (commitments, established points, QBAF) — rather than a flat retrieval blob.

### 3.4 Context Injection Instrumentation

A recurring question in ontology-grounded AI systems is whether injected context is actually utilized by the model. To move from intuition to data, I instrument the context injection pipeline with a **context injection manifest** that records:

- **Injected nodes**: all taxonomy nodes included in the agent's context, with their POV, BDI category, relevance score, and tiering status (primary ★ vs. supporting)
- **Referenced nodes**: after the agent responds, nodes that appear to have been referenced in the response (detected via node ID and label matching)
- **Utilization rate**: the ratio of referenced to injected nodes, broken down by POV, BDI category, and tiering status

The manifest is attached to each debate entry and displayed in the diagnostics panel as a "Context Usage Analysis" section. This enables empirical answers to questions like: "Are primary (★) nodes referenced more often than supporting nodes?" "Do agents ignore certain BDI categories?" "Is the 35-node cap too generous or too tight?"

The instrumentation is lightweight (string matching, no additional AI calls) and operates transparently alongside the existing pipeline. Over time, the utilization data will inform threshold tuning, cap adjustment, and relevance algorithm improvements.

## 4. FIRE: Confidence-Gated Iterative Claim Extraction

### 4.1 Motivation: Single-Shot Extraction Failures

Single-shot claim extraction — one AI call to extract all claims from a document — exhibits three systematic failure modes that degrade extraction quality:

**Specificity collapse.** When uncertain about a document's claims, the model defaults to vague formulations that are technically true but analytically useless: "AI has potential risks" instead of "GPT-4's emergent capabilities in bioweapons synthesis pose proliferation risks." Vague claims are hard to attack, support, or classify — they survive extraction but provide no analytical value. Specificity collapse is especially prevalent in long documents where later sections receive less attention.

**Warrant deficit.** The model extracts surface-level claims (what the document says) without engaging the argument structure (why the document says it). A warranted claim connects evidence to conclusion through explicit reasoning; an unwarranted claim is a bare assertion. The warrant deficit represents a failure of comprehension — the model is keyword-matching rather than understanding.

**Claim clustering.** The model fixates on the most salient theme in the document and generates variations of the same claim, missing secondary arguments. This "attention tunnel" effect is especially common when the document's opening paragraphs state a strong thesis that dominates the model's attention.

### 4.2 The Evidence Criteria Heuristic

FIRE assesses extraction reliability through a heuristic computed from three universal criteria on each claim's `evidence_criteria`:

| Criterion | Weight | What it detects |
|-----------|--------|----------------|
| `specificity = precise` | +0.2 | Claim names identifiable entities, quantities, or mechanisms |
| `has_warrant = true` | +0.2 | Claim includes reasoning connecting evidence to conclusion |
| `internally_consistent = true` | +0.1 | Claim doesn't contradict other extracted claims |

Base confidence: 0.3. Threshold for acceptance: 0.7. Range: 0.3 (vague, unwarranted, inconsistent) to 0.8 (precise, warranted, consistent).

The heuristic captures *extraction surface quality* — observable textual properties that correlate with reliable extraction. It deliberately does not capture factual accuracy (a precise claim can be wrong), completeness (individual claims don't indicate coverage), or importance (trivially true claims score high). The Q-0 calibration (Section 5.2) showed that BDI-specific criteria have different reliability profiles across models, so FIRE uses only the three universal criteria that are stable across all claim types.

### 4.3 Iterative Refinement Protocol

Claims below the confidence threshold enter a refinement loop. Each iteration sends a targeted prompt addressing one uncertain claim, asking the model to:

1. **Verify** the claim against source document text
2. **Cite** supporting passages as verbatim quotes
3. **Re-evaluate** evidence criteria in light of cited evidence
4. **Update** claim text if refinement reveals a more precise formulation

If the model returns `verified: false`, confidence is set to 0.1 and iteration stops — a strong signal of extraction hallucination.

Four termination guardrails prevent unbounded iteration: max 5 iterations per claim, max 20 iterations per document, 60-second wall-clock timeout, and 25 API calls per invocation. When any guardrail triggers, FIRE returns results accumulated so far with a `termination_reason` field.

### 4.4 The FIRE Sniff: Automatic Triggering

Not all documents benefit from iterative extraction. I implement a two-stage decision mechanism:

**Stage 1 (pre-extraction, zero API cost):** Three deterministic document-level signals trigger automatic FIRE: word count > 8,000 (context window degradation risk), chunked processing required (merge artifacts), or complex PDF layout (noisy conversion). If any signal fires, FIRE runs directly.

**Stage 2 (post-extraction):** For documents passing Stage 1, single-shot extraction runs first. Five output signals are evaluated: low-confidence claim rate > 30%, specificity collapse rate > 40%, warrant deficit rate > 50%, unmapped concept rate > 40%, and claim clustering > 60%. If 2+ signals fire, FIRE re-runs on the document.

The cost model averages ~2.6 API calls per document (vs. 1.0 for single-shot, 8-25 for unconditional FIRE).

### 4.5 Evaluation (E1)

Formal evaluation against a gold-standard claim set (PP-1) is in preparation. Preliminary testing across 170+ source documents shows FIRE identifies 15-30% more specific claims than single-shot extraction, with the iterative refinement loop most effective on documents exceeding 8,000 words. Full precision/recall metrics await completion of the annotated gold-standard set.

**Methodology.** I will construct a gold-standard claim set (PP-1) from 25 documents spanning all three POVs and varying in length (2,000-15,000 words), domain complexity, and document type (academic papers, policy reports, opinion pieces). Two annotators will independently identify factual claims and classify their evidence criteria. Inter-annotator agreement will be measured via Cohen's kappa.

Each document will be processed under three conditions: (1) single-shot extraction, (2) FIRE iterative extraction, and (3) FIRE with the two-stage sniff. Metrics: claim-level precision (are extracted claims real?), recall (are gold-standard claims found?), and F1. Additionally, I will compute mean absolute error on evidence criteria (specificity, has_warrant, internally_consistent) between AI-assigned and human-annotated values.

**Expected results.** I expect FIRE to improve precision (fewer hallucinated claims due to the verification loop) with modest recall improvement (targeted refinement may surface claims missed in the initial pass). The improvement should be largest on long, complex documents where single-shot extraction is most prone to specificity collapse and claim clustering.

## 5. QBAF: Formal Argument Strength in Multi-POV Discourse

### 5.1 DF-QuAD Gradual Semantics

I implement DF-QuAD (Rago et al., 2016) for computing argument strength from base scores and attack/support relationships.¹ Given a set of arguments with base strengths b(a) in [0,1] and typed relationships (supports/attacks), DF-QuAD iteratively computes:

> ¹ **Terminology mapping:** Throughout the paper, we use standard QBAF terminology: *intrinsic strength* τ(a) for the initial argument quality before propagation, and *dialectical strength* σ(a) for the computed strength after attack/support propagation (Baroni et al., 2019). In the implementation, these correspond to `base_strength` and `computed_strength` respectively. Similarly, the base strength categories *evidential* (backed by specific data or sources), *inferential* (logical reasoning without specific evidence), and *unsupported* (bare assertion) correspond to the implementation labels `grounded`, `reasoned`, and `asserted`. The BDI per-criterion assessment scores are stored as `bdi_sub_scores` in the implementation. This mapping is documented in Appendix A.

For each argument *a* with attackers *Att(a)* and supporters *Sup(a)*:

$$\sigma(a) = b(a) + b(a) \cdot \text{agg}(Sup(a)) - b(a) \cdot \text{agg}(Att(a))$$

where agg() aggregates the strengths of attacking or supporting arguments. The computation iterates until convergence (threshold: 0.001 absolute change in any argument's strength).

Attack types receive differential weights following Pollock's classification: *rebut* (weight 1.0, direct contradiction), *undercut* (weight 1.1, inference denial — slightly stronger because it challenges the reasoning, not just the conclusion), and *undermine* (weight 1.2, premise attack — strongest because it challenges the foundation). These weights are configurable.

Beyond attack-type weights, each argument network edge receives a 0.0--1.0 relationship strength assigned by the LLM during claim extraction, evaluating relevance to the target claim, evidence specificity, and directness of engagement. This per-edge weight separates relationship strength from existence confidence and defaults to 0.5 for edges without explicit AI evaluation, replacing the previous uniform 1.0 default. The two weight dimensions compose multiplicatively in the DF-QuAD aggregation: an undermine edge (type weight 1.2) with relationship strength 0.8 contributes an effective weight of 0.96, while the same attack type with weak engagement (relationship strength 0.3) contributes only 0.36.

For acyclic argument graphs, the standard Gauss-Seidel iteration (updating each node's strength in-place before processing the next) converges rapidly. However, three-POV debates naturally produce cyclic attack graphs — A attacks B, B attacks C, C attacks A — where Gauss-Seidel iteration can oscillate indefinitely. To handle these cases, the system monitors convergence and switches to Jacobi iteration (computing all updates from the previous iteration's values before applying any) after detecting 3 consecutive iterations with non-decreasing maximum delta. Jacobi iteration is paired with adaptive damping (d=0.3): each update is blended as σ_new = (1-d)·σ_old + d·σ_computed, smoothing oscillations in cyclic subgraphs while preserving convergence speed in acyclic regions. This combination guarantees convergence on all argument network topologies observed in practice.

The engine is pure computation — it does not depend on how base scores are sourced. This separation is critical: the calibration challenge (Section 5.2) affects base score quality but not the propagation mechanism.

**Edge attribution.** To support explainability beyond dialectic traces (Section 6.13), the engine provides removal-based edge attribution (`computeEdgeAttribution`): for a target node, it computes the DF-QuAD strength with the full graph, then recomputes with each incident edge removed, measuring the strength delta. The result is a per-edge attribution score quantifying each edge's contribution to the node's final strength — positive for edges that strengthen the node, negative for edges that weaken it. This computation is cheap (<30ms for 30 edges in practice) because each removal requires only local re-propagation rather than full-graph recomputation, and it provides actionable diagnostic information: "this node is strong primarily because of support edge X, and would drop below 0.5 if attack edge Y were removed."

### 5.2 BDI-Aware Base Score Calibration

The Q-0 calibration benchmark tests whether AI-assigned base scores correlate with human expert scores. The calibration journey revealed a fundamental finding about the nature of different claim types.

**Iteration 1: Holistic scoring.** I prompted the AI to assign a single "how strong is this argument?" score (0-1). Result: Pearson r = -0.12 against human scores — essentially uncorrelated. The AI clustered all scores in the 0.7-0.9 range, failing to discriminate between weak and strong arguments.

**Iteration 2: Decomposed rubric.** Following evidence that LLMs perform better on checkable sub-criteria than holistic judgment (Wei et al., 2022), I decomposed "argument strength" into six boolean/categorical criteria: cites_source, source_quality, falsifiable, quantitative, source_consistent, and contested. Base strength was computed deterministically from criterion responses.

**Discovery: BDI-blind bias.** Analysis revealed that 4 of 6 criteria rewarded only empirical evidence (citations, source quality, falsifiability). A strong normative argument ("Nations should establish an AI safety body modeled on the IAEA, because catastrophic-potential technologies require multilateral oversight") scored at the 0.1 floor because it has no peer-reviewed source to cite, is not falsifiable, and contains no quantitative data. The rubric equated "argument strength" with "evidential grounding" — a category error that systematically underscored two of three BDI layers.

**Iteration 3: BDI-aware rubric.** I designed a rubric with three universal criteria (specificity, has_warrant, internally_consistent) and three BDI-specific criteria per layer:

- **Beliefs:** cites_source, source_quality, source_consistent
- **Desires:** values_grounded, tradeoff_acknowledged, precedent_cited
- **Intentions:** mechanism_specified, scope_bounded, failure_mode_addressed

Each BDI layer can achieve the same maximum score (1.0), evaluated on appropriate dimensions. The AI classifies the claim's BDI category first, then answers category-specific criteria.

**Iteration 4: Calibration results.** On 41 calibration claims (balanced across BDI layers) plus 8 hold-out claims:

| Category | Scoring Method | Calibration r | Hold-out MAE |
|----------|---------------|---------------|-------------|
| Beliefs | Human-assigned | N/A | N/A |
| Desires | AI rubric (v3) | 0.65 | 0.13 |
| Intentions | AI rubric (v3) | 0.71 | 0.24 |

Desires and Intentions passed the calibration gate (r > 0.5 per-BDI, aggregate r > 0.7). Beliefs failed across all four prompt iterations.

To expose the calibration structure to downstream consumers, the extraction pipeline now outputs nine per-criterion sub-scores (three per BDI category) rather than a single opaque base_strength. Beliefs are evaluated on source_quality, evidence_strength, and falsifiability; Desires on value_coherence, tradeoff_awareness, and precedent_grounding; Intentions on mechanism_specificity, failure_mode_awareness, and implementation_feasibility. For Desires and Intentions — the categories that passed calibration — the composite base_strength is computed as the arithmetic mean of the three relevant sub-scores, replacing the previous generic 3-bucket categorical scoring (low/medium/high mapped to 0.3/0.5/0.7) with a continuous composite that reflects the calibrated rubric. This mean composition preserves the interpretability of sub-scores while producing a base_strength that feeds directly into the QBAF propagation engine. Beliefs remain on generic categorical scoring (sub-scores default to 0.5) pending the evidence QBAF pipeline that will provide the external verification infrastructure their assessment requires. A bdi_confidence field carries the calibration coefficients so that downstream consumers know which scores to trust. All sub-score fields are optional, preserving backward compatibility with extraction results that predate the decomposed format.

### 5.3 Why Beliefs Resist Automated Scoring

The Beliefs calibration failure is not a prompt engineering problem — it reflects a fundamental asymmetry in what different BDI layers require for assessment:

**Desires and Intentions claims are self-contained.** Whether a normative argument is values-grounded, acknowledges tradeoffs, or cites precedent can be determined from the claim text alone. Whether a strategic claim specifies a mechanism or addresses failure modes is visible in the text. The AI's pattern recognition capabilities are well-suited to these assessments.

**Beliefs claims require external verification.** Whether an empirical claim accurately represents its cited source, whether the source is peer-reviewed, and whether the claim is consistent with the broader evidence base requires access to information outside the claim text — the actual source document, the journal database, the state of scientific consensus. The AI lacks reliable access to this external information and defaults to assessing surface features (assertive language, hedging words) rather than evidential quality.

This asymmetry generalizes beyond this system: any automated argumentation system that attempts to score argument strength must contend with the fact that empirical claims require fundamentally different assessment infrastructure than normative or strategic claims. This finding parallels Hude (2025), who demonstrates that 78% of errors in a graph-constrained legal reasoning system trace to a single architectural limitation (dynamic role assignment), not to stochastic model behavior. In both cases, the failure is a property of the decomposition — which tasks are delegated to the LLM and which are handled symbolically — not a deficiency in the model itself. The implication is that Belief scoring cannot be fixed by better prompts; it requires architectural change (such as retrieval-augmented evidence graphs that provide the external verification the LLM lacks).

### 5.4 Evaluation (E2)

**Calibration data.** 41 claims scored by both human expert and AI rubric, balanced across BDI layers (~14 per category). Claims drawn from 15 source documents spanning AI policy, safety research, and economic analysis.

**Metrics.** Pearson correlation (r) for rank-order validation, Mean Absolute Error (MAE) for absolute accuracy. Per-BDI breakdowns to detect category-specific failure.

**Results.** The hybrid scoring approach (AI for Desires/Intentions, human for Beliefs) achieves the following aggregate calibration:

| Metric | Desires | Intentions | Aggregate |
|--------|---------|------------|-----------|
| Pearson r (calibration) | 0.65 | 0.71 | — |
| MAE (hold-out) | 0.13 | 0.24 | 0.19 |

Hold-out validation (8 unseen claims) confirmed generalization. The per-BDI calibration gate (r > 0.5) passed for both AI-scored categories. Intentions MAE (0.24) is at the threshold — acceptable but flagged for monitoring in production use.

**Failure analysis.** AI scoring failures concentrated in three patterns: (1) implicit sources unrecognized (specific statistics like "77% of organizations" treated as uncited), (2) statistical warrants not counted as warrants (quantitative evidence IS the evidential ground, but the AI expected explicit "because" clauses), and (3) mechanism_specified applied inconsistently (critiques and diagnoses marked as mechanisms when they contain no alternative method). These patterns informed iterative prompt refinements (v1-v3).

## 6. Multi-Agent Debate with Ontological Grounding

#### 6A. Debate Protocol and Turn Architecture

### 6.1 Debate Protocol Design

Debates follow a structured protocol: (1) **clarification phase** — the moderator poses 2-3 scoping questions with multiple-choice options; the user selects answers that narrow the debate focus; (2) **topic refinement** — the moderator synthesizes answers into a precise debate question; (3) **opening statements** — each POV agent presents its initial position, grounded in its BDI-structured taxonomy context; (4) **cross-respond rounds** — the moderator selects which debater should respond to whom, on what specific point, based on argument network analysis; (5) **synthesis** — a separate AI pass extracts areas of agreement, disagreement, unresolved questions, and an AIF-aligned argument map with preference resolution.

Each debate agent receives its POV's taxonomy nodes organized by BDI category, with explicit framing headers. Primary nodes (most relevant to the debate topic, identified via embedding similarity) are marked with ★. Vulnerabilities known to be relevant to the topic are included with the instruction to acknowledge them when directly relevant — building credibility rather than over-conceding.

### 6.2 Turn Pipeline: Neural-Symbolic Decomposition

Each debate turn is decomposed into four sequential AI calls, each with a focused prompt and calibrated temperature. The pipeline exemplifies the system's neural-symbolic design: the structure is deterministic (fixed stage ordering, JSON schema chaining between stages, typed outputs) while each stage's content generation is neural (LLM inference at per-stage temperatures).

| Stage | Temperature | Function | Output |
|-------|-------------|----------|--------|
| **BRIEF** | 0.15 | Summarize dialectical situation: identify the immediate opponent argument being addressed, relevant taxonomy nodes, prior moves, and commitment store state | Structured JSON: opponent claim summary, relevant node IDs, prior move history, dialectical context |
| **PLAN** | 0.4 | Select 1-3 dialectical moves from the catalog, outline logical strategy, identify which taxonomy nodes to mobilize | Structured JSON: selected moves with rationale, argument outline, target nodes |
| **DRAFT** | 0.7 | Generate argumentative text: 3-5 paragraphs with claim sketches, key assumptions, and warranted reasoning | Structured JSON: statement text, claim sketches, assumptions, move_types |
| **CITE** | 0.15 | Map claims back to taxonomy nodes with relevance justifications (minimum 40 characters each) | Structured JSON: taxonomy_refs with node_id, relevance, and justification |

The temperature gradient reflects the cognitive demands of each stage: BRIEF and CITE require precision and fidelity (low temperature), PLAN requires moderate creativity in strategy selection, and DRAFT requires the highest creativity for generating novel argumentative content. The JSON chaining between stages ensures that each stage's output constrains the next stage's input — PLAN cannot select moves that BRIEF did not identify as relevant, and CITE cannot reference nodes that were not mobilized in PLAN.

This decomposition addresses a fundamental problem with single-call turn generation: when a single LLM call must simultaneously assess the dialectical situation, select moves, generate text, and cite sources, the model makes implicit tradeoffs between these tasks that are invisible to the system. The 4-stage pipeline makes each cognitive step explicit, auditable, and independently tunable. If the system produces poor citations, the problem is localized to the CITE stage; if arguments are repetitive, the problem is in PLAN. This decomposition also enables targeted repair: a failed CITE stage can be retried without regenerating the entire turn.

### 6.3 Turn Validation with Repair Loop

Every generated turn passes through a two-stage validation pipeline before entering the argument network. This validation embodies the neural-symbolic principle: Stage A applies deterministic symbolic rules that enforce structural correctness, while Stage B applies neural judgment to assess argumentative quality.

**Stage A (Deterministic): 10 symbolic validation rules.**

1. **move_types present** — the turn specifies at least one dialectical move from the catalog
2. **disagreement_type valid** — if a disagreement is classified, it uses one of the three canonical types (EMPIRICAL, VALUES, DEFINITIONAL)
3. **taxonomy node_ids exist** — all referenced node IDs correspond to actual nodes in the taxonomy
4. **taxonomy_refs relevance** — each taxonomy reference includes a relevance justification of at least 40 characters
5. **statement length** — the argumentative statement contains 3-5 paragraphs
6. **novelty check** — the statement does not substantially repeat content from the speaker's prior turns (measured via token overlap)
7. **move repetition check** — the selected moves are not identical to the speaker's moves in the previous two turns
8. **claim specificity** — after round 3, claims must meet a minimum specificity threshold (no vague formulations like "AI has risks"); after round 4, abstract claims escalate from warning to error severity, forcing a retry — this ensures that Gemini turns, which tend toward vagueness, face the same retry pressure as turns that fail structural rules
9. **JSON schema conformance** — the output matches the expected structured format
10. **hedge-density linter** — sentence-level hedge-word detection with phase- and audience-aware thresholds; exploration phases permit more hedging than synthesis phases, and academic audiences have higher tolerance than policymaker audiences, so the linter adapts its severity dynamically rather than applying a single static threshold

Stage A rules are evaluated deterministically with no LLM calls. Any rule failure produces a specific, actionable repair hint (e.g., "node_id 'acc-B-999' does not exist in taxonomy; closest match: 'acc-B-099'").

**Stage B (Neural, sampled): LLM judge assessment.**

A separate LLM call (at low temperature, 0.15) evaluates three soft qualities that resist deterministic assessment:

1. **ADVANCES** — does the turn advance the debate beyond what has already been said, or does it merely rephrase prior arguments?
2. **CLARIFIES_TAXONOMY** — does the turn engage meaningfully with the taxonomy nodes it cites, or does it name-drop without substantive connection?
3. **WEAKNESSES** — does the turn identify specific weaknesses that should be addressed in a repair attempt?

**Repair loop.** When validation fails (Stage A rule violation or Stage B quality below threshold), the system injects specific repair hints into the next DRAFT attempt. The repair budget is 0-2 retries — sufficient to correct most structural issues without allowing unbounded regeneration. If the turn still fails after retries, it enters the argument network with a validation warning flag, ensuring that the debate never stalls on a single turn.

The two-stage design is deliberate: Stage A catches errors that are objectively wrong (a non-existent node ID is always wrong regardless of context), while Stage B catches errors that require judgment (whether a turn "advances" the debate depends on the full dialectical context). This separation ensures that deterministic errors are never left to neural judgment, while soft assessments are never reduced to brittle rules.

#### 6B. Argumentation Quality and Move Diversity

### 6.4 Dialectical Move Taxonomy and Diversity

The debate system separates two analytical layers that are frequently conflated in the multi-agent debate literature:

**Layer 1: Dialectical moves** — *what* rhetorical action the debater performs (e.g., "I am distinguishing," "I am conceding"). This layer is our engineering contribution, informed by but not directly derived from any single theoretical source.

**Layer 2: Argumentation schemes** — *how* the debater reasons, classified using 13 schemes derived from Walton, Reed, and Macagno (2008), each with 4 critical questions (Section 6.7). A debater may use ARGUMENT_FROM_ANALOGY (Layer 2) while performing a COUNTEREXAMPLE move (Layer 1) — the scheme describes the reasoning pattern; the move describes the dialectical action.

The attack types within the argument network — rebut (contradicts the conclusion), undercut (denies the inference), and undermine (attacks premise credibility) — follow Pollock's (1987, 1995) defeater taxonomy. The commitment store (asserted/conceded/challenged claims per debater, Section 6.5) follows the Hamblin (1970) and Walton & Krabbe (1995) tradition of dialogue commitment tracking, though simplified from their formal systems.

I define ten canonical dialectical moves, consolidated from an initial set of 15 after observing that LLMs struggle with large enumerated lists and that several moves overlapped semantically:

| # | Move | Type | What it does | Subsumes |
|---|------|------|-------------|----------|
| 1 | DISTINGUISH | Attack | Accept evidence, deny applicability | — |
| 2 | COUNTEREXAMPLE | Attack | Concrete case against general claim | — |
| 3 | CONCEDE-AND-PIVOT | Support | Genuine concession + redirect | CONCEDE |
| 4 | REFRAME | Attack | Shift frame to reveal hidden structure | EXPOSE-ASSUMPTION |
| 5 | EMPIRICAL CHALLENGE | Attack | Dispute facts with counter-evidence | GROUND-CHECK |
| 6 | EXTEND | Support | Build on another's point with new substance | STEEL-BUILD |
| 7 | UNDERCUT | Attack | Attack the warrant, not evidence or conclusion | REDUCE |
| 8 | SPECIFY | Neutral | Force falsifiable predictions / name the crux | IDENTIFY-CRUX, NARROW |
| 9 | INTEGRATE | Support | Synthesize multiple perspectives | CONDITIONAL-AGREE |
| 10 | BURDEN-SHIFT | Attack | Challenge proof allocation | — |

The consolidation from 15 to 10 was motivated by two observations. First, LLMs disproportionately choose early items in enumerated lists (primacy bias); a shorter list reduces the variance between list positions. Second, several pairs were semantically overlapping: EXPOSE-ASSUMPTION is a specific form of REFRAME (both reveal hidden structure), STEEL-BUILD is a specific form of EXTEND (both build on another's argument), and IDENTIFY-CRUX is a specific form of SPECIFY (both force precision about the disagreement). The merged moves retain the broader capability while reducing the categorization burden on the LLM.

**Move-edge classification.** Every move maps to a support, attack, or neutral edge type. COUNTEREXAMPLE, DISTINGUISH, UNDERCUT, EMPIRICAL CHALLENGE, BURDEN-SHIFT, and REFRAME produce attack edges. EXTEND, INTEGRATE, and CONCEDE-AND-PIVOT produce support edges. SPECIFY produces neutral edges (restructuring the dialectical space without directly attacking or supporting a claim). This classification is used consistently across extraction, commitment tracking, and convergence signal computation.

**Semantic move normalization.** LLMs routinely hallucinate move names not in the catalog — generating variants like "SURFACE-ASSUMPTION," "EXPOSE-CONTRADICTION," "CONDITIONAL-ACCEPTANCE," or entirely novel labels like "RECONTEXTUALIZE." A two-stage normalization pipeline handles this:

1. **Alias resolution** — a mapping of ~80 known LLM-generated variants to their canonical move (e.g., "STEELMAN" → EXTEND, "IDENTIFY-CRUX" → SPECIFY, "GROUND-CHECK" → EMPIRICAL CHALLENGE). Multi-word aliases are registered in both word orders automatically.

2. **Rejection on failure** — if a move name cannot be resolved through the alias map, it is flagged as a Stage A validation error (not merely a warning), forcing a retry with explicit instruction to use only the 10 canonical names. This prevents hallucinated move names from entering the argument network and corrupting convergence diagnostics.

In earlier iterations, unknown moves were accepted with a warning. This permissive approach led to a proliferation of ~32 distinct move labels in the diagnostics data, many semantically identical, making move distribution analysis unreliable. The strict normalization approach trades a small increase in retry rate for clean, analyzable move data.

**Phase-dependent constructive emphasis.** During exploration and synthesis phases, the prompt emphasizes constructive moves (INTEGRATE, SPECIFY, EXTEND, CONCEDE-AND-PIVOT) without restricting the full catalog. This phase-gating encourages convergence in later rounds without preventing agents from challenging new points when warranted.

The SPECIFY move merits particular attention. It is the only move that forces *falsifiability* into the open — requiring a debater to state what would change their mind. Its absence from the initial move taxonomy allowed debates to run for multiple rounds with neither side ever committing to testable predictions. The moderator is biased toward selecting SPECIFY when the argument network contains two high-strength claims from different speakers with no edges between them — a pattern that signals debaters talking past each other rather than engaging. The `formatSpecifyHint()` function detects this pattern and injects a "SPECIFY OPPORTUNITY" flag into the moderator's context.

**The rhetorical rigidity problem.** In the initial implementation, 27 of 30 post-opening responses used the move pair [CONCEDE, DISTINGUISH], and every response began with the literal phrase "I concede." Analysis identified three compounding causes:

1. *Primacy bias in move ordering.* CONCEDE was listed first in the dialectical moves instruction block. LLMs disproportionately favor the first item in any enumerated list.
2. *JSON example anchoring.* The example JSON in the response prompt showed `"move_types": ["CONCEDE", "DISTINGUISH"]`, directly anchoring the model's output to this exact pair.
3. *No move diversity enforcement.* The model had no memory of its prior moves — it couldn't know it had already conceded three turns in a row.

**Mitigation (implemented).** I applied five prompt-level interventions, each targeting a specific cause:

1. *Move reordering* — COUNTEREXAMPLE first, CONCEDE last (addresses primacy bias)
2. *JSON example change* — example shows `["COUNTEREXAMPLE", "REFRAME"]` instead of `["CONCEDE", "DISTINGUISH"]` (addresses anchoring)
3. *Anti-repetition instruction* — "Do NOT fall into a pattern of using the same moves every turn" with sentence variety guidance (5 alternative phrasings for concessions)
4. *Move history injection* — the model sees its last N move_types with explicit instruction to vary if it has conceded recently
5. *Temperature increase* — debate default raised from 0.3 to 0.5 (addresses sampling-level rigidity)

The temperature finding is independently significant: a systematic audit of temperature parameters across the pipeline revealed that debate agents were configured at 0.3 (optimal for extraction tasks) rather than 0.5-0.7 (appropriate for deliberative reasoning). Low temperature compounds with primacy bias — the model samples the highest-probability move (CONCEDE) more deterministically. I also introduced per-mode temperature for chat: brainstorm (0.7), inform (0.4), decide (0.3), matching the cognitive demands of each mode.

### 6.5 Commitment Tracking and Concession Harvesting

Each debater maintains a commitment store tracking asserted, conceded, and challenged claims. The commitment store is injected into subsequent prompts with a consistency rule: "Do not silently contradict prior assertions."

**Concession harvesting** extends commitment tracking across debates. After synthesis, concessions are classified into three types using linguistic markers:

- **Full** (weight 1.0): Unconditional acceptance. Markers: "I accept that...", "You're right that..."
- **Conditional** (weight 0.5): Acceptance contingent on a condition. Markers: "I concede X, provided Y..."
- **Tactical** (weight 0.0): Arguendo concession. Markers: "Even if I accepted...", "For argument's sake..."

Classified concessions are accumulated per taxonomy node across debates. When weighted concession count on a node crosses a configurable threshold (default: 3.0 across 2+ distinct debates), the harvest dialog surfaces it as a candidate BDI update with three options: *qualify* (add caveat), *weaken* (reduce scope), or *retire* (archive as indefensible). All updates require human review — no automatic taxonomy changes.

This mechanism closes the loop between argumentation output and ontology evolution: repeated concessions signal that the taxonomy has drifted from defensible positions and needs revision. It also captures *convergence* — where POVs are coming together — complementing the situation nodes that capture where they diverge.

Beyond passive concession tracking, the system actively prompts concessions by surfacing QBAF-grounded concession candidates. Before each turn, opponent claims whose computed_strength meets or exceeds 0.65 and that the current speaker has neither attacked nor conceded are injected into the prompt as explicit concession opportunities. This addresses a structural tension in the move-type diversity rule (rule 7): by penalizing consecutive repetition of the same move type, the diversity rule can inadvertently suppress successive concessions even when the dialectical situation warrants them. By making strong opposing arguments salient, the concession candidate mechanism counterbalances defensive incentives without forcing concessions, preserving agent autonomy while ensuring that argumentatively warranted acknowledgments are not suppressed by structural validation constraints.

### 6.6 Preference Resolution and Synthesis

Debate synthesis evaluates which arguments prevail in each area of disagreement. Each preference judgment specifies the prevailing argument, the criterion by which it prevails (empirical_evidence, logical_validity, source_authority, specificity, or scope), and the rationale. This maps to AIF preference application nodes (PA-nodes).

The synthesis also produces an AIF-aligned argument map: claims with IDs, near-verbatim text, speaker attribution, and typed relationships (supported_by with scheme, attacked_by with attack_type, argumentation_scheme, and critical_question_addressed).

### 6.7 Argumentation Scheme Classification

Beyond the dialectical moves (what rhetorical action is taken) and attack types (what kind of challenge is made), I classify the *argumentation scheme* — the reasoning pattern underlying each argument. Drawing from Walton, Reed, and Macagno (2008), I define 13 schemes organized into four families:

| Family | Schemes | BDI Affinity |
|--------|---------|-------------|
| **Evidence-Based** | ARGUMENT_FROM_EVIDENCE, ARGUMENT_FROM_EXPERT_OPINION, ARGUMENT_FROM_PRECEDENT | Beliefs |
| **Reasoning** | ARGUMENT_FROM_CONSEQUENCES, ARGUMENT_FROM_ANALOGY, PRACTICAL_REASONING, ARGUMENT_FROM_DEFINITION | Intentions, Desires |
| **Value** | ARGUMENT_FROM_VALUES, ARGUMENT_FROM_FAIRNESS | Desires |
| **Meta-Argumentative** | ARGUMENT_FROM_IGNORANCE, SLIPPERY_SLOPE, ARGUMENT_FROM_RISK, ARGUMENT_FROM_METAPHOR | Mixed |

Each scheme has four critical questions that identify the conditions under which the argument fails. For example, ARGUMENT_FROM_ANALOGY is challenged by: (1) Are the compared cases genuinely similar? (2) Are there important differences? (3) Is the analogy illuminating or substituting for evidence? (4) Does the analogy break down at the conclusion? The 13th scheme, ARGUMENT_FROM_METAPHOR, is challenged by: (1) Does the metaphor illuminate or substitute for evidence? (2) What aspects of the source domain don't map to the target? (3) Does the metaphor smuggle in unstated assumptions? (4) Is there a competing metaphor that leads to opposite conclusions?

The system uses scheme classification in three ways:

1. **Extraction.** Both claim extraction prompts classify `argumentation_scheme` on each relationship, producing machine-readable scheme labels in the argument network.

2. **Moderator steering.** The cross-respond selection prompt receives the most recent argument's scheme and its critical questions, enabling the moderator to direct debaters toward specific vulnerabilities: "Consider directing a debater to challenge this ARGUMENT_FROM_ANALOGY on CQ2 (important differences that prevent transfer)."

3. **Synthesis.** The argument map includes `argumentation_scheme` and `critical_question_addressed` (integer, 1-4) on each attack, making the synthesis machine-readable: "C7 challenges C3's analogy by raising CQ2."

This integration makes the debate system scheme-aware at every stage — extraction, steering, and synthesis — without requiring formal scheme ontology reasoning.

### 6.7.1 Domain Vocabulary Injection

Extraction prompts include a curated 35-term domain vocabulary derived from automated mismatch analysis. The vocabulary was constructed by analyzing 93 debate transcripts (3,855 extraction mismatches across 455 unique concepts) to identify terms where the LLM's general-purpose understanding diverges from the project's domain-specific usage. For example, "alignment" in AI safety discourse refers specifically to the technical problem of ensuring AI systems pursue intended objectives, not to the general sense of agreement or coordination. Each vocabulary entry provides the term, its domain-specific definition, and a disambiguation note distinguishing it from common usage. The vocabulary is injected into the extraction system prompt as a reference block, reducing terminology-driven extraction errors without increasing per-claim prompt length.

### 6.8 Metaphor Reframing

Multi-agent debates can fall into convergence stalls — extended exchanges where agents recycle the same arguments without generating new insight. Research in conceptual metaphor theory (Lakoff and Johnson, 1980) and analogical reasoning (Gentner and Markman, 1997) suggests that introducing a novel conceptual frame can break such stalls by restructuring how agents reason about the topic.

I implement a two-level metaphor reframing mechanism:

**Level 1: Curated metaphor library.** Eight domain-specific metaphors are curated, each offering a distinct conceptual frame for AI policy discourse:

| Metaphor | Frame | What it highlights |
|----------|-------|--------------------|
| AI as Infrastructure | Public utility / shared resource | Governance parallels with electricity, roads, telecommunications |
| AI as Ecosystem | Biological system with niches and predators | Emergence, adaptation, unintended consequences |
| AI as Mirror | Reflection of human biases and assumptions | Whose values are encoded, whose are invisible |
| AI as Apprentice | Learner requiring mentorship and boundaries | Human responsibility, gradual trust-building |
| AI as Weapon | Dual-use technology with offensive potential | Arms race dynamics, proliferation risks |
| AI as Language | New communication medium | Literacy requirements, cultural impact, translation gaps |
| AI as Territory | Contested space requiring governance | Sovereignty, colonization, indigenous displacement |
| AI as Experiment | Ongoing trial with uncertain outcomes | Informed consent, reversibility, control groups |

**Level 2: Stall detection and injection.** The moderator tracks argument diversity across recent turns. When it detects a convergence stall (repeated schemes, diminishing novelty), it selects a metaphor relevant to the current debate topic and injects it as a reframing prompt: "Consider this debate through the lens of [metaphor]: [description]. How does this reframing change the analysis?" The selected metaphor is recorded in the debate diagnostics as a `metaphor_reframe` entry, enabling post-hoc analysis of which metaphors produce the most productive reframings.

Arguments produced through metaphor reframing are classified under the ARGUMENT_FROM_METAPHOR scheme, with the four critical questions guiding subsequent challenges. This ensures metaphorical arguments receive the same analytical treatment as other argument types.

#### 6C. Safety, Robustness, and Failure Mode Interventions

### 6.9 Persona-Free Neutral Evaluator

A structural risk in multi-agent debate is *persona contamination*: the evaluator inherits framing from the agents it judges. If synthesis knows that "Prometheus" represents accelerationism, it may unconsciously weigh arguments through that lens rather than assessing reasoning quality neutrally.

I introduce a persona-free neutral evaluator that reads the debate transcript with all persona labels stripped. Speaker names are replaced with randomized neutral labels (Speaker A/B/C, shuffled per debate to prevent positional bias). The evaluator receives no POV taxonomy, no personality descriptions, and no framing about which perspectives the speakers represent.

The evaluator runs at three checkpoints: **baseline** (after opening statements — establishes the initial neutral reading), **midpoint** (after round 3 or the debate midpoint — detects whether the debate is engaging cruxes or drifting), and **final** (parallel with synthesis — produces the definitive neutral verdict). Each checkpoint is independent — no memory of prior checkpoints.

At each checkpoint, the evaluator produces:

1. **Cruxes** — core disagreements that, if resolved, would change conclusions, classified by disagreement type (empirical/values/definitional) and status (addressed/partially_addressed/unaddressed)
2. **Claim assessments** — per-claim neutral verdict (well_supported, plausible_but_underdefended, contested_unresolved, refuted, or off_topic) with confidence level and reasoning
3. **Overall assessment** — whether the debate is engaging real disagreement vs. performing disagreement, plus the single strongest unaddressed claim

The highest-value output is the **divergence view**: programmatic comparison of the final neutral evaluation against the persona synthesis. This surfaces cases where the synthesis marked a claim as resolved but the evaluator marked it contested, cruxes the evaluator flagged that the synthesis omitted, or status mismatches where synthesis says "agreed" but the evaluator says "unaddressed." These divergences indicate where persona framing may have biased the synthesis.

Critically, the neutral evaluator never influences the debate: it does not affect moderator selection, debater prompts, or synthesis output. It operates as a parallel assessment channel — users see both views and draw their own conclusions from any divergence.

### 6.10 LLM Failure Mode Interventions

LLM debate agents exhibit failure modes qualitatively different from human debaters. Human debaters may argue in bad faith, but they do not hallucinate evidence, fabricate opponent positions while sincerely attempting to steelman, or unconsciously drift toward their opponent's position through token-level accommodation. Five targeted interventions address these LLM-specific failures. All are non-blocking — failure in any intervention never aborts the debate — and all degrade gracefully when required capabilities are unavailable.

**1. Unanswered Claims Ledger.** The 8-entry context compression window is tactical: claims from early rounds disappear from the moderator's view. The moderator can only prioritize what it can see. The unanswered claims ledger tracks all claims with `base_strength > 0.4` persistently across the debate. After each claim extraction, `updateUnansweredLedger()` marks claims as addressed when edges target them. Every 3 rounds, `formatUnansweredClaimsHint()` surfaces the oldest unanswered claim in the moderator's context, ensuring that strong early claims cannot be silently abandoned.

**2. Inline Empirical Claim Verification.** LLMs hallucinate evidence — fabricating statistics, misattributing studies, or inventing institutional positions. After claim extraction, Belief claims with `specificity: 'precise'` (containing specific numbers, dates, or named entities) are auto-fact-checked via web search — Gemini backends use the native `google_search` tool, while non-Gemini backends use Tavily search (Tavily is a web search API optimized for LLM consumption, used as fallback when Gemini's native search tool is unavailable), extending empirical verification to all configured backends rather than restricting it to Gemini-only deployments. Results are stored on the argument network node as `verification_status` (verified/disputed/unverifiable) and `verification_evidence`. Disputed claims inject a `[Fact-check]` system entry before the next turn. A cap of 2 verifications per turn bounds API cost. When web search is unavailable (CLI adapter), verification silently skips.

**3. Steelman Validation.** The steelman instruction ("present the strongest version of the opponent's position") is one of the most important debate prompts, but LLMs frequently fabricate plausible-sounding positions that no opponent actually holds. Claim extraction now outputs `steelman_of` (opponent name or null). When a steelman is detected, NLI cross-encoder comparison against the opponent's actual committed assertions (up to 10 most recent) checks whether the steelman entails what the opponent actually said. If max entailment falls below 0.6, a `[Steelman check]` system entry surfaces the opponent's actual top-3 assertions. When NLI is unavailable, validation silently skips.

**4. Position Drift Detection (Sycophancy Guard).** LLMs exhibit sycophantic accommodation — gradually shifting toward an interlocutor's position without explicit concession or argued agreement. The primary detection mechanism uses per-claim decomposition rather than holistic embedding comparison. After opening statements, each speaker's initial claims are extracted and cached. After each cross-respond, the current response's claims are compared against the speaker's opening claims, and each claim is classified into one of three bins: *maintained* (similarity ≥ 0.7 — the claim persists substantially unchanged), *refined* (similarity 0.3–0.7 — the claim has evolved but remains recognizable), or *abandoned* (similarity < 0.3 — the claim has been dropped or contradicted). Explicit concessions identified in the commitment store are exempt from the abandonment count, since argued concession is legitimate position evolution, not sycophancy. If more than 50% of opening claims are abandoned without corresponding concessions over 3+ turns, a `[Sycophancy guard]` system entry flags the drift. When the embedding adapter is unavailable, the system falls back to holistic embedding comparison: the current response embedding is compared against the speaker's own opening (`self_similarity`) and each opponent's opening (`opponent_similarities`), with monotonic decrease in self-similarity and monotonic increase in opponent similarity over 3+ turns triggering the guard. When neither embedding mechanism is available, drift tracking silently skips.

**5. Missing Arguments Pass.** Multi-agent debates converge on the arguments that happen to be raised, with no record of what was never said. Post-synthesis, a fresh LLM (receiving no transcript context) is given only the debate topic, a compact taxonomy summary (node labels + BDI categories), and the synthesis text. It identifies 3-5 strongest arguments on any side that were never raised during the debate, with BDI layer classification and explanation of why each argument is strong. This surfaces structural gaps in the debate's coverage.

**6. Doctrinal Boundaries.** While the sycophancy guard (intervention 4) detects drift reactively, doctrinal boundaries provide a proactive structural constraint against identity erosion. Each debate character defines 4 rejection constraints — core doctrinal positions that the agent may not concede under any circumstances. For example, Sentinel (safetyist) holds "existential risk from advanced AI is a legitimate concern that warrants precautionary action" as a doctrinal boundary: it can concede any specific argument about timelines, mechanisms, or governance structures, but it cannot concede that existential risk is not worth worrying about. These boundaries are injected into all in-character prompts (PLAN, DRAFT, and reflections), framed as "You may concede any specific argument, but you must not abandon these core positions." This ensures that genuine concession on specific points — which is epistemically valuable — is distinguished from wholesale identity erosion, which would reduce the debate to a single perspective.

The graceful degradation architecture is deliberate: the CLI engine's `AIAdapter` exposes only `generateText`, while the UI's bridge API provides `generateTextWithSearch`, `nliClassify`, and `computeQueryEmbedding` as optional extensions via the `ExtendedAIAdapter` interface. Each intervention checks for capability availability before executing and silently skips if unavailable. This means the full intervention suite runs in the Taxonomy Editor UI (which has access to all APIs) while the CLI engine gets a reduced set (unanswered claims ledger and missing arguments pass only), with no code path changes required.

### 6.11 Disagreement Typing

Each disagreement is classified into one of three types that map to BDI layers:

| Type | BDI Layer | Resolvability | Example |
|------|-----------|--------------|---------|
| EMPIRICAL | Belief divergence | Resolvable by evidence | "Does scaling eliminate bias?" |
| VALUES | Desire divergence | Negotiable via tradeoffs | "Is speed or safety more important?" |
| DEFINITIONAL | Conceptual divergence | Requires term clarification | "What counts as 'alignment'?" |

This classification determines the appropriate resolution strategy: empirical disagreements call for evidence gathering, values disagreements call for tradeoff analysis, and definitional disagreements call for term disambiguation before substantive debate can proceed.

#### 6D. Convergence Diagnostics and Phase Management

### 6.12 Convergence Diagnostics

Assessing whether a multi-agent debate is progressing toward genuine understanding — rather than cycling through repetitive exchanges — requires quantitative signals. I define seven per-turn convergence diagnostics, all computed deterministically from the argument network with no LLM calls. This purely symbolic computation ensures that convergence assessment is reproducible, auditable, and independent of the neural components that generate debate content.

1. **Move Disposition** — the ratio of confrontational moves (COUNTEREXAMPLE, EMPIRICAL CHALLENGE, UNDERCUT, REFRAME, BURDEN-SHIFT) to collaborative moves (EXTEND, INTEGRATE, CONCEDE-AND-PIVOT) across recent turns. A debate that remains purely confrontational after round 5 is likely stuck in positional warfare; one that shifts toward collaborative moves signals genuine engagement.

2. **Engagement Depth** — the fraction of the speaker's taxonomy nodes that have edges connecting to nodes from other POVs in the argument network. A speaker who cites many nodes but whose nodes have no cross-POV edges is talking past opponents rather than engaging. Computed as: |nodes with external edges| / |total cited nodes|.

3. **Recycling Rate** — word overlap between the current turn and prior same-speaker turns, measured via tokenized intersection over union. High recycling (>0.6) indicates the speaker has exhausted novel arguments and is paraphrasing prior content.

4. **Strongest Opposing Argument** — the QBAF computed strength (via DF-QuAD) of the strongest attack edge targeting the speaker's nodes. This surfaces the single most threatening counterargument the speaker faces, enabling the moderator to direct engagement toward it.

5. **Concession Opportunity** — the ratio of strong attacks faced (QBAF strength > 0.5) to concession moves made. A speaker who faces multiple strong attacks but never concedes may be exhibiting rhetorical rigidity; one who concedes more than they are attacked may be sycophantic. The diagnostic flags both extremes.

6. **Position Delta** — word overlap drift between the speaker's opening statement and their most recent turn. Gradual drift without explicit concession signals sycophantic accommodation (cross-referenced with the Position Drift Detection intervention in Section 6.10). Sharp shifts coinciding with explicit concessions signal genuine position evolution.

7. **Crux Rate** — the frequency of IDENTIFY-CRUX moves and whether identified cruxes are followed up in subsequent turns. An identified crux that receives no engagement in the following two turns indicates a missed opportunity for convergence.

These seven signals are displayed together in the diagnostics panel as a per-turn convergence dashboard. Because all signals are computed from the argument network's graph structure and node metadata (QBAF strengths, edge types, move classifications), they are fully deterministic — running the same computation on the same argument network always produces identical results. This makes convergence assessment debuggable: if a diagnostic flags an anomaly, the underlying graph data can be inspected directly.

**Process reward scores.** In addition to the seven convergence diagnostics, each turn receives a continuous process reward score that composes five dimensions: *engagement* (whether the turn responds to the specific claim it was directed to address), *novelty* (inverse of recycling against prior same-speaker turns), *consistency* (alignment with the speaker's commitment store), *grounding* (proportion of claims tied to taxonomy nodes or cited evidence), and *move quality* (appropriateness of the selected dialectical move given the current phase and argument network state). The composite score provides a per-step quality signal analogous to process reward models (Lightman et al., 2023), enabling fine-grained identification of where debate quality degrades — at the individual turn level rather than only at the debate level. Unlike outcome reward (which evaluates only the final synthesis), process reward scores identify *which turns* contributed to or detracted from convergence, informing both real-time moderator steering and post-hoc analysis of debate dynamics.

### 6.23 Adaptive Phase Transitions

Prior multi-agent debate systems advance through fixed round counts or simple heuristics — "explore for five rounds, then synthesize." This design conflates debate pacing with debate progress: a debate that converges quickly wastes rounds in exploration, while one that uncovers deep cruxes is forced into synthesis before those cruxes are resolved. The adaptive phase transition subsystem replaces fixed round counts with deterministic signal composites that detect when the debate has genuinely exhausted a phase's epistemic purpose, providing another instance of the neural-symbolic architecture: all transition signals are computed symbolically from the argument network and discourse features, while the content generated within each phase remains neural.

The debate proceeds through three phases — thesis-antithesis, exploration, and synthesis — with transitions governed by composite scores that aggregate weighted signals from the argument network and discourse patterns. The exploration exit decision is driven by a saturation score comprising six weighted components: recycling pressure (weight 0.30), which measures the rate at which agents reintroduce previously stated positions; crux maturity (0.25), which tracks whether identified cruxes have received substantive engagement from all parties; concession plateau (0.15), which detects stalling in the rate of new concessions; engagement fatigue (0.15), which monitors declining depth of argumentative engagement across successive turns; pragmatic convergence (0.05), which captures lexical signals of emerging agreement; and scheme stagnation (0.10), which detects contraction in the repertoire of argumentation schemes being deployed. When this composite exceeds the exploration exit threshold (default 0.65), the transition to synthesis fires. Scheme stagnation deserves particular note: it operationalizes the intuition that a debate whose agents have narrowed to only one or two argumentation schemes from the 13-scheme taxonomy (Section 6.7) — for example, cycling between ARGUMENT_FROM_EVIDENCE and ARGUMENT_FROM_CONSEQUENCES — has exhausted its exploratory potential regardless of what the other signals indicate. Stagnation is measured using a 40/60 weighted combination of unigram (individual scheme) and bigram (scheme-pair transition) entropy over a sliding window, which catches not only simple repertoire contraction but also combinatorial stagnation where agents alternate between the same two schemes in a fixed pattern.

The synthesis exit decision relies on a convergence score built from four weighted components: QBAF agreement density (0.35), measuring the proportion of argument pairs whose computed strengths have stabilized within a narrow band; position stability (0.25), tracking whether agents' committed positions have stopped shifting between turns; irreducible disagreement ratio (0.25), estimating the fraction of remaining disagreements that reflect genuine value differences rather than resolvable empirical disputes; and a synthesis pragmatic signal (0.15), capturing lexical markers of integrative language and joint commitment. The default convergence threshold is 0.70.

Pragmatic signals — the lexical components feeding both composite scores — are computed through pure deterministic analysis of the discourse surface. Hedge-to-assertive ratios track the balance of tentative versus committed language. Concessive plateau detection measures the rate of concessive markers (acknowledging, granting, accepting) over a sliding window to identify stalling. Meta-discourse crux markers detect when agents explicitly label a disagreement as fundamental. Synthesis integration language identifies phrases characteristic of position reconciliation. All lexicon matching uses word-boundary regex patterns with a 4-token negation window to filter false positives: when a negation token (e.g., "don't," "not," "never") appears within 4 tokens preceding a lexicon match, the match is suppressed. This prevents phrases like "I don't concede" from triggering the concessive lexicon. A small set of negation-bearing phrases (e.g., "not necessarily," "not entirely") are marked as immune to the filter, since they function as hedges rather than negations in discourse context. These signals require no LLM inference; they operate on token-level pattern matching against curated lexicons, ensuring full reproducibility.

A three-layer confidence gating mechanism prevents spurious transitions caused by noisy or insufficient data. The first layer assesses extraction confidence — whether the underlying signals have been computed from enough turns to be meaningful. The second layer assesses stability confidence — whether the composite score has remained above threshold long enough to distinguish a genuine trend from a transient spike. The third layer assesses global confidence — a floor (default 0.40) below which transitions are deferred regardless of the composite score, protecting against early-debate transitions when the argument network is too sparse to support reliable signal computation. To prevent indefinite deferral, an escalation mechanism activates after 3 consecutive deferrals: the confidence floor drops by 0.10 per subsequent deferral (minimum 0.20), progressively relaxing the gate when the debate consistently signals readiness but the floor blocks transition. Force-exits (triggered by the hard node cap or maximum round bounds) bypass confidence gating unconditionally. Only when all three layers agree does the transition fire.

Pacing presets — tight, moderate, and thorough — configure minimum and maximum round bounds for each phase, providing guardrails that prevent degenerate behavior at both extremes. Even when the saturation score crosses threshold, the minimum bound ensures that each phase receives enough rounds to establish its epistemic function. Conversely, the maximum bound forces a transition when signals fail to trigger naturally, preventing indefinite stalling. The system permits up to two regressions from synthesis back to exploration when a synthesis attempt reveals unresolved cruxes, with threshold ratcheting on each regression: the re-entry threshold increases by a fixed increment, requiring stronger evidence of renewed exploration potential with each successive regression, preventing oscillation.

As the argument network grows during extended debates, a network garbage collection mechanism prunes low-value nodes to maintain computational tractability. When the argument network exceeds 175 nodes, the garbage collector activates in three priority tiers: first removing orphan nodes (those with no attack or support edges), then pruning tangential leaf nodes whose computed strength falls below 0.3, and finally removing low-engagement nodes with strength below 0.4. The target is to reduce the network to approximately 150 nodes. A hard cap at 200 nodes forces an immediate transition to synthesis regardless of the composite score, ensuring that the argument network never grows beyond the point where QBAF propagation and convergence diagnostics become computationally expensive or conceptually unwieldy.

All weights, thresholds, and pacing parameters described in this section are externalized in a configuration file (`provisional-weights.json`) rather than embedded in source code. This separation permits empirical tuning — adjusting the relative importance of recycling pressure versus crux maturity, or tightening the confidence floor for shorter debates — without modifying the transition logic itself. The implementation spans five modules: `phaseTransitions.ts` orchestrates the overall transition logic, `pragmaticSignals.ts` computes the lexicon-based discourse features, `schemeStagnation.ts` monitors argumentation scheme diversity, `signalConfidence.ts` implements the three-layer confidence gate, and `networkGc.ts` manages argument network pruning.

#### 6E. Post-Debate Analysis and Taxonomy Evolution

### 6.13 Dialectic Traces

When a debate concludes with a synthesis that identifies prevailing arguments and preference resolutions, a natural question arises: *why* did a particular position prevail? Dialectic traces answer this question through purely symbolic computation — deterministic BFS (breadth-first search) graph traversal through the argument network — producing human-readable narrative chains that explain outcomes without any AI calls.

**Algorithm.** The trace computation proceeds in six steps:

1. **Find relevant AN nodes** — starting from a synthesis preference (e.g., "the safetyist position on governance prevailed"), identify the argument network nodes that correspond to the prevailing and defeated positions.
2. **Expand subgraph** — extract the connected subgraph containing all nodes reachable from the starting nodes within 3 hops, including all attack and support edges.
3. **Sort by QBAF strength** — order nodes in the subgraph by their DF-QuAD computed strength, establishing the strength hierarchy.
4. **BFS traversal** — perform breadth-first search from the prevailing node, following attack and support edges. Each traversal step records: the source node, the edge type (attack/support), the target node, and both nodes' computed strengths.
5. **Action classification** — each traversal step is classified into a narrative action: "X attacked Y on [edge type], reducing Y's strength from [pre] to [post]" or "X supported Y, increasing Y's strength."
6. **Narrative ordering and capping** — steps are ordered chronologically (by debate round) and capped at 12 steps maximum to produce a readable narrative rather than an exhaustive graph dump.

**Output.** The trace produces a structured narrative such as: "The safetyist governance position (strength 0.78) prevailed because: (1) it was supported by the IAEA analogy argument (strength 0.72, round 2), (2) the accelerationist speed objection (strength 0.45) was undercut by the skeptic's regulatory precedent argument (strength 0.61, round 4), and (3) the accelerationist's strongest remaining attack (innovation bottleneck, strength 0.38) was never addressed but was outweighed by the accumulation of support edges."

Because the entire computation is deterministic — BFS traversal, QBAF strength lookup, edge classification — dialectic traces are fully reproducible and auditable. A researcher who disagrees with a trace can inspect the underlying graph, verify the QBAF strengths, and trace the BFS path step by step. This level of explainability is a direct consequence of the neural-symbolic architecture: the neural components generated the debate content, but the symbolic components explain the outcome.

### 6.14 Reflections

After debate synthesis, a post-debate meta-cognitive pass gives each debater access to the full argument network, commitment store, and convergence signals, then asks: "Given everything that happened in this debate, what changes — if any — should be made to the taxonomy?" This reflections mechanism closes the loop between debate output and taxonomy evolution more systematically than concession harvesting alone.

Each reflection produces a set of proposed taxonomy edits, each classified by type and accompanied by evidence:

| Edit Type | Description | Example |
|-----------|-------------|---------|
| **revise** | Modify an existing node's description or scope | "acc-B-042 should acknowledge the regulatory precedent evidence raised in round 4" |
| **add** | Propose a new taxonomy node | "A safetyist Intention node for 'graduated deployment frameworks' is missing from the taxonomy" |
| **qualify** | Add a caveat or boundary condition to an existing node | "saf-D-015 should note that the IAEA analogy breaks down for dual-use commercial AI" |
| **deprecate** | Flag a node as no longer defensible | "acc-B-071's claim about unregulated markets producing safety has been refuted across 3 debates" |

Each proposed edit carries a **confidence level** (high/medium/low) based on the strength of evidence from the debate, and references specific debate entries (by round and speaker) as supporting evidence. Proposed edits must match the taxonomy's existing tone and abstraction level — a reflection that proposes adding a colloquial or overly specific node is flagged for revision.

Critically, all proposed edits require **human review** before any taxonomy changes are made. The reflections mechanism surfaces candidates for evolution; it does not automate evolution. This design reflects the principle that taxonomy curation — deciding what the canonical representation of a discourse should include — is a human judgment that should be informed by debate outcomes, not delegated to them.

### 6.20 Taxonomy Gap Diagnostics

Context injection instrumentation (Section 3.4) tracks which injected nodes the model referenced in each turn, but it does not aggregate this data into a structural coverage analysis. Taxonomy gap diagnostics computes a comprehensive per-debate coverage report answering: "Where are the holes in each POV's taxonomy?"

The analysis proceeds in three phases. The first two are entirely deterministic; the third is an optional LLM call.

**Phase 1 (deterministic): Per-POV coverage.** For each POV, the analysis aggregates context injection manifests across all turns: total taxonomy nodes, nodes injected at least once, nodes actually referenced in responses, and the utilization rate (referenced / injected). Primary nodes (starred as most relevant) that were never cited despite being injected are flagged as `unreferenced_relevant` — the taxonomy considers them important to this topic, but the agent found them unnecessary. Coverage is broken down by BDI category to reveal whether a POV's beliefs, desires, or intentions are disproportionately underutilized.

**Phase 2 (deterministic): BDI balance and unmapped arguments.** For each POV, the analysis counts taxonomy nodes per BDI category, debate citations per BDI category, and argument network nodes per BDI category, then identifies the weakest category. Separately, argument network nodes that do not match any taxonomy node (embedding cosine similarity below 0.4 to all nodes, when embeddings are available) are flagged as unmapped arguments — novel positions that emerged during the debate and have no corresponding taxonomy entry. Each unmapped argument is classified as `novel_argument` (genuinely new), `cross_cutting` (spans POV boundaries), or `refinement_needed` (close to an existing node but more specific).

**Phase 3 (optional LLM): Cross-POV gap identification.** The synthesis disagreements and BDI balance data are sent to an LLM, which identifies structural gaps that prevented deeper engagement between perspectives. This phase can be disabled for purely deterministic analysis.

The output — stored as `taxonomy_gap_analysis` on the debate session — provides a summary banner (overall coverage percentage, most underserved POV and BDI category, unmapped argument count, cross-POV gap count) alongside detailed per-POV breakdowns. This data enables empirical answers to questions previously resolved by intuition: "Should this POV add more Intention nodes?" "Are accelerationist Beliefs underrepresented in debates about governance?"

### 6.21 Evaluation (E3)

[RESULTS PENDING]

**Methodology.** I will conduct an A/B test comparing BDI-structured context injection against flat context injection. 20 debates will be generated on the same 10 topics: 10 with BDI-structured taxonomy context (nodes grouped by Beliefs/Desires/Intentions with framing headers, ★-tiered by relevance) and 10 with flat context (same nodes presented as an unstructured list without BDI grouping or relevance tiering).

Three human evaluators will rate each debate on four dimensions using a 5-point Likert scale:
1. **Argument quality:** Are claims well-structured (claim + evidence + warrant)?
2. **Taxonomy grounding:** Do agents reference taxonomy nodes appropriately and accurately?
3. **Disagreement identification:** Do agents correctly identify the type of their disagreements (empirical vs. values vs. definitional)?
4. **Perspective-taking:** Do agents engage with opposing viewpoints rather than talking past each other?

Inter-rater reliability will be measured via Krippendorff's alpha. Statistical significance will be assessed via paired t-test or Wilcoxon signed-rank test.

**Expected results.** I expect BDI-structured context to produce significantly higher scores on disagreement identification (agents taught the BDI framework should classify disagreements more accurately) and perspective-taking (agents seeing opposing interpretations via situation nodes should engage more directly). I expect modest improvement on argument quality (BDI framing encourages structured reasoning) and taxonomy grounding (★-tiering directs attention to relevant nodes).

### 6.21.1 Evaluation (E9): Embedding Field Ablation

Controlled comparison of multi-field embedding configurations on 778 taxonomy nodes. Three conditions: current weights (description 0.55, assumes 0.35, lineage 0.10), no-lineage (0.611, 0.389, 0, 0, 0), and single-pass concatenation. Metrics: intra-cluster coherence, inter-cluster separation, MRR on 50 edge pairs.

**Results.** Lineage degrades separation by 9.4% with no retrieval benefit; assumes provides 14% MRR boost; concatenation degrades retrieval by 26%.

**Conclusion.** Intellectual lineage categories are too coarse for embedding enrichment, but underlying assumptions create valuable semantic bridges. The optimal weights (description 0.611, assumes 0.389) reflect the finding that the `assumes` field captures inferential structure — the reasoning beneath each claim — that produces more discriminative embeddings than surface-level description alone. Naive concatenation fails because it dilutes the high-signal fields with low-signal metadata, producing embeddings that cluster by surface topic rather than argumentative content.

### 6.21.2 Evaluation (E10): Embedding Model Comparison

Evaluation of four sentence-transformer models (all-MiniLM-L6-v2, all-MiniLM-L12-v2, bge-small-en-v1.5, gte-small) on taxonomy retrieval. All produce 384-dim vectors.

**Results.** The current model (all-MiniLM-L6-v2, 2021) outperforms all newer alternatives — bge-small degrades MRR by 32%, gte-small by 37%.

**Cause.** Newer models optimized for general retrieval produce concentrated embedding spaces that lose discriminative power on short, homogeneous academic argument texts. The general retrieval models suffer from hubness problems — a small number of "hub" vectors attract disproportionate similarity mass, degrading discrimination in the high-density node space characteristic of a policy taxonomy where many nodes address overlapping themes.

**Conclusion.** MTEB benchmark rankings do not transfer to domain-specific pairwise comparison tasks. Model selection for specialized retrieval should be validated empirically on the target distribution rather than inherited from general-purpose leaderboards.

#### 6F. Context Management and Specialized Features

### 6.15 Audience Targeting

Debates can be tailored to specific audiences: policymakers, technical researchers, industry leaders, academic community, or general public. Per-audience directives shape tone, evidence expectations, and argumentation style. For example, policymaker-targeted debates emphasize actionable recommendations and regulatory precedent, while technical researcher-targeted debates emphasize methodological rigor and empirical evidence standards. Audience targeting is specified at debate initialization and propagated to all stage prompts (BRIEF, PLAN, DRAFT, CITE) as a contextual directive.

### 6.16 Coverage Tracking

For document-sourced debates — where the debate topic originates from a specific source document — the system tracks which source claims were actually discussed during the debate. Coverage is computed via a combination of embedding-based similarity (cosine similarity between source claims and debate content using all-MiniLM-L6-v2) and text-overlap matching (tokenized intersection). Each source claim receives a tri-state classification: **covered** (directly discussed with substantive engagement), **partially_covered** (mentioned or tangentially addressed), or **uncovered** (not discussed). A strength-weighted variant weights each source claim by its QBAF computed_strength, so claims that proved pivotal in the argument network contribute more to the coverage metric than peripheral claims. Probing questions generated by the moderator are prioritized by this strength-weighted score, directing moderator attention toward the most argumentatively consequential uncovered claims. Coverage reports surface structural gaps in debate engagement, enabling follow-up debates that target uncovered claims.

### 6.17 IRAC/CRAC Legal Argument Structure

To improve the rigor of policy argumentation, debate instructions incorporate the CRAC (Conclusion-Rule-Application-Conclusion) legal argument structure. Debaters are prompted to structure key arguments as: (1) state the conclusion, (2) identify the governing rule or principle, (3) apply the rule to the specific facts at hand, and (4) restate the conclusion with the application's support. This structure is particularly effective for policy debates where regulatory frameworks, precedent, and institutional design are contested.

A complementary counter-tactics block equips debaters with awareness of six common argumentative maneuvers that can undermine debate quality: **burden shift** (improperly placing the burden of proof on the opponent), **fact reframing** (recharacterizing established facts to support a different conclusion), **premise stacking** (accumulating weak premises to create an illusion of strong support), **conclusion-as-finding** (presenting a desired conclusion as if it were an established finding), **point flooding** (overwhelming opponents with volume rather than quality), and **unverified authority** (citing unnamed experts or institutions without specific references). Debaters are instructed to identify and call out these tactics when encountered, improving the overall epistemic quality of the exchange.

### 6.18 Mid-Debate Gap Injection

The Missing Arguments Pass (Section 6.10, intervention 5) identifies strong unmade arguments, but only runs post-synthesis — after the debate is over. Mid-debate gap injection moves this analysis to the debate midpoint, where surfaced arguments can still influence the exchange.

After the round just past midpoint (configurable; default: `ceil(totalRounds/2) + 1`), an unaligned LLM — carrying no persona, no taxonomy context, and no POV assignment — receives the transcript so far, a compact taxonomy summary (node labels and BDI categories), and the list of arguments already extracted. It identifies 1-2 strong arguments that none of the debaters have made and that their assigned perspectives would be unlikely to make. Each surfaced argument is classified by gap type:

| Gap Type | Description |
|----------|-------------|
| `cross_cutting` | Argument that cuts across POV boundaries, requiring engagement from multiple perspectives |
| `compromise` | A position that partially satisfies multiple POVs but that no single POV would originate |
| `blind_spot` | An argument within a POV's natural territory that its taxonomy fails to cover |
| `unstated_assumption` | A shared premise that all debaters rely on without examining |

The surfaced arguments enter the transcript as system entries. The moderator's cross-respond selection prompt already sees system entries; a steering hint ("System has surfaced gap arguments that no debater has addressed. Consider directing a debater to engage with one.") biases the moderator toward directing engagement. Critically, the receiving agent does not adopt the gap argument — it engages from its own perspective, producing responses classified as `compatible`, `opposed`, `partial`, or `reframed`.

The cost is one additional LLM call per debate at temperature 0.5, adding approximately 30 seconds of latency — negligible relative to the 40+ calls in a standard 5-round debate. The feature can be disabled by setting `gapInjectionRound` to 0.

### 6.19 Cross-Cutting Node Promotion

The 133 situation nodes (Section 3.1) capture shared concepts with per-POV BDI-decomposed interpretations, but they are manually curated and do not grow from debate findings. Cross-cutting node promotion closes this gap by automatically detecting three-way agreements in the synthesis phase and proposing new situation nodes that capture the shared understanding.

After synthesis phase 1 (which produces `areas_of_agreement`), the system filters for agreement points where all three POVs concur. For each such agreement, an LLM determines whether the agreed-upon position maps to an existing situation node or warrants a new one. When a new node is proposed, the LLM generates BDI-decomposed interpretations per POV — recognizing that even when three perspectives agree on a surface conclusion, they may agree for fundamentally different reasons. For example, all three POVs might agree that "AI systems should be reversible," but the accelerationist frames this as a market efficiency requirement (reversibility reduces deployment risk), the safetyist as a safety-critical design constraint (reversibility enables shutdown), and the skeptic as a democratic accountability mechanism (reversibility gives affected communities recourse).

Proposals appear in the harvest dialog alongside taxonomy refinement suggestions, with three actions: create the situation node, map to an existing node, or dismiss. All proposals require human review. The cost is one additional LLM call per debate, at temperature 0.3, and only fires when three-way agreements exist in the synthesis.

### 6.22 Active Moderator Architecture

The system described thus far treats the moderator as a routing oracle: it selects which debater speaks next and on what topic, but it never speaks substantively into the debate. This design is adequate for turn sequencing but fundamentally unlike real-world moderation, where the moderator is often the most consequential voice in the room — not because they argue, but because they shape the conditions under which argumentation happens. The facilitation literature consistently shows that effective moderators operate across a full spectrum, from adversarial pressure ("Senator, yes or no") to supportive facilitation ("That's an important concession; let me make sure everyone heard it"), and that softer moves — acknowledgment, revoicing, encouragement — often do more for discussion quality than forceful content injection alone. A moderator who only challenges produces defensive debaters; one who also acknowledges and revoices produces debaters who take risks, concede when warranted, and build on each other's ideas. The active moderator extends the system with an interventionist moderation layer that spans this full spectrum.

The moderator's design exemplifies the neural-symbolic architecture that governs the turn pipeline (Section 6.2) and turn validation (Section 6.3). A two-stage process separates advisory judgment from authoritative enforcement. Before each round, the engine deterministically pre-computes a trigger evaluation context: the Debate Health Score, trajectory modifiers, per-debater burden, SLI floor breach counts, adaptive persona-aware thresholds, and remaining budget. This context — entirely symbolic, requiring no LLM calls — is packaged and passed to Stage 1, where the LLM recommends whether to intervene, which move to use, and which debater to target. The engine then validates the recommendation against deterministic constraints (budget, cooldown, phase, prerequisites, burden cap, same-debater consecutive rule) before acting. The LLM is advisory; the engine is authoritative. A hallucinated move type, a phase-violating recommendation, or a budget-exceeding suggestion is caught and suppressed, and the round proceeds with no intervention. If validated, a second LLM call (Stage 2) composes the intervention text. This two-stage split ensures that each stage is independently testable and that failures in generation never contaminate selection logic.

The moderator operates with a taxonomy of 14 moves organized into six families: Procedural (REDIRECT, BALANCE, SEQUENCE), Elicitation (PIN, PROBE, CHALLENGE), Repair (CLARIFY, CHECK, SUMMARIZE), Reconciliation (ACKNOWLEDGE, REVOICE), Reflection (META-REFLECT), and Synthesis (COMPRESS, COMMIT). Each move carries an interactional force annotation (directive, interrogative, declarative, or reflective) for diagnostic and analytical purposes. This vocabulary parallels the 15 dialectical moves available to debaters (Section 6.4) but operates at a different level of abstraction: debater moves are argumentative acts within the discourse, while moderator moves are facilitative acts about the discourse. The six families span the full facilitation spectrum from adversarial (Elicitation, burden weight 1.0) through neutral (Procedural, 0.5; Repair, 0.75) to supportive (Reconciliation, 0.25), ensuring that the moderator's repertoire is not restricted to challenging interventions.

The Debate Health Score operationalizes "debate quality" as a deterministic scalar computed from the convergence signals window (Section 6.12). Five weighted components contribute: engagement depth (0.25), novelty measured as inverse recycling rate (0.25), responsiveness measured as concession follow-through rate (0.20), taxonomy coverage (0.15), and turn balance across debaters (0.15). This composite signal drives intervention triggering through trajectory modifiers: consecutive health declines lower the effective intervention threshold (making intervention more likely), while consecutive improvements raise it. Individual component floors (SLI floors) trigger family-specific interventions when a component breaches its minimum for consecutive turns — for example, sustained low novelty triggers elicitation moves, while sustained imbalance triggers procedural correction.

Persona-aware modifiers implement a learn-from-experience loop. Each debater-move pair carries a prior probability reflecting persona-specific expectations — for instance, the accelerationist persona (Prometheus) has elevated priors for PIN and PROBE, reflecting a tendency to resist commitment. These priors decay toward the neutral baseline (1.0) as the moderator actually fires the corresponding move, using exponential decay at rate 0.15 per observed trigger. The effect is that the moderator's expectations converge on observed behavior rather than stereotypes: a debater who responds well to early PINs will face fewer subsequent PINs as the prior decays.

Three prerequisite rules enforce a pragmatic ordering constraint drawn from discourse analysis: supportive moves must create the conditions for productive challenge. First, a concession must be acknowledged (ACKNOWLEDGE) before further pressure is applied. Second, semantic divergence must be repaired (CLARIFY) before elicitation moves can proceed. Third, a detected misunderstanding must be checked (CHECK) before a CHALLENGE is issued. These prerequisites implement the principle that challenge without prior understanding produces defensiveness rather than engagement.

Budget, cooldown, and burden tracking prevent the moderator from dominating the exchange. A per-debate budget (approximately one intervention per 2.5 rounds) caps total interventions. When the budget exhausts, the engine grants a smaller refill equal to the original budget divided by one plus the current epoch, accompanied by a proportionally longer cooldown gap that also scales with the epoch count; successive refills therefore deliver progressively fewer interventions at progressively wider intervals, modeling the natural facilitation pattern in which a moderator front-loads steering and then withdraws. High-value moves — PIN, PROBE, CHALLENGE, REDIRECT, CLARIFY, CHECK, and META-REFLECT — consume only one-third of a budget unit per use, while routine moves consume a full unit, biasing the moderator toward substantive interventions that shape the discourse over procedural ones that merely sequence it. Escalating cooldown — increasing from 1-round to 2-round gaps after two interventions — prevents clustering. Burden tracking accumulates a per-debater load weighted by family (Elicitation at 1.0, Reconciliation at 0.25), and a burden cap prevents any debater from receiving more than 1.5 times the average burden, ensuring equitable targeting. COMMIT interventions, which request final position commitments during synthesis, operate off-budget and are exempt from cooldown, since they serve a structural role tied to phase completion rather than debate steering.

Move responses are subject to hard compliance checking with typed response schemas. When the moderator issues a PIN, the target debater must include a `pin_response` field with a structured position (agree, disagree, or conditional) and reasoning. When the moderator issues a PROBE, the debater must supply typed evidence. This extends the deterministic validation principle from turn validation (Section 6.3, Stage A) to moderator interactions: the debater's response to a moderator intervention is schema-validated, not left to free-form interpretation. Moves that serve supportive or procedural functions (ACKNOWLEDGE, BALANCE, REDIRECT) impose no response format — they shape the discourse context without demanding specific structured output.

Phase gating restricts which move families are available in each debate phase. During thesis-antithesis, only procedural, repair, and reconciliation families are primary, with elicitation available after round 2. Exploration opens the full vocabulary including reflection. Synthesis restricts to synthesis and reconciliation families, with COMMIT available only in this final phase. This is analogous to the constructive move phase-gating for debaters (Section 6.4), where INTEGRATE, IDENTIFY-CRUX, CONDITIONAL-AGREE, and STEEL-BUILD are injected only during exploration and synthesis.

For document-grounded debates, the moderator performs semantic drift detection to address a failure mode specific to LLM-mediated argumentation: models readily spiral into implementation details or literalize metaphors in ways human debaters would not. Three drift patterns are monitored. Metaphor literalization occurs when a figurative term introduced for rhetorical effect is subsequently treated as a literal technical concept — for example, when a metaphor like "alignment tax" is discussed as though it names a specific fiscal instrument — and triggers a CLARIFY intervention that resurfaces the original figurative intent. Implementation spiral detects a shift from policy-level reasoning into engineering specifics, as when a debate about governance frameworks drifts into API design or deployment tooling, and triggers a REDIRECT to restore the appropriate level of abstraction. Scope creep identifies the introduction of external frameworks, taxonomies, or theoretical constructs that have no basis in the source documents and triggers a CHECK that asks the introducing agent to ground the claim in the available evidence. To anchor these checks, a structured summary of the source document is injected into both the move-selection and intervention-generation prompts, giving the moderator a stable reference point against which to measure semantic displacement.

## 7. Cross-POV Conflict Detection and Resolution

### 7.1 From Binary Matching to QBAF-Augmented Analysis

Early conflict detection used binary text matching: two claims are in conflict if they make contradictory assertions about the same topic. This approach produces high recall but low precision — superficially contradictory claims may actually address different aspects of the same topic, or the apparent contradiction may dissolve when the claims are understood in their BDI context.

QBAF-augmented conflict analysis adds formal argument strength to conflict instances. Instead of binary "these claims conflict," the system reports: these claims conflict, here are the attack/support relationships in the surrounding argument network, and here are the computed strengths after propagation. A conflict between a strong, well-supported claim (computed_strength 0.85) and a weak, isolated claim (computed_strength 0.3) is qualitatively different from a conflict between two equally supported positions — the former is likely resolvable by evidence, the latter represents a genuine crux.

### 7.2 Situation Nodes as Perspectival Anchors

DOLCE D&S situation nodes serve as shared reference points for cross-POV analysis. When two POVs interpret the same situation node differently, the `disagreement_type` classification (definitional, interpretive, or structural) identifies the nature of the divergence:

- **Definitional:** POVs define the key concept differently (e.g., "alignment" means different things to accelerationists and safetyists)
- **Interpretive:** POVs agree on the concept but disagree on its significance or implications
- **Structural:** POVs frame the concept within different causal or normative structures

This classification guides resolution strategy: definitional disagreements require term disambiguation, interpretive disagreements require evidence weighing, and structural disagreements require framework comparison.

### 7.3 Steelman Vulnerability and Fallacy Detection

Each taxonomy node carries optional `steelman_vulnerability` — the strongest counterargument to that position, expressed as a per-POV object describing how each opposing perspective would most effectively challenge it. This forces the system to represent positions at their strongest (steelmanning) before identifying weaknesses.

Fallacy detection classifies potential reasoning errors into four tiers: formal (logically invalid inference), informal_structural (argument scheme misapplication), informal_contextual (context-dependent error), and cognitive_bias (systematic reasoning distortion). Each detected fallacy includes a confidence level (likely/possible/borderline) and an explanation grounded in the specific node content, not generic critique.

## 8. Discussion

### 8.1 Vocabulary Over Formalism

A recurring design decision throughout this system is the adoption of ontological *vocabulary* — naming conventions, category tests, description patterns, and typed relationships — rather than formal ontological *reasoning* in OWL/RDF. I chose this approach because:

1. **The domain is discourse, not reality.** DOLCE was designed for how humans organize experience; BFO was designed for mind-independent reality. AI policy discourse is inherently perspectival — there is no "correct" ontological classification of whether "AI regulation should be proportional" is a Desire or an Intention. The category tests provide principled disambiguation without requiring formal subsumption reasoning.

2. **LLM prompts operate on vocabulary, not triples.** When I instruct a debate agent "YOUR EMPIRICAL GROUNDING (Beliefs): these are the factual claims you take as true," the ontological vocabulary shapes the agent's reasoning through natural language instruction. Encoding this as OWL triples would require a separate reasoning engine with no direct benefit to prompt quality.

3. **JSON structures are auditable and evolvable.** A taxonomy node with `category: "Desires"` and a genus-differentia description is immediately readable by human analysts. An OWL class hierarchy with rdfs:subClassOf relationships requires specialized tooling to inspect and modify.

This design choice has a cost: without formal reasoning, subsumption relationships, category membership, and constraint satisfaction must be enforced through prompt instructions and runtime validation (regex patterns, enum checks). For this use case — discourse analysis, not biomedical knowledge engineering — this tradeoff favors accessibility over formal completeness.

### 8.2 The Human-AI Scoring Boundary

The Q-0 calibration outcome reveals a principled boundary between what current LLMs can and cannot reliably assess. Normative and strategic claims (Desires, Intentions) are self-contained — their quality criteria (values grounding, tradeoff acknowledgment, mechanism specification) are visible in the claim text and assessable through pattern recognition, the LLM's core strength. Empirical claims (Beliefs) require external verification — checking source accuracy, evaluating evidence quality, and assessing consistency with the scientific record — which exceeds the model's reliable capabilities.

This finding generalizes: any automated argumentation system should expect different assessment reliability across different claim types, and the reliable/unreliable boundary will track the self-contained/externally-verifiable distinction, not the simple/complex distinction that might be assumed.

The hybrid approach (AI for Desires/Intentions, human for Beliefs) is not a failure of prompt engineering — it is a principled acknowledgment of the current human-AI task allocation boundary. As LLMs gain better grounding in external knowledge (through retrieval augmentation, tool use, or training data improvement), the boundary may shift. But the BDI-aware rubric design will remain useful: even with better models, separating the assessment criteria by claim type produces more auditable scores than holistic judgment.

### 8.3 Parameter Calibration as Complementary Intervention

The rhetorical rigidity problem (Section 6.4) illustrates a broader principle: prompt engineering and parameter calibration are complementary interventions, not substitutes. The prompt-level fixes (move reordering, anti-repetition, move history) address *what the model is instructed to do*. The temperature increase (0.3 → 0.5) addresses *how the model samples from its output distribution*. Neither alone fully resolves the problem — low temperature makes even well-instructed models deterministic, while high temperature without clear instructions produces incoherent variation.

More broadly, a systematic audit revealed that the pipeline had accumulated temperature defaults appropriate for extraction (0.1-0.2) applied to deliberative tasks that benefit from moderate creativity (0.5-0.7). The mismatch between task type and sampling parameter was invisible in individual interactions but produced systematic quality degradation across debates. I recommend that multi-stage NLP pipelines explicitly calibrate temperature per task type rather than inheriting a single default.

The embedding similarity threshold calibration (Section 3.3) reveals a similar principle: the original threshold (0.3) was chosen without empirical validation and admitted 93.3% of node pairs (measured from the pairwise cosine similarity distribution across 565 taxonomy nodes) — effectively no filtering. Empirical distribution analysis produced a principled threshold (0.48) that meaningfully filters while preserving diversity; this threshold now self-tunes via adaptive post-debate write-back (Section 8.9). The general lesson: hardcoded thresholds in NLP systems should be validated against their actual data distributions, not set by intuition.

The per-turn retrieval mechanism (Section 3.3) illustrates a related failure mode: *intended behavior masked by a silent implementation bug*. An earlier version of `getRelevantTaxonomyContext` built a per-turn query string from the debate topic and recent transcript, as designed, but then scored nodes against `matchingVectors[0]` — the first vector in object iteration order — and discarded the query text entirely. The selected node set was therefore deterministic across the entire debate, and the novelty validator fired repeatedly because the retrieval layer could not surface new candidates no matter how the debate evolved. The observable symptom (a validator warning) was three layers removed from the root cause (a line of code that threw away its own input). The general lesson: when an instrumented validator triggers persistently, the first hypothesis should be that the upstream mechanism it is checking is broken, not that the model is ignoring instructions. Prompt-level repairs to a downstream symptom cannot substitute for a functioning retrieval layer.

### 8.4 Metaphor as Cognitive Reset

The metaphor reframing mechanism (Section 6.8) addresses a limitation of pure logical argumentation: when agents have exhausted their repertoire of evidence-based and reasoning-based moves, introducing a novel conceptual frame can restructure the problem space. This is consistent with Lakoff and Johnson's (1980) observation that metaphors are not decorative but constitutive — they determine which aspects of a problem are salient and which are invisible.

The curated metaphor library represents a deliberate design choice: rather than allowing the AI to generate arbitrary metaphors (which risks incoherent or misleading frames), I provide eight carefully selected metaphors that each highlight genuine aspects of AI policy discourse. The stall detection mechanism ensures metaphors are introduced only when the debate has genuinely converged, preventing gratuitous reframing that could derail productive exchanges.

Early observations suggest that metaphor reframing is most productive when it bridges BDI layers — e.g., the "AI as Experiment" metaphor naturally connects empirical questions (Beliefs: what are the outcomes?) with normative questions (Desires: was informed consent given?) and strategic questions (Intentions: how do we ensure reversibility?). This cross-BDI bridging may explain why metaphorical arguments are classified as "Mixed" BDI affinity in the scheme taxonomy.

### 8.5 LLM Failure Modes as a Design Category

The five interventions (Section 6.10) represent a design category distinct from both prompt engineering and parameter calibration: *runtime monitoring and correction* of LLM-specific behavioral failures. Prompt engineering shapes what the model is instructed to do; parameter calibration shapes how it samples; runtime interventions detect and respond to failures *after they occur*.

This distinction matters because some LLM failure modes are not preventable through instruction. Sycophantic drift is not caused by unclear instructions — the model "knows" it should maintain its position but accommodates at the token level. Hallucinated evidence is not caused by missing instructions to be truthful — the model generates fabricated statistics with the same confidence as accurate ones. These failures require detection infrastructure (embeddings for drift, web search for verification, NLI for steelman checking) that operates outside the prompt.

The graceful degradation architecture — where each intervention checks for capability availability and silently skips if unavailable — reflects a pragmatic reality: not all deployment contexts provide all capabilities. The CLI adapter lacks web search, NLI, and embedding computation; the UI bridge provides all three. Rather than requiring a uniform capability set, the system adapts its intervention suite to what is available.

### 8.6 Falsifiability as a Structural Gap

The SPECIFY move addresses what may be the single most important structural gap in LLM debate: the absence of falsifiability commitments. In human academic debate, demanding "what would change your mind?" is recognized as the most truth-productive move because it forces hidden assumptions into the open and makes disagreements resolvable in principle. Its absence from the initial dialectical taxonomy — which included seven moves for challenging, conceding, and reframing positions — meant that debates could run for five rounds with neither side ever stating what would count as evidence against their position.

The moderator bias mechanism (triggered by isolated high-strength claims with no edges between them) targets the specific argument network topology that signals the need for falsifiability demands: when two debaters have built strong, well-supported positions that simply do not engage with each other, the productive move is not another counterexample or distinction but a demand that one side operationalize their position.

### 8.7 Neural-Symbolic Architecture for Explainable Argumentation

The system's most distinctive architectural property is the systematic pairing of neural and symbolic computation at every layer. This is not an ad-hoc combination — it reflects the principled determinate-indeterminate decomposition described in Section 3.0: determinate operations (those with one correct answer) are encoded symbolically, while interpretive judgments (those admitting multiple reasonable interpretations) are delegated to LLMs bounded by graph constraints. Hude (2025) demonstrates the power of this decomposition in legal reasoning, achieving a 10× accuracy improvement over unconstrained LLMs. Our system applies the same principle to multi-perspective argumentative discourse, where the taxonomy graph, argument network, and QBAF propagation provide the structural backbone that constrains, verifies, and explains neural outputs at every layer.

**The 4-stage turn pipeline (Section 6.2)** exemplifies this pairing at the micro level. The pipeline structure — stage ordering, JSON schemas, typed outputs, inter-stage chaining — is entirely symbolic. The content generated within each stage is entirely neural. This decomposition provides two critical properties that a single neural call cannot: *localizability* (a citation error is traced to the CITE stage, not to "the model") and *independent tunability* (the DRAFT stage can run at temperature 0.7 for creativity while CITE runs at 0.15 for precision, rather than forcing a single temperature to serve competing demands). This decomposition also mitigates the length and discourse-disruption degradation that Sanayei et al. (2025) document in LLM-as-judge settings: by decomposing each turn into bounded subtasks, no single LLM call must process the full debate context holistically.

**Turn validation (Section 6.3)** exemplifies the pairing at the quality-control level. The 9 deterministic rules of Stage A catch errors that are objectively verifiable (a non-existent node ID, a statement with only 2 paragraphs) without consuming any LLM calls. The neural Stage B assesses qualities that resist formalization (whether a turn genuinely "advances" the debate). Neither layer alone suffices: purely symbolic validation would miss argumentative quality issues, while purely neural validation would miss structural errors that the LLM generates confidently.

**Convergence diagnostics (Section 6.12)** exemplify the pairing at the analysis level. All seven signals are computed from the argument network's graph structure — QBAF strengths, edge types, move classifications, token overlaps — without any LLM calls. This means convergence assessment is fully reproducible: the same argument network always produces identical diagnostics. The neural components generated the debate content that populates the argument network, but the assessment of that content's convergence properties is entirely symbolic.

**Dialectic traces (Section 6.13)** exemplify the pairing at the explanation level. BFS traversal through the argument network produces deterministic narrative chains explaining why a position prevailed. A researcher can follow the trace step by step, verify each QBAF strength, inspect each edge, and confirm or challenge the explanation. This level of auditability is impossible in systems where outcomes are assessed by another neural call — "the LLM said this side won" provides no verifiable reasoning chain.

**The active moderator (Section 6.22)** exemplifies the pairing at the intervention level. The engine pre-computes all trigger context deterministically — Debate Health Score, trajectory modifiers, SLI floor breaches, per-debater burden, adaptive persona thresholds — and the LLM makes a soft judgment about whether and how to intervene. The engine then validates the recommendation against six deterministic constraints (budget, cooldown, phase appropriateness, prerequisite ordering, burden cap, same-debater consecutive rule) before any intervention fires. Move responses are schema-validated using the same deterministic compliance checking that governs turn validation. The moderator thus instantiates the neural-symbolic split at a new level of abstraction: the LLM generates natural-language interventions and exercises judgment about when discourse conditions warrant action, while the engine enforces the structural invariants — budget limits, fairness constraints, pragmatic prerequisites — that prevent moderation itself from degrading debate quality.

**Adaptive phase transitions (Section 6.23)** exemplify the pairing at the structural pacing level. Every transition signal — recycling pressure, crux maturity, concession plateau, scheme stagnation, QBAF agreement density, position stability — is computed deterministically from the argument network and discourse surface without any LLM calls, yet the argumentative content generated within each phase is entirely neural. The engine decides when to transition based on symbolic composites; the LLM decides what to argue within the phase the engine selects. This separation ensures that debate pacing is reproducible and auditable — the same argument network always produces the same transition decision — while preserving the creative flexibility of neural content generation within each phase.

This architecture addresses a fundamental tension in multi-agent debate systems. Pure neural systems (multiple LLM agents debating with unstructured outputs) are creative but opaque — they produce interesting debates whose outcomes cannot be explained or audited. Pure symbolic systems (formal argumentation frameworks with hand-coded arguments) are auditable but brittle — they cannot generate novel arguments or assess soft argumentative qualities. The neural-symbolic pairing provides both: neural creativity in content generation and symbolic rigor in validation, measurement, and explanation.

The practical consequence is that every claim the system makes about debate outcomes is backed by a verifiable computation. "This position prevailed" is backed by a dialectic trace through the QBAF. "This debate is converging" is backed by seven deterministic metrics. "This turn is valid" is backed by 10 symbolic rules plus a neural quality assessment. This dual backing makes the system suitable for policy analysis contexts where trust in computational tools requires more than "the AI said so."

Our DF-QuAD implementation is formally an instance of aggregative QBAF semantics (Munro et al., 2026, Proposition 1), using product aggregation for both attacks and supports with a multiplicative combining function. While 515 variants exist within the aggregative framework, empirical comparison across all reviewed papers — ArgRAG (Zhu et al., 2025), the unified framework (Alfano et al., 2026), and this aggregative analysis — shows only minor performance differences between semantics choices. The architectural decision to use formal gradual semantics is more consequential than which specific semantics is selected. Future work could explore asymmetric aggregation (different functions for attacks vs. supports) for regulatory contexts where burden of proof is asymmetric.

### 8.8 Addressing the Fixed-Role Critique

A natural objection to the system's design is that three agents with permanent identities narrow the argument space. If Prometheus always argues from the accelerationist taxonomy, Sentinel always from the safetyist taxonomy, and Cassandra always from the skeptic taxonomy, then arguments that cross these boundaries — compromise positions, shared assumptions, positions that no single POV would originate — will never surface through the agents alone. The critique is valid: the argument space of the debate system is bounded by the combined content of the three taxonomies.

However, the critique frequently misdiagnoses the cause. Proposals such as shadow debates (agents temporarily swap roles), role rotation (Prometheus argues the safetyist position), and devil's advocate rounds (an agent argues against its own taxonomy) assume that agent identity and taxonomy are separable — that Prometheus could meaningfully argue from Sentinel's taxonomy while remaining Prometheus. In this system, this assumption is false. The taxonomy *is* the identity. Each agent's BDI-structured context injection (Section 3.3), its commitment store, its relevance scoring, its situation node interpretations, and its validated move history are all grounded in its assigned taxonomy. "Prometheus argues the safetyist position" does not produce a novel perspective; it produces a second Sentinel with a confusing name.

This architectural insight — identity is taxonomy, not persona — reframes the fixed-role limitation as a taxonomy coverage problem rather than a persona rigidity problem. The question is not "how do we make agents more flexible?" but "how do we ensure the combined taxonomy covers the argument space relevant to each debate topic?" LLMs do not accumulate identity across sessions; each debate starts fresh from whatever taxonomy context is injected. The apparent "fixedness" of the agents is precisely and only the fixedness of their taxonomy content.

The system already contains partial mitigations for taxonomy coverage gaps. The Missing Arguments Pass (Section 6.10, intervention 5) identifies strong unmade arguments post-debate. Reflections (Section 6.14) give each agent a meta-cognitive pass to identify gaps between their taxonomy and what the debate actually required. Situation nodes (Section 3.1) capture shared concepts with per-POV interpretations, providing a structured space for cross-cutting engagement. Concession harvesting (Section 6.5) feeds genuine convergence back into the taxonomy across debates.

Three new features close the remaining gaps while working with the identity-is-taxonomy design rather than against it:

1. **Mid-debate gap injection** (Section 6.18) moves the missing arguments analysis from post-debate to mid-debate, where surfaced arguments can still influence the exchange. An unaligned LLM — one with no persona assignment and no taxonomy — identifies arguments that none of the three perspectives would originate, classified by gap type (cross-cutting, compromise, blind spot, unstated assumption). The moderator directs existing agents to engage with these arguments from their own perspectives, expanding the argument space without violating identity boundaries.

2. **Cross-cutting node promotion** (Section 6.19) detects three-way agreements in synthesis and proposes new situation nodes that capture the shared understanding with nuanced per-POV BDI-decomposed interpretations. This grows the taxonomy's cross-cutting coverage from debate findings rather than relying solely on manual curation.

3. **Taxonomy gap diagnostics** (Section 6.20) provides a deterministic per-debate coverage analysis — per-POV utilization rates, BDI balance, unmapped arguments, cross-POV gaps — that answers "where are the holes?" with data rather than intuition. Repeated coverage patterns across debates identify structural taxonomy gaps that curators can address.

Together, these features implement the principled response to the fixed-role critique: acknowledge that the argument space is taxonomy-bounded, then systematically identify and close gaps in taxonomy coverage — through mid-debate injection of uncovered arguments, through promotion of cross-cutting agreements into the taxonomy, and through diagnostic visibility into where coverage falls short.

### 8.9 Automated Parameter Calibration

The system contains over 100 hardcoded numeric parameters — similarity thresholds, temperature settings, scoring weights, cap values, and phase transition gates. Most were initially set by intuition. A systematic audit identified the five parameters with the highest impact on debate quality:

1. **Exploration exit threshold** (0.65) — directly controls debate length by determining when exploration transitions to synthesis
2. **Embedding relevance threshold** (0.48) — controls which taxonomy nodes the debater sees, directly affecting argument grounding
3. **QBAF attack type weights** (rebut: 1.0, undercut: 1.1, undermine: 1.2) — compound nonlinearly through the argument network
4. **Draft temperature** (0.7) — controls creative diversity of argumentative text generation
5. **Saturation signal weights** (6 weights summing to 1.0) — determine when the debate has exhausted a phase

For each parameter, I designed an automated calibration mechanism that requires no LLM calls and no human judgment — only arithmetic on data already collected by existing instrumentation:

| # | Parameter | Category | Data source | Algorithm |
|---|-----------|----------|-------------|-----------|
| 1 | Exploration exit threshold | Phase | Neutral evaluator: crux resolution, engagement flag | Bucket-average: threshold producing highest quality score |
| 2 | Embedding relevance threshold | Context | Context injection manifest: utilization rates | Directional: raise if waste > 70%, lower if primary utilization < 50% |
| 3 | QBAF attack weights | Output | Synthesis preferences vs QBAF computed strengths | Concordance maximization |
| 4 | Draft temperature | Output | Turn validator: structural errors vs repetition warnings | Composite cost minimization at the crossover point |
| 5 | Saturation signal weights | Phase | Convergence signals at transition vs neutral evaluator quality | Ordinary least squares regression |
| 6 | Context compression window | Context | Unanswered claims ledger: claims forgotten rate | Directional: raise window if > 40% forgotten, lower if < 15% |
| 7 | GC trigger threshold | Context | AN node count + GC occurrence vs neutral evaluator quality | Correlation: raise trigger if GC debates are lower quality |
| 8 | Crux resolution threshold | Phase | Engine crux status vs neutral evaluator crux status | Divergence minimization: adjust threshold to reduce disagreement |
| 9 | Node selection caps | Context | Utilization rate + relevance score variance | Adaptive: narrow-topic debates (low variance) get tighter caps |
| 10 | Semantic recycling threshold | Output | Recycling detector vs turn validator novelty signal | Agreement maximization between two independent repetition detectors |
| 11 | Cluster MinSimilarity | Upstream | Taxonomy mapping ratio: AN nodes with taxonomy refs | Directional: loosen if mapping < 50%, tighten if > 85% |
| 12 | Duplicate claim similarity | Upstream | Near-miss duplicate pairs (similarity in [threshold-0.05, threshold]) | Near-miss rate: lower threshold if > 5% are near-misses |
| 13 | FIRE confidence threshold | Upstream | Borderline claim survival: claims at threshold vs refutation rate | Raise if borderline claims < 50% survive, lower if > 85% survive |
| 14 | Hierarchy cohesion threshold | Upstream | Average base_strength of taxonomy-grounded nodes in debates | Tighten if avg branch cohesion < 0.45, relax if > 0.75 |
| 15 | Extraction density (KP divisor) | Upstream | Claims per 1000 source-document words | Target 2-5 claims/1k: raise divisor if > 6, lower if < 1.5 |

Each debate logs a calibration data point (~1KB) to `calibration-log.json` in the data directory. The log accumulates across local and cloud (Azure) environments — both write the same schema with an `origin` field distinguishing data provenance. The system has accumulated calibration data from 100+ debates across local and cloud environments. A CLI optimizer (`npx tsx lib/debate/calibrationOptimizer.ts <data-root> [--apply]`) reads the log, runs all ten algorithms, and optionally writes updated values to `provisional-weights.json`. The optimization runs in milliseconds with no LLM calls. The relevance threshold (parameter #2) is now self-tuning via a closed-loop post-debate write-back mechanism: after each debate, the system automatically proposes a revised threshold based on context utilization data, subject to 4 safety rails — a 5-debate minimum sample size, medium+ optimizer confidence, hard bounds [0.35, 0.60], and a manual override flag that preserves human-set values. This eliminates the need for manual CLI invocation for the highest-impact context parameter; other parameters still require explicit optimizer runs.

The fifteen parameters divide into four categories by their optimization characteristics:

**Phase-transition parameters** (#1, #5, #8) directly control debate length and pacing. Their quality signal comes from the neutral evaluator — an independent, persona-free assessment of whether the debate engaged real disagreement and resolved its cruxes. These parameters benefit most from data accumulation because their optima depend on the model, topic distribution, and debate style.

**Context parameters** (#2, #6, #7, #9) control what the debater sees and remembers. Their quality signal comes from the context injection instrumentation — utilization rates, forgotten claims, and network size. These parameters can adapt faster because each debate produces multiple data points (one per turn).

**Output parameters** (#3, #4, #10) control how the debater generates and how its output is classified. Their quality signals come from the turn validator and argument network — structural error rates, repetition warnings, and concordance between independent quality signals. These parameters are most sensitive to model changes — a model switch may require recalibration.

**Upstream pipeline parameters** (#11-#15) control document ingestion, claim extraction, and taxonomy structure. These are the most consequential parameters because they determine the foundation everything else operates on — if clusters are wrong, no amount of debate tuning compensates. Their optimization requires cross-pipeline tracking: a claim is extracted during ingestion, but its quality is measured during debates (attack rate, survival rate, taxonomy mapping). This cross-pipeline signal makes them slower to calibrate but uniquely valuable — they are the only parameters where downstream debate performance feeds back to improve upstream extraction quality.

The optimizer is conservative: only medium or high confidence recommendations are applied, all changes are bounded within safe ranges, and parameters that lack sufficient data are left unchanged. This approach transforms parameter tuning from a one-time intuition to an ongoing empirical process — early parameters were chosen by educated guesswork; as debate data accumulates, they converge toward their empirically optimal values.

### 8.10 Relationship to Process Reward Models

The calibration and evaluation system described above shares structural parallels with Process Reward Models (PRMs; Lightman et al., 2023; Uesato et al., 2022), which evaluate the correctness of each intermediate step in a multi-step reasoning chain rather than scoring only the final output. In our system, a multi-turn debate is the reasoning chain, and each turn is a step that receives independent quality assessment.

**Parallels.** Our per-turn process reward score (Section 6.12) — composing engagement, novelty, consistency, grounding, and move quality into a continuous [0,1] signal — functions as a step-level reward in the PRM sense. The seven convergence diagnostics provide additional per-step signals analogous to PRM verification: recycling rate detects reasoning loops, engagement depth measures whether each step responds to relevant prior steps, and scheme stagnation identifies repetitive reasoning patterns. The adaptive phase transition system (Section 6.23) uses these step-level signals as quality gates — transitioning from exploration to synthesis only when the accumulated process signals indicate substantive engagement — paralleling PRM-guided search, where step-level scores steer the reasoning trajectory.

**Honest differences.** Our system is PRM-*adjacent*, not a PRM implementation. Three distinctions matter. First, PRMs evaluate reasoning against a single ground truth (the math problem has one correct answer); our system evaluates reasoning from three perspectives simultaneously, where "correctness" is perspectival. Second, our step-level scores are computed by a hybrid of symbolic rules (9 deterministic checks) and neural assessment (turn quality judgment), not by a trained reward model. This makes our scores more transparent but potentially less calibrated than a learned verifier. Third, standard PRMs improve a single model's generation through search or reinforcement learning; our step-level signals improve a knowledge base (the taxonomy) through adversarial refinement — a fundamentally different optimization target.

**What PRM theory suggests we should explore.** ThinkPRM (Wang et al., 2025) demonstrates that generative verifiers — LLMs that produce step-by-step verification reasoning — outperform discriminative classifiers while requiring 100× fewer labels. Applied to our system, this suggests replacing our binary turn validation (accept/retry) with a generative verifier that produces an explicit reasoning chain about turn quality: "This turn cites acc-beliefs-012 as evidence. The node describes empirical validation of decentralized development. The claim is consistent with the cited node, but does not address the counter-evidence in saf-beliefs-019. Process score: 0.65." This would enrich our diagnostics with causal explanations of quality scores, not just the scores themselves. Self-Debate Reinforcement Learning (SDRL; 2026) further suggests that training a model on our 93+ debate transcripts could produce agents that are simultaneously better arguers and better critics — a direction for future work requiring training infrastructure we do not currently maintain.

### 8.11 Limitations

**Taxonomy curation and iteration plateau.** While AI-assisted, the taxonomy requires significant human curation. Automated taxonomy proposal generation plateaus after 3-4 passes on the same health data — the system's token budget limits each pass to ~30 of 400+ unmapped concepts, and the same high-frequency concepts resurface. A full iteration cycle (propose → approve → re-summarize → re-propose) added 14 new nodes but did not significantly reduce the unmapped concept count (431 → 447 after re-summarization), indicating that the gap between automated extraction and taxonomy coverage is partially structural — not all unmapped concepts warrant dedicated nodes. NLI-based semantic deduplication of unmapped concepts (implemented via embedding-based cosine clustering at threshold 0.75) reduced 447 unique unmapped concepts to 354 clusters (21% reduction), addressing the repetition problem but not the structural gap.

**Three-POV simplification.** The accelerationist/safetyist/skeptic trichotomy is a deliberate simplification. Real AI policy discourse includes many more perspectives (industry, government, civil society, Global South, labor, etc.). The three-POV structure provides sufficient perspectival multiplicity for demonstrating the system's capabilities while remaining manageable. As discussed in Section 8.8, the argument space is bounded by taxonomy content rather than agent persona, and three new features — mid-debate gap injection (Section 6.18), cross-cutting node promotion (Section 6.19), and taxonomy gap diagnostics (Section 6.20) — mitigate this constraint by systematically identifying and closing coverage gaps. Nevertheless, perspectives not represented by any taxonomy remain invisible to the system regardless of these mitigations.

**English only.** All documents, taxonomy nodes, and debate transcripts are in English. No cross-lingual evaluation has been conducted. The BDI framework and AIF vocabulary are language-independent, but the prompts, disambiguation tests, and genus-differentia patterns are English-specific.

**FIRE evaluation gap.** The gold-standard claim set (PP-1) required for rigorous FIRE evaluation has not yet been constructed. The FIRE methodology is presented based on system design and preliminary testing, not formal evaluation.

**Embedding model.** The all-MiniLM-L6-v2 model used for relevance scoring was initially assumed to be a limitation due to its lightweight, general-purpose design. However, systematic evaluation (t/272) showed it outperforms both bge-small-en-v1.5 (-32% retrieval quality) and gte-small (-37%) on our policy taxonomy domain. The general retrieval models suffer from hubness problems — a small number of "hub" vectors attract disproportionate similarity mass, degrading discrimination in our high-density node space. The model is therefore empirically validated for our specific use case, though BDI-aware relevance must still be enforced at the prompt level (via BDI grouping and ★-tiering) rather than the embedding level, since the model discriminates by POV (intra-POV mean similarity 0.58 vs cross-POV 0.47) but weakly by BDI category (0.54 vs 0.49 — only a 0.05 gap).

**Concession harvesting scale.** The concession harvesting mechanism is implemented and accumulating data across 100+ debates. However, formal validation — measuring whether classified concessions (full, conditional, tactical) correctly predict taxonomy evolution needs — requires structured annotation that has not yet been conducted. Specifically, a gold-standard annotation of concession classifications against retrospective taxonomy changes is needed to assess whether the weighted accumulation threshold (default: 3.0 across 2+ debates) identifies genuine taxonomy drift.

**Metaphor reframing validation.** The curated metaphor library and stall detection mechanism have been implemented but not yet formally evaluated. Systematic evaluation requires tracking which metaphors produce novel arguments (vs. superficial restatements) across a large debate corpus.

**Context utilization measurement.** The injection instrumentation uses string matching for reference detection, which may miss paraphrased references and false-positive on coincidental term overlap. More sophisticated reference detection (e.g., NLI-based similarity between injected node content and response text) would improve accuracy.

**Neutral evaluator independence.** The neutral evaluator uses the same underlying LLM as the debate agents. While persona stripping removes explicit identity cues, the LLM may still recognize argument patterns associated with particular perspectives (e.g., scaling-focused arguments as "accelerationist"), partially undermining the blinding. True independence would require a different model family or human evaluators.

**Intervention threshold sensitivity.** The LLM failure mode interventions use thresholds: base_strength > 0.4 for ledger inclusion, entailment < 0.6 for steelman rejection, 3 turns for sycophancy detection. The relevance threshold now self-tunes via adaptive post-debate write-back (Section 8.9): after each debate, the optimizer proposes a revised threshold subject to 4 safety rails (5-debate minimum sample, medium+ confidence, bounds [0.35, 0.60], manual override). Other intervention thresholds have been validated against the updated embedding distributions but remain manually set pending sufficient calibration data.

**SPECIFY move adoption.** The SPECIFY move's effectiveness depends on LLMs' ability to generate genuine falsifiability commitments rather than vague hedges ("I would change my mind if overwhelming evidence..."). Early observations suggest that explicit prompt instruction ("what specific outcome in the next 5 years") is necessary to elicit operationalized predictions, but formal evaluation has not been conducted.

### 8.12 Ethical Considerations

This system analyzes discourse about AI policy — a politically sensitive domain where computational tools can amplify certain perspectives while marginalizing others. Several ethical considerations apply:

**Perspective selection bias.** The three-POV structure (accelerationist, safetyist, skeptic) reflects perspectives prominent in Anglophone AI policy discourse. Perspectives from the Global South, indigenous communities, labor organizations, and non-technical stakeholders are not explicitly represented. The taxonomy's structure shapes which arguments are surfaced and which are invisible.

**Analytical vs. advocacy framing.** The system is designed as an analytical tool (mapping the discourse landscape) rather than an advocacy tool (recommending policy positions). However, the act of organizing perspectives into a structured taxonomy inevitably makes some framings more salient than others. The genus-differentia description format, by enforcing precision, may favor formalized academic perspectives over grassroots or experiential ones.

**AI-generated debate content.** Debate agents generate arguments based on taxonomy context, not personal belief or lived experience. Arguments attributed to the "safetyist" perspective are AI-generated approximations of safety-concerned positions, not authentic representations of any individual's views. This distinction must be clearly communicated to users.

**Concession harvesting and evolving positions.** Automated tracking of which positions are repeatedly conceded could be misused to claim that a perspective is "losing" the debate. The system explicitly frames concessions as signals about taxonomy accuracy, not about the merits of the underlying position — a distinction that must be maintained in any public presentation of results.

## 9. Conclusion

I have presented an integrated system for multi-perspective AI policy discourse analysis that addresses the fundamental limitation of flat, single-label stance detection through a neural-symbolic architecture in which LLM-based content generation is systematically paired with symbolic validation, computation, and explanation. The three-layer approach — ontological grounding (DOLCE D&S + BDI + AIF), formal argumentation (QBAF with BDI-aware calibration), and confidence-gated extraction (FIRE) — demonstrates that respecting the multi-dimensional structure of policy disagreements produces richer, more auditable analysis than compressing opinions into binary labels.

Key findings include:

1. **BDI decomposition is principled and practical.** Separating empirical claims from normative commitments and strategic reasoning, using explicit disambiguation tests, improves both AI debate quality and argument strength calibration. The decomposition is not ad-hoc — it derives from established work in philosophy of mind and agent-based systems. Extending BDI decomposition to situation node interpretations (all 133 nodes now carry belief/desire/intention/summary per POV) enables debate agents to target specific layers within each perspective's understanding of shared concepts.

2. **Different claim types require different assessment infrastructure.** The Q-0 calibration outcome (AI succeeds on Desires/Intentions, fails on Beliefs) reveals a fundamental asymmetry traceable to the self-contained vs. externally-verifiable nature of different claim types. This finding generalizes beyond this system to any automated argumentation pipeline.

3. **Ontological vocabulary suffices for discourse analysis.** Adopting DOLCE/BDI/AIF naming conventions in JSON structures — without formal OWL/RDF reasoning — provides sufficient grounding to shape AI reasoning through prompt instructions and runtime validation. The "vocabulary over formalism" approach makes the system accessible and evolvable while preserving ontological rigor.

4. **Multi-agent debate requires active diversity management.** Without explicit move diversity enforcement, LLM debate agents converge on repetitive rhetorical patterns. The solution requires both prompt-level interventions (move ordering, anti-repetition, move history) AND parameter-level calibration (temperature appropriate to the task type). Neither alone suffices.

5. **Argumentation scheme classification enriches debate analysis.** Classifying the reasoning pattern behind each argument (13 Walton-derived schemes with scheme-specific critical questions) enables the moderator to steer debates toward specific vulnerabilities and the synthesis to produce machine-readable argument maps that explain not just *what* was attacked but *how* and *on what grounds*.

6. **Parameter calibration is an empirical discipline, not an intuition.** Thresholds and temperatures set without validation against actual data distributions produce systematic quality degradation that is invisible in individual interactions but measurable in aggregate. The embedding similarity threshold (0.3 → 0.48) and debate temperature (0.3 → 0.5) were both corrected through empirical analysis rather than guesswork.

7. **Metaphor reframing addresses convergence stalls.** When logical argumentation exhausts its repertoire, curated conceptual metaphors provide novel frames that restructure the problem space. Integrating metaphorical arguments into the scheme taxonomy (ARGUMENT_FROM_METAPHOR with four critical questions) ensures they receive the same analytical rigor as other argument types.

8. **Instrumentation enables data-driven optimization.** Context injection instrumentation — tracking which injected nodes are actually referenced by the model — transforms context engineering from intuition-based tuning to empirical optimization. The lightweight manifest approach (string matching, no additional AI calls) demonstrates that useful instrumentation need not be expensive.

9. **LLM debate agents require LLM-specific interventions.** Hallucinated evidence, steelman fabrication, sycophantic drift, and compression-window blindness are failure modes absent in human debate that require targeted countermeasures. The intervention architecture demonstrates that these can be addressed non-blockingly — each intervention degrades gracefully when required capabilities are unavailable, and failure in any intervention never aborts the debate.

10. **Persona-free evaluation surfaces framing bias.** The neutral evaluator — reading the same debate with speaker identities stripped — provides a bias-detection layer analogous to blinded peer review. Divergence between the persona synthesis and the neutral evaluation indicates where persona framing may have biased the assessment, giving users two independent perspectives on the same debate rather than a single potentially contaminated verdict.

11. **Falsifiability demands are the most truth-productive debate move.** The SPECIFY move — requiring a debater to state what specific evidence would change their mind — addresses a structural gap in the dialectical taxonomy. Without it, debates can run for multiple rounds with neither side ever committing to testable predictions. The moderator bias toward SPECIFY when the argument network shows isolated high-strength claims (strong positions with no direct engagement) targets the precise conditions where falsifiability demands are most productive.

12. **Neural-symbolic decomposition enables both creativity and auditability.** The 4-stage turn pipeline (BRIEF-PLAN-DRAFT-CITE) demonstrates that decomposing LLM-based argumentation into focused stages with deterministic JSON chaining between them produces more auditable, tunable, and repairable debate turns than single-call generation. The symbolic pipeline structure constrains the neural content generation without limiting its creativity — each stage operates at an independently calibrated temperature appropriate to its cognitive demands.

13. **Deterministic convergence diagnostics provide LLM-independent debate assessment.** Seven per-turn signals — all computed from the argument network's graph structure, QBAF strengths, and move classifications without any LLM calls — enable reproducible, debuggable assessment of whether debates are progressing toward genuine understanding. Because the diagnostics are purely symbolic, they are independent of the neural components that generate debate content, providing an orthogonal assessment channel.

14. **Deterministic dialectic traces explain debate outcomes without neural inference.** BFS traversal through the argument network produces human-readable narrative chains that explain why a position prevailed, grounded in verifiable QBAF computations and edge classifications. This level of explainability — where a researcher can follow the trace step by step and verify each claim — distinguishes the system from multi-agent debate systems where outcomes are assessed by another opaque neural call.

15. **Post-debate reflections close the taxonomy evolution loop.** By giving each debater access to the full argument network and convergence signals post-debate, the reflections mechanism surfaces specific, evidence-grounded taxonomy edit proposals (revise, add, qualify, deprecate) with confidence levels. Combined with concession harvesting, this provides two complementary feedback channels: concession harvesting captures incremental convergence across debates, while reflections capture structural insights from individual debates.

16. **Agent identity is taxonomy, not persona — and this reframes the fixed-role critique.** The observation that three fixed-perspective agents bound the argument space is correct, but the standard remedies (role rotation, shadow debates, devil's advocate rounds) assume agent identity and taxonomy are separable. In this system they are not: the taxonomy *is* the identity. This insight reframes the limitation as a taxonomy coverage problem rather than a persona rigidity problem, leading to three features — mid-debate gap injection, cross-cutting node promotion, and taxonomy gap diagnostics — that expand argument space coverage by identifying and closing gaps in taxonomy content rather than attempting to make agents argue outside their grounding.

Future work includes formal FIRE evaluation (E1), scaled concession harvesting validation, cross-lingual extension, integration with retrieval-augmented generation to address the Beliefs scoring gap, systematic evaluation of metaphor reframing effectiveness across debate corpora, longitudinal analysis of neutral evaluator divergence patterns to identify which persona framings most frequently bias synthesis, and empirical validation of the neural-symbolic architecture's auditability claims through user studies with policy analysts examining dialectic traces and convergence diagnostics.

## References

ALDayel, A. and Magdy, W. (2021). Stance detection with BERT embeddings for web discourse. *Proceedings of the 16th International AAAI Conference on Web and Social Media (ICWSM)*.

Baroni, P., Rago, M., and Toni, F. (2019). From fine-grained properties to broad principles for gradual argumentation: A principled spectrum. *International Journal of Approximate Reasoning*, 105:252-286.

BDI Ontology (2025). The Belief-Desire-Intention Ontology for modelling mental reality and agency. *arXiv preprint arXiv:2511.17162*.

Bratman, M. (1987). *Intention, Plans, and Practical Reason*. Harvard University Press.

Cayrol, C. and Lagasquie-Schiex, M.-C. (2005). On the acceptability of arguments in bipolar argumentation frameworks. *Proceedings of the 8th European Conference on Symbolic and Quantitative Approaches to Reasoning with Uncertainty (ECSQARU)*, pages 378-389.

Chan, C. M., Chen, W., Su, Y., Yu, J., Xue, W., Zhang, S., Fu, J., and Liu, Z. (2024). ChatEval: Towards better LLM-based evaluators through multi-agent debate. *Proceedings of the 12th International Conference on Learning Representations (ICLR)*.

Chesnevar, C. I., McGinnis, J., Modgil, S., Rahwan, I., Reed, C., Simari, G., South, M., Vreeswijk, G., and Willmott, S. (2006). Towards an argument interchange format. *The Knowledge Engineering Review*, 21(4):293-316.

Du, Y., Li, S., Torralba, A., Tenenbaum, J. B., and Mordatch, I. (2023). Improving factuality and reasoning in language models through multiagent debate. *Proceedings of the 40th International Conference on Machine Learning (ICML)*.

Dung, P. M. (1995). On the acceptability of arguments and its fundamental role in nonmonotonic reasoning, logic programming and n-person games. *Artificial Intelligence*, 77(2):321-357.

Hamblin, C. L. (1970). *Fallacies*. Methuen.

Ebrahimi, J., Dou, D., and Lowd, D. (2022). A survey of stance detection in online texts. *ACM Computing Surveys*, 54(3):1-37.

Fauconnier, G. and Turner, M. (2002). *The Way We Think: Conceptual Blending and the Mind's Hidden Complexities*. Basic Books.

Gentner, D. and Markman, A. B. (1997). Structure mapping in analogy and similarity. *American Psychologist*, 52(1):45-56.

Guarino, N., Oberle, D., and Staab, S. (2009). What is an ontology? In *Handbook on Ontologies*, pages 1-17. Springer.

Hart, H. L. A. (1961). *The Concept of Law*. Oxford University Press.

Holyoak, K. J. and Thagard, P. (1995). *Mental Leaps: Analogy in Creative Thought*. MIT Press.

Hude, Z. (2025). Where has legal knowledge gone: Constraining LLMs with knowledge graphs for interpretable reasoning. Available at: https://github.com/hudetova/Gardner2025.

Janier, M. and Reed, C. (2014). OVA+: An argument analysis interface. *Proceedings of the 5th International Conference on Computational Models of Argument (COMMA)*.

Jonnalagadda, S., Cohen, T., Wu, S., and Gonzalez, G. (2012). Enhancing clinical concept extraction with distributional semantics. *Journal of Biomedical Informatics*, 45(1):129-140.

Khan, A., Hughes, J., Valentine, D., Ruis, L., Sachan, M., and Perez, E. (2024). Debating with more persuasive LLMs leads to more truthful answers. *arXiv preprint arXiv:2402.06782*.

Lakoff, G. and Johnson, M. (1980). *Metaphors We Live By*. University of Chicago Press.

Lauscher, A., Ng, L., Napoles, C., and Tetreault, J. (2022). Rhetoric, logic, and dialectic: Advancing theory-based argument quality assessment. *Proceedings of the 29th International Conference on Computational Linguistics (COLING)*.

Lawrence, J., Janier, M., and Reed, C. (2012). Auto-segmentation of dialogical argumentation. *Proceedings of the 4th Workshop on Computational Models of Natural Argument (CMNA)*.

Li, Y., Sosea, T., Sawant, A., Nair, A. J., Inkpen, D., and Caragea, C. (2023). P-stance: A large dataset for stance detection in political domain. *Proceedings of the 61st Annual Meeting of the Association for Computational Linguistics (ACL)*.

Liang, T., He, Z., Jiao, W., Wang, X., Wang, Y., Wang, R., Yang, Y., Tu, Z., and Shi, S. (2023). Encouraging divergent thinking in large language models through multi-agent debate. *arXiv preprint arXiv:2305.19118*.

Lightman, H., Kosaraju, V., Burda, Y., Edwards, H., Baker, B., Lee, T., Leike, J., Schulman, J., Sutskever, I., and Cobbe, K. (2023). Let's verify step by step. *arXiv preprint arXiv:2305.20050*.

Liao, B., et al. (2025). Process reward models for LLM agents: Practical framework and directions. *arXiv preprint arXiv:2502.10325*.

Ling, X. and Weld, D. S. (2012). Fine-grained entity recognition. *Proceedings of the 26th AAAI Conference on Artificial Intelligence*.

Luo, Y., Liu, Z., Shi, Y., and Zhang, Y. (2024). Exploring the sensitivity of LLMs to components of multi-dimensional stance. *Proceedings of the 2024 Conference on Empirical Methods in Natural Language Processing (EMNLP)*.

Masolo, C., Borgo, S., Gangemi, A., Guarino, N., and Oltramari, A. (2003). WonderWeb deliverable D18: Ontology library (final). *IST Project 2001-33052 WonderWeb*.

Munro, R., et al. (2026). Aggregative semantics for quantitative bipolar argumentation frameworks. *arXiv preprint arXiv:2603.06067*.

Mayer, T., Cabrio, E., and Villata, S. (2020). Transformer-based argument mining for healthcare applications. *Proceedings of the 24th European Conference on Artificial Intelligence (ECAI)*.

Mohammad, S. M., Kiritchenko, S., Sobhani, P., Zhu, X., and Cherry, C. (2016). SemEval-2016 task 6: Detecting stance in tweets. *Proceedings of the 10th International Workshop on Semantic Evaluation (SemEval)*.

Pollock, J. L. (1987). Defeasible reasoning. *Cognitive Science*, 11(4):481-518.

Pollock, J. L. (1995). *Cognitive Carpentry: A Blueprint for How to Build a Person*. MIT Press.

Prakken, H. (2006). Formal systems for persuasion dialogue. *The Knowledge Engineering Review*, 21(2):163-188.

Rago, A., Toni, F., Aurisicchio, M., and Baroni, P. (2016). Discontinuity-free decision support with quantitative argumentation debates. *Proceedings of the 15th International Conference on Principles of Knowledge Representation and Reasoning (KR)*.

Rahwan, I., Zablith, F., and Reed, C. (2007). Laying the foundations for a world wide argument web. *Artificial Intelligence*, 171(10-15):897-921.

Rao, A. S. and Georgeff, M. P. (1991). Modeling rational agents within a BDI-architecture. *Proceedings of the 2nd International Conference on Principles of Knowledge Representation and Reasoning (KR)*.

Sanayei, A., Vesic, S., Blanco, E., and Surdeanu, M. (2025). Can LLMs judge debates? Evaluating non-linear reasoning via argumentation theory semantics. *Findings of the Association for Computational Linguistics: EMNLP 2025*, pages 21244-21262.

Smith, B., Ashburner, M., Rosse, C., et al. (2015). The OBO Foundry: coordinated evolution of ontologies to support biomedical data integration. *Nature Biotechnology*, 25(11):1251-1255.

Stab, C. and Gurevych, I. (2017). Parsing argumentation structures in persuasive essays. *Computational Linguistics*, 43(3):619-659.

Thibodeau, P. H. and Boroditsky, L. (2011). Metaphors we think with: The role of metaphor in reasoning. *PLoS ONE*, 6(2):e16782.

Törnberg, P. (2024). How to use LLMs for text analysis. *Proceedings of the National Academy of Sciences (PNAS)*, 121(24).

Uesato, J., Kushman, N., Kumar, R., Song, F., Siegel, N., Wang, L., Creswell, A., Irving, G., and Higgins, I. (2022). Solving math word problems with process- and outcome-based feedback. *arXiv preprint arXiv:2211.14275*.

Wang, Q., et al. (2025). Process reward models that think. *arXiv preprint arXiv:2504.16828*.

Walton, D. N. and Krabbe, E. C. W. (1995). *Commitment in Dialogue: Basic Concepts of Interpersonal Reasoning*. SUNY Press.

Walton, D., Reed, C., and Macagno, F. (2008). *Argumentation Schemes*. Cambridge University Press.

Wei, J., Wang, X., Schuurmans, D., Bosma, M., Ichter, B., Xia, F., Chi, E., Le, Q., and Zhou, D. (2022). Chain-of-thought prompting elicits reasoning in large language models. *Advances in Neural Information Processing Systems (NeurIPS)*, 35.
