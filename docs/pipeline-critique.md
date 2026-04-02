# Document Processing Pipeline — Best Practices Critique

A critical evaluation of the AI Triad ingestion pipeline against established AI/LLM best practices for document processing, information extraction, and knowledge base construction.

---

## Overall Assessment

The pipeline is **pragmatic and well-structured for its current scale** (~200 taxonomy nodes, dozens of documents). Several design choices that appear unorthodox are defensible at this scale. However, the architecture has **scaling limits and verification gaps** that will become problems as the taxonomy and document corpus grow.

**Grade: B+.** Good engineering for a research tool. Needs hardening for production reliability.

---

## What the Pipeline Gets Right

### 1. Semantic Boundary Chunking
Splitting on Markdown headings rather than fixed character counts is the right approach. Research consistently shows that semantic chunking (respecting document structure) produces better extraction quality than arbitrary splits. The heading > paragraph > character fallback chain is well-ordered.

### 2. Density-Scaled Extraction Targets
Scaling extraction minimums and targets proportionally to document length is a sophisticated touch that most extraction pipelines lack. The formulas (e.g., `MAX(3, wordCount/500)`) prevent both over-extraction from short documents and under-extraction from long ones. The density retry mechanism catches the most common failure mode — the model being too conservative.

### 3. Human-in-the-Loop for Taxonomy Changes
Unmapped concepts generate proposals, not automatic changes. This is the correct approach for a knowledge base where accuracy matters more than throughput. Auto-applied taxonomy changes would introduce compounding errors.

### 4. Temperature Selection
0.1 for extraction is appropriate — you want deterministic, reproducible outputs when extracting structured data from documents. 0.3 for taxonomy proposals (where some creativity is desired) is a reasonable bump.

### 5. JSON Mode + Repair
Using `JsonMode: enabled` forces the model to produce valid JSON, eliminating the most common class of parsing failures. The `Repair-TruncatedJson` fallback handles the second most common failure (output truncation). This two-layer approach is robust.

### 6. Verbatim Field Requirement
Requiring word-for-word excerpts from the source document is a grounding mechanism that makes hallucination auditable. If the `verbatim` field doesn't appear in the source, the extraction is suspect.

---

## Significant Concerns

### 1. Monolithic Prompt — Too Many Tasks in One Call

**The problem:** A single AI call does POV classification, BDI categorization, claim extraction, taxonomy mapping, stance assessment, verbatim extraction, factual claim identification, temporal classification, conflict matching, AND unmapped concept detection. That's 10+ distinct cognitive tasks in one prompt.

**Why this matters:** LLM performance degrades as task count increases within a single prompt. Each additional task competes for the model's attention. Research on "lost in the middle" effects shows that instructions in the middle of long prompts receive less attention. With a ~50KB taxonomy + full document + extraction instructions, the middle of this prompt is a dead zone.

**Best practice:** Decompose into a multi-step pipeline:
1. **Step 1:** Extract raw claims and key points (no taxonomy context needed)
2. **Step 2:** Classify each claim by POV and BDI category (with taxonomy labels only, not full descriptions)
3. **Step 3:** Map classified claims to specific taxonomy nodes (with targeted context — only nodes in the relevant POV/category)
4. **Step 4:** Identify unmapped claims and generate proposals

Each step is simpler, more focused, and can be validated independently. The total token cost may increase, but accuracy per task would improve significantly.

**Counterargument:** The current approach works because the taxonomy is small (~200 nodes). If the model can attend to the full taxonomy in context, decomposition adds latency without proportional accuracy gain. This is valid today but will fail as the taxonomy grows past ~500 nodes.

### 2. Taxonomy Mapping by Prompt Injection — No Verification Layer

**The problem:** The AI maps claims to taxonomy nodes by receiving the full taxonomy in the prompt and outputting node IDs. There is no verification that these mappings are correct. A hallucinated or incorrect `taxonomy_node_id` propagates silently into the summary.

**Why this matters:** In information extraction, precision errors compound. If a claim is mapped to the wrong node, it distorts that node's coverage metrics, poisons conflict detection (by creating false cross-POV disagreements), and misleads the health analysis.

