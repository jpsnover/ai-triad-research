# Deep Read: Wang 2026 — Interpretable Computational Metaphor Processing

**Paper:** Wang, Shun (2026). *Interpretable Computational Metaphor Processing.* PhD thesis, University of Sheffield.
**Source:** https://etheses.whiterose.ac.uk/id/eprint/38149/1/Thesis.pdf
**Reviewed by:** Computational Linguist, 2026-06-04
**Purpose:** Extract algorithms, training data, benchmarks, and adoption feasibility for AI Triad Research's metaphor-as-insight engineering goal.

---

## 1. Research Questions

1. How can computational models effectively detect and interpret metaphorical expressions in context?
2. What techniques can improve the denoising of context for accurate metaphor understanding?
3. What are the cross-linguistic and cultural challenges in metaphor processing, and how can they be addressed computationally?
4. How can metaphor processing models be made more interpretable and explainable?

## 2. Theoretical Foundations

Three theories underpin the thesis — all relevant to our project:

| Theory | Core Idea | Relevance to AI Triad |
|--------|-----------|----------------------|
| **Selectional Preference Violation (SPV)** | Metaphors emerge when a predicate's arguments violate expected semantic constraints (Wilks 1975) | Could detect when debate claims use AI terms in semantically unexpected ways — a signal of metaphorical framing |
| **Conceptual Metaphor Theory (CMT)** | Metaphors are cross-domain mappings: concrete source → abstract target (Lakoff & Johnson 1980) | The theoretical backbone of "insight through metaphor" — breaking a frame means making the source→target mapping visible, then offering an alternative source domain |
| **Metaphor Identification Procedure (MIP/MIPVU)** | Compare contextual vs. basic meaning; if they diverge and basic meaning can be understood, the word is metaphorical (Pragglejaz 2007) | Operationalizable at token level — the foundation for all three detection models |

**Key definition for our purposes:** A word is metaphorical when its **contextual meaning** (shaped by surrounding discourse, culture, sentiment) diverges from its **basic meaning** (more concrete, body-related, historically older). This is exactly the mechanism by which conceptual frameworks become invisible — users stop noticing that "AI race" maps competition semantics onto development semantics.

## 3. Chapter 3: Metaphor Detection Models

### 3.1 RoPPT — RoBERTa with Pruning on Target-Oriented Parse Trees

**Algorithm:**
1. Parse sentence into dependency tree (spaCy or Biaffine parser)
2. Re-root tree at the target word
3. Prune nodes beyond neighbour range = 4 from root
4. Average-pool RoBERTa hidden states over pruned context only
5. Classify via MIP + SPV modules

**Architecture:** RoBERTa encoder + syntactic pruning layer + MIP/SPV classification heads

**Training data:** VUA-18 (116K targets, 18.4% metaphor), VUA-20 (160K targets, 15% metaphor)

**Benchmarks (F1):**
| Dataset | RoPPT | Previous SOTA |
|---------|-------|--------------|
| VUA-18 | **79.1%** | 78.1% (MelBERT) |
| VUA-20 | **72.8%** | 71.9% (MelBERT) |
| TroFi (zero-shot) | 54.2% | — |
| MOH-X (zero-shot) | 79.3% | — |

**Key insight:** Performance gain scales with sentence length — +0.5% for <20 tokens, +1.6% for 20-40, +3.5% for >40. Removing irrelevant context is critical for metaphor detection in long discourse (like debate transcripts).

**Adoption feasibility:** HIGH. The syntactic pruning is a pre-processing step, not a model change. We could apply it to debate transcript analysis without retraining — just prune context around candidate metaphorical terms before feeding to any classifier.

### 3.2 FrameBERT — Semantic Frame Integration

**Algorithm:**
1. Pre-train frame identification on FrameNet 1.7 (~19K annotations): predict target frame + all sentence frames from RoBERTa embeddings
2. Extract frame distribution vectors as "concept embeddings"
3. Concatenate frame embeddings with MIP/SPV embeddings
4. Fine-tune on metaphor detection

**Architecture:** RoBERTa + 12-layer frame identification pre-training + frame-augmented MIP/SPV

**Training data:** FrameNet 1.7 (~19K train, 6K test, 2K eval) + VUA datasets

