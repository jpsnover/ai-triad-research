# AI/NLP Usage Audit — AI Triad Research

**Scope:** every LLM call site and computational-linguistics technique in the codebase, audited on three questions: (1) is an LLM the right tool at all, (2) if yes, is the specific technique/model best practice, (3) where should we migrate to a different technique. Research-backed via current literature (sources at end). Written 2026-07-08 by Fable 5, commissioned by Jeffrey Snover.

**Headline:** This codebase is unusually well-engineered on the "right tool" question — many things that look like AI features are already deterministic (BDI weights, quality scoring, gap scoring, convergence signals), and the LLM call sites already use embedding pre-filters, two-phase cheap/expensive screening, NLI cross-encoders, and structured-output schemas. The audit found **two sites that are actively wrong** (QBAF semantics doesn't match the published algorithm it claims to implement; the QBAF conflict cmdlet documents embedding clustering that doesn't exist), **one silent-data-loss trap** (embedding input truncation), and a handful of technique upgrades.

---

## Part 1 — Site-by-site findings

### 1. QBAF conflict analysis — `Invoke-QbafConflictAnalysis` + `lib/debate/qbaf.ts` ⚠️ ACTIVELY WRONG (two ways)

**(a) What it does:** `scripts/AITriad/Public/Invoke-QbafConflictAnalysis.ps1` loads factual claims from summaries, detects attack/support relations **deterministically** (shared `linked_taxonomy_nodes` + opposing `doc_position`, lines 139–172), computes `base_strength` from evidence-criteria heuristics (lines 297–329), then pipes to `scripts/qbaf-bridge.mjs` → `lib/debate/qbaf.ts` for strength propagation. No LLM in the loop — good.

