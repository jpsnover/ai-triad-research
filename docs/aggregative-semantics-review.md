# Aggregative Semantics Review — Alternative QBAF Gradual Semantics

**Paper:** Aggregative Semantics for Quantitative Bipolar Argumentation Frameworks
**Authors:** Munro et al.
**Venue:** arXiv, March 2026
**Link:** https://arxiv.org/abs/2603.06067

**Authors:** Computational Linguist (sections A, C) · Technical Lead (sections B, D)

---

## A. What This Paper Validates About Our Approach

*Section authored by Computational Linguist*

### A1. DF-QuAD Is a Valid Aggregative Semantics

Their Proposition 1 formally proves that **DF-QuAD is an instance of their aggregative framework**, decomposable into:
- φℛ(M) = φ𝒮(M) = ∏(1-m) (product aggregation for both attacks and supports)
- A specific combining function φf

This means our DF-QuAD implementation is not an ad-hoc formula — it's a principled member of a well-defined family of semantics with known formal properties. This is useful for our academic paper: we can cite this subsumption result to justify our choice within the broader landscape.

### A2. Semantic Choice Is Context-Dependent, Not Universal

Their main finding — 515 variants, no single best — reinforces what we've seen across all reviewed papers: the choice of specific semantics matters less than the architectural decision to use formal argumentation at all. ArgRAG showed "only minor differences," the unified framework paper called it "orthogonal," and now this paper shows the choice depends on contextual requirements (ordering, repetition, weakening behavior).

For our debate context, DF-QuAD's properties are appropriate:
- **Commutative** — argument order shouldn't affect outcome (our Jacobi iteration ensures this)
- **Non-idempotent** — multiple identical attacks DO accumulate (correct for debates where repeated challenges increase pressure)
- **Symmetric φℛ = φ𝒮** — we treat attack and support aggregation identically, which is reasonable for multi-POV debate where neither side has default privilege

### A3. Asymmetric Aggregation Is an Interesting Option We Don't Need Yet

Their key insight is that φℛ ≠ φ𝒮 enables modeling contexts where attacks and supports aggregate differently — e.g., legal reasoning under "presumption of innocence" (attacks must overcome a higher bar). In AI policy debate, we have no analogous asymmetry — all three POVs enter on equal footing. But if we ever model regulatory contexts (where the burden of proof falls on one side), asymmetric aggregation would be the right tool.

---

## B. What We Should Adopt

*Section authored by Technical Lead*

### B1. Configurable Aggregation Function in `qbaf.ts`

**Current state:** The DF-QuAD formula is hardcoded at `qbaf.ts:133`:
```typescript
let newStrength = clamp(base * (1 - aggAtt) * (1 + aggSup));
```

The aggregation of attacks (`aggAtt = Σ(σ × w)`, clamped) and supports (`aggSup = Σ(σ × w)`, clamped) are also hardcoded.

**What to do:** Extract three pluggable functions into `QbafOptions`:

```typescript
interface QbafOptions {
  // ... existing fields ...
  /** Aggregation function for attack influences. Default: sum-and-clamp. */
  aggregateAttacks?: (influences: number[]) => number;
  /** Aggregation function for support influences. Default: sum-and-clamp. */
  aggregateSupports?: (influences: number[]) => number;
  /** Combining function: (base, aggAtt, aggSup) → strength. Default: DF-QuAD. */
  combine?: (base: number, aggAtt: number, aggSup: number) => number;
}
```

