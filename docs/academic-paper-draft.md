# BDI-Grounded Argumentation for Multi-Perspective AI Policy Analysis: Integrating QBAF, FIRE, and Ontological Framing in a Living Taxonomy

**Jeffrey Snover**

## Abstract

AI policy discourse involves competing empirical claims, normative commitments, and strategic reasoning that existing NLP tools compress into lossy single-label representations. I present an integrated system for multi-perspective discourse analysis that combines three layers: (1) ontological grounding using a composite of DOLCE D&S (perspectival multiplicity), BDI (Belief-Desire-Intention agent characterization), and AIF (Argument Interchange Format) vocabulary; (2) formal argumentation via Quantitative Bipolar Argumentation Frameworks (QBAFs) with a novel BDI-aware base score calibration that addresses the fundamental asymmetry between empirical and normative claim assessment; and (3) confidence-gated iterative claim extraction (FIRE) that replaces single-shot summarization with a per-claim verification loop guided by evidence criteria heuristics. The system organizes AI policy literature through a four-POV taxonomy (accelerationist, safetyist, skeptic, and shared situations) with ~565 nodes, supports multi-agent debates with ontology-grounded context injection instrumented for utilization tracking, classifies arguments using a 13-scheme taxonomy derived from Walton's argumentation schemes (each with scheme-specific critical questions that guide moderator steering), employs metaphor reframing to break rhetorical stalls, and feeds debate findings back into the taxonomy through concession harvesting. A persona-free neutral evaluator reads debate transcripts with speaker identities stripped, producing independent claim assessments at three checkpoints (baseline, midpoint, final) whose divergence from the persona-grounded synthesis surfaces evaluation bias. Five targeted interventions address LLM-specific debate failure modes: an unanswered claims ledger that persists across the compression window, inline empirical verification via web search, NLI-based steelman validation, embedding-based sycophancy detection, and a post-synthesis missing arguments pass. I evaluate QBAF base score calibration across BDI layers, finding that AI reliably scores normative (Desires, r=0.65) and strategic (Intentions, r=0.71) claims but not empirical (Beliefs) claims — a fundamental asymmetry I attribute to the self-contained vs. externally-verifiable nature of different claim types. I also present empirical findings on embedding-based relevance scoring calibration and the effects of temperature parameter selection on debate quality. [RESULTS PENDING for E1, E3]

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

My contribution is twofold: (1) I apply QBAF to real policy discourse at scale with calibrated base scores (existing QBAF work primarily uses synthetic data or small-scale experiments), and (2) I discover and address a BDI-layer-dependent asymmetry in base score calibration that has not been reported in prior work.

### 2.4 Ontology-Grounded NLP

Ontologies have been used in NLP for knowledge representation (Guarino et al., 2009), entity typing (Ling and Weld, 2012), and domain-specific information extraction (Jonnalagadda et al., 2012). DOLCE (Masolo et al., 2003) has been applied to discourse analysis through its Descriptions and Situations (D&S) extension, which models how the same situation can receive different descriptions from different perspectives. BFO (Smith et al., 2015) dominates biomedical ontology but assumes a mind-independent reality that is ill-suited to perspectival discourse analysis.

