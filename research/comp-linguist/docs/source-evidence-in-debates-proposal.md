# Proposal: Injecting Source Document Evidence into the Debate Pipeline

## The Untapped Resource

The AI Triad project has 440 summarized source documents containing two types of structured evidence that are currently invisible to the debate engine:

**1. Factual Claims** (~5.7 per document, ~2,500 total across the corpus)
Each is a specific, citable fact extracted from the source text:
```json
{
  "claim": "AI adoption translates to only 0.5%-3.5% of work hours as of August 2024.",
  "claim_label": "Generative AI Adoption Intensity",
  "specificity": "precise",
  "temporal_bound": "2024",
  "linked_taxonomy_nodes": ["skp-beliefs-042"],
  "evidence_criteria": { "has_warrant": "true", "internally_consistent": "true" }
}
```
88% are linked to taxonomy nodes. 82% are rated "precise." These are exactly the concrete, citable facts that the judge's QUALITY feedback keeps demanding.

**2. POV Key Points** (~17 per document, ~7,500 total)
Per-perspective analysis with direct quotes from the source:
```json
{
  "stance": "opposed",
  "taxonomy_node_id": "acc-intentions-009",
  "point": "The authors reject the 'superintelligence' framing...",
  "verbatim": "But it is in contrast to both utopian and dystopian visions...",
  "excerpt_context": "Introduction, paragraph 1"
}
```
These provide both the analytical framing AND a citable verbatim quote — grounding arguments in actual published text rather than LLM-generated assertions.

## The Problem with Injecting into Existing Stages

The current pipeline (BRIEF → PLAN → DRAFT → CITE) already pushes prompt token budgets:

| Stage | Typical prompt size | What's in it |
|---|---|---|
| BRIEF | ~6,000-8,000 tokens | Persona, taxonomy context, recent transcript, assignment |
| PLAN | ~8,000-10,000 tokens | Brief output, field-aware strategy, move list, prior moves |
| DRAFT | ~10,000-12,000 tokens | Brief, plan, intervention, paragraph/claim constraints |
| CITE | ~8,000-10,000 tokens | Taxonomy context, draft text, citation history |

Adding source evidence to any existing stage would push tokens past model limits. A typical taxonomy node has 5-11 linked source references — injecting all of them at 500-900 chars each would add 2,500-10,000 chars (~600-2,500 tokens) per node, and debaters cite 4-5 nodes per turn.

## Proposed: EVIDENCE Stage (New Pipeline Step)

Add a 5th stage between PLAN and DRAFT:

```
BRIEF → PLAN → EVIDENCE → DRAFT → CITE
```

### What EVIDENCE Does

