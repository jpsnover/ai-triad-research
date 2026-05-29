# Fact Injection: Diverse Evidence Sampling for Debate Prompts

**Author:** CL.Investigate1 (Computational Linguist)
**Date:** 2026-05-28
**Status:** Design proposal — pending approval

---

## Context

The debate pipeline already retrieves source evidence facts from the evidence index and injects them into the draft prompt (`turnPipeline.ts:556-584`, `evidenceFromSummaries.ts:75-141`). The current system:

1. Collects all facts linked to the plan's `target_nodes`
2. Deduplicates by first 80 chars of claim text
3. Sorts by specificity (precise > qualified > vague), then by temporal_bound presence
4. Takes the top 3 facts and top 2 key points
5. Formats as `=== AVAILABLE SOURCE EVIDENCE ===` block in the draft prompt

This works but has three problems at scale.

---

## Problem

### 1. Redundancy

Popular taxonomy nodes accumulate many facts saying the same thing in different words. The 80-char prefix dedup catches exact copies but misses semantic duplicates. Two facts from different sources both saying "mandatory audits improve safety outcomes" both pass dedup and both get selected.

### 2. Source Concentration

The sort-and-slice approach has no source diversity awareness. If one comprehensive survey paper contributes the 3 most specific facts for a node, all 3 selected facts come from the same document. The debater cites one source three times instead of three sources once.

### 3. Perspective Homogeneity

Facts have `doc_position` (supports/disputes/qualifies) but the ranker ignores it. For a node with 40 supporting facts and 5 disputing facts, the top 3 are always supporting. The debater never sees the counter-evidence — exactly the evidence they'd need to preemptively address in a strong argument.

---

## Proposal: Diverse Evidence Sampling

Replace the current sort-and-slice with a diversity-aware selection algorithm. Same token budget, higher information density.

### Algorithm

```
Input:  All facts linked to target_nodes (may be 50-100+)
Output: 2-3 facts per primary node, max 10 total

Step 1: SEMANTIC DEDUP
  Group facts by word overlap (>50% shared significant words)
  → Keep one per cluster: highest specificity, then most recent

Step 2: SCORE
  For each surviving fact:
    base_score = specificity_weight (precise=1.0, qualified=0.67, vague=0.33)

Step 3: DIVERSE GREEDY SELECT
  Initialize: selected = [], used_docs = {}, used_years = {}, has_dispute = false
  For each fact (descending by base_score):
    diversity_bonus = 0
    if fact.doc_id NOT in used_docs:       bonus += 0.20
    if fact.year NOT in used_years:        bonus += 0.10
    if fact.doc_position == 'disputes'
       AND NOT has_dispute:                bonus += 0.30

    adjusted_score = base_score + diversity_bonus
    Insert into selected (maintain sort by adjusted_score)
    Update used_docs, used_years, has_dispute

  Return top K from selected
```

### Why Greedy with Diversity Bonuses

The greedy approach is O(N) after sorting — fast enough for inline computation in the evidence stage. The bonuses are calibrated so that:

- A `qualified` fact from a new source (0.67 + 0.20 = 0.87) beats a `precise` fact from an already-used source (1.0 + 0.0 = 1.0) only if the precise fact's source is already represented. This ensures the first selection is always the most specific, but subsequent selections diversify.
- A `disputes` fact gets a one-time 0.30 bonus — large enough to outrank a `qualified` supporting fact, ensuring counter-evidence surfaces when available. The bonus fires only once (first disputing fact), so the selection doesn't over-represent challenges.

### Example

Node `saf-beliefs-042` with 60 facts. Current system selects:

```
1. "Mandatory audits improved safety in 94% of cases" (precise, 2024) [study-A]
2. "Government-mandated safety reviews reduced incident rates by 40%" (precise, 2024) [study-B]
3. "Comprehensive audit frameworks correlate with lower failure rates" (precise, 2023) [survey-C]
```

Three confirmatory facts, two from the same year, all supporting. The debater's argument is confident but one-dimensional.

Diverse sampling selects:

```
1. "Mandatory audits improved safety in 94% of cases" (precise, 2024) [study-A]
   → First pick: highest specificity
2. "82% of audited firms used the same consulting firm as auditor,
    raising independence concerns" (qualified, 2023, disputes) [investigation-D]
   → Second pick: new source (+0.20), new year (+0.10), first dispute (+0.30)
     adjusted = 0.67 + 0.60 = 1.27 > any remaining supporting fact
3. "Pre-2020 voluntary audits detected 0 critical vulnerabilities across
    47 assessed systems" (precise, 2019) [historical-review-E]
   → Third pick: new source (+0.20), new year (+0.10)
     adjusted = 1.0 + 0.30 = 1.30
```