**Benchmarks (F1):**
| Dataset | FrameBERT | RoPPT |
|---------|-----------|-------|
| VUA-18 | 78.8% | 79.1% |
| VUA-20 | **73.0%** | 72.8% |
| TroFi | **74.2%** | 54.2% |
| MOH-X | **83.8%** | 79.3% |

**Key insight:** Semantic frames capture the contrast between literal and figurative usage better than raw embeddings. Ablation: 13% F1 drop when frame embeddings are shuffled, confirming the model actively uses conceptual information. Best cross-dataset transfer (TroFi 74.2% vs RoPPT 54.2%).

**Adoption feasibility:** MEDIUM. Requires FrameNet 1.7 and frame identification pre-training. More complex pipeline, but the frame annotations themselves are valuable — they could enrich taxonomy nodes with structured frame data.

### 3.3 BasicBERT — Explicit Basic Meaning Modeling

**Algorithm (BasicMIP):**
1. For each target word with literal annotations in training data: average RoBERTa embeddings across all literal instances → "basic meaning vector"
2. Compute contrast: cosine distance between basic meaning vector and contextual embedding
3. For words without literal annotations: fall back to AMIP (average all instance embeddings)
4. Concatenate BasicMIP + AMIP + SPV for classification

**Architecture:** RoBERTa + BasicMIP/AMIP/SPV modules

**Training data:** VUA-18/20 literal annotations as gold-standard basic meanings (no external resource needed)

**Benchmarks (F1):**
| Dataset | BasicBERT | FrameBERT | RoPPT |
|---------|-----------|-----------|-------|
| VUA-18 | 79.0% | 78.8% | **79.1%** |
| VUA-20 | **73.3%** | 73.0% | 72.8% |
| VUA-18 (targets w/ literal annot.) | **81.1%** | — | — |

**Key insight:** Semantic contrast gap = 0.89 for metaphor vs. 0.13 for literal in BasicMIP (vs. only 0.13 gap in AMIP). Explicit basic meaning modeling captures the *degree* of metaphoricity, not just binary classification. This is directly relevant to measuring how "deep" a metaphorical frame is.

**Adoption feasibility:** HIGH for analysis; LOW for real-time use. The basic meaning vectors are pre-computable. Could run as a post-debate annotation pass — score each claim's key terms for degree of metaphoricity.

### 3.4 Model Complementarity

| Model | Strength | Weakness |
|-------|----------|----------|
| RoPPT | Long sentences, balanced P/R | Low cross-dataset transfer |
| FrameBERT | Highest precision, best transfer | Lower recall |
| BasicBERT | Theoretical upper bound on annotated targets, stability | Degrades on unannotated words |

**Ensemble potential:** The three models make different errors. An ensemble combining syntactic pruning + frame semantics + basic meaning would be theoretically optimal. Wang proposes this as future work.

## 4. Chapter 4: MMTE — Cross-Linguistic Metaphor Translation

### 4.1 Corpus

| Dimension | Value |
|-----------|-------|
| Source | MOH-X: 647 English sentences (315 metaphorical, 332 literal) |
| Target languages | Chinese (ZH), Italian (IT) |
| Translation systems | Google Translate, Opus-MT, Youdao, GPT-4o |
| Total instances | ~1,900 |
| Annotators | 18 native speakers (linguistics majors, professional English) |
| Annotations per instance | 3 (from independent groups) |

**Publicly available:** https://figshare.com/s/bd4137fb3a05cf122b01

### 4.2 Annotation Dimensions

| Dimension | Type | What it measures |
|-----------|------|-----------------|
| Fluency | 5-point Likert | Grammar and naturalness |
| Intelligibility | 5-point Likert | Clarity of metaphorical meaning |
| Fidelity | 5-point Likert | Faithfulness to source meaning |
| Overall Quality | 5-point Likert | Holistic assessment |
| Authenticity | 5-point Likert | Reads like native usage |
| **Equivalence** | Categorical | Full / Part / Non / Mistranslation |
| **Emotion** | 4-label | Zero / Less / Same / More emotional content |

### 4.3 Equivalence Types (Critical for Our Project)

