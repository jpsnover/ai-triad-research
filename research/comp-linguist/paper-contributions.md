# Paper Contribution Paragraphs

Draft text for inclusion in general or academic papers. Each section is self-contained and can be adapted to the target venue.

---

## 1. Per-Claim Sycophancy Detection in Multi-Agent Debate

**Venue fit:** AI Safety, LLM Alignment, Computational Argumentation (COMMA, AAAI, ACL)

### Problem Statement

Large language models exhibit sycophancy — the tendency to shift positions toward an interlocutor's views rather than maintaining principled disagreement (Perez et al., 2023; Sharma et al., 2023). In multi-agent debate systems where LLM-powered agents represent distinct viewpoints, sycophancy undermines the epistemic value of the debate by collapsing genuine disagreements into artificial consensus.

### Prior Approach and Its Limitations

Existing sycophancy detection relies on holistic embedding drift: the agent's current response is compared against its opening statement using cosine similarity of sentence embeddings. A monotonic decrease in self-similarity coupled with increasing similarity to an opponent's opening triggers a sycophancy warning. However, this approach conflates legitimate position refinement with capitulation. When a debater updates one claim based on evidence while maintaining three others, the holistic embedding shifts — triggering a false alarm. The method is simultaneously too sensitive (false positives on refinement) and too coarse (misses targeted capitulation on individual claims).

### Our Approach

We decompose sycophancy detection from the statement level to the claim level. After opening statements, the argument network's claim extraction pipeline identifies 3–8 distinct claims per speaker, each with an independent embedding. On subsequent turns, new claims are embedded and compared against the speaker's opening claims using cosine similarity, producing a per-claim drift classification:

- **Maintained** (similarity ≥ 0.7): the claim is recognizably the same position
- **Refined** (0.3 ≤ similarity < 0.7): the claim has evolved but is not abandoned
- **Abandoned** (similarity < 0.3): the position has been dropped

The sycophancy signal is computed as the fraction of opening claims classified as *abandoned without explicit concession*. The system integrates with a concession tracker that records when a debater explicitly grants a point using concessive language ("I concede," "fair point," "you're right that..."). Claims with recorded concessions are exempted from the sycophancy score — they represent principled updates, not accommodation.

The guard fires only when more than 50% of a speaker's opening claims are abandoned without concession after three or more turns. The holistic embedding drift method is preserved as a fallback when per-claim tracking is unavailable (e.g., when the embedding adapter is offline).

### Significance

This approach makes three contributions: (1) it distinguishes legitimate intellectual progress from sycophantic drift at the granularity of individual arguments; (2) it integrates concession tracking to avoid penalizing the very behavior debates are designed to produce — genuine engagement with opposing evidence; and (3) it provides per-claim observability that enables fine-grained analysis of how positions evolve through multi-turn argumentation.

---

## 2. Adaptive Damping for DF-QuAD on Cyclic Attack Graphs

**Venue fit:** Computational Argumentation (COMMA), Knowledge Representation (KR), Multi-Agent Systems (AAMAS)

### Problem Statement

The DF-QuAD algorithm (Rago et al., 2016) computes graded argument acceptability via iterative fixed-point semantics. For each argument *v*, the strength σ is updated as:

σ(v) = τ(v) × (1 − aggAtt) × (1 + aggSup)

where τ(v) is the base strength, aggAtt aggregates attacker influences, and aggSup aggregates supporter influences. While DF-QuAD converges reliably on acyclic graphs, convergence is not guaranteed when attack cycles exist — a common topology in multi-perspective debates where three viewpoints form triangular attack patterns (A attacks B, B attacks C, C attacks A).

### Prior Work

Existing QBAF implementations either ignore the non-convergence case (relying on an iteration cap that produces arbitrary final values) or switch to alternative semantics such as the h-categorizer (Pu et al., 2015), which guarantees convergence but changes the acceptability function's behavior for support edges. Neither approach preserves DF-QuAD's semantics while handling cycles.

### Our Approach