Different sources, different years, includes a challenge. The debater can now build a nuanced argument: "Audits work (94% improvement), but only with structural independence — historical voluntary audits found nothing."

---

## Integration

### Where It Goes

Replace the ranking logic in `retrieveSourceEvidence()` (`evidenceFromSummaries.ts:92-106`). The function signature, return type, and formatting stay the same — only the internal selection changes.

```typescript
// Current (lines 92-106):
const uniqueFacts = /* prefix dedup */;
const rankedFacts = uniqueFacts.sort(/* specificity, temporal */);
const selectedFacts = rankedFacts.slice(0, maxFacts);

// Proposed:
const deduped = semanticDedup(candidateFacts);
const selected = diverseGreedySelect(deduped, maxFacts);
```

### New Functions

```typescript
// In evidenceFromSummaries.ts

/** Semantic dedup: group facts with >50% significant word overlap, keep best per cluster. */
function semanticDedup(facts: SourceFact[]): SourceFact[]

/** Diverse greedy selection: maximize information diversity within token budget. */
function diverseGreedySelect(
  facts: SourceFact[],
  maxFacts: number,
): SourceFact[]
```

### What Doesn't Change

- The evidence stage's position in the pipeline (between Plan and Draft)
- The `=== AVAILABLE SOURCE EVIDENCE ===` formatting
- The `EvidenceBrief` return type
- The `maxFacts` and `maxKeyPoints` parameters
- The key point selection logic (POV-aware, verbatim-preferring)
- The diagnostics logging (`stage: 'evidence'` in stageDiags)
- The token budget (~500 tokens for 10 facts)

---

## Semantic Dedup Design

### Why Not Prefix Dedup

The current prefix dedup (`claim.slice(0, 80).toLowerCase()`) misses:
- "Mandatory audits improve safety" vs. "Required safety audits lead to better outcomes" — different words, same meaning
- "The EU AI Act requires conformity assessments" vs. "Conformity assessments are mandated by the EU AI Act" — word order variation

### Word Overlap Approach

```typescript
function semanticDedup(facts: SourceFact[]): SourceFact[] {
  const OVERLAP_THRESHOLD = 0.50;
  const MIN_WORD_LENGTH = 4;

  // Extract significant words (>= 4 chars, lowered, stopwords removed)
  function sigWords(text: string): Set<string> {
    return new Set(
      text.toLowerCase()
        .split(/\s+/)
        .filter(w => w.length >= MIN_WORD_LENGTH && !STOPWORDS.has(w))
    );
  }

  // Compute Jaccard-like overlap
  function overlap(a: Set<string>, b: Set<string>): number {
    const smaller = a.size <= b.size ? a : b;
    const larger = a.size > b.size ? a : b;
    let shared = 0;
    for (const w of smaller) if (larger.has(w)) shared++;
    return shared / Math.max(smaller.size, 1);
  }

  // Greedy clustering: assign each fact to the first cluster with >50% overlap
  const clusters: { representative: SourceFact; words: Set<string> }[] = [];

  // Sort by specificity first — ensures the best fact becomes the representative
  const sorted = [...facts].sort((a, b) =>
    (SPECIFICITY_RANK[b.specificity] ?? 0) - (SPECIFICITY_RANK[a.specificity] ?? 0)
  );

  for (const fact of sorted) {
    const fw = sigWords(fact.claim);
    let merged = false;
    for (const cluster of clusters) {
      if (overlap(fw, cluster.words) >= OVERLAP_THRESHOLD) {
        merged = true;
        break; // representative is already the most specific (sorted first)
      }
    }
    if (!merged) {
      clusters.push({ representative: fact, words: fw });
    }
  }

  return clusters.map(c => c.representative);
}
```

**Performance:** O(N × K) where N = total facts and K = number of clusters. With typical K < 30 (most nodes have < 100 facts after prefix dedup), this is sub-millisecond.

**Stopwords:** Reuse the existing `STOPWORDS` set from `taxonomyRelevance.ts:151-156`.

---

## Configuration

```typescript
interface DiverseEvidenceConfig {
  /** Significant word overlap threshold for semantic dedup. Default 0.50. */
  dedupOverlapThreshold: number;
  /** Diversity bonus for facts from unused source documents. Default 0.20. */
  sourceBonus: number;
  /** Diversity bonus for facts from unused temporal periods. Default 0.10. */
  temporalBonus: number;
  /** One-time bonus for the first disputing fact. Default 0.30. */
  disputeBonus: number;
}

const DEFAULT_CONFIG: DiverseEvidenceConfig = {
  dedupOverlapThreshold: 0.50,
  sourceBonus: 0.20,
  temporalBonus: 0.10,
  disputeBonus: 0.30,
};
```

