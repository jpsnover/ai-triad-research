# Paper Review: Towards Effective Extraction and Evaluation of Factual Claims

**Paper:** Metropolitansky, D. & Larson, J. (2025). *Towards Effective Extraction and Evaluation of Factual Claims.* ACL 2025 Main Conference. Microsoft Research.
**arXiv:** https://arxiv.org/abs/2502.10855
**License:** CC BY 4.0
**Reviewed by:** Computational Linguist, 2026-06-04
**Ticket:** t/371

---

## 1. Summary

The paper introduces Claimify, an LLM-based claim extraction pipeline, and a three-dimensional evaluation framework for claim quality. Claimify decomposes long-form LLM-generated text into independently verifiable factual claims via a three-stage pipeline: (1) **Selection** — classifying sentences as containing verifiable content and rewriting to exclude unverifiable parts, (2) **Disambiguation** — detecting referential and structural ambiguity and determining whether context resolves it, and (3) **Decomposition** — extracting decontextualized atomic claims. The evaluation framework measures **entailment** (source→claim), **element-level coverage** (granular assessment of what information is captured vs. missed), and **decontextualization** (whether omitted context changes the fact-checking verdict). Claimify achieves 99% entailment, 87.9% element-level accuracy, and 80.6% desirable decontextualization on the BingCheck dataset (396 Copilot answers, 6,490 sentences, 73K+ extracted claims), outperforming VeriScore, DnD, SAFE, AFaCTA, and Factcheck-GPT.

## 2. Key Technical Details

### 2.1 Claimify Pipeline

| Stage | Input | Output | Key Innovation |
|-------|-------|--------|---------------|
| **Selection** | Sentence + context (p preceding, f following) | "No verifiable claims" / rewritten verifiable-only / original | Rewrites sentences to retain only verifiable components before decomposition |
| **Disambiguation** | Verifiable sentence + context | "Cannot be disambiguated" / clarified sentence / original | Detects referential + structural ambiguity; refuses to extract when ambiguity is unresolvable (max 5.4% of sentences) |
| **Decomposition** | Disambiguated sentence + context | List of decontextualized factual claims | Bracketed notation flags inferred context (e.g., "[a celebrity]") |

### 2.2 Evaluation Framework

| Dimension | Method | Key Metric |
|-----------|--------|-----------|
| **Entailment** | LLM prompt (validated against NLI model, which had significant limitations) | % of claims entailed by source |
| **Coverage** | Element-level: decompose sentence into information elements, classify as verifiable/unverifiable, check if covered by claims | Macro F1 across verifiable/unverifiable elements |
| **Decontextualization** | Outcome-based: generate maximally decontextualized claim (c_max), retrieve evidence for both c and c_max, check if verdicts align | % of desirable result types (verdict-aligned) |

### 2.3 Benchmarks (GPT-4o-2024-08-06)

| Method | Claims | Entailment | Sent. Accuracy | Elem. Macro F1 | Decontext. (Bing) |
|--------|--------|-----------|----------------|---------------|------------------|
| **Claimify** | 12,406 | **99.0%** | **91.8%** | **83.7%** | **80.5%** |
| VeriScore | 7,420 | 99.2% | 79.0% | 62.5% | 79.3% |
| SAFE | 22,786 | 96.6% | 65.0% | 57.3% | 78.7% |
| DnD | 27,717 | 89.1% | 63.7% | 56.2% | 78.6% |

### 2.4 Ablation

Removing the Selection stage causes the largest drop (Elem. F1: 83.7% → 54.4%). Disambiguation removal drops Elem. F1 to 75.9%. Selection-as-detector-only (no rewriting) drops to 74.7%. All variants still outperform most baselines.

## 3. Relevance to AI Triad Research

### 3.1 Direct Overlap: Debate Engine Claim Extraction

Our debate engine already performs claim extraction via the `my_claims` field in debater responses. The turn validator (`turnValidator.ts:412-425`) enforces claim specificity after round 3 — checking for numbers, named entities, timelines, etc. The argument network (`argumentNetwork.ts`) classifies claims by BDI category, base_strength, specificity, and extraction_confidence.