I adopt a composite ontology: DOLCE D&S provides the perspectival framework (three POV "descriptions" of shared "situations"), BDI provides agent characterization (structuring each perspective's internal reasoning), and AIF provides argumentation vocabulary (formalizing how perspectives interact). Critically, I adopt ontological *vocabulary* — naming conventions, category tests, and description patterns — rather than formal OWL/RDF triples. This "vocabulary over formalism" approach provides sufficient grounding for discourse analysis without the engineering overhead of formal ontology reasoning.

### 2.5 LLM-as-Debater and Multi-Agent Argumentation

Multi-agent debate using LLMs has been explored for factual accuracy improvement (Du et al., 2023), reasoning enhancement (Liang et al., 2023), and deliberative alignment (Chan et al., 2024). These systems typically assign agents fixed positions and evaluate debate outcomes on factual benchmarks.

A persistent problem in multi-agent debate is *rhetorical rigidity*: agents defend assigned stances without genuine concession, producing repetitive exchanges that fail to converge on shared understanding. Khan et al. (2024) show that allowing agents to self-select positions improves factual accuracy. My system addresses rhetorical rigidity through four mechanisms: (1) a dialectical move taxonomy with diversity enforcement (preventing repetitive CONCEDE-DISTINGUISH cycling), (2) per-debater commitment tracking that prevents silent self-contradiction, (3) concession harvesting that propagates genuine concessions back to the taxonomy, closing the loop between argumentation output and ontology evolution, and (4) metaphor reframing that introduces novel conceptual frames during rhetorical stalls, drawing on research in analogical reasoning (Gentner and Markman, 1997) and conceptual blending (Fauconnier and Turner, 2002).

Beyond rhetorical rigidity, LLM-based debate agents exhibit failure modes absent in human debate: sycophantic position drift (accommodating opponents without argued concession), hallucinated evidence (fabricating citations or statistics), steelman fabrication (misrepresenting opponent positions while appearing to steelman), and compression-window blindness (forgetting early claims as context is compressed). My system introduces five targeted interventions for these LLM-specific failures, each non-blocking and designed for graceful degradation when required capabilities (web search, NLI, embeddings) are unavailable. Additionally, a persona-free neutral evaluator independently assesses claims with speaker identities stripped, providing a bias-detection layer analogous to blinded peer review.

### 2.6 Metaphor and Analogical Reasoning in Argumentation

Conceptual metaphor theory (Lakoff and Johnson, 1980) demonstrates that metaphors are not mere rhetorical decoration but foundational cognitive structures that shape reasoning about abstract domains. In policy discourse, competing metaphors ("AI as tool" vs. "AI as agent" vs. "AI as infrastructure") frame the problem space differently and license different conclusions. Thibodeau and Boroditsky (2011) show that even brief metaphorical framing significantly shifts policy preferences in experimental settings.

Analogical reasoning has been studied as a mechanism for creative problem-solving (Gentner and Markman, 1997) and for bridging conceptual gaps in multi-agent negotiation (Holyoak and Thagard, 1995). I build on this literature by introducing curated metaphors into multi-agent debate at moments of convergence stall, providing novel conceptual frames that can break repetitive argumentation patterns.

## 3. System Architecture

The system implements a five-stage pipeline: **ingest** (document conversion and metadata extraction), **extract** (claim identification with confidence assessment), **argue** (multi-agent debate with ontology-grounded context), **synthesize** (argument mapping, preference resolution, disagreement typing), and **evolve** (taxonomy updates via debate harvest, concession accumulation, and health analysis).

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

2. **Relevance tiering.** When embedding-based relevance scores are available (via cosine similarity against the debate topic using all-MiniLM-L6-v2 embeddings, threshold 0.45), the top-5 nodes per BDI category are marked as primary (★) with explicit instruction to prioritize them. Supporting nodes provide broader context but should not dominate the response. The threshold was empirically calibrated: analysis of pairwise similarity distributions across 565 nodes showed the original threshold (0.3) admitted 93.3% of all node pairs — effectively no filtering. At 0.45, approximately 70% of pairs pass, providing meaningful filtering while preserving diversity through the `minPerCategory=3` floor. Notably, the embedding model discriminates by POV (intra-POV mean similarity 0.58 vs cross-POV 0.47) but weakly by BDI category (0.54 vs 0.49), indicating that BDI-aware relevance must be enforced at the prompt level rather than the embedding level.

3. **CHESS dynamic branch injection.** For large taxonomies, only nodes within relevant taxonomy branches are injected at full depth; other branches contribute only top-level nodes as a "safety margin." This bounds context size while preserving coverage.

**Per-turn retrieval with recency diversification.** Retrieval is recomputed every turn against a query string composed of the debate topic plus the most recent transcript window, so the injected context tracks the actual trajectory of the exchange rather than freezing at opening. A naive per-turn embedding retrieval, however, exhibits a second pathology: *citation lock-in*. The same small cluster of nodes scores highest turn after turn, producing repetitive `taxonomy_refs` across a speaker's consecutive responses. A novelty validator (rule: "at least one taxonomy_ref must be a node not cited across the speaker's last two turns") initially surfaced the problem but could not repair it at the prompt level alone, because the high-scoring nodes that the speaker actually wanted to cite remained identical across turns.

The fix is a lightweight diversification lever applied in the score map before top-K selection: each node cited by the current speaker in their last two turns has its similarity score multiplied by 0.55. Recently-cited nodes are not banned — they remain eligible — but they must outscore alternatives by roughly 45% to be reselected. This preserves continuity of argument while forcing exploration of adjacent taxonomy territory as the debate progresses. A lexical fallback (tokenized query ↔ label+description overlap normalized by the geometric mean of token-set sizes) ensures the retrieval path degrades gracefully when no embedding adapter is available rather than collapsing to a static list.

**Node caps.** To prevent context bloat, the system enforces hard caps on injected context: a maximum of 35 POV nodes and 15 situation nodes per debate agent. These caps were introduced after observing that uncapped injection could inject 130+ situation nodes, overwhelming the agent's attention budget. The caps are applied after relevance scoring, ensuring that the most relevant nodes are retained.

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

[RESULTS PENDING]

**Methodology.** I will construct a gold-standard claim set (PP-1) from 25 documents spanning all three POVs and varying in length (2,000-15,000 words), domain complexity, and document type (academic papers, policy reports, opinion pieces). Two annotators will independently identify factual claims and classify their evidence criteria. Inter-annotator agreement will be measured via Cohen's kappa.

Each document will be processed under three conditions: (1) single-shot extraction, (2) FIRE iterative extraction, and (3) FIRE with the two-stage sniff. Metrics: claim-level precision (are extracted claims real?), recall (are gold-standard claims found?), and F1. Additionally, I will compute mean absolute error on evidence criteria (specificity, has_warrant, internally_consistent) between AI-assigned and human-annotated values.

**Expected results.** I expect FIRE to improve precision (fewer hallucinated claims due to the verification loop) with modest recall improvement (targeted refinement may surface claims missed in the initial pass). The improvement should be largest on long, complex documents where single-shot extraction is most prone to specificity collapse and claim clustering.

## 5. QBAF: Formal Argument Strength in Multi-POV Discourse

### 5.1 DF-QuAD Gradual Semantics

I implement DF-QuAD (Rago et al., 2016) for computing argument strength from base scores and attack/support relationships. Given a set of arguments with base strengths b(a) in [0,1] and typed relationships (supports/attacks), DF-QuAD iteratively computes:

For each argument *a* with attackers *Att(a)* and supporters *Sup(a)*:

$$\sigma(a) = b(a) + b(a) \cdot \text{agg}(Sup(a)) - b(a) \cdot \text{agg}(Att(a))$$

where agg() aggregates the strengths of attacking or supporting arguments. The computation iterates until convergence (threshold: 0.001 absolute change in any argument's strength).

Attack types receive differential weights following Pollock's classification: *rebut* (weight 1.0, direct contradiction), *undercut* (weight 1.1, inference denial — slightly stronger because it challenges the reasoning, not just the conclusion), and *undermine* (weight 1.2, premise attack — strongest because it challenges the foundation). These weights are configurable.

The engine is pure computation — it does not depend on how base scores are sourced. This separation is critical: the calibration challenge (Section 5.2) affects base score quality but not the propagation mechanism.

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

### 5.3 Why Beliefs Resist Automated Scoring

The Beliefs calibration failure is not a prompt engineering problem — it reflects a fundamental asymmetry in what different BDI layers require for assessment:

**Desires and Intentions claims are self-contained.** Whether a normative argument is values-grounded, acknowledges tradeoffs, or cites precedent can be determined from the claim text alone. Whether a strategic claim specifies a mechanism or addresses failure modes is visible in the text. The AI's pattern recognition capabilities are well-suited to these assessments.

**Beliefs claims require external verification.** Whether an empirical claim accurately represents its cited source, whether the source is peer-reviewed, and whether the claim is consistent with the broader evidence base requires access to information outside the claim text — the actual source document, the journal database, the state of scientific consensus. The AI lacks reliable access to this external information and defaults to assessing surface features (assertive language, hedging words) rather than evidential quality.

This asymmetry generalizes beyond this system: any automated argumentation system that attempts to score argument strength must contend with the fact that empirical claims require fundamentally different assessment infrastructure than normative or strategic claims.

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

### 6.1 Debate Protocol Design

Debates follow a structured protocol: (1) **clarification phase** — the moderator poses 2-3 scoping questions with multiple-choice options; the user selects answers that narrow the debate focus; (2) **topic refinement** — the moderator synthesizes answers into a precise debate question; (3) **opening statements** — each POV agent presents its initial position, grounded in its BDI-structured taxonomy context; (4) **cross-respond rounds** — the moderator selects which debater should respond to whom, on what specific point, based on argument network analysis; (5) **synthesis** — a separate AI pass extracts areas of agreement, disagreement, unresolved questions, and an AIF-aligned argument map with preference resolution.

Each debate agent receives its POV's taxonomy nodes organized by BDI category, with explicit framing headers. Primary nodes (most relevant to the debate topic, identified via embedding similarity) are marked with ★. Vulnerabilities known to be relevant to the topic are included with the instruction to acknowledge them when directly relevant — building credibility rather than over-conceding.

### 6.2 Dialectical Move Taxonomy and Diversity

I define eight canonical dialectical moves available to debate agents:

1. **DISTINGUISH** — accept the opponent's evidence but show it doesn't apply to this context
2. **COUNTEREXAMPLE** — provide a specific case challenging the opponent's general claim
3. **CONCEDE-AND-PIVOT** — acknowledge a valid point, then redirect to what it misses (genuine concession required, not "Great point, but..." empty flattery)
4. **REFRAME** — shift the framing to reveal what the current frame hides
5. **EMPIRICAL CHALLENGE** — dispute the factual basis of a claim with specific counter-evidence
6. **EXTEND** — build on another debater's point to strengthen or expand it
7. **UNDERCUT** — attack the warrant (reasoning link) rather than the evidence or conclusion
8. **SPECIFY** — demand that the opponent operationalize their position: what specific evidence, outcome, or condition would falsify their claim?

Three legacy moves (REDUCE, ESCALATE, CONCEDE) remain accepted in the classification pipeline for backward compatibility but are not prompted for.

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

### 6.3 Commitment Tracking and Concession Harvesting

Each debater maintains a commitment store tracking asserted, conceded, and challenged claims. The commitment store is injected into subsequent prompts with a consistency rule: "Do not silently contradict prior assertions."

**Concession harvesting** extends commitment tracking across debates. After synthesis, concessions are classified into three types using linguistic markers:

- **Full** (weight 1.0): Unconditional acceptance. Markers: "I accept that...", "You're right that..."
- **Conditional** (weight 0.5): Acceptance contingent on a condition. Markers: "I concede X, provided Y..."
- **Tactical** (weight 0.0): Arguendo concession. Markers: "Even if I accepted...", "For argument's sake..."

Classified concessions are accumulated per taxonomy node across debates. When weighted concession count on a node crosses a configurable threshold (default: 3.0 across 2+ distinct debates), the harvest dialog surfaces it as a candidate BDI update with three options: *qualify* (add caveat), *weaken* (reduce scope), or *retire* (archive as indefensible). All updates require human review — no automatic taxonomy changes.

This mechanism closes the loop between argumentation output and ontology evolution: repeated concessions signal that the taxonomy has drifted from defensible positions and needs revision. It also captures *convergence* — where POVs are coming together — complementing the situation nodes that capture where they diverge.

### 6.4 Preference Resolution and Synthesis

Debate synthesis evaluates which arguments prevail in each area of disagreement. Each preference judgment specifies the prevailing argument, the criterion by which it prevails (empirical_evidence, logical_validity, source_authority, specificity, or scope), and the rationale. This maps to AIF preference application nodes (PA-nodes).

The synthesis also produces an AIF-aligned argument map: claims with IDs, near-verbatim text, speaker attribution, and typed relationships (supported_by with scheme, attacked_by with attack_type, argumentation_scheme, and critical_question_addressed).

### 6.5 Argumentation Scheme Classification

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

### 6.6 Metaphor Reframing

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

### 6.7 Persona-Free Neutral Evaluator

A structural risk in multi-agent debate is *persona contamination*: the evaluator inherits framing from the agents it judges. If synthesis knows that "Prometheus" represents accelerationism, it may unconsciously weigh arguments through that lens rather than assessing reasoning quality neutrally.

I introduce a persona-free neutral evaluator that reads the debate transcript with all persona labels stripped. Speaker names are replaced with randomized neutral labels (Speaker A/B/C, shuffled per debate to prevent positional bias). The evaluator receives no POV taxonomy, no personality descriptions, and no framing about which perspectives the speakers represent.

The evaluator runs at three checkpoints: **baseline** (after opening statements — establishes the initial neutral reading), **midpoint** (after round 3 or the debate midpoint — detects whether the debate is engaging cruxes or drifting), and **final** (parallel with synthesis — produces the definitive neutral verdict). Each checkpoint is independent — no memory of prior checkpoints.

At each checkpoint, the evaluator produces:

1. **Cruxes** — core disagreements that, if resolved, would change conclusions, classified by disagreement type (empirical/values/definitional) and status (addressed/partially_addressed/unaddressed)
2. **Claim assessments** — per-claim neutral verdict (well_supported, plausible_but_underdefended, contested_unresolved, refuted, or off_topic) with confidence level and reasoning
3. **Overall assessment** — whether the debate is engaging real disagreement vs. performing disagreement, plus the single strongest unaddressed claim

The highest-value output is the **divergence view**: programmatic comparison of the final neutral evaluation against the persona synthesis. This surfaces cases where the synthesis marked a claim as resolved but the evaluator marked it contested, cruxes the evaluator flagged that the synthesis omitted, or status mismatches where synthesis says "agreed" but the evaluator says "unaddressed." These divergences indicate where persona framing may have biased the synthesis.

Critically, the neutral evaluator never influences the debate: it does not affect moderator selection, debater prompts, or synthesis output. It operates as a parallel assessment channel — users see both views and draw their own conclusions from any divergence.

### 6.8 LLM Failure Mode Interventions

LLM debate agents exhibit failure modes qualitatively different from human debaters. Human debaters may argue in bad faith, but they do not hallucinate evidence, fabricate opponent positions while sincerely attempting to steelman, or unconsciously drift toward their opponent's position through token-level accommodation. Five targeted interventions address these LLM-specific failures. All are non-blocking — failure in any intervention never aborts the debate — and all degrade gracefully when required capabilities are unavailable.

**1. Unanswered Claims Ledger.** The 8-entry context compression window is tactical: claims from early rounds disappear from the moderator's view. The moderator can only prioritize what it can see. The unanswered claims ledger tracks all claims with `base_strength > 0.4` persistently across the debate. After each claim extraction, `updateUnansweredLedger()` marks claims as addressed when edges target them. Every 3 rounds, `formatUnansweredClaimsHint()` surfaces the oldest unanswered claim in the moderator's context, ensuring that strong early claims cannot be silently abandoned.

**2. Inline Empirical Claim Verification.** LLMs hallucinate evidence — fabricating statistics, misattributing studies, or inventing institutional positions. After claim extraction, Belief claims with `specificity: 'precise'` (containing specific numbers, dates, or named entities) are auto-fact-checked via web search (Gemini's `google_search` tool). Results are stored on the argument network node as `verification_status` (verified/disputed/unverifiable) and `verification_evidence`. Disputed claims inject a `[Fact-check]` system entry before the next turn. A cap of 2 verifications per turn bounds API cost. When web search is unavailable (CLI adapter), verification silently skips.

**3. Steelman Validation.** The steelman instruction ("present the strongest version of the opponent's position") is one of the most important debate prompts, but LLMs frequently fabricate plausible-sounding positions that no opponent actually holds. Claim extraction now outputs `steelman_of` (opponent name or null). When a steelman is detected, NLI cross-encoder comparison against the opponent's actual committed assertions (up to 10 most recent) checks whether the steelman entails what the opponent actually said. If max entailment falls below 0.6, a `[Steelman check]` system entry surfaces the opponent's actual top-3 assertions. When NLI is unavailable, validation silently skips.

**4. Position Drift Detection (Sycophancy Guard).** LLMs exhibit sycophantic accommodation — gradually shifting toward an interlocutor's position without explicit concession or argued agreement. After opening statements, each speaker's opening embedding is cached. After each cross-respond, the current response embedding is compared against the speaker's own opening (`self_similarity`) and each opponent's opening (`opponent_similarities`). If `self_similarity` decreases monotonically for 3+ turns AND any `opponent_similarity` increases monotonically for 3+ turns AND no explicit concessions were made, a `[Sycophancy guard]` system entry flags the drift. When embedding computation is unavailable, drift tracking silently skips.

**5. Missing Arguments Pass.** Multi-agent debates converge on the arguments that happen to be raised, with no record of what was never said. Post-synthesis, a fresh LLM (receiving no transcript context) is given only the debate topic, a compact taxonomy summary (node labels + BDI categories), and the synthesis text. It identifies 3-5 strongest arguments on any side that were never raised during the debate, with BDI layer classification and explanation of why each argument is strong. This surfaces structural gaps in the debate's coverage.

The graceful degradation architecture is deliberate: the CLI engine's `AIAdapter` exposes only `generateText`, while the UI's bridge API provides `generateTextWithSearch`, `nliClassify`, and `computeQueryEmbedding` as optional extensions via the `ExtendedAIAdapter` interface. Each intervention checks for capability availability before executing and silently skips if unavailable. This means the full intervention suite runs in the Taxonomy Editor UI (which has access to all APIs) while the CLI engine gets a reduced set (unanswered claims ledger and missing arguments pass only), with no code path changes required.

### 6.9 Disagreement Typing

Each disagreement is classified into one of three types that map to BDI layers:

| Type | BDI Layer | Resolvability | Example |
|------|-----------|--------------|---------|
| EMPIRICAL | Belief divergence | Resolvable by evidence | "Does scaling eliminate bias?" |
| VALUES | Desire divergence | Negotiable via tradeoffs | "Is speed or safety more important?" |
| DEFINITIONAL | Conceptual divergence | Requires term clarification | "What counts as 'alignment'?" |

This classification determines the appropriate resolution strategy: empirical disagreements call for evidence gathering, values disagreements call for tradeoff analysis, and definitional disagreements call for term disambiguation before substantive debate can proceed.

### 6.10 Evaluation (E3)

[RESULTS PENDING]

**Methodology.** I will conduct an A/B test comparing BDI-structured context injection against flat context injection. 20 debates will be generated on the same 10 topics: 10 with BDI-structured taxonomy context (nodes grouped by Beliefs/Desires/Intentions with framing headers, ★-tiered by relevance) and 10 with flat context (same nodes presented as an unstructured list without BDI grouping or relevance tiering).

Three human evaluators will rate each debate on four dimensions using a 5-point Likert scale:
1. **Argument quality:** Are claims well-structured (claim + evidence + warrant)?
2. **Taxonomy grounding:** Do agents reference taxonomy nodes appropriately and accurately?
3. **Disagreement identification:** Do agents correctly identify the type of their disagreements (empirical vs. values vs. definitional)?
4. **Perspective-taking:** Do agents engage with opposing viewpoints rather than talking past each other?

Inter-rater reliability will be measured via Krippendorff's alpha. Statistical significance will be assessed via paired t-test or Wilcoxon signed-rank test.

**Expected results.** I expect BDI-structured context to produce significantly higher scores on disagreement identification (agents taught the BDI framework should classify disagreements more accurately) and perspective-taking (agents seeing opposing interpretations via situation nodes should engage more directly). I expect modest improvement on argument quality (BDI framing encourages structured reasoning) and taxonomy grounding (★-tiering directs attention to relevant nodes).

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

The rhetorical rigidity problem (Section 6.2) illustrates a broader principle: prompt engineering and parameter calibration are complementary interventions, not substitutes. The prompt-level fixes (move reordering, anti-repetition, move history) address *what the model is instructed to do*. The temperature increase (0.3 → 0.5) addresses *how the model samples from its output distribution*. Neither alone fully resolves the problem — low temperature makes even well-instructed models deterministic, while high temperature without clear instructions produces incoherent variation.

More broadly, a systematic audit revealed that the pipeline had accumulated temperature defaults appropriate for extraction (0.1-0.2) applied to deliberative tasks that benefit from moderate creativity (0.5-0.7). The mismatch between task type and sampling parameter was invisible in individual interactions but produced systematic quality degradation across debates. I recommend that multi-stage NLP pipelines explicitly calibrate temperature per task type rather than inheriting a single default.

The embedding similarity threshold calibration (Section 3.3) reveals a similar principle: the original threshold (0.3) was chosen without empirical validation and admitted 93.3% of node pairs — effectively no filtering. Empirical distribution analysis produced a principled threshold (0.45) that meaningfully filters while preserving diversity. The general lesson: hardcoded thresholds in NLP systems should be validated against their actual data distributions, not set by intuition.

The per-turn retrieval mechanism (Section 3.3) illustrates a related failure mode: *intended behavior masked by a silent implementation bug*. An earlier version of `getRelevantTaxonomyContext` built a per-turn query string from the debate topic and recent transcript, as designed, but then scored nodes against `matchingVectors[0]` — the first vector in object iteration order — and discarded the query text entirely. The selected node set was therefore deterministic across the entire debate, and the novelty validator fired repeatedly because the retrieval layer could not surface new candidates no matter how the debate evolved. The observable symptom (a validator warning) was three layers removed from the root cause (a line of code that threw away its own input). The general lesson: when an instrumented validator triggers persistently, the first hypothesis should be that the upstream mechanism it is checking is broken, not that the model is ignoring instructions. Prompt-level repairs to a downstream symptom cannot substitute for a functioning retrieval layer.

### 8.4 Metaphor as Cognitive Reset

The metaphor reframing mechanism (Section 6.6) addresses a limitation of pure logical argumentation: when agents have exhausted their repertoire of evidence-based and reasoning-based moves, introducing a novel conceptual frame can restructure the problem space. This is consistent with Lakoff and Johnson's (1980) observation that metaphors are not decorative but constitutive — they determine which aspects of a problem are salient and which are invisible.

The curated metaphor library represents a deliberate design choice: rather than allowing the AI to generate arbitrary metaphors (which risks incoherent or misleading frames), I provide eight carefully selected metaphors that each highlight genuine aspects of AI policy discourse. The stall detection mechanism ensures metaphors are introduced only when the debate has genuinely converged, preventing gratuitous reframing that could derail productive exchanges.

Early observations suggest that metaphor reframing is most productive when it bridges BDI layers — e.g., the "AI as Experiment" metaphor naturally connects empirical questions (Beliefs: what are the outcomes?) with normative questions (Desires: was informed consent given?) and strategic questions (Intentions: how do we ensure reversibility?). This cross-BDI bridging may explain why metaphorical arguments are classified as "Mixed" BDI affinity in the scheme taxonomy.

### 8.5 LLM Failure Modes as a Design Category

The five interventions (Section 6.8) represent a design category distinct from both prompt engineering and parameter calibration: *runtime monitoring and correction* of LLM-specific behavioral failures. Prompt engineering shapes what the model is instructed to do; parameter calibration shapes how it samples; runtime interventions detect and respond to failures *after they occur*.

This distinction matters because some LLM failure modes are not preventable through instruction. Sycophantic drift is not caused by unclear instructions — the model "knows" it should maintain its position but accommodates at the token level. Hallucinated evidence is not caused by missing instructions to be truthful — the model generates fabricated statistics with the same confidence as accurate ones. These failures require detection infrastructure (embeddings for drift, web search for verification, NLI for steelman checking) that operates outside the prompt.

The graceful degradation architecture — where each intervention checks for capability availability and silently skips if unavailable — reflects a pragmatic reality: not all deployment contexts provide all capabilities. The CLI adapter lacks web search, NLI, and embedding computation; the UI bridge provides all three. Rather than requiring a uniform capability set, the system adapts its intervention suite to what is available.

### 8.6 Falsifiability as a Structural Gap

The SPECIFY move addresses what may be the single most important structural gap in LLM debate: the absence of falsifiability commitments. In human academic debate, demanding "what would change your mind?" is recognized as the most truth-productive move because it forces hidden assumptions into the open and makes disagreements resolvable in principle. Its absence from the initial dialectical taxonomy — which included seven moves for challenging, conceding, and reframing positions — meant that debates could run for five rounds with neither side ever stating what would count as evidence against their position.

The moderator bias mechanism (triggered by isolated high-strength claims with no edges between them) targets the specific argument network topology that signals the need for falsifiability demands: when two debaters have built strong, well-supported positions that simply do not engage with each other, the productive move is not another counterexample or distinction but a demand that one side operationalize their position.

### 8.7 Limitations

**Taxonomy curation and iteration plateau.** While AI-assisted, the taxonomy requires significant human curation. Automated taxonomy proposal generation plateaus after 3-4 passes on the same health data — the system's token budget limits each pass to ~30 of 400+ unmapped concepts, and the same high-frequency concepts resurface. A full iteration cycle (propose → approve → re-summarize → re-propose) added 14 new nodes but did not significantly reduce the unmapped concept count (431 → 447 after re-summarization), indicating that the gap between automated extraction and taxonomy coverage is partially structural — not all unmapped concepts warrant dedicated nodes. NLI-based semantic deduplication of unmapped concepts (implemented via embedding-based cosine clustering at threshold 0.75) reduced 447 unique unmapped concepts to 354 clusters (21% reduction), addressing the repetition problem but not the structural gap.

**Three-POV simplification.** The accelerationist/safetyist/skeptic trichotomy is a deliberate simplification. Real AI policy discourse includes many more perspectives (industry, government, civil society, Global South, labor, etc.). The three-POV structure provides sufficient perspectival multiplicity for demonstrating the system's capabilities while remaining manageable.

**English only.** All documents, taxonomy nodes, and debate transcripts are in English. No cross-lingual evaluation has been conducted. The BDI framework and AIF vocabulary are language-independent, but the prompts, disambiguation tests, and genus-differentia patterns are English-specific.

**FIRE evaluation gap.** The gold-standard claim set (PP-1) required for rigorous FIRE evaluation has not yet been constructed. The FIRE methodology is presented based on system design and preliminary testing, not formal evaluation.

**Embedding model.** The all-MiniLM-L6-v2 model used for relevance scoring is a lightweight general-purpose encoder, not specialized for policy terminology. Empirical calibration showed it discriminates by POV (intra-POV mean similarity 0.58 vs cross-POV 0.47) but weakly by BDI category (0.54 vs 0.49 — only a 0.05 gap). This means BDI-aware relevance must be enforced at the prompt level (via BDI grouping and ★-tiering) rather than the embedding level. Domain-specific encoders may improve both dimensions.

**Concession harvesting scale.** The concession harvesting mechanism has been designed and implemented but not yet validated at scale. Meaningful validation requires concession data accumulated across 20+ debates — a volume that has not yet been reached.

**Metaphor reframing validation.** The curated metaphor library and stall detection mechanism have been implemented but not yet formally evaluated. Systematic evaluation requires tracking which metaphors produce novel arguments (vs. superficial restatements) across a large debate corpus.

**Context utilization measurement.** The injection instrumentation uses string matching for reference detection, which may miss paraphrased references and false-positive on coincidental term overlap. More sophisticated reference detection (e.g., NLI-based similarity between injected node content and response text) would improve accuracy.

**Neutral evaluator independence.** The neutral evaluator uses the same underlying LLM as the debate agents. While persona stripping removes explicit identity cues, the LLM may still recognize argument patterns associated with particular perspectives (e.g., scaling-focused arguments as "accelerationist"), partially undermining the blinding. True independence would require a different model family or human evaluators.

**Intervention threshold sensitivity.** The LLM failure mode interventions use fixed thresholds: base_strength > 0.4 for ledger inclusion, entailment < 0.6 for steelman rejection, 3 turns for sycophancy detection. These thresholds were set by judgment rather than empirical calibration. Systematic sensitivity analysis across debate corpora has not been conducted.

**SPECIFY move adoption.** The SPECIFY move's effectiveness depends on LLMs' ability to generate genuine falsifiability commitments rather than vague hedges ("I would change my mind if overwhelming evidence..."). Early observations suggest that explicit prompt instruction ("what specific outcome in the next 5 years") is necessary to elicit operationalized predictions, but formal evaluation has not been conducted.

### 8.8 Ethical Considerations

This system analyzes discourse about AI policy — a politically sensitive domain where computational tools can amplify certain perspectives while marginalizing others. Several ethical considerations apply:

**Perspective selection bias.** The three-POV structure (accelerationist, safetyist, skeptic) reflects perspectives prominent in Anglophone AI policy discourse. Perspectives from the Global South, indigenous communities, labor organizations, and non-technical stakeholders are not explicitly represented. The taxonomy's structure shapes which arguments are surfaced and which are invisible.

**Analytical vs. advocacy framing.** The system is designed as an analytical tool (mapping the discourse landscape) rather than an advocacy tool (recommending policy positions). However, the act of organizing perspectives into a structured taxonomy inevitably makes some framings more salient than others. The genus-differentia description format, by enforcing precision, may favor formalized academic perspectives over grassroots or experiential ones.

**AI-generated debate content.** Debate agents generate arguments based on taxonomy context, not personal belief or lived experience. Arguments attributed to the "safetyist" perspective are AI-generated approximations of safety-concerned positions, not authentic representations of any individual's views. This distinction must be clearly communicated to users.

**Concession harvesting and evolving positions.** Automated tracking of which positions are repeatedly conceded could be misused to claim that a perspective is "losing" the debate. The system explicitly frames concessions as signals about taxonomy accuracy, not about the merits of the underlying position — a distinction that must be maintained in any public presentation of results.

## 9. Conclusion

I have presented an integrated system for multi-perspective AI policy discourse analysis that addresses the fundamental limitation of flat, single-label stance detection. The three-layer approach — ontological grounding (DOLCE D&S + BDI + AIF), formal argumentation (QBAF with BDI-aware calibration), and confidence-gated extraction (FIRE) — demonstrates that respecting the multi-dimensional structure of policy disagreements produces richer, more auditable analysis than compressing opinions into binary labels.

Key findings include:

1. **BDI decomposition is principled and practical.** Separating empirical claims from normative commitments and strategic reasoning, using explicit disambiguation tests, improves both AI debate quality and argument strength calibration. The decomposition is not ad-hoc — it derives from established work in philosophy of mind and agent-based systems. Extending BDI decomposition to situation node interpretations (all 133 nodes now carry belief/desire/intention/summary per POV) enables debate agents to target specific layers within each perspective's understanding of shared concepts.

2. **Different claim types require different assessment infrastructure.** The Q-0 calibration outcome (AI succeeds on Desires/Intentions, fails on Beliefs) reveals a fundamental asymmetry traceable to the self-contained vs. externally-verifiable nature of different claim types. This finding generalizes beyond this system to any automated argumentation pipeline.

3. **Ontological vocabulary suffices for discourse analysis.** Adopting DOLCE/BDI/AIF naming conventions in JSON structures — without formal OWL/RDF reasoning — provides sufficient grounding to shape AI reasoning through prompt instructions and runtime validation. The "vocabulary over formalism" approach makes the system accessible and evolvable while preserving ontological rigor.

4. **Multi-agent debate requires active diversity management.** Without explicit move diversity enforcement, LLM debate agents converge on repetitive rhetorical patterns. The solution requires both prompt-level interventions (move ordering, anti-repetition, move history) AND parameter-level calibration (temperature appropriate to the task type). Neither alone suffices.

5. **Argumentation scheme classification enriches debate analysis.** Classifying the reasoning pattern behind each argument (13 Walton-derived schemes with scheme-specific critical questions) enables the moderator to steer debates toward specific vulnerabilities and the synthesis to produce machine-readable argument maps that explain not just *what* was attacked but *how* and *on what grounds*.

6. **Parameter calibration is an empirical discipline, not an intuition.** Thresholds and temperatures set without validation against actual data distributions produce systematic quality degradation that is invisible in individual interactions but measurable in aggregate. The embedding similarity threshold (0.3 → 0.45) and debate temperature (0.3 → 0.5) were both corrected through empirical analysis rather than guesswork.

7. **Metaphor reframing addresses convergence stalls.** When logical argumentation exhausts its repertoire, curated conceptual metaphors provide novel frames that restructure the problem space. Integrating metaphorical arguments into the scheme taxonomy (ARGUMENT_FROM_METAPHOR with four critical questions) ensures they receive the same analytical rigor as other argument types.

8. **Instrumentation enables data-driven optimization.** Context injection instrumentation — tracking which injected nodes are actually referenced by the model — transforms context engineering from intuition-based tuning to empirical optimization. The lightweight manifest approach (string matching, no additional AI calls) demonstrates that useful instrumentation need not be expensive.

9. **LLM debate agents require LLM-specific interventions.** Hallucinated evidence, steelman fabrication, sycophantic drift, and compression-window blindness are failure modes absent in human debate that require targeted countermeasures. The intervention architecture demonstrates that these can be addressed non-blockingly — each intervention degrades gracefully when required capabilities are unavailable, and failure in any intervention never aborts the debate.

10. **Persona-free evaluation surfaces framing bias.** The neutral evaluator — reading the same debate with speaker identities stripped — provides a bias-detection layer analogous to blinded peer review. Divergence between the persona synthesis and the neutral evaluation indicates where persona framing may have biased the assessment, giving users two independent perspectives on the same debate rather than a single potentially contaminated verdict.

11. **Falsifiability demands are the most truth-productive debate move.** The SPECIFY move — requiring a debater to state what specific evidence would change their mind — addresses a structural gap in the dialectical taxonomy. Without it, debates can run for multiple rounds with neither side ever committing to testable predictions. The moderator bias toward SPECIFY when the argument network shows isolated high-strength claims (strong positions with no direct engagement) targets the precise conditions where falsifiability demands are most productive.

Future work includes formal FIRE evaluation (E1), scaled concession harvesting validation, cross-lingual extension, integration with retrieval-augmented generation to address the Beliefs scoring gap, systematic evaluation of metaphor reframing effectiveness across debate corpora, and longitudinal analysis of neutral evaluator divergence patterns to identify which persona framings most frequently bias synthesis.

## References

ALDayel, A. and Magdy, W. (2021). Stance detection with BERT embeddings for web discourse. *Proceedings of the 16th International AAAI Conference on Web and Social Media (ICWSM)*.

Baroni, P., Rago, M., and Toni, F. (2019). From fine-grained properties to broad principles for gradual argumentation: A principled spectrum. *International Journal of Approximate Reasoning*, 105:252-286.

Bratman, M. (1987). *Intention, Plans, and Practical Reason*. Harvard University Press.

Cayrol, C. and Lagasquie-Schiex, M.-C. (2005). On the acceptability of arguments in bipolar argumentation frameworks. *Proceedings of the 8th European Conference on Symbolic and Quantitative Approaches to Reasoning with Uncertainty (ECSQARU)*, pages 378-389.

Chan, C. M., Chen, W., Su, Y., Yu, J., Xue, W., Zhang, S., Fu, J., and Liu, Z. (2024). ChatEval: Towards better LLM-based evaluators through multi-agent debate. *Proceedings of the 12th International Conference on Learning Representations (ICLR)*.

Chesnevar, C. I., McGinnis, J., Modgil, S., Rahwan, I., Reed, C., Simari, G., South, M., Vreeswijk, G., and Willmott, S. (2006). Towards an argument interchange format. *The Knowledge Engineering Review*, 21(4):293-316.

Du, Y., Li, S., Torralba, A., Tenenbaum, J. B., and Mordatch, I. (2023). Improving factuality and reasoning in language models through multiagent debate. *Proceedings of the 40th International Conference on Machine Learning (ICML)*.

Dung, P. M. (1995). On the acceptability of arguments and its fundamental role in nonmonotonic reasoning, logic programming and n-person games. *Artificial Intelligence*, 77(2):321-357.

Ebrahimi, J., Dou, D., and Lowd, D. (2022). A survey of stance detection in online texts. *ACM Computing Surveys*, 54(3):1-37.

Fauconnier, G. and Turner, M. (2002). *The Way We Think: Conceptual Blending and the Mind's Hidden Complexities*. Basic Books.

Gentner, D. and Markman, A. B. (1997). Structure mapping in analogy and similarity. *American Psychologist*, 52(1):45-56.

Guarino, N., Oberle, D., and Staab, S. (2009). What is an ontology? In *Handbook on Ontologies*, pages 1-17. Springer.

Holyoak, K. J. and Thagard, P. (1995). *Mental Leaps: Analogy in Creative Thought*. MIT Press.

Janier, M. and Reed, C. (2014). OVA+: An argument analysis interface. *Proceedings of the 5th International Conference on Computational Models of Argument (COMMA)*.

Jonnalagadda, S., Cohen, T., Wu, S., and Gonzalez, G. (2012). Enhancing clinical concept extraction with distributional semantics. *Journal of Biomedical Informatics*, 45(1):129-140.

Khan, A., Hughes, J., Valentine, D., Ruis, L., Sachan, M., and Perez, E. (2024). Debating with more persuasive LLMs leads to more truthful answers. *arXiv preprint arXiv:2402.06782*.

Lakoff, G. and Johnson, M. (1980). *Metaphors We Live By*. University of Chicago Press.

Lauscher, A., Ng, L., Napoles, C., and Tetreault, J. (2022). Rhetoric, logic, and dialectic: Advancing theory-based argument quality assessment. *Proceedings of the 29th International Conference on Computational Linguistics (COLING)*.

Lawrence, J., Janier, M., and Reed, C. (2012). Auto-segmentation of dialogical argumentation. *Proceedings of the 4th Workshop on Computational Models of Natural Argument (CMNA)*.

Li, Y., Sosea, T., Sawant, A., Nair, A. J., Inkpen, D., and Caragea, C. (2023). P-stance: A large dataset for stance detection in political domain. *Proceedings of the 61st Annual Meeting of the Association for Computational Linguistics (ACL)*.

Liang, T., He, Z., Jiao, W., Wang, X., Wang, Y., Wang, R., Yang, Y., Tu, Z., and Shi, S. (2023). Encouraging divergent thinking in large language models through multi-agent debate. *arXiv preprint arXiv:2305.19118*.

Ling, X. and Weld, D. S. (2012). Fine-grained entity recognition. *Proceedings of the 26th AAAI Conference on Artificial Intelligence*.

Luo, Y., Liu, Z., Shi, Y., and Zhang, Y. (2024). Exploring the sensitivity of LLMs to components of multi-dimensional stance. *Proceedings of the 2024 Conference on Empirical Methods in Natural Language Processing (EMNLP)*.

Masolo, C., Borgo, S., Gangemi, A., Guarino, N., and Oltramari, A. (2003). WonderWeb deliverable D18: Ontology library (final). *IST Project 2001-33052 WonderWeb*.

Mayer, T., Cabrio, E., and Villata, S. (2020). Transformer-based argument mining for healthcare applications. *Proceedings of the 24th European Conference on Artificial Intelligence (ECAI)*.

Mohammad, S. M., Kiritchenko, S., Sobhani, P., Zhu, X., and Cherry, C. (2016). SemEval-2016 task 6: Detecting stance in tweets. *Proceedings of the 10th International Workshop on Semantic Evaluation (SemEval)*.

Rago, A., Toni, F., Aurisicchio, M., and Baroni, P. (2016). Discontinuity-free decision support with quantitative argumentation debates. *Proceedings of the 15th International Conference on Principles of Knowledge Representation and Reasoning (KR)*.

Rahwan, I., Zablith, F., and Reed, C. (2007). Laying the foundations for a world wide argument web. *Artificial Intelligence*, 171(10-15):897-921.

Rao, A. S. and Georgeff, M. P. (1991). Modeling rational agents within a BDI-architecture. *Proceedings of the 2nd International Conference on Principles of Knowledge Representation and Reasoning (KR)*.

Smith, B., Ashburner, M., Rosse, C., et al. (2015). The OBO Foundry: coordinated evolution of ontologies to support biomedical data integration. *Nature Biotechnology*, 25(11):1251-1255.

Stab, C. and Gurevych, I. (2017). Parsing argumentation structures in persuasive essays. *Computational Linguistics*, 43(3):619-659.

Thibodeau, P. H. and Boroditsky, L. (2011). Metaphors we think with: The role of metaphor in reasoning. *PLoS ONE*, 6(2):e16782.

Törnberg, P. (2024). How to use LLMs for text analysis. *Proceedings of the National Academy of Sciences (PNAS)*, 121(24).

Walton, D., Reed, C., and Macagno, F. (2008). *Argumentation Schemes*. Cambridge University Press.

Wei, J., Wang, X., Schuurmans, D., Bosma, M., Ichter, B., Xia, F., Chi, E., Le, Q., and Zhou, D. (2022). Chain-of-thought prompting elicits reasoning in large language models. *Advances in Neural Information Processing Systems (NeurIPS)*, 35.