All thresholds configurable for calibration tuning. The defaults are designed so that:
- First selection: always the most specific fact (no bonuses needed)
- Second selection: a disputing fact from a different source beats a second supporting fact from the same source
- Third selection: a temporally distant fact from a new source rounds out the evidence

---

## Diagnostics

### Evidence Stage Diagnostics (Already Logged)

The evidence stage already logs `facts` and `keyPoints` in the stage diagnostics. Add:

```typescript
{
  stage: 'evidence',
  work_product: {
    facts: selectedFacts,
    keyPoints: selectedKPs,
    // NEW:
    candidate_count: deduped.length,     // how many survived dedup
    raw_count: candidateFacts.length,     // total before dedup
    dedup_removed: candidateFacts.length - deduped.length,
    source_diversity: new Set(selectedFacts.map(f => f.doc_id)).size,
    has_dispute: selectedFacts.some(f => f.doc_position === 'disputes'),
    temporal_range: [earliest_year, latest_year],
  }
}
```

### DiagnosticsWindow — Evidence Tab

The existing Evidence tab in the diagnostics shows the raw evidence block. With diverse sampling, also show:
- **Candidate pool size:** "47 facts → 22 after dedup → 3 selected"
- **Diversity indicators:** source count, temporal range, dispute included
- **Why each fact was selected:** "Fact 1: highest specificity. Fact 2: new source + dispute bonus. Fact 3: new source + new year."

---

## Calibration Metric

Add `evidence_diversity` to `CalibrationDataPoint`:

```typescript
evidence_diversity: {
  avg_source_count: number;       // mean unique doc_ids in selected facts per turn
  avg_temporal_range_years: number; // mean range between oldest and newest selected fact
  dispute_inclusion_rate: number;  // fraction of turns where a disputing fact was selected
} | null;
```

Tracked across debates to measure whether the diverse sampling actually produces varied evidence or degenerates to the same facts every turn.

---

## Edge Cases

### Node with ≤ 3 facts
Skip diversity algorithm. Return all facts sorted by specificity. Diversity logic is unnecessary when the pool is small.

### Node with no "disputes" facts
The dispute bonus never fires. Selection proceeds on source and temporal diversity alone. This is the common case for nodes where all source literature agrees.

### All facts from the same source
Source bonus never fires after the first selection. Temporal diversity becomes the primary differentiator. If all facts are also from the same year, the selection falls back to pure specificity ranking — same as the current behavior. No regression.

### No evidence index available
`retrieveSourceEvidence` already handles this — returns empty evidence brief. No change.

---

## Phased Delivery

| Phase | What | Effort |
|-------|------|--------|
| 1 | Semantic dedup (replace prefix dedup) | Low — self-contained function swap |
| 2 | Diverse greedy select (replace sort-and-slice) | Low — same function, new ranking logic |
| 3 | Enhanced diagnostics (candidate counts, diversity indicators) | Low — add fields to existing stage diag |
| 4 | Calibration metric (`evidence_diversity`) | Low — add to calibration logger |
| 5 | DiagnosticsWindow evidence tab enhancement | Medium — Taxonomy Editor scope |

Phases 1-2 are the core change — one function replacement in `evidenceFromSummaries.ts`. Phases 3-4 are observability. Phase 5 is UI polish.

---

## Open Questions

1. **Should the dispute bonus scale with pool composition?** Current: fixed +0.30 for first dispute. Alternative: scale by `dispute_count / total_count` — if 40% of facts dispute the node, disputes are common and don't need a bonus. If only 5% dispute, the bonus should be higher. Keep simple for V1, revisit if dispute inclusion rate is too high.

2. **Should key points (POV summaries) also get diverse sampling?** Current: key points are ranked by POV match + verbatim presence. They don't have `doc_position` or `temporal_bound`. Diverse sampling could apply source diversity, but the pool is smaller (typically 5-10 key points vs. 30-60 facts). Defer — the fact selection is the higher-value improvement.

3. **Should facts be injected into the Brief stage as well as Draft?** Currently evidence only appears in Draft. The Brief identifies which nodes to ground against but doesn't see the available evidence. Injecting a lightweight "evidence availability" signal into the Brief (e.g., "saf-beliefs-042 has 47 source facts, including 5 disputes") would help the Brief stage plan which claims are well-evidenced vs. asserted. Low additional token cost. Consider for V2.