**Alignment with Claimify's framework:**

| Claimify Dimension | Our Current Approach | Gap |
|--------------------|---------------------|-----|
| **Entailment** | Not explicitly checked. We validate structure (JSON shape) and specificity (regex), but don't verify that `my_claims` are actually entailed by the `statement` text. | **GAP: We have no entailment verification.** A debater could list claims in `my_claims` that aren't actually in their statement. |
| **Coverage** | Partial. We check that `my_claims` isn't empty and contains specific claims, but don't measure whether claims cover all verifiable content in the statement. | **GAP: No coverage measurement.** We don't know if debaters omit key factual content from their claim list. |
| **Decontextualization** | Not addressed. Claims in `my_claims` are short sketches (often 1 sentence) that assume debate context. | **MODERATE GAP.** Within-debate, context is available. But for cross-debate analysis (crux registry, argument network queries), decontextualized claims would be more useful. |
| **Disambiguation** | `ambiguity_resolved` field exists in AN extraction (`argumentNetwork.ts:148`) with values: "none" / "acknowledged" / "collapsed". | **PARTIAL MATCH.** We detect ambiguity collapse but don't refuse to extract when ambiguity is unresolvable. |
| **Verifiability filtering** | `base_strength` classification distinguishes "grounded" / "reasoned" / "asserted". Verification status: "verified" / "disputed" / "unverifiable". | **PARTIAL MATCH.** We classify verifiability but don't filter unverifiable claims from extraction. |

### 3.2 Element-Level Coverage as a Calibration Metric

Claimify's element-level coverage evaluation is directly applicable as a new calibration metric. Currently, our `claims_per_1k_words` metric (`calibrationLogger.ts:662-666`) measures extraction density but not extraction quality. Element-level coverage would measure whether the claims actually capture the verifiable information in each debate turn.

### 3.3 Decontextualization for Cross-Debate Analysis

Our crux registry (`cruxRegistry.ts`) and crux-to-taxonomy feedback loop (`cruxTaxonomyFeedback.ts`) aggregate claims across debates. Decontextualized claims would improve:
- **Crux deduplication**: Embedding similarity on decontextualized claims would be more reliable than on context-dependent sketches
- **Taxonomy alignment**: Claims that carry their own context map more accurately to taxonomy nodes
- **Evidence QBAF backfill**: `backfill-evidence-qbaf.ts` searches for evidence to verify claims — decontextualized claims would produce better search queries

### 3.4 Selection Stage → Specificity Enforcement

Claimify's Selection stage (classifying verifiable vs. unverifiable content, rewriting to retain only verifiable parts) directly parallels our turn validator's Rule 9 (claim specificity). But Claimify's approach is more principled — it operates at the element level rather than using regex patterns for numbers/entities. Adopting a Selection-like pre-pass could replace or supplement our regex-based specificity check.

### 3.5 Disambiguation → Ambiguity Handling

Claimify's explicit refusal to extract from unresolvable ambiguity (max 5.4% rejection rate) is more conservative than our current approach. Our `ambiguity_resolved: "collapsed"` tag records when extraction picks one reading of an ambiguous claim, but we don't block it. For high-stakes applications (taxonomy updates, cross-debate crux tracking), refusing to extract ambiguous claims could reduce noise.

## 4. Recommendations