**Best practice:** Add a lightweight verification step:
- **Embedding similarity check:** Compute cosine similarity between the extracted claim text and the mapped node's description. Flag mappings below a threshold (e.g., 0.3) for human review.
- **Confidence score:** Ask the model to output a confidence score (0-1) alongside each `taxonomy_node_id`. Low-confidence mappings get flagged.
- **Bidirectional verification:** For each mapping, ask: "Given this taxonomy node, is this claim relevant?" The forward pass (claim → node) and backward pass (node → claim) should agree.

**Estimated effort:** Medium. Embedding similarity is already available in the Electron app (the taxonomy editor uses it for semantic search). Wiring it into the PS pipeline as a post-processing validation step would catch the worst mapping errors.

### 3. No Overlap in Chunking — Cross-Boundary Claims Lost

**The problem:** Non-overlapping chunks mean that claims spanning a chunk boundary are split across two chunks. Neither chunk has the full context to extract the claim correctly. The merge step deduplicates by string prefix, but it cannot reconstruct a claim that was partially extracted in two chunks.

**The pipeline's rationale** — "overlap would just create duplicate work" — is incorrect. Overlap exists not to create duplicates but to ensure claims near boundaries have sufficient context in at least one chunk.

**Why this matters:** Academic papers frequently develop arguments across section boundaries. A claim introduced at the end of one section and elaborated at the start of the next will be truncated in both chunks.

**Best practice:** Add 10-20% overlap between chunks. A `MaxChunkTokens` of 15,000 with 2,000 tokens of overlap (13,000 unique + 2,000 shared) would catch most boundary claims. The deduplication step already handles the resulting duplicates.

**Alternative:** If overlap is undesirable, add a "boundary claims" pass — a focused extraction on the 2,000-token window around each chunk boundary, looking specifically for claims that span the split point.

### 4. String-Prefix Deduplication is Fragile

**The problem:** Chunk merge deduplicates key points by `taxonomy_node_id | point[0:80]` and factual claims by `claim_label` (lowercase). This is brittle:
- Two chunks may describe the same claim in slightly different words → no dedup
- The AI may generate the same claim with a different opening sentence → no dedup
- Conversely, two genuinely different claims may share an 80-character prefix → false dedup

**Best practice:** Use embedding-based deduplication. Compute embeddings for each extracted claim and merge claims with cosine similarity > 0.85. This catches semantic duplicates regardless of surface-level wording.

**Cheaper alternative:** Use the AI model itself for deduplication — present pairs of candidate duplicates and ask "Are these the same claim? Y/N." This is slower but more accurate than string matching.

### 5. No Extraction Quality Measurement

**The problem:** There is no evaluation framework. The pipeline has no way to answer: "How many claims did we miss?" or "What percentage of taxonomy mappings are correct?" The density check (minimum counts) catches catastrophic failures but says nothing about quality.

**Why this matters:** Without measurement, you cannot improve the pipeline. Parameter changes (chunk size, temperature, prompt wording) may improve or degrade quality, and you'd never know.

**Best practice:** Build a small gold-standard evaluation set:
1. Take 5-10 documents
2. Have a human manually extract key_points, factual_claims, and taxonomy mappings
3. Run the pipeline on the same documents
4. Measure: precision, recall, F1 for claim extraction; accuracy for taxonomy mapping; false positive/negative rates for conflict detection

This is a one-time investment (~4-8 hours of human annotation) that enables all future pipeline optimization to be evidence-based.

### 6. Token Estimation is Crude

**The problem:** `1 token = 4 characters` is a rough heuristic. Actual tokenization varies by model and content:
- Technical text with code/equations: ~3 chars/token
- Conversational English: ~4-5 chars/token
- Non-English text or special characters: ~2-3 chars/token

A 20% error in token estimation means documents near the 20,000-token threshold may be mis-routed (chunked when they'd fit in one call, or sent as a single call when they're too large).

**Best practice:** Use the target model's actual tokenizer (tiktoken for OpenAI, or the Gemini tokenizer API's `countTokens` endpoint). If that's too slow, calibrate the heuristic: measure actual token counts for 20 representative documents and derive a better ratio.

**Pragmatic compromise:** The current heuristic is probably off by 10-20%, and the 20K threshold has 5K of headroom (the single-call path handles up to 32K tokens). So mis-routing is unlikely to cause failures. But it does mean some documents near the boundary get unnecessarily chunked, increasing cost and latency.

---

## Moderate Concerns

### 7. Full Taxonomy in Every Prompt — Cost and Attention

