# Exclusion Embeddings: Theory of Success

## The Core Idea

Every taxonomy node describes what it **is about** and what it **excludes**. We embed both separately:

- `vector` — embedding of the node's core description (what it IS)
- `exclusion_vector` — embedding of the Excludes clause (what it is NOT)

When any pipeline step selects a taxonomy element for processing, we use both embeddings to answer a simple question:

> **Is the candidate text better described by what this node covers, or by what it explicitly excludes?**

If the candidate is closer to the excluded meaning than the core meaning, the taxonomy element is a bad match — even if it scored high on the main similarity.

## The Decision Framework

Given a candidate text (a claim, a draft statement, a query) and a taxonomy node:

```
sim_main = cosine(candidate_embedding, node.vector)
sim_excl = cosine(candidate_embedding, node.exclusion_vector)
```

### Two complementary tests

| Test | Formula | Use case | Question answered |
|------|---------|----------|-------------------|
| **Ratio test** | `sim_excl > sim_main × R` | Post-selection validation | "Now that we picked this node, is the candidate actually in its exclusion zone?" |
| **Absolute test** | `sim_excl > T` | Drift detection | "Is this text suspiciously similar to excluded content, regardless of main similarity?" |

### When to apply each

- **Ratio test (R = 0.95)**: Use when you've already matched a candidate to a specific node and want to validate the match. A ratio near 1.0 means the candidate is equidistant between what the node covers and what it excludes — that's a classification boundary error.

- **Absolute test (T = 0.65)**: Use when monitoring ongoing discourse for scope drift. Even if the main similarity is also high (the node is relevant), a high exclusion similarity means the argument is wandering into territory the node explicitly disclaims.

## Where Taxonomy Elements Get Selected

The debate pipeline selects taxonomy elements at six points. At each, the exclusion embedding should serve as a **reject/warn filter**:

### 1. Taxonomy Context Injection (relevance scoring)

**What happens:** `taxonomyRelevance.ts` scores nodes by embedding similarity + lexical overlap to decide which nodes to inject into debater prompts.

**How exclusion should work:** After ranking nodes by relevance, apply the ratio test to the top-N candidates. If a node's exclusion_vector is too similar to the debate topic/current round focus, demote it. This prevents injecting nodes whose *excluded content* happens to match the discussion topic.

**Status:** ✅ Implemented — `filterByExclusionRatio()` in `exclusionGuard.ts`, integrated into `selectRelevantNodes()` and `selectRelevantSituationNodes()` via `RelevanceOptions.nodeEmbeddings` + `queryVector`. Trace accessible via `_exclusionFilter` on returned arrays.

### 2. Claim Extraction Attribution

**What happens:** After a debater speaks, claims are extracted and attributed to taxonomy nodes by embedding similarity.

**How exclusion works:** For each newly extracted claim matched to a node, check: `sim_excl > sim_main × 0.95`. If true, the claim is in the node's exclusion zone — it was mis-attributed. Flag for review.

**Status:** ✅ Implemented — `checkClaimExclusionBoundary()` in `exclusionGuard.ts`, called at `debateEngine.ts:4844`

### 3. Draft Scope Boundary Check

**What happens:** After generating a draft statement, before committing to transcript.

**How exclusion works:** Embed the first 500 chars of the draft. For each taxonomy ref the statement cites, check: `cosine(draft_emb, exclusion_vector) > 0.65`. If true, the draft is drifting into territory the cited node explicitly disclaims. Add a caveat.

**Status:** ✅ Implemented — `checkDraftScopeBoundary()` in `exclusionGuard.ts`, called at `debateEngine.ts:3122`

### 4. Situation Injection

**What happens:** Situations are selected for injection into debate rounds based on relevance to current discussion.

**How exclusion should work:** Before injecting a situation, check whether the debate's current focus is in the situation's exclusion zone. If the situation excludes the exact topic being debated, injecting it will confuse rather than help.

**Status:** ✅ Implemented — `filterByExclusionAbsolute()` in `exclusionGuard.ts`, called at `debateEngine.ts:1561`. Uses absolute threshold (0.65). Skipped situations recorded in flight recorder and injection manifest.

### 5. Chat / Analysis Prompts

**What happens:** When a user asks questions in the taxonomy editor, relevant nodes are retrieved for context.

**How exclusion should work:** After retrieving candidate nodes for a user query, apply the ratio test. If a node's exclusion content matches the query better than its core content, it's a false positive retrieval.

**Status:** ❌ Not implemented

### 6. Lexical Relevance Scoring

**What happens:** `taxonomyRelevance.ts` uses keyword matching against node descriptions as a scoring signal.

**How exclusion should work:** Strip "Excludes:" text before lexical matching. Currently, keywords in the Excludes clause can produce false-positive relevance matches (the node mentions the keyword, but only to say it's NOT about that).

**Status:** ❌ Not implemented (t/446 covers stripping from injection, but lexical scoring not yet addressed)

## Why This Works

The Excludes clause is a human-authored scope boundary. It captures the author's knowledge of common confusions: "People might think this node covers X, but it doesn't — X belongs elsewhere." Embedding this text creates a semantic "negative space" around each node.

Without exclusion enforcement, the pipeline makes systematic errors:
- Attributes claims to nodes that explicitly disclaim them
- Injects nodes whose exclusion content matches the debate topic
- Allows debaters to argue from a node while actually discussing what it excludes

With exclusion enforcement, the system respects scope boundaries the way a human taxonomist would — by recognizing that high similarity to excluded content is a *disqualifying* signal, not a qualifying one.

## Threshold Rationale

| Threshold | Value | Calibrated on | Rationale |
|-----------|-------|---------------|-----------|
| `EXCLUSION_RATIO_THRESHOLD` | 0.95 | 19 debates, 685 AN nodes (t/452) | At 0.95, 18.3% of nodes flagged. Lower values (0.85) produced 30% flag rate with many false positives. 0.95 catches only claims genuinely at the classification boundary. |
| `SCOPE_BOUNDARY_THRESHOLD` | 0.65 | 19 debates, draft averages (t/452) | At 0.65, 2.8% warning rate. The absolute threshold is conservative — only flags when a draft is strongly similar to excluded content regardless of main similarity. |

## Observable Outcomes

When working correctly:
- Debates stay within their attributed taxonomy nodes' core scope
- Mis-attributed claims are flagged before they corrupt the argument network
- Drafts that wander into excluded territory get caveats warning the reader
- No "invisible failures" where a node is selected because of its Excludes text

When NOT working:
- Claims cluster around exclusion boundaries (high sim_excl relative to sim_main)
- Debaters argue about topics their cited nodes explicitly exclude
- Context injection includes nodes that are only relevant via their Excludes clause

## Implementation Summary

| Component | Status | Ticket |
|-----------|--------|--------|
| Exclusion vectors generated (98.4% coverage) | ✅ Done | t/448 |
| Strip Excludes from debate injection prompts | ✅ Done | t/446 |
| Claim extraction overlap guard (ratio test) | ✅ Done | t/450 |
| Draft scope boundary check (absolute test) | ✅ Done | t/451 |
| Threshold calibration | ✅ Done | t/452 |
| Editor embedding strips Excludes from main vector | ✅ Done | t/447 |
| Editor save generates exclusion_vector | ✅ Done | t/449 |
| Taxonomy context injection filtering | ❌ Not started | — |
| Situation injection filtering | ❌ Not started | — |
| Lexical relevance scoring stripping | ❌ Not started | — |
| Chat/analysis prompt filtering | ❌ Not started | — |
| Positive diagnostic trace on clean pass | ❌ Not started | — |
