# Academic Paper Plan: Computational Linguistics Contributions

## Production Plan

### Working Title

**"BDI-Grounded Argumentation for Multi-Perspective AI Policy Analysis: Integrating QBAF, FIRE, and Ontological Framing in a Living Taxonomy"**

Shorter alternative for space-constrained venues:
**"Ontology-Grounded Multi-Agent Argumentation for AI Policy Discourse Analysis"**

### Core Thesis

Structured AI policy discourse analysis requires three layers that existing systems lack: (1) ontological grounding that separates empirical claims from normative commitments and strategic reasoning (BDI), (2) formal argumentation frameworks that propagate argument strength through attack/support networks (QBAF), and (3) confidence-gated extraction that distinguishes reliable claims from hallucinated ones (FIRE). This paper presents an integrated system that combines all three, demonstrating that ontology-aware argumentation produces richer, more auditable policy analysis than flat stance classification or unstructured debate.

### Target Venues (ranked by fit)

| Venue | Fit | Deadline cycle | Why |
|-------|-----|---------------|-----|
| **ACL 2027** (main conference) | High | ~Jan 2027 | Flagship CL venue. The BDI-grounded prompt engineering, FIRE extraction, and multi-agent debate protocol are novel CL contributions. |
| **EMNLP 2026** (main conference) | High | ~Jun 2026 | Strong fit for empirical NLP systems. FIRE evaluation and QBAF calibration provide quantitative results. Tight timeline. |
| **ArgMining @ ACL/EMNLP** (workshop) | Very High | Varies | Dedicated argument mining workshop. Perfect audience for QBAF, AIF alignment, attack typology, preference resolution. Lower bar, faster turnaround. Good first target. |
| **COMMA 2026** (Computational Models of Argument) | Very High | ~Apr 2026 | Premier formal argumentation venue. QBAF calibration, BDI-aware scoring, concession harvesting are direct contributions to COMMA's scope. |
| **NAACL 2027** | Medium | ~Dec 2026 | North American venue, good for systems papers. Slightly less international reach than ACL. |
| **AI & Society** (journal) | Medium | Rolling | Interdisciplinary journal. Better for the policy analysis framing than the technical CL contributions. Consider for a companion paper. |
| **Argument & Computation** (journal) | High | Rolling | Dedicated journal for computational argumentation. QBAF + AIF + concession harvesting fit perfectly. Longer review cycle but archival. |

**Recommended strategy:** Submit to **ArgMining workshop** first (lower risk, fast feedback, establishes priority), then expand to **ACL or COMMA** main conference with evaluation results from ArgMining feedback.

### Authorship Considerations

- **Primary author(s):** Project lead + computational linguist (system design, evaluation design, linguistic analysis)
- **Contributing authors:** Team members who implemented core systems (QBAF engine, FIRE engine, debate protocol, taxonomy editor)
- **Acknowledgments:** All Orca agents who contributed to design decisions (traceable via git co-author tags and email threads)
- **Ethics statement required** for ACL venues — the system analyzes AI policy discourse, which is politically sensitive. Frame as analytical tool, not advocacy platform. The three-POV structure (accelerationist/safetyist/skeptic) is explicitly designed to prevent single-perspective bias.

### Required Experiments and Evaluations

| Experiment | What it measures | Data needed | Status |
|------------|-----------------|-------------|--------|
| **E1: FIRE vs single-shot extraction quality** | Precision/recall of factual claim extraction with and without iterative refinement | 20-30 documents with gold-standard annotated claims | Gold-standard set needed (PP-1) |
| **E2: QBAF calibration (Q-0 results)** | Correlation between AI-scored and human-scored argument strength, per BDI layer | 41 calibration claims + 8 hold-out claims (already scored) | Complete — r=0.65 Desires, r=0.71 Intentions, Beliefs=human-assigned |
| **E3: BDI context vs flat context for debate quality** | Does BDI-structured taxonomy injection improve debate agent reasoning vs unstructured injection? | A/B test: 10 debates with BDI context vs 10 with flat node list, human evaluation of argument quality | Needs design + execution |
| **E4: Concession harvesting accuracy** | Do classified concessions (full/conditional/tactical) correctly predict taxonomy evolution needs? | Concession accumulator data from 20+ debates | Needs Phase 1 data accumulation |
| **E5: Cross-POV disagreement typing** | Agreement between AI-assigned and human-assigned disagreement types (definitional/interpretive/structural) | 50 disagreement instances from debate synthesis, human-annotated | Needs annotation |
| **E6: FIRE sniff precision** | Does the two-stage sniff correctly identify documents that benefit from FIRE? | 50 documents: run both single-shot and FIRE, compare quality delta vs sniff prediction | Needs execution after sniff implementation |
| **E7: Genus-differentia description compliance** | Before/after comparison of description quality with ontological grounding enforcement | Taxonomy audit data (t/91 baseline: 65.6% compliance) | Partial — baseline exists |
| **E8: Move diversity post-PQ-9** | Does the dialectical move diversity fix (PQ-9) produce more varied debate exchanges? | 10 debates pre-fix vs 10 debates post-fix, measure move_types distribution | Pre-fix data exists (Debate.json), post-fix needs collection |

