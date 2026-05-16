# Fact-Checking in the Debate Engine

This document explains when fact-checks are triggered, how they work, how their results update QBAF scores, and how they affect the course of the debate.

## When Fact-Checks Trigger

Fact-checking runs **after claim extraction** on each debate turn. It is not applied to every claim — only claims that meet specific criteria.

### Trigger Conditions

A claim is fact-checked when ALL of these are true:

1. **BDI category is Belief** — only empirical claims are fact-checkable. Desires (normative) and Intentions (strategic) are not subject to factual verification.
2. **Specificity is "precise"** — the claim contains specific numbers, dates, named entities, or directly verifiable facts. Claims classified as "general" or "abstract" are not fact-checked.
3. **Search adapter is available** — the `generateTextWithSearch` method exists on the AI adapter (available in the Taxonomy Editor, not in the CLI).
4. **Cap of 2 per turn** — at most 2 claims per debate turn are fact-checked, to control API costs and latency.

### What Gets Skipped

- Desire claims ("AI governance should prioritize safety") — normative, not verifiable
- Intention claims ("We should implement audits by 2028") — strategic, not verifiable
- Belief claims with "general" specificity ("AI has risks") — too vague to verify
- Belief claims with "abstract" specificity ("Intelligence is a positive-sum resource") — theoretical, not empirically testable
- All claims when running via CLI (no search adapter)

## How Fact-Checks Work

There are two verification paths, tried in priority order:

### Path 1: Evidence QBAF (preferred, when source corpus available)

This path uses the project's own source documents as the evidence base. It's a 3-stage pipeline:

**Stage 1: Evidence Retrieval** (`evidenceRetriever.ts`)
- Takes the claim text and searches the source corpus (documents in `ai-triad-data/sources/`)
- Uses a hybrid of keyword extraction and embedding similarity (when available)
- Returns top-10 evidence passages with similarity scores

**Stage 2: Evidence Classification** (LLM call)
- For each retrieved passage, an LLM classifies the relationship to the claim:
  - `support` — the evidence supports the claim
  - `contradict` — the evidence contradicts the claim
  - `irrelevant` — the evidence is not relevant
- Also assigns `source_reliability` (how authoritative the source is) and `relevance` (how closely related)

**Stage 3: QBAF Computation** (`computeFactCheckStrength()` in qbaf.ts)
- Builds a micro-QBAF graph:
  - Central node: the claim (base_strength = 0.5)
  - Surrounding nodes: each evidence passage (base_strength = source_reliability x relevance)
  - Edges: support or attack, weighted by relevance
- Runs DF-QuAD gradual semantics on this mini-network
- Output: `computed_strength` (0-1) — the claim's strength after incorporating all evidence

**Result:**
- `computed_strength >= 0.6` → `verification_status: 'verified'`
- `computed_strength <= 0.4` → `verification_status: 'disputed'`
- Between 0.4-0.6 → `verification_status: 'unverifiable'`

### Path 2: Web Search Verdict (fallback, when no source corpus)

When the source corpus is unavailable, the system falls back to a single-shot web search:

- Calls `generateTextWithSearch` with the claim text
- LLM searches the web and produces a verdict:
  - `verified` — evidence supports the claim
  - `disputed` — evidence contradicts the claim
  - `unverifiable` — insufficient evidence either way
- Also returns confidence (`high`, `medium`, `low`) and a 1-2 sentence evidence summary

## How Results Update QBAF Scores

Fact-check results modify the claim's `base_strength` in the argument network, which then propagates through the full QBAF computation.

### Base Strength Updates

| Verification Path | Result | base_strength |
|---|---|---|
| Evidence QBAF | computed_strength from DF-QuAD | Direct use (0-1 continuous) |
| Web search | verified + high confidence | 0.85 |
| Web search | verified + medium confidence | 0.70 |
| Web search | verified + low confidence | 0.60 |
| Web search | disputed + any confidence | 0.20 |
| Web search | unverifiable | 0.45 |

The mapping is performed by `factCheckToBaseStrength()` in `argumentNetwork.ts`.

### Propagation Effect

Once a fact-checked claim's base_strength is updated, the change propagates through the full argument network via QBAF:

```
Verified claim (0.85) attacking an opponent's claim:
  → opponent's claim strength drops significantly
  → claims that depend on the opponent's claim also weaken
  → the verified claim's supporters get a boost

Disputed claim (0.20) being attacked:
  → the attack has minimal effect (attacking something already weak)
  → but claims that SUPPORT the disputed claim also lose credibility
```

