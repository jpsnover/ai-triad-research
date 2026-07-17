# Literature Map and Paper-Worthy Contribution Inventory

**Ticket:** t/1606 (builds on t/1604)
**Author:** Computational Linguist
**Date:** 2026-07-17
**Status:** Draft for PM integration (paper prose is PM-owned; see handoff ticket)

This document maps the methods used in AI Triad Research to their closest prior academic work, inventories the project's paper-worthy novel contributions, prioritizes them, and connects each to a supporting ablation or causal study. Study numbers refer to the eleven-study catalog in [`rosetta-stone-ablation-causal-studies.md`](rosetta-stone-ablation-causal-studies.md) (t/1604); this document does not re-derive those designs.

A standing honesty constraint applies throughout. The five debate calibration metrics (`crux_addressed_rate`, `repetition_rate`, `claims_forgotten`, `convergence_score`, `situation_crux_alignment`) are unvalidated instruments until the single-rater validity preregistrations (t/1586, t/1342) complete. Every contribution whose evidence rests on these metrics is flagged **[UM]** (unvalidated metric) below. Novelty claims are literature-relative. Each is stated against the mapped works in Part 1, and none claims "first ever" beyond what the citation search covered.

---

## Part 1: Literature Map

Ten project methods, each with its closest prior work and a one-line relation: **adopts** (we use it as published), **extends** (we build on it in a direction the source did not take), or **departs** (we deliberately do something the source argues against or does not contemplate).

### 1.1 BDI decomposition of discourse positions

The project decomposes each policy camp's position into Beliefs, Desires, and Intentions, with every POV node in exactly one category.