**Minimum viable evaluation for ArgMining:** E1 + E2 + E3 (extraction quality, QBAF calibration, BDI context impact)

**Full evaluation for ACL/COMMA:** All eight experiments

### Data Availability

| Dataset | Size | Availability | Sensitivity |
|---------|------|-------------|-------------|
| Taxonomy (4 POVs) | ~500 nodes | Can release (no PII) | Low — ontological structure, not personal data |
| Source documents | ~80 documents | Mixed — some are copyrighted PDFs | Release metadata + snapshots where permitted; cite originals otherwise |
| Summaries | ~80 JSON files | Can release (derived analysis) | Low |
| Debates | ~25 sessions | Can release (AI-generated, no PII) | Low |
| QBAF calibration data | 49 claims with human scores | Can release | Low |
| Conflict instances | ~1,500 entries | Can release | Low |

**Recommendation:** Release the taxonomy, debate transcripts, QBAF calibration data, and conflict instances as a companion dataset. Source documents require per-document copyright review. Summaries are derivative but should be releasable.

### Timeline

| Milestone | Target | Dependency |
|-----------|--------|------------|
| Gold-standard claim set (PP-1) designed | +2 weeks | CL + domain expert annotation |
| E1 (FIRE vs single-shot) executed | +4 weeks | PP-1 complete |
| E3 (BDI vs flat context) designed and run | +4 weeks | 20 debates generated |
| E5 (disagreement typing) annotated | +3 weeks | 50 instances selected + annotated |
| ArgMining draft | +8 weeks | E1 + E2 + E3 results |
| ArgMining submission | +10 weeks | Review + revision |
| Full evaluation (E4-E8) for main conference | +16 weeks | Concession data accumulated, FIRE sniff implemented |
| ACL/COMMA draft | +20 weeks | All experiments complete |

---

## Paper Outline

### 1. Introduction
Motivate the problem: AI policy discourse involves competing empirical claims, normative commitments, and strategic reasoning that existing NLP tools (binary stance detection, flat topic models) compress into lossy single-label representations, losing the multi-dimensional structure that makes policy disagreements tractable.

#### 1.1 The Projection Problem in Stance Detection
Current stance detection systems project multi-dimensional opinions (factual belief, severity assessment, policy support) onto binary Favor/Against labels, producing false disagreements when annotators and models compress different dimensions differently.

#### 1.2 Contributions
Enumerate the three-layer contribution: ontological grounding (BDI + DOLCE + AIF), formal argumentation (QBAF with BDI-aware scoring), and confidence-gated extraction (FIRE). State that the system is deployed and actively used for AI policy research.

### 2. Related Work
Position the system against existing work in argument mining, stance detection, and computational argumentation.

#### 2.1 Argument Mining and Claim Extraction
Survey claim extraction pipelines (Stab & Gurevych 2017, Lauscher et al. 2022), noting the gap between extraction and formal argumentation — most systems extract claims but don't compute argument strength or propagate attack/support relationships.

#### 2.2 Stance Detection and Multi-Dimensional Opinion
Survey binary stance detection limitations (Mohammad et al. 2016, ALDayel & Magdy 2021) and recent work on multi-dimensional stance (Li et al. 2023). Position BDI decomposition as a principled alternative to ad-hoc multi-label schemes.

#### 2.3 Computational Argumentation Frameworks
Survey QBAF and gradual semantics (Baroni et al. 2018, Rago et al. 2016), AIF (Chesnevar et al. 2006, Rahwan et al. 2007), and existing tools (OVA, AIFdb). Note the gap: existing QBAF implementations use synthetic data or small-scale experiments — our system applies QBAF to real discourse at scale with calibrated base scores.

#### 2.4 Ontology-Grounded NLP
Survey ontology use in NLP (DOLCE in discourse analysis, BFO in biomedical NLP). Position our DOLCE D&S + BDI + AIF composite as a novel layered ontology for perspectival discourse, noting the "vocabulary over formalism" design decision.

#### 2.5 LLM-as-Debater and Multi-Agent Argumentation
Survey multi-agent debate systems (Du et al. 2023, Liang et al. 2023, Chan et al. 2024). Note the rhetorical rigidity problem (agents defend assigned stances without genuine concession) and our mitigation (dialectical move diversity, commitment tracking, concession harvesting).

