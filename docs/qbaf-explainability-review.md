# QBAF Explainability Review — Counterfactual & Attribution Explanations

**Papers:**
1. Change in QBAF: Sufficient, Necessary, and Counterfactual Explanations (2025) — [arXiv:2509.18215](https://arxiv.org/abs/2509.18215)
2. Applying Attribution Explanations in Truth-Discovery QBAFs (2024) — [arXiv:2409.05831](https://arxiv.org/html/2409.05831)

**Authors:** Computational Linguist (sections A, C) · Technical Lead (sections B, D)

---

## A. What These Papers Validate About Our Approach

*Section authored by Computational Linguist*

### A1. QBAF Explainability Is a Recognized Research Gap

Paper 1 explicitly states: "real-life application scenarios of QBAFs are still nascent, we do not (or not yet) see means for evaluating the QBAF explainability approach in real-life applications." Our debate system — with 93+ debates, 3,470+ AN claims, and live QBAF propagation — is exactly the kind of real-life application they lack for evaluation. This positions us as both consumers and potential contributors to QBAF explainability research.

### A2. Our Dialectic Traces Are a Simplified Attribution Approach

Our dialectic traces (Section 6.13 of the paper) use BFS traversal to produce narrative chains explaining why a position prevailed. This is functionally a simplified attribution explanation — we trace which supporters and attackers contributed to an argument's final strength. Paper 2's removal-based attribution (φ = σ(α) − σ_{without β}(α)) formalizes what our traces do intuitively: measure each argument's contribution to the topic outcome.

### A3. Bipolar Framework Support Confirmed

Both papers work with bipolar QBAFs (attack + support), confirming our framework choice. Paper 1's reversal operations and Paper 2's attribution scores both handle the bipolar case natively. Our DF-QuAD implementation with typed attacks is compatible with these techniques.

### A4. Semantic Orthogonality Again

Paper 1 discusses DF-QuAD alongside QE and Euler-based semantics. Paper 2 uses QE. Both confirm that explainability techniques are "orthogonal to the choice of gradual semantics" — they work with any semantics, including our DF-QuAD + Jacobi + damping implementation.

---

## B. What We Should Adopt

*Section authored by Technical Lead*

### B1. Removal-Based Edge Attribution for QBAF Timeline

**What Paper 2 does:** For each argument α, compute the attribution of each incoming edge β: φ(β→α) = σ(α) − σ_without_β(α). This measures how much each attacker/supporter actually contributes to the final strength.

**Why this is cheap for us:** Our `computeQbafStrengths()` runs in <1ms for typical debate networks (23-66 nodes). Removal-based attribution for a node with N incoming edges requires N+1 QBAF runs (1 baseline + N with one edge removed). For a node with 30 edges, that's ~30ms — imperceptible even in interactive UI.

**Adoption path:**

1. Add `computeEdgeAttribution()` to `lib/debate/qbaf.ts`:
```typescript
export function computeEdgeAttribution(
  nodes: QbafNode[],
  edges: QbafEdge[],
  targetNodeId: string,
  options?: QbafOptions,
): Map<string, number> {
  const baseline = computeQbafStrengths(nodes, edges, options);
  const baseStrength = baseline.strengths.get(targetNodeId) ?? 0;
  const attributions = new Map<string, number>();

  const targetEdges = edges.filter(e => e.target === targetNodeId);
  for (const edge of targetEdges) {
    const reduced = edges.filter(e => e !== edge);
    const result = computeQbafStrengths(nodes, reduced, options);
    const without = result.strengths.get(targetNodeId) ?? 0;
    attributions.set(`${edge.source}→${edge.target}`, baseStrength - without);
  }
  return attributions;  // positive = edge was helping, negative = edge was hurting
}
```

2. Call on-demand when user clicks a node in the QBAF timeline or ExtractionTimelinePanel — not on every propagation.

3. Display attributions as a ranked list: "Strongest influence: Sentinel's attack on evidence quality (−0.22), Prometheus's supporting data (−0.08 if removed)."

**Priority: MEDIUM** — enriches the existing NL explanations (t/378) with causal attribution. Pairs naturally with the evidence QBAF graphs (t/384) where users want to know which evidence item had the most impact.

**Effort: Small** — ~30 lines of core logic, UI integration in timeline panel.

### B2. Counterfactual "What-If" Queries (DEFERRED)

**What Paper 1 proposes:** Find the minimal set of changes (attack reversals, removals) that would flip an argument from accepted to rejected or vice versa.

**Assessment:** Theoretically interesting for exploring "what would it take to change this conclusion?" but the search is exponential and Paper 1 provides no practical algorithm. We can achieve 80% of the value with a simpler approach: let the user toggle individual edges in the timeline and see the strength change in real-time (since each QBAF run is <1ms).

**Priority: LOW / DEFERRED** — The interactive edge-toggle approach is simpler and more intuitive than formal counterfactual search.

---

## C. What Our System Does That They Don't

*Section authored by Computational Linguist*

### C1. Real-World Scale Application

Paper 1 provides no empirical evaluation — only constructed toy examples. Paper 2 evaluates on a 17-argument, 32-edge truth-discovery scenario and notes that exact Shapley computation is "prohibitively expensive" even at that scale. Our debate AN networks range from 23-66 nodes per debate. While within their computational range for approximated attribution, we'd need to validate performance at our scale.

### C2. Multi-Turn Dynamic Argument Networks

Both papers analyze static QBAFs — fixed argument structures. Our argument network grows incrementally across debate turns, with nodes added, edges created, and GC pruning removing weak nodes. Explaining strength changes in a dynamic, evolving network requires tracking not just "what changed the strength" but "when in the debate did it change and why." Our QBAF timeline already captures per-turn strength snapshots; these papers' techniques would enrich those snapshots with causal attribution.

### C3. Natural Language Explanations

Paper 2 produces numerical attribution scores. Paper 1 produces sets of arguments. Neither generates natural language explanations. Our dialectic traces produce human-readable narrative chains. ArgRAG (t/356) provides template-based NL explanations ("X is accepted because [strongest supporter] even though [strongest attacker]"). We could combine attribution scores with NL templates for richer explanations than any of these papers offer.

### C4. Typed Attacks

Neither paper handles attack subtypes. Paper 1's reversal operations and Paper 2's attribution scores treat all attacks identically. Our Pollock typing (rebut/undercut/undermine with differential weights) means that attribution explanations would need to account for attack type — "this claim weakened because its premise credibility was undermined" vs "this claim weakened because its conclusion was directly rebutted." This is richer explanatory context that generic attribution misses.

---

## D. Specific Recommendations

*Section authored by Technical Lead*

### D1. Implement Removal-Based Attribution in `qbaf.ts` (from B1)

Add `computeEdgeAttribution()` as a new export alongside `computeQbafStrengths()`. Pure function, no side effects, ~30 lines. Tests: verify attribution signs (attack edges should have negative attribution, support edges positive), verify attributions sum approximately to strength delta from base.

### D2. Integrate Attribution into QBAF Timeline Panel

When a user selects a node in the ExtractionTimelinePanel or ConvergenceSignalsPanel where strength changed significantly (|Δ| > 0.1):
- Compute edge attributions on-demand (lazy, not cached — it's fast enough)
- Display as a ranked list below the strength change: "This change was primarily driven by: [edge label] ([±attribution])"
- Color-code: red for attacks that hurt, green for supports that helped
- Include attack type label (rebut/undercut/undermine) for richer context

### D3. Combine with NL Explanations (t/378)

The NL explanation template from t/378 ("strength is X because [supporter] even though [attacker]") currently uses edge weights to pick strongest attacker/supporter. Replace with attribution scores for more accurate causal attribution — the highest-weight edge isn't always the most influential (depends on the attacker's own strength and the graph topology).

### D4. Evidence QBAF Attribution (Pairs with t/384)

For evidence QBAFs (t/384), attribution tells the user which specific evidence item had the most impact on the Belief score. This directly answers "why does this claim have strength 0.63?" → "Primarily because [source doc X] supports it (+0.18), partially offset by [source doc Y] contradicting it (−0.05)."

This is the most user-facing value: making evidence QBAF results explainable at the per-document level.

---

## Quick Assessment

**Paper 1 (Counterfactual):** Theoretically interesting but no evaluation, no production-ready code, and the search for minimal explanations is exponential. The concept of "what would change if this attack were removed?" is valuable for our UI but can be implemented more simply: re-run `computeQbafStrengths()` with one edge removed and compare. Our QBAF engine is fast enough (<1ms per run) to do this interactively.

**Paper 2 (Attribution):** More immediately useful. Removal-based attribution (drop one node/edge, measure strength change) is computationally cheap and directly applicable to our QBAF timeline. For each node whose strength changed significantly between turns, compute φ = σ(with) − σ(without) for each incoming edge to identify the most influential attacker/supporter. This enriches our "strength changed from 0.72 to 0.45" with "primarily due to Sentinel's attack on the evidence quality (attribution: -0.22)."

**Implementation effort:** Small — the QBAF engine already exists, removal-based attribution is just N+1 QBAF runs (one per edge), and our engine runs in <1ms. For a 30-edge node, that's 30ms — imperceptible.

---

*Draft: 2026-05-06 · Computational Linguist & Technical Lead · AI Triad Research*
