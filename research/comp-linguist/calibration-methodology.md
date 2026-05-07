# AI Parameter Calibration Methodology

## Overview

The AI Triad debate system has **16 tunable parameters** that govern how debates are conducted, how claims are evaluated, and how the system decides when to transition between phases. Rather than relying on intuition to set these parameters, we use an automated calibration pipeline that:

1. Logs empirical measurements from every debate
2. Runs optimization algorithms on the accumulated data (no LLM calls)
3. Produces bounded, safety-railed recommendations
4. For one critical parameter (relevance threshold), automatically applies recommendations

All calibration is deterministic arithmetic over logged data — zero LLM involvement, zero human input required, reproducible on identical data.

---

## The Calibration Loop

```
Debate runs → Calibration Logger records ~1KB of metrics per debate
                                    ↓
           Calibration Log accumulates across debates (local + Azure)
                                    ↓
    After 10+ debates: Optimizer reads log, runs 16 algorithms
                                    ↓
         Produces OptimizationResult per parameter (value, confidence, rationale)
                                    ↓
    Applied to provisional-weights.json (with safety rails for auto-applied params)
                                    ↓
                Next debate uses updated parameters → loop repeats
```

---

## What Gets Logged (Calibration Data Point)

After every debate, the `calibrationLogger` records a `CalibrationDataPoint` with ~40 fields organized around the 16 parameters. Each field captures either a **quality signal** (how well the debate went) or a **parameter value** (what setting was active).

Key quality signals:

| Signal | What It Measures | Used By |
|--------|-----------------|---------|
| `crux_addressed_ratio` | Were the real disagreements engaged? | P1 (exploration exit), P5 (saturation weights) |
| `engaging_real_disagreement` | Neutral evaluator: was this a real debate? | P1, P5 |
| `avg_utilization_rate` | Were injected taxonomy nodes actually referenced? | P2 (relevance threshold) |
| `avg_primary_utilization` | Were the top-ranked nodes referenced? | P2 |
| `qbaf_preference_concordance` | Does QBAF strength ordering match synthesis preferences? | P3 (attack weights) |
| `structural_error_rate` | JSON/schema errors per turn | P4 (temperature) |
| `repetition_rate` | Repetition warnings per turn | P4 |
| `claims_forgotten_rate` | Claims that fell out of context window | P6 (compression window) |
| `taxonomy_mapped_ratio` | AN nodes that map to taxonomy nodes | P11 (cluster similarity) |
| `near_miss_duplicate_count` | Almost-duplicate claim pairs | P12 (duplicate threshold) |
| `borderline_claim_survival_rate` | Borderline FIRE claims that survived debate | P13 (FIRE threshold) |

---

## The 16 Parameters and Their Objective Functions

### Tier 1: Phase Transition Parameters

These determine *when* the debate moves between phases. The objective function is **debate quality** — measured by the neutral evaluator's assessment of crux engagement.

**P1. Exploration Exit Threshold** (default: 0.65)
- **What it controls:** The saturation score at which exploration → synthesis transition fires
- **Objective function:** `quality = crux_addressed_ratio × (engaging ? 1.0 : 0.5)`
- **Algorithm:** Bucket threshold values by 0.05 increments, find the bucket with highest average quality
- **Bounds:** [0.45, 0.85]
- **Rationale:** If the threshold is too low, debates exit exploration before cruxes are fully engaged. Too high, debates waste rounds recycling arguments.

**P5. Saturation Signal Weights** (6 weights summing to 1.0)
- **What it controls:** How the 6 sub-signals (recycling pressure, crux maturity, concession plateau, engagement fatigue, pragmatic convergence, scheme stagnation) combine into the saturation score
- **Objective function:** Same quality metric as P1 — `crux_addressed_ratio × engaging`
- **Algorithm:** OLS regression: `quality = w₁×signal₁ + w₂×signal₂ + ...`. The regression coefficients (normalized to sum to 1.0, negatives clamped to 0.02) are the optimal weights
- **Requires:** 8+ data points with saturation signals at transition
- **Rationale:** Some signals are more predictive of debate quality than others. The regression discovers which signals matter most empirically.

**P8. Crux Resolution Threshold** (default: 0.85 polarity)
- **Objective function:** Agreement between engine crux status and neutral evaluator crux status
- **Algorithm:** Minimize `crux_resolution_divergence_rate` — when the engine and evaluator disagree about whether a crux is resolved, the threshold needs adjustment

### Tier 2: Context Parameters

These determine *what context* agents receive. The objective function is **utilization** — whether injected context is actually used.