1. **Reads the plan's `target_claims` and `target_nodes`** — which taxonomy nodes will this turn engage?
2. **Retrieves source evidence for those specific nodes** — factual claims + POV key points linked to those node IDs
3. **Selects the most relevant evidence** — filter by stance (aligned/opposed matches the debater's POV), specificity (prefer "precise"), and recency (prefer current temporal_scope)
4. **Produces a compact evidence brief** — 3-8 pieces of evidence the debater should use, each with the fact, the source document, and optionally a verbatim quote

### Why a Separate Stage?

**Token isolation.** The EVIDENCE stage prompt is small — it receives the plan output (~500 tokens) and a batch of candidate evidence (~2,000-4,000 tokens), and produces a compact evidence brief (~500-800 tokens). That brief is then injected into the DRAFT prompt, replacing the vague "cite concrete evidence" instruction with actual evidence to cite.

**Selective retrieval.** Instead of injecting all source evidence for all taxonomy nodes into the DRAFT prompt (which would explode the token budget), the EVIDENCE stage narrows to only the nodes the debater plans to engage — typically 2-4 nodes, yielding 10-20 candidate evidence items from which 3-8 are selected.

**Separation of concerns.** Evidence selection is a retrieval/ranking task, not a generation task. Mixing it with draft generation (asking the LLM to both find evidence AND write prose) produces worse results than doing them sequentially.

### Pipeline Flow

```
PLAN output:
  target_nodes: [acc-beliefs-032, acc-intentions-027]
  planned_moves: [DISTINGUISH → AN-3, REFRAME, UNDERCUT → AN-3]
           ↓
EVIDENCE stage:
  1. Load summaries for docs linked to acc-beliefs-032 and acc-intentions-027
  2. Collect factual_claims with linked_taxonomy_nodes matching those IDs
  3. Collect pov_key_points with taxonomy_node_id matching those IDs
  4. Filter: specificity=precise, stance matches debater's POV
  5. Rank by relevance to plan's strategic_goal
  6. Select top 3-8 items
           ↓
EVIDENCE output (injected into DRAFT):
  === AVAILABLE SOURCE EVIDENCE ===
  For acc-beliefs-032 (Integration of Empirical Telemetry):
    [1] "AI adoption translates to only 0.5%-3.5% of work hours"
        — ai-as-normal-technology-2026, precise, 2024
    [2] "The rate of AI research publication on arXiv has a doubling
        time of less than two years."
        — ai-as-normal-technology-2026, precise
  For acc-intentions-027 (Subordinating Precaution):
    [3] "China is doubling down on open-source AI strategies to
        influence global infrastructure"
        — eight-ways-ai-will-shape-geopolitics-2026, precise, 2026

  USE these citations in your statement. Reference the source document
  by name when citing a fact. Do NOT invent evidence — use only what
  is provided above.
           ↓
DRAFT stage (receives evidence brief as context)
```

### Token Budget

| Component | Tokens |
|---|---|
| EVIDENCE prompt (plan + candidate evidence) | ~3,000-5,000 |
| EVIDENCE output (compact brief) | ~500-800 |
| Addition to DRAFT prompt | ~500-800 |
| **Net cost per turn** | **~4,000-6,000 tokens + 1 API call** |

This is modest — equivalent to about half a BRIEF stage call. The DRAFT prompt grows by only 500-800 tokens (the evidence brief), well within budget.

### Alternative: Deterministic Evidence Retrieval (No LLM Call)

The EVIDENCE stage could be purely deterministic — no LLM call at all:

1. Read `target_nodes` from plan output
2. Load summaries from disk, filter by node ID linkage
3. Rank by specificity (precise > qualified > vague) and recency
4. Format top 5 as a text block
5. Inject into DRAFT prompt

This costs 0 additional API calls and ~200ms of disk I/O. The tradeoff: no intelligent selection based on the plan's strategic_goal — just mechanical retrieval. But 82% of facts are "precise" and 88% have taxonomy links, so mechanical retrieval would surface good evidence most of the time.

**Recommendation: Start deterministic.** Add the LLM-based ranking only if the mechanical approach surfaces irrelevant evidence.

### What Changes

| Component | Change |
|---|---|
| `turnPipeline.ts` | Add EVIDENCE stage between PLAN and DRAFT |
| New: `evidenceFromSummaries.ts` | Load summaries, filter by node ID, rank, format |
| `taxonomyLoader.ts` | Add summary loading (lazy, on-demand per debate) |
| DRAFT prompt | Add `=== AVAILABLE SOURCE EVIDENCE ===` block |
| Turn validator | Optionally check that DRAFT cites at least 1 source evidence item |
| DiagnosticsWindow | New "Evidence" tab showing what was retrieved |

### What Doesn't Change

- BRIEF, PLAN, CITE stages — untouched
- QBAF, convergence, moderator — untouched
- Opening pipeline — can add later (openings benefit less since they establish positions rather than engage evidence)

### Expected Impact

1. **QUALITY feedback drops.** The judge's most common weakness is "lacks empirical evidence" or "claim unsubstantiated." Debaters with source evidence won't generate vague claims — they'll have specific facts to cite.

2. **Claim specificity improves automatically.** 82% of source facts are "precise" — numbers, dates, named entities. The validation rule that demands specificity (Rule 9) will pass naturally.

3. **Debates become grounded in the actual corpus.** Instead of LLM-generated pseudo-evidence ("studies show..."), debaters cite real documents: "According to the NBER analysis cited in 'AI as Normal Technology,' adoption translates to 0.5-3.5% of work hours." This is auditable.

4. **Cross-POV evidence becomes available.** A safetyist debater engaging an accelerationist node can see what the source documents say from the safety perspective — including "opposed" stance key points with verbatim quotes that directly challenge the node.

5. **The 2,500 factual claims become a debate asset.** Currently they're display-only (visible in the Taxonomy Editor Sources tab). Wiring them into the debate pipeline makes the entire source corpus actionable.

### Risk: Evidence Overload

If every turn injects 5 evidence items at ~100 words each, the debater might produce a laundry-list statement ("According to X... According to Y... According to Z...") rather than a structured argument. Mitigation: the DRAFT prompt instruction should say "Weave 1-2 of these citations into your argument naturally. Do not list-cite all of them."

### Risk: Stale Evidence

Source documents have `temporal_bound` fields. Facts from 2023 may be outdated in a 2026 debate. Mitigation: the retrieval filter should prefer `temporal_scope: 'current_state'` and recent `temporal_bound`. Flag facts older than 2 years as "may be outdated."

---

*Proposed: 2026-05-15 · Computational Linguist · AI Triad Research*
