# Intention Operationality Weight — Design Document

**Author:** CL.Investigate1 (Computational Linguist)
**Date:** 2026-05-25
**Ticket:** t/133
**Status:** Design proposal — pending approval

---

## Problem

Beliefs have confidence (0.0–1.0), Desires have priority (1–5), but Intentions sort by relevance alone. In `taxonomyContext.ts:weightedScore()`:

```typescript
if (Beliefs)    → relevance × confidence
if (Desires)    → relevance × (priority / 5)
if (Intentions) → relevance   // <-- no quality signal
```

This means a vague umbrella strategy like "Accelerating AI Development" sorts equivalently to a concrete actionable strategy like "Targeting Evidenced Harms Over Speculative Risks" — only relevance differentiates them.

## Empirical Analysis

Sampled all Intention nodes across three POVs (254 total):

| Property | Distribution | Differentiating? |
|----------|-------------|-----------------|
| Tree position | 80-84% leaves, 16-20% parents, 3-5% umbrellas | **Yes — strong** |
| Falsifiability | 80-97% medium, 5-12% low, 2-5% high | **Yes — moderate** |
| Epistemic type | 88%+ strategic_recommendation | No — too uniform |
| Node scope | 90%+ scheme | No — too uniform |
| Assumes count | 3-4 per node regardless of depth | No — not differentiating |
| Situation refs | 2-5% have refs | **Yes — weak bonus signal** |

## Proposed Weight: Operationality (1–5)

Following the same 1–5 scale as Desire priority, for symmetry and UI consistency.

### Computation

**Primary signal: tree position** (same pattern as `desirePriority.ts:computeTreePriority`)

| Tree Position | Base Score | Rationale |
|---------------|:---------:|-----------|
| Leaf (no children) | 4 | Terminal strategy — operationally actionable |
| Mid-tree (parent + children) | 3 | Intermediate — organizes concrete strategies |
| Root (no parent) | 2 | Abstract umbrella — too broad to act on |

**Modifier: falsifiability** (+1 for high, -1 for low)

| Falsifiability | Modifier | Rationale |
|----------------|:--------:|-----------|
| High | +1 | Testable prediction — strongest form of Intention |
| Medium | 0 | Default — coherent strategy |
| Low | -1 | Abstract/normative — weak operationality |

**Bonus: situation grounding** (+1 if situation_refs.length > 0)

Situation-connected strategies are grounded in contested real-world concepts. Only 2-5% of nodes qualify, making this a meaningful differentiator.

### Formula

```
operationality = clamp(tree_base + falsifiability_mod + situation_bonus, 1, 5)
```

### Expected Distribution

| Score | Meaning | Expected % | Example |
|:-----:|---------|:----------:|---------|
| 5 | Highly operational | ~5% | Concrete leaf + high falsifiability or situation grounding |
| 4 | Operational | ~75% | Standard leaf node (medium falsifiability) |
| 3 | Structured | ~12% | Mid-tree organizing node |
| 2 | Abstract | ~5% | Root umbrella or low-falsifiability leaf |
| 1 | Vague | ~3% | Root + low falsifiability (theoretical framing) |

This mirrors the Desire priority distribution: most nodes cluster at 3-4, with a meaningful tail at both ends.

### Why Not 0.0–1.0?

Belief confidence uses a continuous 0.0–1.0 scale because it has 4 continuous input signals (base, evidence, debate, edges). Intention operationality has 1 discrete primary signal (tree depth) and 2 binary modifiers — a continuous scale would create false precision. The 1–5 scale matches Desire priority and communicates clearly in the UI.

## Integration Points

### New File: `intentionOperationality.ts`

Following the pattern of `desirePriority.ts`:

```typescript
export function computeOperationality(node: PovNode): number {
  // Tree position base
  let base: number;
  if (node.children.length === 0) base = 4;       // leaf
  else if (node.parent_id) base = 3;               // mid-tree
  else base = 2;                                    // root

  // Falsifiability modifier
  const falsifiability = node.graph_attributes?.falsifiability;
  const falsMod = falsifiability === 'high' ? 1 : falsifiability === 'low' ? -1 : 0;

  // Situation grounding bonus
  const sitBonus = (node.situation_refs?.length ?? 0) > 0 ? 1 : 0;

  return Math.max(1, Math.min(5, base + falsMod + sitBonus));
}

export function assignIntentionOperationality(
  nodes: PovNode[],
  date: string,
): { nodeId: string; operationality: number }[]
```

### PovNode Type Extension (`taxonomyTypes.ts`)

```typescript
/** Intention operationality (1-5). Absent in pre-weighted nodes and non-Intention categories. */
operationality?: number;
operationality_history?: WeightHistoryEntry[];
```

### Weighted Sort (`taxonomyContext.ts`)

```typescript
function weightedScore(node, relevance, category) {
  if (Beliefs)    → relevance × confidence
  if (Desires)    → relevance × (priority / 5)
  if (Intentions) → relevance × (operationality / 5)  // NEW
}

function nodeWeightLabel(node, category) {
  if (Intentions && node.operationality != null)
    → ` (operationality: ${node.operationality}/5)`
}
```

### Framing Instruction

When operationality data is present:
```
"Ordered by operationality. Lead with concrete, actionable strategies.
Lower-operationality intentions provide framing context but should not
anchor your primary argument."
```

### Orchestration (`assignWeights.ts`)

Add after `assignDesirePriorities()`:
```typescript
const intentionResults = assignIntentionOperationality(nodes, date);
```