### 3. System Architecture
Describe the overall system as a pipeline: ingest → extract → argue → synthesize → evolve.

#### 3.1 Ontological Grounding Layer
Describe the three-framework composite: DOLCE D&S provides perspectival multiplicity (situation nodes with three POV interpretations), BDI structures agent mental attitudes (Beliefs/Desires/Intentions with disambiguation tests), AIF provides argumentation vocabulary (7 edge types, attack typology, argument schemes). Justify "vocabulary over formalism" — JSON structures with ontological naming, not OWL/RDF.

#### 3.2 Taxonomy Structure
Describe the four-POV taxonomy (accelerationist/safetyist/skeptic/situations) with ~500 nodes. Detail genus-differentia description format, BDI category assignment with disambiguation tests, and the node attribute schema (epistemic_type, rhetorical_strategy, node_scope, steelman_vulnerability, possible_fallacies).

#### 3.3 BDI-Structured Context Injection
Describe `formatTaxonomyContext`: how nodes are grouped by BDI category with framing headers, tiered by relevance (primary ★ vs supporting), and how CHESS dynamic branch injection selects relevant taxonomy branches for each debate topic.

### 4. FIRE: Confidence-Gated Iterative Claim Extraction
Present FIRE as a contribution to claim extraction methodology.

#### 4.1 Motivation: Single-Shot Extraction Failures
Characterize three failure modes: specificity collapse (safe vagueness), warrant deficit (skim-and-assert), and claim clustering (attention tunnel). Argue that these are predictable from extraction output properties, motivating the confidence-gated approach.

#### 4.2 The Evidence Criteria Heuristic
Define the three universal criteria (specificity, has_warrant, internally_consistent) and the BDI-specific criteria. Analyze what the heuristic actually measures (extraction surface quality) vs what it doesn't (factual accuracy, importance). Present the confidence formula and threshold.

#### 4.3 Iterative Refinement Protocol
Describe the three phases: initial extraction, confidence assessment, targeted follow-up. Detail the refinement prompt design (single-claim focus, verbatim quote requirement). Discuss termination guardrails (per-claim, per-document, wall-clock, API budget).

#### 4.4 The FIRE Sniff: Automatic Triggering
Describe the two-stage sniff: Stage 1 pre-extraction filter (word count, chunking, PDF complexity), Stage 2 post-extraction evaluation (5 output signals, 2+ threshold). Present the cost model.

#### 4.5 Evaluation (E1)
Present FIRE vs single-shot extraction quality on the gold-standard claim set. Metrics: precision, recall, F1 for claim identification; mean absolute error for evidence_criteria scoring.

### 5. QBAF: Formal Argument Strength in Multi-POV Discourse
Present the QBAF integration as a contribution to computational argumentation.

#### 5.1 DF-QuAD Gradual Semantics
Describe the DF-QuAD engine: base_strength propagation through attack (rebut/undercut/undermine with differential weights) and support relationships. Convergence criterion (0.001 threshold).

#### 5.2 BDI-Aware Base Score Calibration
Present the Q-0 calibration journey: holistic scoring failure (r=-0.12), decomposed rubric design, BDI-blind bias discovery (source-evidence bias underscores Desires/Intentions), BDI-aware rubric with universal + category-specific criteria. Final hybrid: AI for Desires/Intentions, human for Beliefs. Present calibration results (r=0.65/0.71) and hold-out validation (MAE=0.13/0.24).

#### 5.3 Why Beliefs Resist Automated Scoring
Analyze the fundamental asymmetry: evidence quality assessment requires verifying claims against external sources the model can't access, while values-grounding (Desires) and mechanism-detection (Intentions) are self-contained in the claim text. This is a property of the BDI layers, not a prompt engineering failure.

#### 5.4 Evaluation (E2)
Present Q-0 calibration data: per-BDI Pearson r, per-BDI MAE, score distributions, failure analysis (which claim types resist automated scoring and why).

### 6. Multi-Agent Debate with Ontological Grounding
Present the debate system as a contribution to multi-agent argumentation.

#### 6.1 Debate Protocol Design
Describe the debate pipeline: clarification phase, opening statements, cross-respond selection (moderator), dialectical responses, synthesis. Detail how BDI context injection teaches agents their worldview structure.

#### 6.2 Dialectical Move Taxonomy and Diversity
Present the six dialectical moves (CONCEDE, DISTINGUISH, REFRAME, COUNTEREXAMPLE, REDUCE, ESCALATE). Diagnose the rhetorical rigidity problem (90% CONCEDE+DISTINGUISH in initial implementation). Present the fix: move ordering, anti-repetition instructions, sentence variety, move history injection. Analyze the linguistic mechanisms (primacy bias, JSON example anchoring).

