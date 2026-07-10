# Top 3 tickets to file the instant Orca reconnects

Source: `fable5-ai-technique-review-report.md` (2026-07-08), "Actively wrong" section. Owner asked (2026-07-08) to file these three specifically once Orca is reachable again — fire immediately on next successful Orca call, don't wait to be asked again.

---

## Ticket 1

**Title:** QBAF engine claims DF-QuAD semantics but implements different math — validity risk for a citable research platform

**Priority:** High
**Type:** Bug
**Suggested owner:** resolve via `resolve_owners_batch` on `lib/debate/qbaf.ts` once Orca's back (likely Shared Lib or Debate Engine role — unconfirmed, Orca was down when scoped)

**Description:**
`lib/debate/qbaf.ts:4-8` documents the module as implementing "DF-QuAD (Discontinuity-Free Quantitative Argumentation Debate) gradual semantics." The published DF-QuAD algorithm (Rago, Toni, Aurisicchio & Baroni 2016; restated in arXiv 2605.02551) aggregates attacker/supporter strengths via the probabilistic sum F(x₁..xₖ) = 1 − ∏(1 − xᵢ), combined via a conditional blend of base score and |aggAtt − aggSup|.

The actual implementation uses:
- **Sum-and-clamp aggregation** (`defaultAggregate`, qbaf.ts:59-63) instead of the product form
- **Multiplicative combine** `base·(1−aggAtt)·(1+aggSup)` (qbaf.ts:65-67) instead of the paper's conditional blend

Consequences: sum-and-clamp saturates at 1.0 (3 weak attackers ≈ 10 strong attackers — exactly the discontinuity DF-QuAD exists to avoid), and the clamp reintroduces the discontinuity class the real algorithm is designed to remove. The code's own oscillation-damping machinery (`oscillationDetected`, `dampingLevel`, qbaf.ts:44-47) is a symptom of having lost the semantics' convergence guarantees. Since this platform's outputs may be cited in AI-policy research, mislabeling the algorithm is a validity problem, not a style nit.

**Acceptance Criteria:**
1. Either (a) implement true DF-QuAD product aggregation + conditional combine as the default, validated against worked examples from the source paper, with the current sum-and-clamp semantics preserved under an explicit non-DF-QuAD name for anyone depending on current behavior, or (b) rename/re-document the current algorithm honestly and remove the DF-QuAD claim — TL to weigh in on which, given downstream blast radius
2. `QbafOptions`'s existing `aggregateAttacks`/`aggregateSupports`/`combine` hooks (qbaf.ts:32-37) should be the extension point — no new plumbing needed
3. Regenerate/verify downstream consumers that bake in current strength values: `evidenceQbaf.ts`, `qbafCombinator.ts`, `enrich_conflicts_qbaf.py`
4. Design comment required before implementation — this is a data-semantics change, not routine
5. Commit SHA in completion comment

---

## Ticket 2

**Title:** Invoke-QbafConflictAnalysis docstring advertises embedding-based claim clustering that doesn't exist — dead `-Threshold` param

**Priority:** Medium
**Type:** Bug
**Suggested owner:** PowerShell (`main.scripts`)

**Description:**
`scripts/AITriad/Public/Invoke-QbafConflictAnalysis.ps1`'s docstring (lines 9-11) states the cmdlet "clusters similar claims using embedding similarity" and exposes `-Threshold` ("Cosine similarity threshold for claim clustering. Default: 0.85", lines 17-18, 34-35). The parameter is never referenced anywhere in the function body — relations are detected only via exact taxonomy-node-ID overlap (shared `linked_taxonomy_nodes` + opposing `doc_position`, lines 139-172). Two claims addressing the same question that got mapped to different (or no) taxonomy nodes are never compared, silently reducing conflict recall. The repo already has everything needed to implement this for real: `Get-TextEmbedding`, `similarity-cache.json`, local MiniLM.

**Acceptance Criteria:**
1. Either (a) wire real embedding-based clustering — embed claim texts, union node-overlap edges with cosine ≥ `-Threshold` pairs, LLM-confirm only the newly-surfaced pairs (not the whole set) — or (b) delete the dead `-Threshold` parameter and correct the docstring to describe only the taxonomy-node-overlap method actually used
2. If (a): before landing, fix the embedding truncation bug from Ticket 3 first, or the new clustering signal inherits that bug
3. Regression test: run against a known conflict-analysis fixture, confirm relation count only grows (or stays equal, if (b))
4. Commit SHA in completion comment

---

## Ticket 3

**Title:** Text embedding silently truncates input at the wrong boundary — chunk-level RAG queries lose everything past ~1,000 chars

**Priority:** High
**Type:** Bug
**Suggested owner:** PowerShell (`main.scripts`)

**Description:**
`scripts/AITriad/Private/Get-TextEmbedding.ps1:64` truncates input text at 2000 chars with a comment citing "(model context limit)." The actual model, all-MiniLM-L6-v2, has an effective window of 256 word-piece tokens ≈ 1,000 chars. Everything between ~1,000 and 2,000 chars is passed to the tokenizer but silently discarded before encoding — callers believe they're embedding up to 2000 chars of input, but only the first ~1,000 chars actually influence the vector. This isn't just staleness — it's a live correctness bug: callers like `Get-RelevantTaxonomyNodes -Query $ChunkText` (RAG node selection for summaries/debates) get an embedding of only the opening of their query text whenever the chunk exceeds ~1,000 chars, degrading retrieval silently with no error or warning.

**Acceptance Criteria:**
1. Fix the truncation boundary to match the model's real limit — either truncate honestly at ~250 tokens (update the comment to state the real reason), or chunk + mean-pool for inputs that exceed it
2. Add a test asserting embeddings for inputs between 1,000-2,000 chars actually change when content past the true boundary changes (this is exactly the case the current code silently gets wrong)
3. Grep all callers passing chunk-length or document-length text (not just short queries) to confirm which retrieval paths were actually affected — flag if any need re-embedding
4. Commit SHA in completion comment

**Note:** low implementation risk (hours), but flag in the completion comment whether any existing embeddings need regeneration as a result — that's a separate, larger follow-up if so, not blocking this fix.