This means fact-checking has **transitive effects** — verifying one claim can shift the strength of many related claims through the argument network.

### Scoring Method Tracking

When a claim is fact-checked, its `scoring_method` is set to `'fact_check'`, distinguishing it from other scoring paths:

| scoring_method | Source |
|---|---|
| `belief_verification` | ThinkPRM 4-step verification chain |
| `evidence_qbaf` | Evidence retrieval + QBAF (during extraction) |
| `fact_check` | Post-extraction inline verification (this process) |
| `belief_specificity` | Specificity proxy (precise/general/abstract) |
| `bdi_composite` | BDI sub-score composite (Desires/Intentions) |
| `unscored` | No scoring data available |

## How Fact-Checks Affect the Debate

### 1. Transcript Entries

Each fact-check produces a visible transcript entry of type `'fact-check'`:

```
Claim AN-7 — verified: Multiple peer-reviewed studies confirm that
current RLHF techniques reduce harmful outputs by 60-80% in
standard benchmarks.
```

or

```
Claim AN-12 — disputed: The claim that "90% of AI researchers
support open-weight models" could not be verified. Available surveys
show significantly lower support rates.
```

These entries appear in the debate transcript between turns, visible to all debaters in subsequent context windows.

### 2. Debater Awareness

Fact-check results affect debaters through three channels:

**Argument Network Context** — when the moderator and debaters see the AN via `formatArgumentNetworkContext()`, disputed claims are marked with their verification status. A debater seeing `AN-12 [disputed]` knows to either defend, revise, or abandon that claim.

**QBAF Strength Display** — a disputed claim (base_strength: 0.20) will have a very low computed_strength in the QBAF display. Debaters using the FIELD-AWARE STRATEGY see these strength signals and can target weak claims with UNDERCUT or EMPIRICAL CHALLENGE moves.

**Moderator Steering** — the moderator's QBAF context (`buildQbafContext()`) highlights high-strength unaddressed claims. A verified claim that opponents haven't engaged becomes a priority for the moderator to direct attention toward. Conversely, a disputed claim that a debater keeps asserting may trigger a CHALLENGE intervention.

### 3. Calibration Impact

Fact-check results feed into calibration Parameter 13 (`borderline_claim_survival_rate`):
- Tracks what fraction of borderline claims (base_strength 0.4-0.55) survive the debate without being refuted
- Fact-checked claims with `verification_status: 'disputed'` that survive (remain above 0.25 computed_strength) indicate the debate failed to engage with available counter-evidence

### 4. Evidence Graph Persistence

When the evidence QBAF path runs, the full evidence graph is stored on the AN node:

```typescript
node.evidence_graph = {
  evidence_items: [...],      // retrieved passages with classifications
  computed_strength: 0.72,    // QBAF result
  qbaf_iterations: 8,         // convergence data
};
```

This persists in the debate JSON file and is available for post-debate analysis, diagnostics, and the Evidence tab in the Taxonomy Editor.

## Interaction with Other Scoring Paths

Fact-checking is ONE of several ways a Belief claim can be scored. The priority order:

```
1. Inline fact-check (verifyPreciseClaims)     — runs post-extraction, overwrites everything
2. ThinkPRM verification (belief_verification) — runs at extraction time
3. Evidence QBAF at extraction (t/455 Stage 2) — runs at extraction time
4. Specificity proxy (precise/general/abstract) — zero-cost fallback
5. Generic (0.50)                               — no scoring data
```

Inline fact-checking (this process) runs AFTER extraction and can OVERWRITE the extraction-time scoring. A claim that was scored 0.70 by the ThinkPRM verification chain at extraction time might be revised to 0.20 if the inline fact-check finds contradicting evidence.

## What Determines Whether Evidence QBAF or Web Search Runs

```
verifyPreciseClaims(newNodes)
  ↓
  Filter: bdi_category === 'belief' AND specificity === 'precise'
  ↓
  Cap at 2 claims per turn
  ↓
  For each claim:
    ↓
    Can we resolve the sources directory?
    ├─ YES → runEvidenceQbaf()
    │         ↓
    │         retrieveEvidence() returns passages?
    │         ├─ YES → classify → QBAF → update node → done
    │         └─ NO  → fall through to web search
    └─ NO  → fall through to web search
    ↓
    Does adapter have generateTextWithSearch?
    ├─ YES → web search → verdict → update node → done
    └─ NO  → skip (CLI path, no verification available)
```

---

*Documented: 2026-05-14 · Computational Linguist · AI Triad Research*