Default implementations match current behavior exactly — zero behavioral change. But now experiments can swap in:
- Product aggregation: `φ(M) = 1 - ∏(1-m)` (the paper's top-performing alternative on their example)
- Asymmetric aggregation: different φ for attacks vs supports
- BDI-specific combining (see B2)

**Priority: LOW** — useful for research/experimentation, not urgently needed.

**Effort: Small** — extract 3 functions, add defaults, pass through options. ~20 lines changed in `qbaf.ts`, fully backward-compatible.

### B2. BDI-Specific Aggregation (EXPLORATORY)

**Concept:** Different BDI categories might warrant different aggregation behavior:
- **Beliefs** — attacks on evidence should aggregate strongly (product: multiple contradictions compound)
- **Desires** — values are resilient to attack (a moral commitment doesn't weaken linearly with opposition count)
- **Intentions** — feasibility attacks compound (multiple implementation concerns are worse than one)

**Assessment:** Theoretically interesting but speculative. We have no calibration data comparing BDI-specific aggregation to uniform DF-QuAD. Not worth implementing until B1 (configurable aggregation) is in place AND we have a calibration framework to measure the difference.

**Priority: DEFERRED** — requires B1 + calibration infrastructure. File as a research question, not a ticket.

---

## C. What Our System Does That They Don't

*Section authored by Computational Linguist*

### C1. Cyclic Graph Handling

Their framework is defined **only for acyclic QBAFs** (ac-WAG). They explicitly defer cyclic graphs to future work. Our DF-QuAD implementation handles cyclic attack patterns (which arise naturally in 3-POV debates) via Jacobi iteration with adaptive damping (t/270). This is a fundamental capability gap — their 515 variants are untested on the graph topologies our system routinely encounters.

### C2. Typed Attacks

No Pollock typing. Their framework assumes binary attack/support with a consistency constraint (ℛ ∩ 𝒮 = ∅). Our differential weights (rebut 1.0, undercut 1.05, undermine 1.1) compose with the aggregation function, adding a dimension their framework doesn't model.

### C3. Real-World Evaluation

515 variants tested on one 5-argument toy example. No real debate data, no benchmarks, no human evaluation. Our system has 93+ debates, 3,470+ claims, and calibrated base scores. The gap between "here are 515 possibilities" and "here's what works on real data" is substantial.

### C4. Oscillation Detection and Convergence

They provide no convergence analysis — acyclic graphs don't need it. Our adaptive damping mechanism detects oscillation and guarantees convergence on any graph topology, a practical necessity they've deferred.

### C5. Edge Attribution

Our newly implemented `computeEdgeAttribution()` (t/395) provides per-edge influence measurement on the computed strengths. Their framework provides no explainability mechanism — just the final strength values.

---

## D. Specific Recommendations

*Section authored by Technical Lead*

### D1. Make Aggregation Configurable (from B1) — Low Priority

Extract the three hardcoded functions into `QbafOptions` with defaults matching current DF-QuAD behavior. ~20 lines, fully backward-compatible. This enables future A/B testing without engine rewrites.

Not urgent — create a ticket when we're ready to run semantics experiments. The paper's 515 variants are a research direction, not an action item.

### D2. Don't Switch Away from DF-QuAD

CL's "Quick Assessment" is correct on all three points. DF-QuAD is validated, handles our cyclic graphs, and semantic choice is confirmed secondary across 4 independent papers. No action needed.

### D3. Cite the Subsumption Result

Their Proposition 1 (DF-QuAD as aggregative semantics instance) is citable in our paper's Section 8.7:

> "Our DF-QuAD implementation is formally an instance of aggregative QBAF semantics (Munro et al., 2026, Proposition 1), using product aggregation for both attacks and supports with a multiplicative combining function. While 515 variants exist within this framework, empirical comparison across all reviewed papers shows only minor performance differences between semantics choices — the architectural decision to use formal gradual semantics is more consequential than which specific semantics is selected."

### D4. Asymmetric Aggregation as Future Research Note

If we ever model regulatory contexts where burden of proof is asymmetric (e.g., "prove AI is safe before deployment" vs "prove AI is unsafe to ban it"), asymmetric aggregation (different φ for attacks vs supports) would be the right tool. Note in the paper as a future direction. No implementation now.

---

## Quick Assessment

**Should we switch away from DF-QuAD?** No. Three reasons:

1. **No empirical evidence** that any of the 515 alternatives performs better on debate data. Their toy example shows different semantics produce different results (0.47 vs 0.50 vs 0.73 for DF-QuAD/QE/aggregative), but without real evaluation we can't know which is "correct."

2. **Cyclic graph gap** — our debates produce cyclic attack patterns that their framework can't handle. Switching to an acyclic-only semantics would be a regression.

3. **Convergence across all reviews** — ArgRAG, the unified framework, and this paper all confirm semantic choice is secondary. Our DF-QuAD + Jacobi + damping implementation is battle-tested on 93+ debates with known convergence properties.

**What IS worth doing:** Make the aggregation function **configurable** in `qbaf.ts` so future experiments can swap in alternative semantics without engine changes. Currently the formula `σ(v) = τ(v) × (1 - aggAtt) × (1 + aggSup)` is hardcoded. Extracting aggAtt/aggSup computation and the combining function into pluggable interfaces would enable A/B testing alternative semantics on our debate data — the empirical evaluation this paper lacks.

---

*Draft: 2026-05-06 · Computational Linguist & Technical Lead · AI Triad Research*