We introduce an adaptive damping mechanism that activates only when oscillation is detected, preserving DF-QuAD's native convergence behavior on acyclic graphs while guaranteeing convergence on cyclic ones.

**Oscillation detection.** We monitor the maximum per-node strength delta across iterations. If the delta fails to decrease by at least 5% for three consecutive iterations, we classify the computation as oscillating.

**Jacobi iteration.** We switch from the common Gauss-Seidel update order (in-place, order-dependent) to Jacobi iteration (simultaneous update from the previous iteration's values). This is more faithful to DF-QuAD's formal definition, which assumes all σ_i values are drawn from the same iteration, and is necessary for oscillation to manifest predictably rather than being masked by update ordering.

**Adaptive damping.** Upon detecting oscillation, we apply under-relaxation with damping factor d = 0.3:

σ_{i+1}(v) = (1 − d) × σ_new(v) + d × σ_i(v)

This is equivalent to an exponential moving average with α = 0.7, a standard technique in iterative relaxation methods. The damping factor reduces the update step size, guaranteeing convergence by contracting the iteration map. Crucially, damping is not applied until oscillation is detected — acyclic graphs converge at full speed with zero overhead.

### Evaluation

In a three-agent debate system with accelerationist, safetyist, and skeptic viewpoints, triangular attack cycles arise naturally. With base strengths near unity (τ = 0.96) and strong attack weights (w = 1.0), the undamped DF-QuAD iteration oscillates indefinitely. Our adaptive mechanism detects the oscillation within 6 iterations and converges to a stable fixed point within the remaining iteration budget. On the same system's acyclic subgraphs (which constitute the majority of argument structures), no damping is applied and convergence matches the baseline.

---

## 3. Multi-Field Embedding Ablation for Ontological Descriptions

**Venue fit:** Information Retrieval (SIGIR, ECIR), Knowledge Representation (KR), Ontology Engineering

### Background

Taxonomy nodes in the AI Triad system follow a genus-differentia description format grounded in DOLCE upper ontology categories:

> "A [Belief|Desire|Intention] within [POV] discourse that [differentia]. Encompasses: [scope]. Excludes: [boundaries]."

Each node carries multiple semantic fields: the description itself, a set of underlying assumptions (`assumes`), intellectual lineage categories, epistemic type, and rhetorical strategy. Prior work on multi-field document embeddings (Gysel et al., 2018) typically encodes fields independently, weights them, and combines into a single vector.

### The Re-Normalization Distortion

We identified a systematic distortion in the standard approach of pre-normalizing each field embedding to unit L2 norm before weighted combination. When field embeddings are pre-normalized and then combined with weights (e.g., 0.55 × description + 0.35 × assumes + 0.10 × lineage), the subsequent re-normalization of the combined vector distorts the intended weight ratios in an input-dependent manner. If the description and assumes embeddings are geometrically aligned (high cosine), their contributions reinforce constructively and the weight ratio is approximately preserved. If they are orthogonal, the effective weights shift unpredictably. The intended weighting becomes a function of the input's semantic geometry — defeating the purpose of explicit weight specification.

The fix is straightforward: encode fields without pre-normalization (preserving raw magnitudes), apply weights, then normalize once. This ensures the weight ratios reflect the intended contribution of each field.

### Ablation Results

We conducted a controlled ablation across 778 taxonomy nodes, evaluating three embedding configurations against cluster separation (mean intra-cluster minus inter-cluster cosine similarity) and retrieval quality (Mean Reciprocal Rank on 50 edge pairs with known relationships):

| Configuration | Separation | MRR | Clusters |
|---|---|---|---|
| Description + Assumes + Lineage (0.55/0.35/0.10) | 0.297 | 0.051 | 104 |
| Description + Assumes (0.611/0.389) | 0.323 | 0.051 | 133 |
| Single-pass concatenation | 0.329 | 0.038 | 186 |
| Description only (1.0) | 0.321 | 0.044 | 234 |

**Key findings:**

1. **Intellectual lineage degrades separation by 9.4% with no retrieval benefit.** Lineage categories are coarse (~8 distinct values across 520 nodes), causing unrelated nodes sharing a lineage category to be artificially pulled together in embedding space.

2. **Assumptions provide a 14% retrieval boost.** The `assumes` field captures underlying premises that create semantic bridges between nodes discussing the same foundational ideas with different vocabulary. Dropping assumes degrades MRR from 0.051 to 0.044.

3. **Concatenation degrades retrieval by 26%.** Despite producing the best cluster separation, single-pass concatenation (embedding all fields as one string) loses the discriminative power of explicit field weighting. The model's 512-token attention mechanism cannot replicate targeted field emphasis.

4. **General-purpose models degrade on this domain.** A separate evaluation of four embedding models showed that newer, higher-MTEB-scoring models (BGE-small, GTE-small) degraded retrieval by 32–37% on our taxonomy, while the older all-MiniLM-L6-v2 outperformed all candidates. The concentrated embedding spaces of retrieval-optimized models lose discriminative power on short, homogeneous academic argument texts.

### Implications

For ontological knowledge bases with structured, multi-field descriptions: (1) raw-encode-then-normalize produces more faithful weighted combinations than pre-normalize-then-combine; (2) coarse categorical fields (few distinct values relative to corpus size) should be excluded from embeddings even at low weights — they reduce separation without aiding retrieval; (3) semantic fields capturing underlying reasoning (assumptions, warrants) are more valuable than surface-level metadata; and (4) MTEB benchmark rankings do not transfer to domain-specific pairwise comparison tasks on short academic texts.

---

## 4. Data-Driven Vocabulary Alignment for Structured Argumentation

**Venue fit:** NLP Applications (EMNLP, NAACL), Argument Mining

### Problem

In debate systems grounded in a structured taxonomy, claims extracted from LLM-generated debate turns frequently paraphrase taxonomy concepts using colloquial vocabulary. For example, a debater may say "making AI do what we want" instead of the taxonomy's standardized term "AI alignment," or "chip controls" instead of "compute governance." This vocabulary mismatch degrades downstream operations that compare claims against taxonomy nodes — coverage tracking, gap analysis, and relevance scoring all rely on textual or embedding similarity that suffers when equivalent concepts use different surface forms.

### Methodology

We developed an automated mismatch detection pipeline that identifies systematic vocabulary gaps between debate claims and taxonomy labels. For each of 3,470 claims extracted from 93 completed debates, we compute both cosine similarity (via sentence embeddings) and Jaccard word overlap against 775 taxonomy node labels. Pairs with high cosine similarity (≥ 0.55) but low word overlap (< 0.25) represent vocabulary mismatches: semantically equivalent content expressed with different words.

This analysis identified 3,855 unique mismatches across 455 taxonomy concepts. The mismatches cluster around four domains: policy and governance terminology (e.g., "liability regime," "regulatory sandboxes"), safety engineering (e.g., "formal verification," "deceptive alignment"), market dynamics (e.g., "barrier to entry," "race to the bottom"), and philosophical concepts (e.g., "human agency," "performative compliance").

### Intervention

Rather than post-hoc normalization (which risks losing the debater's intended nuance), we inject a curated domain vocabulary — 35 standardized terms with definitions and common colloquial alternatives — directly into the claim extraction prompt. The vocabulary is advisory ("use these standardized terms when the claim expresses the same concept") rather than mandatory, preserving the LLM's ability to faithfully represent novel arguments that fall outside the vocabulary.

The vocabulary was derived in two phases: an initial expert-curated set of 17 terms targeting the highest-value paraphrase corrections, expanded to 35 terms via the automated mismatch analysis. The expansion prioritized terms appearing 14+ times in debate claims with systematic taxonomy mismatches (cosine > 0.55, Jaccard < 0.10).

### Significance

This approach demonstrates a lightweight, reversible method for aligning LLM-generated argumentation with a structured ontology. Unlike fine-tuning or constrained decoding, vocabulary injection preserves the generative model's flexibility while guiding it toward terminological consistency. The mismatch detection pipeline is reusable: it can be re-run periodically as the taxonomy evolves, automatically identifying new vocabulary gaps without manual annotation.

---

## 5. Argument-Network-Driven Taxonomy Relevance Scoring

**Venue fit:** Information Retrieval, Computational Argumentation, Multi-Agent Systems (SIGIR, COMMA, AAMAS)

### Problem Statement

Multi-agent debate systems that inject structured knowledge (taxonomy nodes, ontological context) into agent prompts face a relevance scoring problem: which nodes from a large taxonomy are most relevant to a specific debate turn? The standard approach embeds the debate topic as a single query vector and scores all nodes by cosine similarity. This produces systematically low scores when the topic text is short (a URL, a one-sentence prompt) or when the debate has evolved beyond its original framing.

### Prior Approach and Its Limitations

Our system previously constructed a relevance query by concatenating the debate topic with the last 500 characters of recent transcript, embedding this as a single vector (all-MiniLM-L6-v2, 384-dim), and scoring all taxonomy nodes by cosine similarity against it. This approach had three failure modes: (1) **length mismatch** — a 50-character topic query compared against 200-word genus-differentia node descriptions produces systematically low cosine similarity (observed P90 = 0.43, mean = 0.32); (2) **semantic blending** — a multi-topic debate turn about both "compute governance" and "open-source safety" produces one averaged query vector that matches neither concept well; (3) **static anchoring** — as the debate evolves and new arguments emerge, scoring remains anchored to the original topic string, not the actual discourse trajectory.

### Our Approach

We replace the single topic-query embedding with per-claim argument network (AN) scoring. After each debate turn, the claim extraction pipeline identifies 3–8 distinct claims and adds them to the argument network. Each claim is independently embedded. Taxonomy node relevance is then computed as:

```
node_score = max(cosine(node_embedding, claim_embedding) for claim in AN_claims)
```

A node that is highly similar to *any* active claim scores high, even if it is irrelevant to the original topic string. Optionally, claim similarity is strength-weighted — claims with higher QBAF computed strength contribute more, so nodes relevant to strong surviving arguments are prioritized over nodes relevant to refuted claims.

The approach is computationally efficient: with 150 AN claims and 572 taxonomy nodes, the scoring requires ~86K dot products on 384-dim vectors — under 100ms in Python, negligible in JavaScript.

### Experimental Validation

On a sample debate about state-led AI regulation, we compared single-query scoring against AN-claim-max scoring across 195 skeptic POV nodes:

| Metric | Single Query | AN-Claim-Max | Improvement |
|---|---|---|---|
| Mean score | 0.320 | 0.373 | +16.6% |
| P90 score | 0.435 | 0.456 | +4.8% |
| Max score | 0.569 | 0.598 | +5.1% |
| Nodes ≥ 0.45 (green threshold) | 11 | 23 | **+109%** |

The most dramatic improvement was on "Protecting Data Privacy and Individual Autonomy" (skp-desires-003): single-query score 0.19 (bottom quartile, would not be injected), AN-claim-max score 0.56 (top 15%, strongly injected). The single query missed this node because the topic text ("Discuss: [URL]") shared no semantic surface with "data privacy." The AN-claim-max scored it correctly because a debate claim about "state-managed data extraction" was semantically close.

### Significance

This approach makes three contributions: (1) it eliminates the query-length and topic-format sensitivity of single-vector scoring, producing meaningful scores even for URL-based or one-sentence debate topics; (2) it makes relevance scoring *adaptive* — as the debate progresses and the AN grows, the taxonomy nodes surfaced to each agent shift to match the actual discourse trajectory; (3) it connects formal argumentation (QBAF strength) to information retrieval (embedding similarity), using argument quality as a relevance signal — a bridge between the computational argumentation and IR communities.

---

## 6. Per-Agent Utility Functions for Multi-Agent Debate Calibration

**Venue fit:** Multi-Agent Systems (AAMAS), Computational Argumentation (COMMA)

### Problem Statement

Multi-agent debate systems that employ QBAFs for argument evaluation compute a single, global graph state -- argument strengths propagated across all nodes via DF-QuAD. However, the shared graph does not answer the per-agent question: "Did this agent make a strategically effective move?" Existing calibration metrics measure debate-level quality, not individual agent performance. Without per-agent utility, there is no principled way to detect stagnation (an agent contributing turns that change nothing), runaway dominance (one agent's position monotonically strengthening without effective opposition), or strategic disengagement (an agent retreating from cruxes without conceding).

### Prior Approach and Its Limitations

Prior work treats QBAF evaluation as a global property of the argumentation graph (Baroni et al., 2019; Rago et al., 2016). Game-theoretic models of argumentation (Rahwan & Larson, 2009) define utility functions over outcomes but typically assume a two-player zero-sum structure. In multi-perspective debate systems with three or more agents -- where the goal is wisdom generation rather than victory -- neither the zero-sum model nor global graph metrics provide agent-level strategic feedback.

### Our Approach

We define a per-agent utility function that projects the shared QBAF argument network through agent-specific lenses. The `AgentUtility` score decomposes into three components: (1) **position strength** -- the mean computed QBAF strength of the agent's undefeated nodes (strength >= 0.3 after propagation); (2) **attack effectiveness** -- the fraction of opponent nodes weakened below the 0.3 defeat threshold; and (3) **crux engagement** -- the fraction of identified cruxes the agent has substantively addressed.

The critical design choice is persona-specific weighting. Each debate character receives weights reflecting its epistemic role: Prometheus (accelerationist) is weighted toward position strength (0.45/0.30/0.25), reflecting a persuasion-leaning strategy; Sentinel (safetyist) toward crux engagement (0.30/0.25/0.45), reflecting evidence orientation; Cassandra (skeptic) most heavily crux-weighted (0.20/0.25/0.55), reflecting truth-seeking priority. A supplementary concession asymmetry metric detects agents that strategically concede only low-value positions while pressing attacks on high-value targets.

### Significance

This approach makes three contributions: (1) it provides the first per-agent utility decomposition for multi-perspective QBAF-based debate, bridging global graph evaluation and agent-level strategic assessment; (2) persona-specific weighting embeds character-consistent epistemic values directly into the utility function, enabling calibration that respects the cooperative-adversarial hybrid nature of research debate; and (3) per-turn utility curves enable automated detection of debate pathologies (stagnation, dominance, disengagement) that are invisible to aggregate quality metrics.

---

## 7. One-Step Move-Quality Lookahead with QBAF Evaluation

**Venue fit:** AI Safety, Computational Argumentation (COMMA, AAAI)

### Problem Statement

In LLM-powered multi-agent debate, move generation is single-shot: the model produces a draft turn, claims are extracted, and the result is committed to the argument network. There is no quality gate between generation and commitment. Low-value turns -- restating existing positions, introducing tangential claims, failing to engage cruxes -- are committed at the same cost as high-value turns, degrading debate quality and consuming finite API token budget.

### Prior Approach and Its Limitations

Full game-tree search (minimax, MCTS) is standard for move quality in adversarial settings (Silver et al., 2017), but the branching factor in LLM-debate is prohibitively large: 10 dialectical move types multiplied by variable claim counts multiplied by three agents. RL-based debate training (Irving et al., 2018) addresses this at training time but assumes stable reward signals and large compute budgets unavailable in live research debate on API-tier access.

### Our Approach

We introduce a one-step lookahead gate that uses QBAF propagation as a lightweight strategic evaluator. After the LLM generates a draft turn and claims are extracted: (1) extracted claims are added as provisional nodes to a copy of the argument network with tentative edges; (2) DF-QuAD strengths are computed on both baseline and tentative networks (under 10ms per propagation for a 100-node graph); (3) the per-agent utility delta is computed (position strength, attack effectiveness, crux engagement with persona-specific weights); (4) if the delta falls below threshold, a targeted regeneration hint is injected identifying which utility component was weakest, and one retry is permitted.

The gate augments the crux tracker for tentative evaluation: new claims that attack or support crux nodes receive credit in the tentative utility score. Maximum retry count is capped at one to prevent infinite loops; if the retry also fails, the turn is committed and a `low_utility_turn` calibration event is logged.

### Significance

This approach makes three contributions: (1) it introduces QBAF-based argument evaluation as a real-time move-quality gate, using formal argumentation semantics not just for post-hoc analysis but as a generative quality signal; (2) it achieves strategic depth at minimal cost -- one extra graph propagation (sub-10ms) and at most one LLM retry, versus dozens-to-hundreds of calls for tree search; and (3) it directly mitigates the filibustering exploit (flooding the graph with weak claims) since low-utility claims that fail to shift the strategic landscape are rejected before they pollute the argument network.

---

## 8. Wisdom-Oriented Topic Quality Gate for Debate Systems

**Venue fit:** NLP Applications (EMNLP, NAACL), Computational Argumentation (COMMA)

### Problem Statement

The quality of a multi-agent debate is substantially determined before the first turn: a poorly framed topic produces shallow, circuitous debate regardless of agent sophistication. Yet existing debate systems treat topic selection as exogenous -- the user provides a topic string and the system debates it as given. There is no systematic assessment of whether a topic's properties predict wisdom-generating outcomes versus degenerate outcomes.

### Prior Approach and Its Limitations

Topic quality in educational and competitive debate contexts relies on subjective criteria: "controversial," "balanced," "well-scoped" (Branham, 1991). In computational argumentation, topic quality is not formally studied. In our system, early debates on vague topics ("Discuss AI safety") or lopsided topics ("Is deceptive alignment bad?") consistently produced low calibration scores -- low crux-addressed rates, high repetition, rapid convergence to trivial consensus -- but these failures were only detectable post-hoc, after consuming the full API budget.

### Our Approach

We introduce a two-phase, 20-point topic quality rubric combining deterministic structural analysis with LLM-assessed framing properties.

**Phase A: Structural scoring (10 points, deterministic).** The topic text is embedded and compared against all taxonomy nodes via cosine similarity. Five dimensions scored 0/1/2: (1) **crux density** -- whether activated nodes span multiple POV camps; (2) **evidence coverage** -- fraction of activated nodes with entries in the source evidence index; (3) **BDI heterogeneity** -- balance across Beliefs, Desires, and Intentions; (4) **abstraction level** -- per-POV activation counts in a Goldilocks zone (8-15 nodes); (5) **situation activation** -- cross-cutting node engagement.

**Phase B: Frame scoring (10 points, LLM-assessed).** A single LLM call scores five linguistic properties: (1) **conditionality** -- conditional vs. binary framing; (2) **mechanism focus** -- causal pathways vs. outcome-only; (3) **stakeholder breadth** -- distributed agency; (4) **tension acknowledgment** -- named conflict vs. neutral; (5) **scope boundedness** -- concrete artifacts vs. open-ended.

Topics scoring 14+ auto-proceed. Topics scoring below 8 trigger automated reframing: the LLM generates a rewritten topic targeting lowest-scoring dimensions, with per-dimension explanations. A quality gate enforces that reframed topics must score equal to or higher than the original (up to three retries).

### Significance

This approach makes three contributions: (1) it establishes the first formal, measurable link between topic input properties and debate output quality in multi-agent argumentation -- demonstrating that structural properties (crux density, BDI heterogeneity, evidence coverage) predict wisdom-generating outcomes; (2) it integrates taxonomy-grounded structural analysis with linguistic frame assessment in a complementary two-phase design -- structural scoring is deterministic and zero-cost, while frame scoring captures pragmatic properties not inferable from embeddings alone; and (3) the automated reframing pipeline converts topic assessment from passive diagnostic into active intervention, catching predictable failure modes before resources are committed.

---

*Updated 2026-05-22 by Computational Linguist · AI Triad Research*
