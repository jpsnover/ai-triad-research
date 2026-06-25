# AN-Based Taxonomy Relevance: Architecture Proposal

## The Problem

The debate system currently scores taxonomy relevance using a **topic-blended query**: the debate topic + recent transcript, embedded as one vector, compared against all taxonomy nodes. This has three failure modes:

1. **URL topics produce garbage scores** — When the topic is a URL (e.g., `"Discuss: https://www.globaltimes.cn/..."`) the embedding is semantically meaningless. Observed scores: 0.05-0.08 (near-zero).

2. **Blended queries lose precision** — A debate turn about both "compute governance" and "open-source safety" produces one averaged query vector that matches neither concept well.

3. **Static topic anchoring** — As the debate evolves and new arguments emerge, the scoring remains anchored to the original topic string, not the actual discourse trajectory.

## The Proposed Model

```
All source types (topic, document, URL)
    → Extract claims → AN nodes (with embeddings)
        → For each AN node, find most relevant taxonomy nodes
            → Inject taxonomy grounded per-claim context
```

**Core principle:** The argument network IS the debate. Taxonomy relevance should be driven by what's actually being argued (AN claims), not by what was originally asked (topic string).

### How `scoreNodesViaAN()` Works

The function already exists in `taxonomyRelevance.ts:235-268`:

```
For each taxonomy node:
    For each AN claim:
        Compute cosine similarity(node embedding, claim embedding)
        If strength-weighted: blend 70% raw similarity + 30% QBAF strength
    Node's score = max similarity across all claims
```

This means a taxonomy node scores high if it's relevant to ANY active argument — even if it's irrelevant to the original topic.

### Hybrid Model: AN-Primary with Topic Floor

Pure per-AN scoring risks tunnel vision (only surfacing nodes relevant to existing claims, suppressing novel angles). The solution is a hybrid:

```
final_score = max(per_AN_score, topic_score × 0.5)
```