- **Full-Equivalence:** Both literal AND contextual meanings preserved (e.g., "swallow words" → "咽下话" — both use throat/ingestion metaphor)
- **Part-Equivalence:** Contextual meaning preserved but through a DIFFERENT metaphor (both figurative, different source domain)
- **Non-Equivalence:** Contextual meaning preserved but translation is LITERAL (metaphor lost)
- **Mistranslation:** Meaning not preserved

**This taxonomy maps directly to our insight-engineering goal:** Part-equivalence is the most interesting case — the same concept expressed through different metaphorical frames across cultures. These are natural "frame breakers."

### 4.4 Key Findings

**Metaphor vs. literal translation quality:**
- Metaphorical expressions score lower across ALL metrics
- ~20% of metaphor translations lose figurative status (non-equivalence)
- ~10% are mistranslated entirely
- BUT: full-equivalence metaphor translations score HIGHER than literal translations — when the metaphor transfers cleanly, it enhances quality

**Emotional salience:**
- Full-equivalence metaphors preserve emotion; non-equivalent translations lose it
- Maintaining figurative status correlates with emotion preservation
- **Implication for our project:** When we present alternative metaphorical frames, we need to verify emotional salience is preserved — a frame that loses emotional weight won't generate insight

**Language typology:**
- EN-IT translations generally outperform EN-ZH (closer language families)
- BUT training corpus size can override typological distance (Youdao EN-ZH > EN-IT)
- **Implication:** Cross-cultural metaphor pairs need language-specific quality verification

**LLM evaluation accuracy (GPT-4o):**
| Task | EN-IT | EN-ZH |
|------|-------|-------|
| Full-equivalence classification | 86.7% | 76.5% |
| Non/Part-equivalence classification | 94.0% | 86.3% |

LLMs are reliable equivalence classifiers — could automate metaphor equivalence annotation at scale.

**Inter-annotator agreement:** Low for metaphorical expressions (α = 0.13-0.38) vs. literal (0.29-0.48). Metaphor interpretation is inherently subjective — our system should present this as a feature (multiple valid interpretations), not a bug.

### 4.5 LLM Explanation Capability

GPT-4 can generate semantic explanations of WHY a metaphor was translated a certain way — comparing literal vs. contextual meanings across languages. This is directly applicable to generating "frame awareness" annotations for taxonomy nodes.

## 5. Chapter 5: Sparse Autoencoder Interpretability

### 5.1 Architecture

**SAE decomposition:**
- Input: MLP activation vectors from final decoder block of LLM
- Encoder: s = ReLU(F(x - bd) + be)
- Decoder: x̂ = F^T s + bd
- Loss: MSE_reconstruction + λ||s||₁ (sparsity penalty)
- Dictionary dimension >> input dimension (overcomplete basis)

**Training data:** 12.3B tokens from mixed sources (Common Crawl 8.75B, C4 1.75B, GitHub 0.60B, ArXiv 0.30B, Books 0.25B, Wikipedia 0.25B, StackExchange 0.20B, OpenMathInstruct 0.20B)

### 5.2 Pipeline

1. Extract activated features for target word via SAE plug-in
2. Rank features by semantic similarity (GPT-3.5-turbo)
3. If top-activated feature ≠ intended contextual meaning → flag as ambiguous
4. GPT-4 generates 1-2 sentence clarification
5. Append clarification to original input → re-feed to LLM
6. Get improved output

### 5.3 Models Tested

Llama-3 (3.1-8B-Instruct), Mistral (7B-Instruct), Gemma (7b-it), Phi-3 (Small-8K-Instruct) — all ~7-8B parameters.

### 5.4 Results

**Metaphor detection (Table 5.8) — average +3.76% absolute (+5.38% relative):**
| Model | MOH-X gain | TroFi gain |
|-------|-----------|-----------|
| Llama-3 | +4.3% | +4.0% |
| Mistral | +5.1% | +2.3% |
| Gemma | +4.0% | +2.9% |
| Phi-3 | +4.3% | +3.2% |

Enhanced Llama-3 reaches 84.4% on MOH-X — surpassing RoPPT baseline (80.1%).

**Math QA (Table 5.9) — average +12.52% absolute (+47.78% relative):**
Gains of 10-18% across all models and math domains. All improvements confirmed via paired t-tests (p < 0.05) and McNemar's tests (p < 0.001).

### 5.5 Adoption Feasibility