#### 6.3 Commitment Tracking and Concession Harvesting
Describe per-debater commitment stores (asserted/conceded/challenged). Present concession harvesting: classification (full/conditional/tactical with linguistic markers), weighted accumulation across debates, threshold-gated taxonomy evolution. Argue this closes the loop between argumentation output and ontology evolution.

#### 6.4 Preference Resolution and Synthesis
Describe how synthesis evaluates which arguments prevail, by what criterion (empirical_evidence/logical_validity/source_authority/specificity/scope), with rationale. Connect to AIF preference applications.

#### 6.5 Disagreement Typing
Present the three disagreement types (EMPIRICAL/VALUES/DEFINITIONAL) and their mapping to BDI layers (Belief divergence/Desire divergence/conceptual divergence). Argue this classification determines whether a disagreement is resolvable by evidence, negotiable via tradeoffs, or requires term clarification.

#### 6.6 Evaluation (E3, E5, E8)
E3: BDI-structured vs flat context — human evaluation of argument quality, taxonomy reference accuracy, disagreement identification. E5: Disagreement typing accuracy — inter-annotator agreement. E8: Move diversity pre/post PQ-9.

### 7. Cross-POV Conflict Detection and Resolution
Present the conflict detection pipeline as a contribution to automated discourse analysis.

#### 7.1 From Binary Matching to QBAF-Augmented Analysis
Describe the evolution from binary conflict detection (Find-Conflict) to QBAF-augmented analysis (Invoke-QbafConflictAnalysis). Show how attack/support propagation produces computed_strength that reflects the full argument network, not just pairwise claim comparison.

#### 7.2 Situation Nodes as Perspectival Anchors
Describe how DOLCE D&S situation nodes (with three POV interpretations) serve as shared reference points for cross-POV analysis. When two POVs interpret the same situation differently, the disagreement_type classification identifies whether the conflict is definitional, interpretive, or structural.

#### 7.3 Steelman Vulnerability and Fallacy Detection
Describe per-POV steelman vulnerability analysis (identifying each position's strongest counterargument) and tiered fallacy detection (formal/informal_structural/informal_contextual/cognitive_bias). Position these as argumentation quality diagnostics that help analysts identify where positions are genuinely weak vs where they're being unfairly attacked.

### 8. Discussion
Reflect on design decisions, limitations, and broader implications.

#### 8.1 Vocabulary Over Formalism
Justify the decision to adopt ontological vocabulary in JSON structures rather than OWL/RDF triples. Argue that for discourse analysis (as opposed to biomedical ontology or knowledge graphs), the naming conventions and prompt instructions provide sufficient grounding without the engineering overhead of formal ontology reasoning.

#### 8.2 The Human-AI Scoring Boundary
Reflect on the Q-0 outcome: AI reliably scores Desires and Intentions claims but not Beliefs claims. Discuss implications for automated argumentation systems — which assessment tasks should be automated and which require human judgment? Generalize beyond this project.

#### 8.3 Limitations
- Taxonomy is manually curated (with AI assistance) — not fully automated
- Three POVs is a simplification of the actual AI policy landscape
- English-only — no cross-lingual evaluation
- FIRE evaluation requires gold-standard annotation (expensive)
- Concession harvesting not yet validated at scale (Phase 1 data accumulating)
- Embedding model (all-MiniLM-L6-v2) is lightweight — domain-specific encoders may improve relevance scoring

#### 8.4 Ethical Considerations
The system analyzes discourse about AI policy — a politically sensitive domain. The three-POV structure is designed to prevent single-perspective bias, but the choice of which three perspectives to model is itself a framing decision. Discuss whose perspectives are included, whose are excluded, and how the taxonomy's structure shapes which arguments are surfaced.

### 9. Conclusion
Summarize the three-layer contribution (ontological grounding, formal argumentation, confidence-gated extraction). Argue that multi-perspective policy analysis requires computational linguistics tools that respect the multi-dimensional structure of policy disagreements rather than compressing them into binary labels.

### Appendices

#### A. Taxonomy Schema
Full JSON schema for POV nodes and situation nodes with all attribute fields.

#### B. Prompt Templates
Representative prompt excerpts: debate system prompt with BDI context, FIRE refinement prompt, QBAF evidence criteria prompt, concession classification prompt.

#### C. QBAF Calibration Data
Full Q-0 results table: 49 claims with human scores, AI rubric scores, evidence_criteria breakdown, per-BDI correlations.

#### D. Dialectical Move Distribution
Pre-PQ-9 vs post-PQ-9 move_types frequency analysis across 20 debates.