**(b) Problem 1 — the engine is not DF-QuAD.** `qbaf.ts:4-8` claims "Implements DF-QuAD (Discontinuity-Free Quantitative Argumentation Debate) gradual semantics." The published DF-QuAD ([Rago, Toni, Aurisicchio & Baroni 2016](https://www.cs.cf.ac.uk/caf2016/assets/submissions/Rago.pdf)) aggregates attacker/supporter strengths with the probabilistic sum **F(x₁..xₖ) = 1 − ∏(1 − xᵢ)** and combines via a conditional blend of base score and |aggAtt − aggSup| (confirmed against [arXiv 2605.02551](https://arxiv.org/html/2605.02551v1), which restates the product-based aggregation and conditional influence function). The implementation instead uses **sum-and-clamp** aggregation (`defaultAggregate`, qbaf.ts:59-63) and a **multiplicative combine** `base·(1−aggAtt)·(1+aggSup)` (qbaf.ts:65-67). Consequences: (i) sum-and-clamp saturates at 1.0, so 3 weak attackers ≈ 10 strong attackers — DF-QuAD's product form was designed precisely to avoid this; (ii) the clamp reintroduces the discontinuity class DF-QuAD exists to remove; (iii) the code carries oscillation-damping machinery (`oscillationDetected`, `dampingLevel`, qbaf.ts:44-47) — a symptom of having lost the semantics' convergence behavior. Since this is a research platform whose outputs may be cited, labeling non-standard semantics "DF-QuAD" is a validity problem, not a style nit.

**(c) Problem 2 — documented clustering doesn't exist.** The cmdlet's docstring (lines 9-11) says it "clusters similar claims using embedding similarity" and exposes `-Threshold` ("Cosine similarity threshold for claim clustering. Default: 0.85", lines 17-18, 34-35). **The parameter is never referenced in the function body.** Relations are detected only via exact taxonomy-node-ID overlap — two claims about the same question that were mapped to different (or no) nodes are never compared. The repo already has everything needed to do it properly (`Get-TextEmbedding`, `similarity-cache.json`, MiniLM local).

**Recommendation:** (1) Implement true DF-QuAD — the `QbafOptions` interface already accepts custom `aggregateAttacks`/`aggregateSupports`/`combine` hooks (qbaf.ts:32-37), so this is a small, test-driven change: add the product-form aggregate + conditional combine as defaults, validate against worked examples from the paper, keep the old semantics available under an explicit non-DF-QuAD name. **Effort: 1–2 days. Risk: medium — all computed strengths shift; downstream consumers (`evidenceQbaf.ts`, `qbafCombinator.ts`, enrich_conflicts_qbaf.py) need a regen pass.** (2) Either wire embedding-based claim clustering (embed claim texts, union node-overlap edges with cosine ≥ Threshold pairs, then LLM-confirm only the new pairs) or delete the `-Threshold` parameter and fix the docstring. **Effort: half day (doc fix) to 2 days (real clustering). Risk: low.**

### 2. Embeddings — all-MiniLM-L6-v2 everywhere ⚠️ one silent trap + aging model

**What it does:** `scripts/embed_taxonomy.py` (MODEL_NAME line 39) generates 384-dim vectors for all taxonomy nodes; consumed by `Get-RelevantTaxonomyNodes.ps1` (RAG node selection for summaries/debates), `Invoke-EdgeDiscovery` pre-filtering, `Get-EmbeddingClusters`, convergence signals (`convergenceSignals.ts:22` — semantic recycling at cosine 0.85), and the taxonomy-editor semantic search. Synthetic multi-vector expansion (`synthetic_embeddings.json`, `Get-RelevantTaxonomyNodes.ps1:122-139`) implements doc2query-style pseudo-text augmentation — a legitimate, published retrieval technique.

**Is a dedicated embedding model right?** Yes — this is exactly the case where you should NOT use an LLM. Keep the architecture.

**Trap:** `Get-TextEmbedding.ps1:64` truncates inputs at **2000 chars** "(model context limit)" — but MiniLM-L6-v2's effective window is **256 word-piece tokens ≈ 1,000 chars**. Everything between ~1,000 and 2,000 chars is silently discarded by the tokenizer, and callers passing document excerpts/chunk text (`Get-RelevantTaxonomyNodes -Query $ChunkText`) get embeddings of only the opening of their query. This is a real correctness bug for chunk-level RAG queries, not just staleness.

**Model choice:** MiniLM-L6-v2 is a 2020-era model. Current small open models materially beat it on MTEB retrieval — bge-small/large-en-v1.5, gte family, nomic-embed-text-v1.5 (8,192-token context, 137M params) ([BentoML 2026 guide](https://www.bentoml.com/blog/a-guide-to-open-source-embedding-models), [MTEB overview](https://modal.com/blog/mteb-leaderboard-article)). The repo already owns the evaluation harness to de-risk a swap: `Compare-EmbeddingModel.ps1`, `evaluate_embeddings.py`, a golden test set, and `Test-RerankerBaseline.ps1` (which correctly frames a gate: "if reranking captures >80% of available lift, the synthetic corpus investment may not be justified" — and its cross-encoder rerank stage, `ms-marco-MiniLM-L-6-v2`, is itself the standard bi-encoder→cross-encoder pattern).

**Recommendation:** (1) **Immediately** fix the truncation mismatch — either truncate honestly at ~250 tokens, or chunk+mean-pool long queries. Effort: hours. (2) Run `Compare-EmbeddingModel` against `bge-small-en-v1.5` and `nomic-embed-text-v1.5` on the golden set; if MRR lift is material, re-embed (nodes + synthetic corpus) and **recalibrate every hard-coded cosine threshold** (0.20 edge-discovery floor, 0.30 embedding-first, 0.85 recycling/clustering — thresholds are not portable across models). Effort: ~1 week including recalibration. Risk: medium (threshold drift), fully measurable with existing tooling.

### 3. Document ingestion / POV summary pipeline — `Invoke-POVSummary` → `Invoke-DocumentSummary` → `Merge-ChunkSummaries` ✅ right tool, minor upgrades

**What it does** (per `docs/document-processing-pipeline.md`, verified against code): heading-aware greedy chunking with runt merge, no overlap (chars/4 token estimate); CHESS pre-classification (`Get-DocumentPovClassification.ps1` — ~600-token flash-lite call to pick POV branches); RAG node injection via `Get-RelevantTaxonomyNodes` (replaced full-taxonomy injection — 15k → 3-5k tokens); single-shot vs FIRE iterative extraction gated by a **deterministic 2-signal sniff** (`Test-FireRequired.ps1`); density-scaled extraction targets with counted validation and one retry-with-nudge; `Repair-TruncatedJson` salvage; chunk merge dedup by exact 80-char-prefix keys, first-occurrence-wins (`Merge-ChunkSummaries.ps1`). Model: gemini-3.1-flash-lite, temp 0.1, JSON mode.

**Assessment:** LLM extraction is correct — no classical technique extracts POV-framed key points with stance and taxonomy mapping. The scaffolding (deterministic gates around LLM calls, density validation, cheap-model default) matches current best practice; the CHESS+RAG+FIRE staging is genuinely better than what most published ingestion pipelines do. Three upgrades:

- **Semantic dedup in chunk merge.** Exact-prefix dedup misses paraphrases across chunks — the #1 artifact of non-overlapping chunking. You already have local MiniLM; add a second pass collapsing key points with cosine > ~0.9 within the same POV/node. Effort: 1-2 days. Risk: low (log what gets collapsed).
- **Guardrail on LLM taxonomy-node assignments.** The LLM assigns `taxonomy_node_id` in-context; the existence of `Repair-AITSummaryMappings.ps1` says mis-mappings happen. Cheap post-hoc check: cosine(claim text, assigned node text) below a floor ⇒ flag for review or null the mapping. Entity-linking practice is retrieve-and-verify, not generate-and-trust. Effort: 1 day.
- **PDF metadata:** `Get-AIMetadata` (flash-lite) is fine, but for scholarly PDFs GROBID is the deterministic standard if metadata quality ever becomes a pain point. Optional; not worth a service dependency today.

### 4. Edge discovery — `Invoke-EdgeDiscovery.ps1` ✅ right tool, technique is literature-consistent

**What it does:** three modes — per-node (embedding top-K candidates + cross-POV floor + LLM proposes typed edges), two-phase (flash-lite screen → bigger-model classify, ~50-60% token cut), and embedding-first (NumPy similarity matrix → LLM classifies type only for pairs ≥ 0.30). All outputs gated through `Resolve-EdgeType` (canonical 8 types), confidence < 0.5 dropped, human approval required (`status='proposed'`), evaluated-pair ledger for incremental runs.

**Is the LLM right?** Yes — and this is now backed by evidence, not just priors: [Carrasco et al., "Can Large Language Models perform Relation-based Argument Mining?" (arXiv 2402.11243)](https://arxiv.org/pdf/2402.11243) found that appropriately primed/prompted general-purpose LLMs **outperform the best fine-tuned RoBERTa baselines** on attack/support relation classification across ten datasets. So the tempting alternative ("fine-tune a relation classifier") is not clearly better even before you count training-data costs. The embedding-prefilter→LLM-classify shape is also the standard GraphRAG-era pattern.

**Upgrades:** (1) You already ship an NLI cross-encoder (`nli-deberta-v3-small` in embed_taxonomy.py, `nli-classify` subcommand). Use it as a free third signal: pairs the NLI model scores `contradiction` with margin are near-certain `CONTRADICTS` candidates and could skip (or pre-fill) LLM classification; `entailment` pairs prime `SUPPORTS`. Effort: 2-3 days. (2) The LLM's verbalized `confidence` values should be treated as ordinal, not probabilistic — verbalized confidence is known to be miscalibrated. You have ground truth accumulating (approve/reject decisions on proposed edges via `Approve-Edge`); periodically fit the accept-rate-per-confidence-bucket and adjust the 0.5 cutoff empirically. Effort: 1 day of analysis.

### 5. Edge weight evaluation — `Invoke-EdgeWeightEvaluation.ps1` ⚠️ change elicitation technique

**What it does:** batches of 30 edges to flash-lite, asks for a scalar `weight` 0.0–1.0 per edge (lines 143–208), then applies a **deterministic** modulation layer (confidence/priority/doctrinal factors, lines 210–253).

**Assessment:** The modulation layer is the good part. The elicitation is the weak part: asking an LLM for bare scalars in [0,1] produces poorly-calibrated, heavily-quantized outputs (mass at 0.7/0.8) — the LLM-as-judge literature consistently recommends rubric-anchored discrete levels or pairwise comparisons over raw scalar elicitation ([G-Eval and rubric-based scoring](https://www.confident-ai.com/blog/why-llm-as-a-judge-is-the-best-llm-evaluation-method), [FutureAGI best-practices survey](https://futureagi.com/blog/llm-as-judge-best-practices-2026)). Your own edge schema already defines a `strength: strong|moderate|weak` enum (Invoke-EdgeDiscovery.ps1:416) — the discrete scale exists but the weight pipeline doesn't use it.

**Recommendation:** elicit a 4–5 level anchored rubric ("strong = target's plausibility changes materially if source is false…") and map levels to numbers deterministically; keep the modulation layer unchanged. Cheap A/B: distribution spread + agreement on double-scored batches. Effort: 1-2 days. Risk: low (weights regenerate under `-Force`).

### 6. BDI weight assignment — `Invoke-BDIWeightAssignment.ps1` ✅ exemplary — no AI, correctly so

Despite living in the "AI Enrichment" section of AGENTS.md, this is a fully deterministic multi-signal formula (epistemic-type base + evidence/debate/edge boosts for belief confidence; tree-position rules for desire priority and intention operationality; lines 156–282). This is the right call — auditable, reproducible, free — and the pattern other sites should copy. **Keep as-is.** (Only note: the inputs `epistemic_type`/`falsifiability` come from LLM attribute extraction, so garbage-in risk concentrates in site #7.)

### 7. Attribute extraction — `Invoke-AttributeExtraction.ps1` ✅ keep

LLM batch-classifies nodes (batch 8, temp 0.2, flash-lite) into fixed enums (epistemic_type, falsifiability, rhetorical_strategy, etc.). A fine-tuned classifier is the classical alternative, but with ~565 nodes total and a mostly-one-time run, there's no training set and no ROI. One suggestion: since site #6's numeric formulas key off `epistemic_type`/`falsifiability`, these two labels deserve a **stronger model or a 2-model agreement check** (re-run disagreements with claude-sonnet). Effort: half day.

### 8. Ingestion priority — `Get-IngestionPriority.ps1` ✅ already hybrid, correctly

Gap scoring is entirely rule-based (orphan=10, one-sided-conflict=8, unmapped=7, echo-chamber=6, imbalance=5, single-POV=4; lines 74–216); the LLM is used only for the one genuinely generative sub-task — turning gaps into web search queries — and is skippable (`-NoAI`) with graceful key-missing fallback. **Keep as-is.** This is the textbook division of labor.

### 9. Debate engine — `lib/debate/` ✅ right tool; architecture matches or exceeds published practice

- **Turn generation** (BRIEF→PLAN→DRAFT→CITE staged pipeline, per-stage retry): LLM is obviously the only tool for persona-grounded argument generation. The staged decomposition with per-stage schemas is stronger than the single-shot generation in most published multi-agent-debate work.
- **Validation** is the hybrid the LLM-as-judge literature recommends: Stage A = 10 deterministic symbolic rules; Stage B = LLM judge (`turnValidator.ts:240` — default judge `claude-haiku-4-5`, deliberately a *different* model than the debater, with fallback wiring at `debateEngine.ts:3386-3387`). Cross-model judging avoids self-preference bias — good.
- **Convergence detection** (`convergenceSignals.ts`): 7 deterministic signals using word-overlap + embedding cosine (recycling ≥ 0.85), move polarity, QBAF strengths. No LLM — correct.
- **Quality scoring** (`qualityScore.ts:30-72`, PS parity in `Get-DebateQualityMetrics.ps1`): deterministic 8-metric weighted composite over pipeline-derived calibration data. No LLM — correct.

**Gaps vs best practice** ([judge-reliability surveys](https://arxiv.org/pdf/2606.19544), [FutureAGI](https://futureagi.com/blog/llm-as-judge-best-practices-2026)): (1) no human gold-set anchoring the judge — without one, judge drift is undetectable ("no human gold-set means no anchor"); build a ~50-turn human-scored set and re-validate the judge quarterly (there's already `Test-AITJudgeModel.ps1` and `Get-CalibrationTrend.ps1` — extend rather than build). (2) The hand-set weights in the quality composite (20/15/15/10/15/10/10/5) have, as far as the code shows, never been validated against human debate-quality rankings; one afternoon of rank-correlation against human ratings would either justify or fix them. (3) `debate.crux-refresh` runs at temp 0 with a 15s timeout on 2.5-flash — sensible; the three `synthesis.*` phases (the most user-visible output of the whole product) run on gemini-2.5-flash — this is the one place where an upgrade to a frontier model would be felt most and cost least (3 calls per debate).

### 10. Vernacular generation — `Invoke-VernacularBatch.ps1` ✅ keep, add a free deterministic gate + fix duplication

LLM rewriting to 10th-grade reading level is the right tool. Two findings: (1) the prompt **targets Flesch-Kincaid grade ~10** (line 63-64) but nothing verifies it — FK grade is a trivial deterministic formula; compute it on each output and retry the ones that miss. That converts a vibes prompt into a measurable contract for free. Effort: half day. (2) **Prompt duplication/drift:** the cmdlet carries its own detailed inline system prompt (lines 59-72, temp implicit) while `ai-usages.json:18-30` (`enrichment.vernacular-description`) defines a *different, generic* system message at temp 0.7. One of these is dead or they've drifted; per ADR-006 the registry should be the routing layer for this call. Reconcile.

### 11. Fallacy detection — `Find-PossibleFallacy.ps1` ✅ keep (right tool), consider model upgrade

LLM analysis of node reasoning against a fallacy catalog (`Private/fallacy-catalog.json`), conservative-by-prompt, batch 8, flash-lite. Fine-tuned fallacy classifiers exist in the literature but are trained on short argumentative texts, not ontology-node descriptions — poor fit. Nuance: fallacy identification is one of the more reasoning-heavy tasks in the enrichment suite, running on the *cheapest* model; the docstring itself suggests `-Force -Model 'gemini-2.5-pro'` for quality passes. Given ~565 nodes, run it once with a frontier model and freeze. Effort: config only.

### 12. Synthetic corpus — `New-SyntheticCorpus.ps1` + `generate_corpus.py` ✅ keep

Archetype-templated generation, multi-model randomization (`gemini-2.5-flash` + `claude-sonnet-4`), temp 1.0 for diversity, feeding multi-vector retrieval — this mirrors doc2query/HyDE-style retrieval augmentation and the diversity practices in synthetic-data literature (template + model + temperature variation). And the team built `Test-RerankerBaseline` explicitly to check whether a cross-encoder reranker makes the synthetic investment unnecessary — that's the correct scientific control. **Keep; just make sure the reranker-gate decision actually gets run and recorded.**

### 13. CHESS pre-classification — `Get-DocumentPovClassification.ps1` ✅ keep (marginal)

~600-token flash-lite multilabel call, recall-biased by prompt, all-POV fallback on any failure. A classical alternative exists (cosine against POV centroid embeddings — zero cost, deterministic), but the call costs a fraction of a cent and the failure mode is benign (over-inclusion). Migrate only if you're removing the API dependency from the ingestion path entirely.

### 14. NLI — `cross-encoder/nli-deberta-v3-small` (embed_taxonomy.py:40-45) ✅ keep

Used for entailment/contradiction classification in `claimExtractionPipeline.ts`, `Find-SituationCandidates.ps1`, and the editor. Using a dedicated NLI cross-encoder instead of an LLM here is exactly right, and the confidence-margin→neutral downgrade (NLI_CONFIDENCE_MARGIN, line 46) is a sound reliability guard. If NLI precision ever becomes limiting, `nli-deberta-v3-base` is a drop-in with better accuracy at ~3x latency. Also: as noted in §4, this asset is under-used — wire it into edge discovery.

### 15. Organization/POV alignment — `Find-OrganizationByPOV.ps1`, `Compare-OrganizationPositions.ps1` ✅ not an AI site

Both are pure filters/joins over stored `pov_alignment` scores. No change. (If those stored scores are ever LLM-assigned at import time, that assignment inherits the scalar-elicitation caveat from §5.)

### 16. UsageID registry — `ai-usages.json` — model-assignment audit

Findings across the 25 entries:

| Issue | Entries | Detail |
|---|---|---|
| **Floating `-latest` aliases** | `server.chat-response`, `server.search`, `server.news-report`, `po.analysis-*` use `gemini-flash-lite-latest` | Silent behavior/regression drift when Google repoints the alias; contradicts the registry's own purpose (controlled experimentation, per-usage cost tracking). Pin explicit versions. |
| **Cheap model on highest-stakes output** | `synthesis.extract/map/evaluate` (gemini-2.5-flash) | Synthesis is the product's headline artifact; 3 calls/debate. Best-leverage model upgrade in the file. |
| **Frontier model possibly over-provisioned** | `enrichment.situation-bdi-decomposition` (claude-sonnet-4-6) | Defensible for one-time ontology backfill (t/1306/t/1307); revisit if it becomes a recurring path. |
| **Registry/cmdlet drift** | `enrichment.vernacular-description` vs `Invoke-VernacularBatch` inline prompt; `enrichment.edge-discovery.classify` registry says 2.5-flash but the cmdlet's `-Override` reinstates its own default flash-lite (Invoke-EdgeDiscovery.ps1:118, 628-637) | The override pattern is sanctioned, but it means the registry no longer answers "what model does edge classification use" — cost-tracking reports will attribute correctly, config audits won't. Document or align defaults. |
| **Doc-only entry** | `debate.evidence-search` correctly flagged `_doc: not wired` | Fine. |

---

## Part 2 — Executive summary: recommendations ranked by impact ÷ effort

**Actively wrong (fix these, they're correctness/validity bugs, not preferences):**

1. **QBAF engine is labeled DF-QuAD but implements different semantics** (`lib/debate/qbaf.ts:59-67`). For a research platform this is a citable-validity issue. Fix via the existing `QbafOptions` hooks with paper-derived test vectors, or rename honestly. *Effort: 1-2 days. Risk: medium (strength values shift downstream).*
2. **`Invoke-QbafConflictAnalysis` documents embedding clustering that doesn't exist; `-Threshold` is dead** (Invoke-QbafConflictAnalysis.ps1:17-18 vs body). Either wire real embedding clustering (better conflict recall) or fix docs+params. *Effort: 0.5–2 days. Risk: low.*
3. **Embedding truncation trap:** `Get-TextEmbedding.ps1:64` truncates at 2000 chars but MiniLM ignores everything past ~256 tokens (~1,000 chars) — chunk-level RAG queries are silently embedding only their opening. *Effort: hours. Risk: none.*

**High impact / moderate effort:**

4. **Benchmark and likely replace all-MiniLM-L6-v2** (bge-small-en-v1.5 / nomic-embed-text-v1.5) using the existing `Compare-EmbeddingModel` + golden set; recalibrate the 0.20/0.30/0.85 cosine thresholds. Lifts every retrieval-dependent feature (RAG summaries, edge discovery, recycling detection, search). *~1 week. Measurable before commit.*
5. **Upgrade `synthesis.*` UsageIDs to a stronger model** — the most user-visible output, 3 calls/debate. *Config-only.*
6. **Human gold-set for the debate LLM judge** (~50 turns) + quarterly drift check via existing `Test-AITJudgeModel`/`Get-CalibrationTrend`; validate the hand-set quality-score weights against human rankings once. *2-3 days.*

**Low effort, solid returns:**

7. **Edge weights: replace scalar 0-1 elicitation with anchored rubric levels** mapped deterministically to numbers (the `strength` enum already exists). *1-2 days.*
8. **Semantic dedup in `Merge-ChunkSummaries`** (MiniLM cosine, replacing 80-char-prefix keys). *1-2 days.*
9. **Embedding sanity-check on LLM taxonomy-node assignments** in the summary pipeline (flag low-cosine mappings; shrinks the `Repair-AITSummaryMappings` workload). *1 day.*
10. **Deterministic Flesch-Kincaid gate on vernacular output** + reconcile the duplicated vernacular prompt (cmdlet vs registry). *0.5 day.*
11. **Pin `-latest` model aliases in ai-usages.json**; document the edge-discovery override-vs-registry precedence. *Hours.*
12. **Reuse the shipped NLI cross-encoder as a pre-signal in edge discovery** (contradiction margin ⇒ CONTRADICTS candidate). *2-3 days.*
13. **Calibrate LLM edge-confidence against accumulated approve/reject history**; adjust the 0.5 cutoff empirically. *1 day.*

**Explicitly keep as-is (right tool, right technique):** BDI weight assignment (deterministic — exemplary), ingestion priority (heuristic + optional LLM query-gen), quality scoring and convergence signals (deterministic), FIRE gating (deterministic 2-signal sniff), CHESS pre-classification, two-phase/embedding-first edge discovery architecture (validated by the relation-based argument-mining literature — primed LLMs beat fine-tuned RoBERTa), NLI cross-encoder usage, synthetic corpus methodology (including its reranker control gate), attribute extraction, fallacy detection (optionally one frontier-model pass), organization scoring (not AI).

**Sources:**
- [Rago, Toni, Aurisicchio & Baroni — Discontinuity-Free Decision Support with Quantitative Argumentation Debates (DF-QuAD)](https://www.cs.cf.ac.uk/caf2016/assets/submissions/Rago.pdf)
- [Double ReLU Modular Semantics for QBAF (restates DF-QuAD product aggregation + conditional influence)](https://arxiv.org/html/2605.02551v1)
- [Can Large Language Models perform Relation-based Argument Mining? (arXiv 2402.11243)](https://arxiv.org/pdf/2402.11243)
- [A Guide to Open-Source Embedding Models (BentoML, 2026)](https://www.bentoml.com/blog/a-guide-to-open-source-embedding-models)
- [Top embedding models on the MTEB leaderboard (Modal)](https://modal.com/blog/mteb-leaderboard-article)
- [LLM-as-Judge Best Practices: Calibration, Bias, and Cost (FutureAGI)](https://futureagi.com/blog/llm-as-judge-best-practices-2026)
- [Reliability without Validity: Large-Scale Evaluation of LLM-as-a-Judge (arXiv 2606.19544)](https://arxiv.org/pdf/2606.19544)
- [LLM-as-a-Judge guide incl. G-Eval rubric scoring (Confident AI)](https://www.confident-ai.com/blog/why-llm-as-a-judge-is-the-best-llm-evaluation-method)
- [Position bias in rubric-based LLM judges (arXiv 2602.02219)](https://arxiv.org/pdf/2602.02219)