| Prior work | Citation | Relation |
|---|---|---|
| Bratman, M.E. (1987). *Intention, Plans, and Practical Reason*. Harvard UP. | [archive.org](https://archive.org/details/intentionplanspr0000brat) | **Adopts** the belief/desire/intention trichotomy and the philosophical category test distinguishing them. |
| Rao, A.S. & Georgeff, M.P. (1995). BDI Agents: From Theory to Practice. *ICMAS-95*, pp. 312–319. | [PDF](https://cdn.aaai.org/ICMAS/1995/ICMAS95-042.pdf) | **Departs**: Rao & Georgeff use BDI as an agent *architecture* (mental states driving action selection); we use it as a *discourse-position schema* for organizing what a community asserts, wants, and plans. No BDI interpreter executes these nodes. |

### 1.2 Three-POV situation interpretation (DOLCE D&S grounding)

Shared situation nodes carry three camp-specific interpretations (accelerationist, safetyist, skeptic), and prompts elicit a `disagreement_type` (definitional, interpretive, structural) for each.

| Prior work | Citation | Relation |
|---|---|---|
| Gangemi, A. & Mika, P. (2003). Understanding the Semantic Web through Descriptions and Situations. *OTM 2003*, LNCS 2888, pp. 689–706. | [doi:10.1007/978-3-540-39964-3_44](https://doi.org/10.1007/978-3-540-39964-3_44) | **Extends**: D&S separates a situation (state of affairs) from the description that interprets it. We instantiate *three simultaneous competing descriptions* per situation and feed all three to debate agents, which the D&S pattern permits but its applications rarely operationalize. |
| Masolo, C., Borgo, S., Gangemi, A., Guarino, N. & Oltramari, A. (2003). WonderWeb Deliverable D18: Ontology Library. ISTC-CNR. Peer-reviewed successor: Borgo, S. et al. (2022). DOLCE: A descriptive ontology for linguistic and cognitive engineering. *Applied Ontology* 17(1):45–69. | [D18 PDF](http://www.loa.istc.cnr.it/old/Papers/D18.pdf) · [doi:10.3233/AO-210259](https://doi.org/10.3233/AO-210259) | **Adopts** DOLCE upper-ontology categories for situation typing, as vocabulary rather than axioms. |
| Gangemi, A., Guarino, N., Masolo, C., Oltramari, A. & Schneider, L. (2002). Sweetening Ontologies with DOLCE. *EKAW 2002*, LNCS 2473. | [doi:10.1007/3-540-45810-7_18](https://doi.org/10.1007/3-540-45810-7_18) | **Adopts** the "lightweight alignment to DOLCE" pattern for domain content. |
| Barwise, J. & Perry, J. (1983). *Situations and Attitudes*. MIT Press. | [archive.org](https://archive.org/details/situationsattitu00barw) | **Adopts** the underlying situation-semantics stance that meaning is relative to situated interpretation. |

### 1.3 AIF-typed argumentation graph

Eight canonical edge types (SUPPORTS, CONTRADICTS, ASSUMES, WEAKENS, RESPONDS_TO, TENSION_WITH, INTERPRETS, CONVERGES_WITH), attack subtypes rebut/undercut/undermine, and a `node_scope` classifier (claim/scheme/bridging).

| Prior work | Citation | Relation |
|---|---|---|
| Chesñevar, C. et al. (2006). Towards an argument interchange format. *Knowledge Engineering Review* 21(4):293–316. | [doi:10.1017/S0269888906001044](https://doi.org/10.1017/S0269888906001044) | **Extends**: AIF supplies the node/edge ontology for argument interchange; we adapt it into a fixed 8-type edge vocabulary tuned for policy-position graphs, adding CONVERGES_WITH (POV node → consensus situation), which AIF does not define. |
| Pollock, J.L. (1987). Defeasible Reasoning. *Cognitive Science* 11(4):481–518. | [doi:10.1207/s15516709cog1104_4](https://doi.org/10.1207/s15516709cog1104_4) | **Adopts** the rebut/undercut distinction for attack typing. |
| Prakken, H. (2010). An abstract framework for argumentation with structured arguments. *Argument & Computation* 1(2):93–124. | [doi:10.1080/19462160903564592](https://doi.org/10.1080/19462160903564592) | **Adopts** the full rebut/undercut/undermine trichotomy (ASPIC+). |
| Dung, P.M. (1995). On the acceptability of arguments... *Artificial Intelligence* 77(2):321–357. | [doi:10.1016/0004-3702(94)00041-X](https://doi.org/10.1016/0004-3702(94)00041-X) | **Departs**: we do not compute abstract acceptability semantics; edges inform debate context assembly, not extension calculation. |
| Walton, D., Reed, C. & Macagno, F. (2008). *Argumentation Schemes*. Cambridge UP. | [publisher](https://www.cambridge.org/us/catalogue/catalogue.asp?isbn=9780521723749) | **Adopts** the scheme concept behind the `node_scope=scheme` classification. |
| Toulmin, S.E. (1958). *The Uses of Argument*. Cambridge UP. | [doi:10.1017/CBO9780511840005](https://doi.org/10.1017/CBO9780511840005) | **Adopts** the warrant/backing intuition informally; no Toulmin-layout enforcement. |
| Kunz, W. & Rittel, H.W.J. (1970). Issues as Elements of Information Systems. UC Berkeley Working Paper 131. | [escholarship](https://escholarship.org/uc/item/5cj786v8) | **Extends**: IBIS pioneered issue-position-argument mapping for wicked problems; our graph plays that role for AI policy with a typed, machine-consumable edge vocabulary. |
| Lawrence, J. & Reed, C. (2019). Argument Mining: A Survey. *Computational Linguistics* 45(4):765–818. | [doi:10.1162/coli_a_00364](https://doi.org/10.1162/coli_a_00364) | **Adopts** the framing of automated argument-structure extraction; our extraction prompts target this structure directly. |

### 1.4 Situation injection with Lost-in-the-Middle ordering

Relevance-ranked situation nodes are injected into debate context, capped by `situation_max_nodes`, with the highest-priority situations placed at the boundaries of the injection block.

| Prior work | Citation | Relation |
|---|---|---|
| Liu, N.F. et al. (2024). Lost in the Middle: How Language Models Use Long Contexts. *TACL* 12:157–173. | [ACL](https://aclanthology.org/2024.tacl-1.9/) | **Extends**: Liu et al. established the U-shaped position effect as a measurement finding; we adopt boundary placement as a design rule *and* treat ordering as a manipulable experimental variable (Study 6). |
| Reimers, N. & Gurevych, I. (2019). Sentence-BERT. *EMNLP-IJCNLP 2019*, pp. 3982–3992. | [ACL](https://aclanthology.org/D19-1410/) | **Adopts** SBERT-style bi-encoder embeddings (all-MiniLM-L6-v2, 384-dim) for relevance ranking. |

### 1.5 Multi-agent debate engine with process telemetry

A three-agent BDI debate (accelerationist, safetyist, skeptic) with convergence scoring, crux tracking, and per-run calibration logging in `lib/debate/calibrationLogger.ts`.

| Prior work | Citation | Relation |
|---|---|---|
| Irving, G., Christiano, P. & Amodei, D. (2018). AI safety via debate. arXiv:1805.00899. | [arXiv](https://arxiv.org/abs/1805.00899) | **Departs**: Irving et al. use debate as a training/alignment signal judged for a winner; our debate is an *analysis instrument* for mapping disagreement structure, with no winner and no training loop. |
| Du, Y. et al. (2024). Improving Factuality and Reasoning in LMs through Multiagent Debate. *ICML 2024*. | [arXiv](https://arxiv.org/abs/2305.14325) | **Departs**: Du et al. optimize answer accuracy on tasks with ground truth; we measure debate *process* quality on contested questions with no ground truth. |
| Liang, T. et al. (2024). Encouraging Divergent Thinking in LLMs through Multi-Agent Debate. *EMNLP 2024*, pp. 17889–17904. | [ACL](https://aclanthology.org/2024.emnlp-main.992/) | **Extends**: Liang et al. diagnose degeneration-of-thought and prescribe disagreement; our fixed three-camp structure institutionalizes disagreement, and our repetition/forgetting metrics quantify the degeneration they describe. |
| Khan, A. et al. (2024). Debating with More Persuasive LLMs Leads to More Truthful Answers. *ICML 2024* (Best Paper). | [PMLR](https://proceedings.mlr.press/v235/khan24a.html) | **Adopts** the evidence that debate surfaces truth-relevant signal; **departs** from judge-accuracy as the outcome measure. |
| Chan, C.-M. et al. (2024). ChatEval: Towards Better LLM-based Evaluators through Multi-Agent Debate. *ICLR 2024*. | [arXiv](https://arxiv.org/abs/2308.07201) | **Departs**: ChatEval debates to *evaluate* external text; our agents debate the subject matter itself. |
| Wang, X. et al. (2023). Self-Consistency Improves Chain of Thought Reasoning. *ICLR 2023*. | [arXiv](https://arxiv.org/abs/2203.11171) | **Departs**: self-consistency aggregates independent samples; debate agents interact and update. Cited as the non-interactive baseline family. |
| Zheng, L. et al. (2023). Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena. *NeurIPS 2023 D&B*. | [arXiv](https://arxiv.org/abs/2306.05685) | **Adopts** LLM-as-judge methodology (with its documented biases) for metric computation, which is why the metrics carry the [UM] flag pending human validation. |
| Guo, C., Pleiss, G., Sun, Y. & Weinberger, K.Q. (2017). On Calibration of Modern Neural Networks. *ICML 2017*. | [PMLR](https://proceedings.mlr.press/v70/guo17a.html) | **Departs** terminologically: our "calibration log" measures debate-process quality, not probability calibration. The paper must draw this distinction explicitly. |
| Tian, K. et al. (2023). Just Ask for Calibration. *EMNLP 2023*, pp. 5433–5442. | [ACL](https://aclanthology.org/2023.emnlp-main.330/) | **Adopts** elicited-confidence techniques where debater self-assessments are used. |
| Kadavath, S. et al. (2022). Language Models (Mostly) Know What They Know. arXiv:2207.05221 (arXiv-only). | [arXiv](https://arxiv.org/abs/2207.05221) | **Adopts** the self-knowledge premise behind asking models to assess claim status; cite as preprint. |
| Sabien, D. (2016). Double Crux: A Strategy for Resolving Disagreement. CFAR blog (grey literature; no peer-reviewed source). | [CFAR](https://www.rationality.org/resources/updates/2016/double-crux) | **Extends**: the crux concept (the sub-question on which a disagreement actually turns) originates here; we operationalize crux identification and measure `crux_addressed_rate` per round. Must be cited as grey literature. |

### 1.6 Debate-Tested epistemic-testing record

Each taxonomy node accumulates a per-node testing ledger (`lib/debate/debateTested.ts`, t/1523): engagements with verdicts (`held`, `weakened`, `refined`, `open`, `cited`), a strongest-attack-encountered record, and a computed tier (`untested` → `cited` → `contested` → `well_tested`) with a severity-seeking scheduler (`severeTestScheduler.ts`).

| Prior work | Citation | Relation |
|---|---|---|
| Popper, K.R. (1959). *The Logic of Scientific Discovery*. Hutchinson (orig. 1934). Ch. 10, "Corroboration, or How a Theory Stands up to Tests." | [Routledge](https://www.routledge.com/The-Logic-of-Scientific-Discovery/Popper/p/book/9780415278447) | **Extends**: Popper's corroboration is a qualitative appraisal of how a theory has withstood severe tests. We operationalize it as a per-claim data structure: the tier ladder is a corroboration record, and the scheduler implements severity-seeking test selection. |
| Lakatos, I. (1970). Falsification and the Methodology of Scientific Research Programmes. In *Criticism and the Growth of Knowledge*, Cambridge UP, pp. 91–196. | [Cambridge](https://www.cambridge.org/core/books/abs/criticism-and-the-growth-of-knowledge/falsification-and-the-methodology-of-scientific-research-programmes/B1AAD974814D6E7BF35E6449691AA58F) | **Adopts** the progressive/degenerating distinction: the `refined` verdict records content-increasing modification (progressive problem-shift) as distinct from ad hoc weakening. |

### 1.7 Organization→POV claim matching (machine-proposes-human-disposes)

Organizations (`org-NNN`) are linked to POV nodes through a pipeline where the machine proposes typed edges (FUNDS, OPPOSES, ADVOCATES_FOR, ...) with evidence, and a human accepts or rejects each proposal.

| Prior work | Citation | Relation |
|---|---|---|
| Wu, X. et al. (2022). A survey of human-in-the-loop for machine learning. *Future Generation Computer Systems* 135:364–381. | [doi:10.1016/j.future.2022.05.014](https://doi.org/10.1016/j.future.2022.05.014) | **Adopts** the human-in-the-loop framing; our pipeline is an instance of machine-proposal with human verification. |
| Monarch, R. (Munro) (2021). *Human-in-the-Loop Machine Learning*. Manning. | [publisher](https://www.manning.com/books/human-in-the-loop-machine-learning) | **Adopts** the annotation-workflow patterns (model-assisted labeling with human adjudication). |
| Mohammad, S.M., Kiritchenko, S., Sobhani, P., Zhu, X. & Cherry, C. (2016). SemEval-2016 Task 6: Detecting Stance in Tweets. *SemEval-2016*. | [ACL](https://aclanthology.org/S16-1003/) | **Departs**: classic stance detection assigns favor/against/neutral toward one target; our pipeline assigns one of nine typed relations toward nodes in a structured taxonomy. |
| AlDayel, A. & Magdy, W. (2021). Stance Detection on Social Media: State of the Art and Trends. *IP&M* 58(4):102597. | [doi:10.1016/j.ipm.2021.102597](https://doi.org/10.1016/j.ipm.2021.102597) | **Extends**: the survey's target-specific stance framing generalizes here to organization-to-taxonomy alignment with edge-type semantics richer than polarity. |
| Small, C. et al. (2021). Polis: Scaling Deliberation by Mapping High Dimensional Opinion Spaces. *Recerca* 26(2). | [journal](https://www.e-revistes.uji.es/index.php/recerca/article/view/5516) | **Departs**: Polis induces opinion structure bottom-up from votes; we map actors onto a curated, ontology-typed position taxonomy. |

### 1.8 Embedding-based claim→node matching

Extracted claims are matched to taxonomy nodes by cosine similarity over all-MiniLM-L6-v2 embeddings.

| Prior work | Citation | Relation |
|---|---|---|
| Reimers, N. & Gurevych, I. (2019). Sentence-BERT. *EMNLP-IJCNLP 2019*. | [ACL](https://aclanthology.org/D19-1410/) | **Adopts** directly; this is standard practice and claimed as infrastructure, not contribution. |

### 1.9 Genus-differentia node authoring

Every node description follows a controlled template: "A [Belief|Desire|Intention] within [POV] discourse that [differentia]. Encompasses: ... Excludes: ..."

| Prior work | Citation | Relation |
|---|---|---|
| ISO 704:2022. *Terminology work — Principles and methods*. 4th ed. | [ISO](https://www.iso.org/standard/79077.html) | **Adopts** the intensional-definition standard (genus + delimiting characteristics) as the authoring template. |
| Guarino, N. & Welty, C. (2002). Evaluating Ontological Decisions with OntoClean. *CACM* 45(2):61–65. | [doi:10.1145/503124.503150](https://doi.org/10.1145/503124.503150) | **Adopts** the discipline of metaproperty-checked class definitions, applied informally during node review. |

### 1.10 Metric-provenance register

Every metric, threshold, weight, or lexicon in the project carries a declared provenance class (stipulated | derived | human-validated) in `research/comp-linguist/docs/metric-provenance-register.md`.

| Prior work | Citation | Relation |
|---|---|---|
| Wachsmuth, H. et al. (2017). Computational Argumentation Quality Assessment in Natural Language. *EACL 2017*, pp. 176–187. | [ACL](https://aclanthology.org/E17-1017/) | **Extends**: Wachsmuth et al. taxonomize argument-quality dimensions and note the gap between theory-derived and empirically grounded measures; the register makes that gap an explicit, auditable per-metric annotation. |

---

## Part 2: Novel-Contribution Inventory

Each entry states its novelty claim relative to the Part 1 map. None of these claims priority over unpublished or unindexed work; the claim is "not found in the mapped literature," established by the citation search behind Part 1.

**C1. Three-perspective D&S interpretation layer for policy situations.** The mapped D&S literature (§1.2) treats one description interpreting one situation; applications with *multiple simultaneous rival descriptions* of the same situation, elicited per ideological camp with a typed `disagreement_type`, and then fed as structured context to debate agents, do not appear in the mapped work. The novelty is the operational pattern of treating situation semantics as a data structure that carries disagreement rather than resolving it.

**C2. Situation injection as a controlled treatment variable.** RAG-style context injection is ubiquitous, and Liu et al. (§1.4) established position effects. What the mapped literature lacks is injection *policy* (relevance band, count, ordering) treated as a manipulable experimental variable with debate-process outcomes. The three-way design space (whether, which, where) with a dose-response cap sweep is not covered by the mapped work. **[UM]** Outcome measures are the unvalidated calibration metrics.

**C3. Process-level calibration telemetry for multi-agent debate.** The mapped debate literature (§1.5) measures answer accuracy or judge agreement. Per-round process metrics (crux engagement, repetition, claim forgetting, convergence trajectory, situation uptake) logged as first-class run telemetry do not appear in the mapped work; Liang et al. describe degeneration-of-thought qualitatively but do not instrument it. The contribution is the instrument suite plus the logging discipline. **[UM]** This contribution *is* the metrics; it cannot be published before the validity studies (t/1586, t/1342) report inter-rater agreement.

**C4. The Debate-Tested corroboration ledger.** Popperian corroboration (§1.6) has, in the mapped literature, no operationalization as a per-claim data structure in a knowledge base. Ours combines a verdict-typed engagement history, a strongest-attack-encountered record, a monotonically interpretable tier ladder (`untested`/`cited`/`contested`/`well_tested`), and a scheduler that seeks severe tests rather than confirmations. The Lakatos-derived `refined` verdict distinguishes content-increasing revision from mere weakening. This is a philosophy-of-science concept turned into a working epistemic-status system for LLM-mediated argumentation.

**C5. BDI as a discourse-position schema with AIF-typed edges.** BDI (§1.1) is an agent architecture in the mapped literature; AIF (§1.3) is an argument-interchange ontology. Their combination as a *taxonomy schema for ideological positions* (BDI layers as node categories, AIF-derived edges between them, plus CONVERGES_WITH linking positions to consensus situations) is not found in the mapped work. The novelty claim is the hybrid schema and its category test, not either component.

**C6. Machine-proposes-human-disposes actor-alignment pipeline with typed edges.** Stance detection (§1.7) assigns polarity toward targets; HITL annotation (§1.7) verifies labels. The combination here (nine-type actor-relation vocabulary, evidence-carrying machine proposals against an ontology-structured position taxonomy, human adjudication as the commit gate) is an engineering-methods contribution suited to a systems or computational-social-science venue rather than a core NLP one.

**C7. Genus-differentia controlled authoring as an extraction-quality intervention.** ISO 704 definitions (§1.9) are a terminology-management practice. Using the template as a *treatment* hypothesized to improve LLM extraction matching (clearer differentia → better claim→node assignment) is a small but clean empirical question the mapped literature does not ask.

Three methods stay out of the inventory to keep it honest. Embedding-based matching (§1.8) is standard practice. The provenance register (§1.10) is good hygiene that strengthens the *methods sections* of the papers above but is too thin to anchor a paper alone. The debate engine's resilience engineering (crash recovery, flight recording) is solid systems work outside this research program's thesis.

---

## Part 3: Prioritization

Ranking dimensions: **novelty** (distance from mapped literature), **evidence-readiness** (does a designed study exist, and are its instruments trusted), and **audience** (is there an identifiable venue community that cares). Scores are low/medium/high with rationale; the ranking is the CL's judgment, not a computed index.

| Rank | Contribution | Novelty | Evidence-readiness | Audience | Flags |
|---|---|---|---|---|---|
| 1 | C2 situation injection as treatment | High | High (Studies 1, 2, 3, 6 designed) | High (LLM-systems, RAG) | [UM] |
| 2 | C4 Debate-Tested ledger | High | Low (no designed study yet; sketch N-1 below) | Medium-high (epistemology-of-AI, argumentation) | |
| 3 | C1 three-POV D&S layer | High | Medium (Study 4 designed) | Medium (applied ontology, comp. argumentation) | [UM] |
| 4 | C3 calibration telemetry | Medium-high | Blocked (instrument validation t/1586, t/1342 must land first) | High (multi-agent LLM evaluation) | [UM by definition] |
| 5 | C5 BDI+AIF hybrid schema | Medium | Medium (Studies 8, 9, 10; Study 8 low-feasibility) | Medium (argumentation, knowledge engineering) | [UM] partially |
| 6 | C6 org-alignment pipeline | Medium | Low (no designed study; sketch N-2 below) | Medium (comp. social science, systems) | |
| 7 | C7 genus-differentia treatment | Low-medium | Medium (Study 11 designed, 80 runs, cheap) | Low as standalone (methods footnote otherwise) | |

**Rationale for the top of the table.** C2 leads because it is the only contribution where high novelty meets an already-designed, costed evidence package. t/1604 names Studies 1, 2, 3 as the first-paper minimum (550 runs, one topic set, one frozen backend). C4 is the most distinctive idea in the project and the strongest candidate for a second paper, but it currently has zero designed evidence; it ranks second on novelty alone and cannot ship first. C3 is the inverse case. The metrics already exist in production, but publishing an instrument suite whose validity is unmeasured would be the overclaim our own honesty constraints prohibit, so it waits on t/1586/t/1342 and then becomes a strong measurement paper. C7, at the other end, is worth running (Study 11 is the cheapest in the catalog) but publishes as a section inside a larger paper, not alone.

**Recommended first-paper target.** One paper combining C2 (lead contribution) with C1 (the interpretation layer that makes injection content distinctive), evidenced by Studies 1, 2, 3, plus Study 4 if budget allows and Study 6 as the ordering appendix. This matches the t/1604 first-paper minimum and adds the framing that differentiates the work from generic RAG ablations, since what is injected is not retrieved text but ontology-grounded situations carrying three rival interpretations. Second paper: C4 evidenced by new study N-1. Third: C3 as a measurement/validation paper once the preregistered validity work lands, incorporating C5 evidence (Studies 9, 10) as construct support.

---

## Part 4: Supporting-Study Plan

Per contribution: either a reference to a t/1604 study by number, or a new sketch where no existing design covers the claim. Type labels follow the t/1604 contract (ablation = controlled comparison of system configurations; causal = single-point intervention, matched control, fixed-seed replication, dose-response where possible).

| Contribution | Supporting studies | Type | Coverage |
|---|---|---|---|
| C1 three-POV D&S | Study 4 (three-POV vs single shared interpretation) | Ablation | Covered by t/1604 |
| C2 injection as treatment | Study 1 (relevance-as-treatment), Study 2 (none/random/ranked), Study 3 (count dose-response), Study 6 (ordering) | Causal, Ablation, Causal, Ablation | Covered by t/1604 |
| C3 calibration telemetry | t/1586 + t/1342 (instrument validation, preregistered), then Study 5 (prompt-only intervention) as the demonstration | Validation, then Causal | Validation preregs exist; Study 5 covered |
| C4 Debate-Tested ledger | **New: Sketch N-1** | Validity (causal-adjacent) | Not covered; see below |
| C5 BDI+AIF schema | Study 8 (BDI on/off; low feasibility), Study 9 (`disagreement_type` on/off), Study 10 (AIF edge typing on/off) | Ablation ×3 | Covered by t/1604 |
| C6 org pipeline | **New: Sketch N-2** | Measurement (with one ablation arm) | Not covered; see below |
| C7 genus-differentia | Study 11 (templated vs plain descriptions) | Ablation | Covered by t/1604 |

### Sketch N-1: Does the Debate-Tested tier predict independent claim robustness?

- **Hypothesis:** Nodes at higher tiers (`well_tested` > `contested` > `cited` > `untested`) survive novel adversarial challenge at higher rates, and human raters judge them better-supported, at effect sizes large enough to justify the tier as an epistemic-status signal.
- **Manipulated variable:** None in the classic sense; this is a predictive-validity design with a causal arm. Arm A (predictive): sample N nodes stratified by tier, freeze their records, then run fresh adversarial debates (challenger prompts constructed blind to tier) and measure survival (verdict `held` or `refined` vs `weakened`). Arm B (causal): for matched node pairs, randomly assign one to the severe-test scheduler and one to confirmation-seeking engagement for K cycles; compare resulting tier trajectories against blinded human robustness ratings.
- **Outcome metrics:** Tier-stratified survival rate under novel challenge; Spearman correlation between tier and blinded human robustness rating; scheduler-arm difference in human-rated robustness. Human ratings are the criterion, so this study does not inherit the [UM] flag.
- **Why existing designs do not cover it:** Studies 1–11 all treat debate *inputs* (injection, prompts, schema) as the manipulated variable and calibration metrics as outcomes. None tests whether an *accumulated record* over many debates carries valid information. N-1 validates a different artifact class (the ledger, not the run) against a human criterion.
- **Label:** Validity study with one causal arm. Estimated 60 nodes × 3 challenge debates + 2-rater human panel; feasibility medium (rater time is the binding cost, same pool as t/1586).

### Sketch N-2: Precision/recall of the org→POV edge pipeline against a human gold standard

- **Hypothesis:** Machine-proposed typed edges reach precision ≥0.8 against human adjudication, and embedding-based candidate retrieval contributes recall that keyword retrieval alone does not.
- **Manipulated variable:** Candidate-generation method (embedding similarity vs keyword overlap vs union) as an ablation arm; the measurement core has no manipulation.
- **Outcome metrics:** Per-edge-type precision and recall against a gold set of ~200 human-adjudicated org→node pairs (double-annotated, with inter-annotator agreement reported); acceptance rate of machine proposals in the production human-disposes queue as an ecological check.
- **Why existing designs do not cover it:** The t/1604 catalog measures debate-process outcomes exclusively; no study touches the organization pipeline, and none produces precision/recall against human labels.
- **Label:** Measurement study with one ablation arm. Estimated 200 gold pairs, 2 annotators; feasibility high (no debate runs required).

---

## Handoff and process notes

- Paper-bound content from this document routes to the Project Manager for integration into `docs/academic-paper-draft.md`; the CL does not commit that file. A PM-scoped integration ticket accompanies this document (pattern: t/1605).
- No new production metrics, thresholds, or weights are defined here, so no provenance-register entry is triggered. Sketches N-1 and N-2 would trigger register entries only when implemented.
- The [UM] flags in Parts 2–3 are load-bearing. Any paper draft that cites `crux_addressed_rate` or its siblings as evidence before t/1586/t/1342 report must present them as instruments under validation, not validated measures.