Injecting ~50KB of taxonomy JSON into every prompt (and every chunk prompt) is expensive. For a 4-chunk document, that's 200KB of taxonomy context repeated 4 times. This is ~12,500 tokens of taxonomy × 4 chunks = 50,000 tokens of taxonomy alone.

**Impact:** Mostly cost. At current Gemini pricing this is cheap, but it also consumes attention capacity. The model must attend to 200+ node descriptions while processing the document text. Retrieval-augmented generation (RAG) — where you embed the taxonomy and retrieve only the 20-30 most relevant nodes per chunk — would be more efficient and would focus the model's attention.

**When to act:** When the taxonomy exceeds ~500 nodes or ~100KB, the full-injection approach will degrade. Plan the RAG migration now but execute it later.

### 8. Sequential Chunk Processing

Processing chunks sequentially to respect rate limits is correct for API-limited backends, but it makes large documents slow. A 10-chunk document takes 10 × (API call + processing) time.

**Best practice:** Use a semaphore-controlled parallel pipeline — process 2-3 chunks concurrently (within rate limits) instead of strictly sequential. Most APIs support 2-5 concurrent requests.

### 9. Single Density Retry is Insufficient

One retry attempt for low-density results is better than zero, but the retry just appends "give me more" without changing the approach. If the model produced low-density output, repeating the same prompt with a nudge often produces only marginally more.

**Better approach:** On retry, increase temperature slightly (0.1 → 0.3) and restructure the prompt to focus specifically on the underperforming area. If key_points for skeptic were low, retry with: "Focus specifically on claims a skeptic would find relevant in this document."

### 10. No Document Quality Assessment

The pipeline accepts all documents equally. A well-structured academic paper and a rambling blog post with no clear claims both go through the same extraction pipeline. Documents with very low information density produce low-quality summaries that pollute the corpus.

**Best practice:** Add a pre-screening step that estimates document quality/relevance before full extraction. This could be a cheap AI call (low token limit, fast model) that classifies the document as "high/medium/low relevance to AI policy discourse" and flags low-relevance documents for human review before processing.

---

## Minor Concerns

### 11. Markdown Conversion Quality Varies

The priority chain of conversion tools (`markitdown` > `pdftotext` > `mutool`) means different documents may be converted with different tools, producing inconsistent Markdown quality. Two-column academic PDFs, for instance, may have interleaved column text with some converters but not others.

**Mitigation:** Log which converter was used in metadata.json so conversion quality issues can be traced.

### 12. No Provenance Tracking for Claims

Individual claims don't track which chunk they came from (in chunked mode). If a claim looks wrong, there's no easy way to find the source text that produced it without re-running the pipeline.

**Fix:** Include `chunk_index` or `source_offset` in each extracted claim for chunked documents.

### 13. Policy Registry Cap (5KB) is Arbitrary

The 5KB cap on the policy registry in the prompt prevents context bloat but may exclude relevant policies for documents that address many policy areas. As the registry grows, this cap will need to become a relevance filter rather than a size cap.

---

## Prioritized Recommendations

| Priority | Recommendation | Effort | Impact |
|----------|---------------|--------|--------|
| **1** | Build a gold-standard eval set (5-10 docs) | Medium | Enables all other improvements to be measured |
| **2** | Add embedding-based mapping verification | Medium | Catches wrong taxonomy mappings before they propagate |
| **3** | Add chunk overlap (10-20%) | Low | Recovers cross-boundary claims |
| **4** | Replace string-prefix dedup with embedding-based dedup | Medium | Eliminates false positives/negatives in merge |
| **5** | Decompose into multi-step extraction | High | Better per-task accuracy, independent validation |
| **6** | Plan RAG migration for taxonomy context | Low (plan) / High (execute) | Required when taxonomy exceeds ~500 nodes |
| **7** | Add extraction confidence scores | Low | Enables quality filtering without human review |
| **8** | Calibrate token estimation | Low | Better chunk/single-call routing |

---

## Summary

The pipeline's core architecture — convert, chunk, extract, map, detect conflicts — is sound. The prompt engineering (density scaling, JSON mode, verbatim grounding, genus-differentia format) is above average. The main gaps are in **verification** (no way to check if mappings are correct), **evaluation** (no way to measure quality), and **robustness at scale** (full taxonomy injection and string-prefix dedup will fail as the corpus grows). Recommendations 1-4 would address the highest-risk gaps with moderate effort.