- **AN score drives selection** (precision — match what's actually being discussed)
- **Topic score provides a floor** (breadth — maintain connection to the original question)
- **0.5 weight on topic** prevents the floor from dominating — a topic-relevant node only enters if no AN claim produces a stronger match

### First-Mover Handling

The first opening speaker has zero AN nodes. `scoreNodesViaAN()` already handles this:
- Falls back to `topicVector` scoring when `claimEmbeddings.length === 0`
- For URL topics: falls back to document analysis summary if available
- For topic-based debates: falls back to topic string (which works fine when the topic is descriptive text)

---

## Prompt Audit: Which Prompts Benefit?

Every prompt that receives `taxonomyContext` currently gets nodes selected via the topic-blended query. Here's the assessment for each:

### Opening Pipeline (BRIEF → PLAN → DRAFT → CITE)

| Stage | Receives taxonomy? | Benefits from AN-based? | Notes |
|-------|-------------------|------------------------|-------|
| **BRIEF** (opening) | Yes — `input.taxonomyContext` | **YES — HIGH** | The BRIEF recommends "strongest angles" and "relevant taxonomy nodes." Per-AN scoring ensures recommendations are grounded in actual claims (from prior openings), not the topic string. For the FIRST speaker, falls back to topic/document scoring. |
| **PLAN** (opening) | Yes — via the BRIEF output + taxonomy context | **YES — MEDIUM** | The plan inherits the BRIEF's recommendations. Better BRIEF → better plan. |
| **DRAFT** (opening) | Yes — `input.taxonomyContext` | **YES — HIGH** | The draft generates the actual statement. Per-AN scoring ensures the injected nodes are relevant to what the speaker is actually arguing, not a blended average. |
| **CITE** (opening) | Yes — `input.taxonomyContext` | **YES — MEDIUM** | CITE validates and assigns node IDs. Better relevance → better citations. |

### Cross-Respond Pipeline (BRIEF → PLAN → DRAFT → CITE)

| Stage | Receives taxonomy? | Benefits from AN-based? | Notes |
|-------|-------------------|------------------------|-------|
| **BRIEF** (cross-respond) | Yes | **YES — HIGHEST** | This is where the payoff is greatest. By cross-respond time, the AN has 10-30 claims from multiple speakers. Per-AN scoring surfaces taxonomy nodes relevant to the ACTIVE arguments, not the original topic. |
| **PLAN** (cross-respond) | Yes (via BRIEF + context) | **YES — HIGH** | Per-AN scoring means the plan's `evidence_needed` field references actually-relevant nodes. |
| **DRAFT** (cross-respond) | Yes | **YES — HIGH** | The draft can ground claims in precisely-matched taxonomy nodes rather than approximately-matched ones. |
| **CITE** (cross-respond) | Yes | **YES — MEDIUM** | Better relevance → more accurate citation assignment. |

### Other Prompts

| Prompt | Receives taxonomy? | Benefits from AN-based? | Notes |
|--------|-------------------|------------------------|-------|
| **Moderator selection** | No (gets edge context, not taxonomy) | **NO** | Moderator doesn't receive taxonomy nodes. |
| **Moderator intervention** | No | **NO** | Same. |
| **Reflection** | Yes — full POV taxonomy | **NO** | Reflections receive the ENTIRE POV taxonomy, not a relevance-filtered subset. No scoring involved. |
| **Synthesis** | No (receives transcript) | **NO** | Synthesis doesn't receive taxonomy context. |
| **Document analysis** | Yes — via `nodeScores` | **YES — MEDIUM** | Document analysis scoring could use AN claims from the document's own extracted i-nodes rather than the topic string. |
| **Gap check** | Yes — via scoring | **YES — MEDIUM** | Gap detection should find gaps relative to what's being argued (AN), not the original topic. |
| **Taxonomy refinement** | Partial | **NO** | Post-debate, operates on the full AN. |

### Summary: Which Prompts to Convert

**High priority (convert to AN-based):**
- BRIEF (both opening and cross-respond) — drives all downstream strategic decisions
- DRAFT (both) — generates the actual debate content with taxonomy grounding

**Medium priority (convert to AN-based):**
- PLAN (both) — inherits BRIEF quality but also has its own taxonomy context
- CITE (both) — validation benefits from better relevance
- Document analysis — if using extracted i-nodes as AN claims
- Gap check — should detect gaps in AN coverage, not topic coverage

**No change needed:**
- Moderator — doesn't receive taxonomy
- Reflection — receives full taxonomy (no filtering)
- Synthesis — receives transcript (no taxonomy)

---

## What Changes in the Code

### 1. Embed AN claims (new capability needed)

Currently only taxonomy nodes have pre-computed embeddings. AN claims need embeddings for per-claim scoring. Two options:

**Option A: Compute on extraction.** After each `extractClaims()` call, embed each new AN node's text via `computeQueryEmbedding()`. Store on the node. Cost: 3-6 embedding calls per turn (~50ms total with local model).

**Option B: Batch at scoring time.** When `getRelevantTaxonomyContext()` runs, embed all AN claims in one batch. Cost: one batch embedding call per turn. Disadvantage: can't cache across turns.

**Recommendation: Option A.** Embed on extraction, cache on the node. This makes embeddings available to all downstream consumers without re-computation.

### 2. Wire `scoreNodesViaAN()` into `getRelevantTaxonomyContext()`

Replace the current topic-blended scoring (lines 1003-1017) with hybrid AN + topic scoring:

```typescript
private async getRelevantTaxonomyContext(pov: string, priorRefs: string[] = []): Promise<string> {
    const ctx = this.getTaxonomyContext(pov);

    // Collect AN claim embeddings (pre-computed on extraction)
    const anClaims: ANClaimEmbedding[] = (this.session.argument_network?.nodes ?? [])
        .filter(n => n.embedding && n.embedding.length > 0)
        .map(n => ({ id: n.id, vector: n.embedding!, strength: n.computed_strength }));

    // Topic vector as fallback/floor
    let topicVector: number[] | undefined;
    if (adapter.computeQueryEmbedding) {
        const topicQuery = this.session.document_analysis?.summary
            ?? this.session.topic.final;
        const result = await adapter.computeQueryEmbedding(topicQuery);
        topicVector = result.vector;
    }

    // Hybrid: AN-primary with topic floor
    const anScores = scoreNodesViaAN(anClaims, this.taxonomy.embeddings, topicVector, true);

    // If topic is available, blend as floor
    if (topicVector) {
        const topicScores = scoreNodeRelevance(topicVector, this.taxonomy.embeddings);
        for (const [id, topicScore] of topicScores) {
            const anScore = anScores.get(id) ?? 0;
            anScores.set(id, Math.max(anScore, topicScore * 0.5));
        }
    }

    scores = anScores;
    // ... rest unchanged (diversification, selection, formatting)
}
```

### 3. Store AN claim embeddings

Add `embedding?: number[]` to `ArgumentNetworkNode` in types.ts. Populate during `extractClaims()` after each AN node is created.

### 4. Use document summary for URL topics

When `this.session.topic.final` starts with `http`, use `this.session.document_analysis?.summary` as the topic query instead.

---

## Diagnostics Display Changes

The current diagnostics show:
- Relevance scores per taxonomy node (flat list)
- Scoring mode (embedding/lexical)

With AN-based scoring, diagnostics should show:

1. **Per-claim → taxonomy mapping**: Which AN claim drove each taxonomy node's selection
   ```
   saf-beliefs-011 (relevance: 0.72)
     Best match: AN-3 "pre-deployment testing prevents harm" (sim: 0.72)
     Topic floor: 0.31 (not used — AN score higher)
   ```

2. **AN claim coverage**: Which AN claims have strong taxonomy support vs which are "orphaned" (no relevant taxonomy nodes found)
   ```
   AN claims with strong taxonomy grounding: AN-1, AN-3, AN-5
   AN claims with weak grounding (< 0.3): AN-4, AN-6
   ```

3. **Scoring source indicator**: Whether each node was selected via AN-match or topic-floor
   ```
   [AN] saf-beliefs-011 (0.72) — matched AN-3
   [AN] saf-desires-010 (0.65) — matched AN-1
   [TOPIC] saf-intentions-042 (0.38) — topic floor (no AN match)
   ```

---

## Expected Impact on Debate Quality

| Metric | Expected Change | Why |
|--------|----------------|-----|
| `avg_utilization_rate` | **UP** | Nodes selected because they match active arguments are more likely to be referenced |
| `crux_addressed_rate` | **UP** | Per-AN scoring surfaces nodes relevant to the actual disagreements, not the topic in general |
| `argument_redundancy` | **DOWN** | Strength-weighted scoring deprioritizes taxonomy nodes relevant to refuted/weak claims |
| Gap check fire rate | **DOWN** | Fewer false-positive gaps (currently fires because topic-relevant nodes weren't injected for AN-irrelevant reasons) |
| URL debate quality | **DRAMATICALLY UP** | Scores go from 0.05 (garbage) to meaningful values based on extracted claims |

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Tunnel vision (self-reinforcing claim loop) | Topic floor at 0.5× ensures breadth |
| First-mover has no AN data | Fallback to topic/document scoring (already built) |
| AN claims not yet embedded | Compute on extraction, cache on node |
| Increased compute cost | Local embedding model (<1ms per claim), 3-6 claims per turn |
| Backward compatibility | Existing debates with no AN embeddings fall back to topic scoring |

---

*Drafted: 2026-05-09 · Computational Linguist · AI Triad Research*