### Post-Debate Evolution

Operationality starts structural but evolves empirically. Initial assignment says "this is a leaf node with medium falsifiability — probably operationality 4." But after debates where this Intention consistently fails SPECIFY challenges, the evidence overrides the structural prior.

#### Gate Conditions (all must pass)

| # | Condition | Rationale |
|---|-----------|-----------|
| 1 | AN claim clearly instantiates this Intention (`attribution_confidence > 0.60`) | Must be about *this* strategy |
| 2 | Claim was targeted by SPECIFY or EMPIRICAL CHALLENGE move | The "show me how" moves — tests operationality directly |
| 3 | Outcome is decisive (strength > 0.7 or < 0.3 after QBAF) | Middle-ground results don't warrant change |

#### Update Rules

| Condition | Delta | Rationale |
|-----------|:-----:|-----------|
| Claim survived SPECIFY challenge (strength > 0.7) | **+1** | Strategy was successfully operationalized under pressure |
| Claim fell to SPECIFY challenge (strength < 0.3) | **-1** | Strategy couldn't be made concrete when pressed |
| Intention grounded 3+ claims in a single debate, avg strength > 0.5 | **+1** | Productive strategy — generates real arguments |
| Intention conceded by its own advocate | **-1** | Even the proponent couldn't defend it |
| Opponent adopts the strategy (cross-POV support edge) | **+1** | Strategy transcends POV — strong operationality signal |

#### Drift Cap

±2 from initial assignment. On a 1–5 scale, this means a leaf node (4) can drop to 2 or rise to 5, but a root node (2) can't reach below 1. Tighter proportionally than confidence's ±0.30, reflecting that operationality should be more stable than evidential confidence.

#### Dedup

Same pattern as `confidenceDedup.ts` — topic-based (cosine > 0.80) and attack-vector (cosine > 0.85) deduplication prevents multi-debate double-counting. Cross-model robustness applies: if two models independently confirm a SPECIFY failure, that's a stronger signal than one.

#### Comparison with Confidence Evolution

| Aspect | Confidence (Beliefs) | Operationality (Intentions) |
|--------|---------------------|----------------------------|
| Trigger move | Undermine (attack evidence) | SPECIFY / EMPIRICAL CHALLENGE (demand concreteness) |
| What changes | Evidential strength | Actionability |
| Scale | 0.0–1.0 continuous | 1–5 integer |
| Drift cap | ±0.30 (±30% of range) | ±2 (±40% of range) |
| Cross-POV boost | Opponent cites as evidence: +0.10 | Opponent adopts strategy: +1 |
| Evolution speed | Gradual (small float deltas) | Stepped (integer changes) |

#### Implementation Sketch

New file `operationalityEvolution.ts` (or extend `confidenceEvolution.ts`):

```typescript
function evaluateOperationalityGate(
  claim: ArgumentNetworkNode,
  edges: ArgumentNetworkEdge[],
  intentionNode: PovNode,
): { passes: boolean; direction: 'up' | 'down' | 'none' } {
  // 1. Attribution check
  if (!claim.taxonomy_refs?.includes(intentionNode.id))
    return { passes: false, direction: 'none' };

  // 2. Was it SPECIFY'd or EMPIRICAL CHALLENGE'd?
  const challengeEdges = edges.filter(e =>
    e.target === claim.id &&
    (e.scheme === 'SPECIFY' || e.scheme === 'EMPIRICAL CHALLENGE')
  );
  if (challengeEdges.length === 0)
    return { passes: false, direction: 'none' };

  // 3. Outcome
  const strength = claim.computed_strength ?? claim.base_strength ?? 0.5;
  if (strength > 0.7) return { passes: true, direction: 'up' };
  if (strength < 0.3) return { passes: true, direction: 'down' };
  return { passes: false, direction: 'none' };
}

function computeOperationalityUpdates(
  session: DebateSession,
  intentionNodes: PovNode[],
): OperationalityUpdate[] {
  // For each Intention node referenced in the debate:
  // 1. Find all AN claims citing this Intention
  // 2. Run gate on each
  // 3. Aggregate: if majority direction is up/down, apply ±1
  // 4. Check drift cap: |current - initial| ≤ 2
  // 5. Build history entry with reason + attack_claim
}
```

### Diagnostics

- Brief grounding badges (t/131/t/132 pattern): `op:4/5` in teal
- Node detail view: operationality dropdown (1-5) with labels matching priority UI pattern
- DiagnosticsWindow: included in nodeWeights memo alongside confidence/priority
- Operationality evolution trace: same panel pattern as "Confidence Impact" — shows which Intentions changed, delta, and the SPECIFY challenge that triggered it

## Resolved Questions

1. **Name: "operationality"** — chosen over "implementability" because it measures structural concreteness without encoding debatable political judgments. Implementability would require assessing real-world feasibility, which is a debate question, not a taxonomy property.

2. **Doctrinal treatment: no special case.** Operationality measures structural properties, not normative importance. A doctrinal Intention can be operationality 4 (leaf) without special treatment — its importance is already captured by being a doctrinal boundary (visible in the prompt via boundary framing).

## Open Question

**Situation bonus worth it?** Only 2-5% of nodes have `situation_refs`. The bonus is small and rarely fires. It could be dropped for simplicity with minimal impact on the distribution. Decision: include for now — it's one line in the formula and can be removed if the distribution analysis shows it's noise.