**P2. Embedding Relevance Threshold** (default: 0.48)
- **What it controls:** Minimum cosine similarity for a taxonomy node to be injected into debate context
- **Objective function:** Utilization rate = `referenced_nodes / injected_nodes`
- **Algorithm:** If avgUtilization < 30% → raise threshold by 0.03 (too much noise). If avgPrimaryUtilization < 50% → lower threshold by 0.02 (missing relevant nodes). Otherwise: no change.
- **Bounds:** [0.35, 0.60]
- **Adaptive:** This is the only parameter with automatic write-back (t/273). After each debate, if 5+ debates have passed since the last adjustment and confidence is medium+, the recommendation is applied directly to `provisional-weights.json`.
- **Safety rails:** 5-debate minimum between adjustments, medium+ confidence required, bounds enforced, `adaptation_enabled: false` manual override available.

**P6. Context Compression Window** (RECENT_WINDOW)
- **Objective function:** `claims_forgotten_rate` — fraction of claims that fell out of context and were never addressed
- **Algorithm:** If forgotten rate > 20%, expand window. If forgotten rate < 5%, window may be too large (wasting context budget).

**P7. GC Trigger Threshold** (default: 175 nodes)
- **Objective function:** Balance between network tractability and information preservation
- **Algorithm:** Track `an_nodes_at_synthesis` and `gc_runs`. If GC never fires, threshold may be too high. If GC fires >3 times, threshold may be too low.

**P9. Node Selection Cap** (default: 35 POV, 15 situation)
- **Objective function:** Relevance score variance — low variance means all injected nodes are roughly equally relevant (cap too tight). High variance means some injected nodes are noise (cap too loose).

### Tier 3: Output Quality Parameters

These determine the *quality* of generated debate content. The objective function is **error rate** — structural errors and repetition.