**HIGH conceptual value, MEDIUM implementation cost.** The key insight is that SAEs can reveal which internal features correspond to metaphorical processing. For our project:

- We could use SAEs on our debate models (gemini-2.5-flash) to understand how they represent metaphorical frames — but Google models may not have published SAE tools
- The clarification-augmentation pipeline is model-agnostic: detect ambiguity → generate clarification → append to prompt. This could be adapted for our moderator interventions
- The auto-interpretability technique (GPT-4 labeling features) could help us build a metaphor feature dictionary specific to AI policy discourse

## 6. Limitations (Author's Own Assessment)

1. **Single-word metaphors only** (mainly verbs) — multi-word metaphors ("kick the bucket") unaddressed
2. **Target word assumed given** — real-world requires unsupervised detection
3. **English-centric** — limited to EN/ZH/IT
4. **No large-scale human validation** of learned feature interpretability
5. **Controlled experiments only** — not tested on real-world discourse

## 7. Synthesis: What This Means for AI Triad Research

### The Conceptual Framework

Wang provides the technical vocabulary for what "engineering insight through metaphor" means computationally:

1. **Detect** the metaphorical frame (RoPPT/FrameBERT/BasicBERT)
2. **Measure** its depth (BasicMIP contrast score)
3. **Find** alternative frames via cross-cultural equivalence (MMTE part-equivalence cases)
4. **Explain** why the alternative frame offers different analytical leverage (GPT-4 explanation)
5. **Verify** emotional salience is preserved in the alternative frame (MMTE emotion dimension)
6. **Augment** the model's understanding when it's locked into one frame (SAE clarification pipeline)

### Immediate Adoptions (No Model Training Required)

| Action | Effort | Impact |
|--------|--------|--------|
| Tag taxonomy nodes with dominant metaphorical frames (manual + GPT-4 assisted) | LOW | HIGH — makes implicit frames explicit |
| Author 5-10 "frame-breaker" situation nodes using MMTE part-equivalence pattern | LOW | HIGH — tests whether alternative frames shift debate |
| Add `metaphorical_frame` field to situation node schema | LOW | MEDIUM — structural support for frame annotation |
| Use GPT-4 to generate frame explanations for existing POV nodes | LOW | MEDIUM — enriches taxonomy with frame awareness |

### Medium-Term Adoptions (Some Engineering)

| Action | Effort | Impact |
|--------|--------|--------|
| Run BasicBERT as post-debate metaphor annotation pass | MEDIUM | HIGH — measures frame diversity per debate |
| Design `metaphor_diversity_rate` calibration metric | MEDIUM | MEDIUM — tracks frame lock-in |
| Adapt SAE clarification pipeline for moderator interventions | MEDIUM | HIGH — frame-breaking interventions |

### Deferred (Requires Training/Resources)

| Action | Effort | Impact |
|--------|--------|--------|
| Train FrameBERT on AI policy domain text | HIGH | HIGH — domain-specific frame detection |
| Extend MMTE to additional languages (Arabic, Hindi) | HIGH | MEDIUM — broader perspective set |
| Build SAE features for debate models | HIGH | UNCERTAIN — depends on model access |

## 8. Risks

- **Scope creep:** Metaphor analysis is a deep rabbit hole. Keep initial adoption to manual frame annotation + GPT-4 assistance.
- **Model availability:** Wang's model checkpoints may not be published. Architecture is reproducible from the thesis, but training from scratch is significant work. Verify checkpoint availability before committing to model-based approaches.
- **Cultural sensitivity:** Cross-cultural metaphor comparison must avoid reductive stereotyping. Frame as "different metaphorical traditions offer different analytical leverage."
- **Single-word limitation:** AI policy metaphors are often multi-word ("arms race," "alignment tax," "existential risk"). Wang's models target single verbs — extension needed.

## 9. Next Steps

1. **Check model checkpoint availability** — search GitHub/HuggingFace for RoPPT, FrameBERT, BasicBERT
2. **Download MMTE corpus** from figshare — analyze part-equivalence cases for AI-relevant metaphors
3. **Design metaphorical frame annotation schema** for taxonomy nodes — DOLCE-aligned
4. **Author pilot frame-breaker situations** — 5 nodes using cross-cultural metaphor pairs
5. **Create ticket** for each adoption action above
