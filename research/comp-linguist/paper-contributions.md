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

*Updated 2026-05-09 by CL.Investigate1 (Computational Linguist) · AI Triad Research*