**P3. QBAF Attack Type Weights** (default: rebut 1.0, undercut 1.05, undermine 1.1)
- **Objective function:** `qbaf_preference_concordance` — how often QBAF computed strength ordering agrees with the synthesis phase's preference verdicts
- **Algorithm:** If concordance < 50%, recommend narrowing the weight spread (the differential isn't helping). If concordance > 80%, current weights are working.
- **Note:** Cannot re-run QBAF with different weights post-hoc from the log — recommendations are directional only.

**P4. Draft Temperature** (default: 0.7)
- **Objective function:** Minimize composite cost: `structural_error_rate + repetition_rate`
- **Algorithm:** These two errors pull in opposite directions — low temperature reduces structural errors but increases repetition; high temperature increases creativity but causes more schema violations. The optimizer finds the temperature where neither dominates (>2× the other).
- **Bounds:** [0.4, 0.9]
- **Adjustment step:** ±0.05

**P10. Semantic Recycling Threshold** (default: 0.85)
- **Objective function:** Agreement between the recycling detector (embedding cosine) and the turn validator's independent novelty signal
- **Algorithm:** Maximize agreement rate — when both detectors agree, the threshold is well-calibrated.

### Tier 4: Upstream Pipeline Parameters

These govern the extraction and taxonomy pipeline. The objective function is **cross-pipeline consistency** — extraction quality measured during debates.

**P11. Cluster MinSimilarity** (default: 0.55)
- **Objective function:** `taxonomy_mapped_ratio` — fraction of AN nodes that map to at least one taxonomy node
- **Algorithm:** If mapped ratio is low, clusters may be too tight (similar claims in different clusters aren't matching). If too high, clusters may be too loose.

**P12. Duplicate Claim Similarity** (default: 0.85)
- **Objective function:** `near_miss_duplicate_count` — claim pairs with similarity in [threshold-0.05, threshold]
- **Algorithm:** Many near-misses suggest the threshold is too high (real duplicates are being missed). Zero near-misses suggest it may be too low (catching false positives).

**P13. FIRE Confidence Threshold** (default: 0.7)
- **Objective function:** `borderline_claim_survival_rate` — fraction of claims accepted at confidence 0.7-0.75 that survived debate without being refuted
- **Algorithm:** If borderline claims consistently survive, the threshold could be lowered (accepting more claims safely). If they consistently die, the threshold should be raised.

**P14. Hierarchy Cohesion** (cohesion "clear theme" threshold: 0.60)
- **Objective function:** `avg_branch_cohesion` — mean base_strength of taxonomy-grounded nodes in referenced branches

**P15. Extraction Density Quotas** (KP divisor)
- **Objective function:** `claims_per_1k_words` — tracking whether extraction is over- or under-producing claims relative to document length

**P16. API Budget Hard Multiplier** (default: 15)
- **Objective function:** Whether `hit_api_ceiling` fired — if debates consistently hit the ceiling, the multiplier is too tight. If it never fires, the budget may be too generous.

---

## Objective Function Summary

The system uses **three primary objective functions**, each measuring a different dimension of debate quality:

| Objective | What It Measures | Used By | Source |
|-----------|-----------------|---------|--------|
| **Debate quality** | `crux_addressed_ratio × engaging` | P1, P5, P8 | Neutral evaluator |
| **Utilization** | `referenced / injected` nodes | P2, P6, P7, P9 | Context injection manifest |
| **Error rate** | `structural_errors + repetition` | P3, P4, P10 | Turn validation |

These are complementary — a debate can have high quality (good crux engagement) but low utilization (too many irrelevant nodes injected) or high errors (schema violations). The optimizer addresses each dimension independently.

**The neutral evaluator's assessment is the ultimate arbiter of debate quality.** It reads the full debate transcript with speaker identities stripped (persona-free), independently evaluates whether cruxes were identified and addressed, and produces the `crux_addressed_ratio` and `engaging_real_disagreement` signals that drive the primary objective function. This makes the calibration system self-referential in a principled way: the symbolic system (QBAF, phase transitions) generates the debate; a separate neural evaluation (persona-free neutral evaluator) measures its quality; the calibration optimizer uses that measurement to tune the symbolic parameters.

---

## Confidence and Safety Rails

### Confidence Levels

| Level | Requirement | Implication |
|-------|-------------|-------------|
| **High** | 15+ data points, clear signal | Auto-apply for adaptive params |
| **Medium** | 8-14 data points, moderate signal | Apply with caution |
| **Low** | 5-7 data points, weak signal | Report only, don't apply |

### Safety Rails (for adaptive write-back, P2)

1. **Minimum 5 debates** between adjustments — prevents overfitting to single bad runs
2. **Medium+ confidence** required — low-confidence recommendations are logged but not applied
3. **Bounds enforced** — [0.35, 0.60] for relevance threshold; each parameter has its own range
4. **Manual override** — `adaptation_enabled: false` in provisional-weights.json freezes the parameter
5. **History audit trail** — every adjustment logged with timestamp, rationale, data point count

### Where Parameters Live

All tunable parameters are stored in `lib/debate/provisional-weights.json`:

```json
{
  "saturation": { "recycling_pressure": 0.01, "crux_maturity": 0.28, ... },
  "convergence": { "qbaf_agreement_density": 0.35, ... },
  "thresholds": { "exploration_exit": 0.65, "synthesis_exit": 0.70, ... },
  "phase_bounds": { "min_thesis_rounds": 2, "max_exploration_rounds": 8, ... },
  "network": { "gc_trigger": 175, "gc_target": 150, "hard_cap": 200 },
  "budget": { "soft_multiplier": 8, "hard_multiplier": 15 },
  "clustering": { "min_similarity": 0.55, ... },
  "relevance": { "embedding_threshold": 0.48, "adaptation_enabled": true, ... },
  "crux_detection": { "min_base_strength": 0.3, ... },
  "coverage": { "discussed_threshold": 0.65, "covered_threshold": 0.50, ... },
  "confidence": { "floor": 0.40, "escalation_start": 3, ... }
}
```

---

## Running the Optimizer

```bash
# CLI: read calibration log, compute all 16 recommendations
npx tsx lib/debate/calibrationOptimizer.ts [data-root]

# Programmatic: import and call
import { recalibrateParameters } from './calibrationOptimizer';
const report = await recalibrateParameters(dataRoot, { apply: true });
```

The optimizer runs in milliseconds — no LLM calls, pure arithmetic. It reads the calibration log, runs all 16 algorithms, and produces a `RecalibrationReport` with per-parameter recommendations.

---

## Key Design Principles

1. **Deterministic over neural.** The calibration system uses no LLM calls. Every optimization is a closed-form computation or bounded search over logged data. This makes calibration reproducible, auditable, and fast.

2. **Conservative adjustment.** Parameters move in small steps (±0.03 for thresholds, ±0.05 for temperature). Large jumps are clamped. This prevents oscillation and allows the system to converge gradually.

3. **Separate objective functions per concern.** The system doesn't optimize a single global objective. Instead, phase transitions optimize for debate quality, context parameters optimize for utilization, and output parameters optimize for error rate. These concerns are independent — improving one should not degrade another.

4. **The neutral evaluator is the oracle.** The quality signals that drive the primary objective function come from an independent neural evaluation with persona stripping. This creates a clean separation: the debate system generates; the evaluator judges; the optimizer tunes.

5. **Safety rails prevent runaway.** Bounds, minimum data requirements, confidence gating, and manual overrides ensure that the optimizer cannot produce dangerous parameter values even with adversarial calibration data.

---

*Created: 2026-05-06 · Computational Linguist · AI Triad Research*