| # | Recommendation | Priority | Files Affected | Owner |
|---|---------------|----------|---------------|-------|
| 1 | **Add entailment verification to AN extraction.** After claim extraction, run an NLI-style check that each `my_claims` entry is entailed by the debater's `statement`. Flag non-entailed claims with low `extraction_confidence`. This closes the most significant gap. | **HIGH** | `argumentNetwork.ts` (extraction prompt + post-extraction validation) | DebateTool + CL review |
| 2 | **Design `claim_coverage_rate` calibration metric.** Adapt Claimify's element-level coverage to measure what fraction of verifiable information in a debate turn is captured by `my_claims`. Compute per-turn and per-debate. Target: >80% coverage. | **MEDIUM** | `calibrationLogger.ts` (new metric), `calibrationOptimizer.ts` (parameter tuning) | CL + DebateTool |
| 3 | **Add decontextualization post-pass for crux registry claims.** Before persisting claims to the crux registry, run a decontextualization step that expands context-dependent references (pronouns, "this policy", relative dates) using the debate transcript. | **MEDIUM** | `cruxRegistry.ts` (in `persistDebateCruxes`), new prompt template in `prompts.ts` | DebateTool + CL review |
| 4 | **Upgrade specificity check from regex to element-level verifiability.** Replace Rule 9's regex-based specificity check (`turnValidator.ts:414-423`) with an LLM prompt that classifies claim elements as verifiable/unverifiable, similar to Claimify's Selection stage. Would reduce false positives (regex misses) and false negatives (regex pattern-matches non-specific content). | **LOW** | `turnValidator.ts` (Rule 9) | DebateTool + CL review |
| 5 | **Add "cannot disambiguate" rejection to AN extraction.** When `ambiguity_resolved` would be "collapsed", optionally reject the claim instead of extracting with a flag. Configurable threshold: reject in cross-debate contexts (registry, taxonomy) but allow in within-debate contexts (argument network, turn tracking). | **LOW** | `argumentNetwork.ts` (extraction prompt), configuration in debate runner | DebateTool + CL review |

## 5. Risks

- **Latency cost of entailment verification (Rec #1):** Adding an NLI check per turn adds an LLM call. For our gemini-2.5-flash backend, this is ~1-2 seconds per turn. Acceptable for post-debate analysis; may need to be async for real-time debate flow.

- **Element-level coverage measurement cost (Rec #2):** Claimify's element decomposition requires an LLM call per sentence. For calibration purposes, this could be sampled (e.g., 20% of turns) rather than exhaustive.

- **Decontextualization over-expansion (Rec #3):** Adding too much context to claims can make them unwieldy for embedding comparison. Need to balance decontextualization with embedding-friendly conciseness. Claimify's bracketed notation (flagging inferred context) is a useful pattern — preserves the original claim while marking additions.

- **Single-dataset validation:** Claimify was evaluated only on BingCheck (Copilot-generated Q&A). Our domain is multi-agent debate transcripts, which have different characteristics: longer context, argumentative structure, multiple speakers, and normative (not just factual) claims. The Selection stage's verifiable/unverifiable distinction maps cleanly to our belief/desire split (beliefs are verifiable, desires are normative), but this alignment needs empirical validation.

- **Normative claims:** Claimify explicitly filters out unverifiable content. In our debate engine, normative claims (Desires, Intentions) are not empirically verifiable but are still important claims. We need to adapt the framework to distinguish "unverifiable-normative" (keep) from "unverifiable-vague" (flag).

## 6. Verdict

**approve-with-notes** — Highly relevant paper. The evaluation framework (entailment + element-level coverage + decontextualization) is directly adoptable as calibration infrastructure. The biggest gap it exposes is our lack of entailment verification between `my_claims` and `statement` text. The Disambiguation stage's explicit refusal to extract ambiguous claims is a principled approach we should adopt for cross-debate contexts.

**Key insight for the project:** We currently validate claim *form* (specificity via regex) but not claim *substance* (entailment, coverage, decontextualization). Claimify's framework shows how to close that gap with automated, scalable methods.

## 7. Evidence

- Entailment gap demonstrated by comparing `turnValidator.ts:412-425` (regex-only) with Claimify's 99% entailment rate
- Coverage gap demonstrated by comparing `calibrationLogger.ts:662-666` (density-only metric) with Claimify's element-level F1=83.7%
- Disambiguation partial match confirmed at `argumentNetwork.ts:148` (`ambiguity_resolved` field)
- Decontextualization gap relevant to `cruxRegistry.ts:117-165` (embedding-based dedup on context-dependent claims)
