// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Process Reward Model — continuous per-turn quality score.
 *
 * Composes five sub-signals into a single [0,1] process reward score
 * for each debate turn. Designed as a PRM-adjacent signal for:
 * - Calibration weighting (high-reward turns produce more reliable data)
 * - Phase transition timing (accumulating low rewards → debate exhaustion)
 * - Training signal for future debate-model fine-tuning
 *
 * See: research/comp-linguist/process-reward-models.md
 */

import type {
  ConvergenceSignals,
  TurnValidation,
  DebatePhase,
} from './types.js';

// ── Sub-score weights ────────────────────────────────────────
// These sum to 1.0. Engagement and novelty weighted highest
// because they are the strongest indicators of productive debate.

export const PROCESS_REWARD_WEIGHTS = {
  engagement:   0.25,
  novelty:      0.25,
  consistency:  0.20,
  grounding:    0.15,
  move_quality: 0.15,
} as const;

// ── Types ────────────────────────────────────────────────────

export interface ProcessRewardComponents {
  /** Engagement depth: ratio of targeted (cross-node) claims to standalone. From convergence signals. */
  engagement: number;
  /** Novelty: 1 - recycling rate. Low overlap with prior same-speaker turns. */
  novelty: number;
  /** Consistency: commitment consistency + concession responsiveness. */
  consistency: number;
  /** Taxonomy grounding: validation grounding pass + taxonomy ref utilization. */
  grounding: number;
  /** Move quality: move diversity + specificity + constructive move usage. */
  move_quality: number;
}

export interface ProcessRewardScore {
  /** Composite process reward in [0,1]. Higher = better turn quality. */
  score: number;
  /** Per-component sub-scores in [0,1]. */
  components: ProcessRewardComponents;
  /** The weights used (for logging reproducibility). */
  weights: typeof PROCESS_REWARD_WEIGHTS;
}

// ── Input context ────────────────────────────────────────────

export interface ProcessRewardInput {
  /** Convergence signals for this turn. */
  convergenceSignals: ConvergenceSignals;
  /** Turn validation result (dimensions + score). */
  turnValidation: TurnValidation;
  /** Current debate phase (affects sub-score expectations). */
  phase: DebatePhase;
  /** Number of distinct move types used in this turn. */
  moveCount: number;
  /** Number of distinct move types used by this speaker in the prior turn. */
  priorMoveCount?: number;
  /** Taxonomy ref count from this turn. */
  taxonomyRefCount: number;
  /** Total taxonomy nodes injected into context for this turn. */
  injectedNodeCount?: number;
}

// ── Computation ──────────────────────────────────────────────

/**
 * Compute the continuous process reward score for a debate turn.
 *
 * Pure function — no side effects, no I/O.
 */
export function computeProcessReward(input: ProcessRewardInput): ProcessRewardScore {
  const { convergenceSignals: cs, turnValidation: tv, phase } = input;

  // 1. Engagement: direct from convergence signals dialectical_engagement ratio
  const engagement = clamp(cs.dialectical_engagement.ratio);

  // 2. Novelty: inverse of recycling rate.
  //    Use semantic similarity when available (more accurate), fall back to lexical.
  const recyclingRate = cs.argument_redundancy.semantic_max_similarity
    ?? cs.argument_redundancy.avg_self_overlap;
  const novelty = clamp(1 - recyclingRate);

  // 3. Consistency: blend of concession responsiveness and position stability.
  //    Concession: 1.0 if concession taken or no opportunity, 0.0 if missed.
  //    Position stability: lower drift is better (less sycophantic drift).
  const concessionScore =
    cs.concession_opportunity.outcome === 'taken' ? 1.0 :
    cs.concession_opportunity.outcome === 'none' ? 0.8 : // no opportunity — neutral-positive
    0.0; // missed
  const driftPenalty = clamp(cs.position_drift.drift * 2); // scale drift [0,0.5] → [0,1]
  const consistency = clamp(concessionScore * 0.6 + (1 - driftPenalty) * 0.4);

  // 4. Grounding: from turn validation dimensions + taxonomy ref utilization.
  const groundingPass = tv.dimensions.grounding.pass ? 1.0 : 0.0;
  const schemaPass = tv.dimensions.schema.pass ? 1.0 : 0.0;
  const refUtilization = input.injectedNodeCount && input.injectedNodeCount > 0
    ? clamp(input.taxonomyRefCount / input.injectedNodeCount)
    : (input.taxonomyRefCount > 0 ? 0.7 : 0.3); // fallback when injection count unknown
  const grounding = clamp(groundingPass * 0.4 + schemaPass * 0.3 + refUtilization * 0.3);

  // 5. Move quality: diversity, advancement, phase-appropriate constructiveness.
  const advancementPass = tv.dimensions.advancement.pass ? 1.0 : 0.0;
  const moveDiversity = computeMoveDiversity(input.moveCount, input.priorMoveCount);
  const phaseBonus = computePhaseBonus(tv, cs, phase);
  const move_quality = clamp(advancementPass * 0.4 + moveDiversity * 0.3 + phaseBonus * 0.3);

  const components: ProcessRewardComponents = {
    engagement,
    novelty,
    consistency,
    grounding,
    move_quality,
  };

  const w = PROCESS_REWARD_WEIGHTS;
  const score = clamp(
    components.engagement * w.engagement +
    components.novelty * w.novelty +
    components.consistency * w.consistency +
    components.grounding * w.grounding +
    components.move_quality * w.move_quality,
  );

  return { score, components, weights: PROCESS_REWARD_WEIGHTS };
}

// ── Helpers ──────────────────────────────────────────────────

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Move diversity: reward using multiple distinct moves and varying from prior turn.
 * 1 move = 0.3, 2 moves = 0.6, 3+ moves = 1.0. Penalize if identical to prior count.
 */
function computeMoveDiversity(moveCount: number, priorMoveCount?: number): number {
  const countScore = moveCount >= 3 ? 1.0 : moveCount === 2 ? 0.6 : moveCount === 1 ? 0.3 : 0.0;
  const variationBonus = priorMoveCount !== undefined && moveCount !== priorMoveCount ? 0.1 : 0;
  return clamp(countScore + variationBonus);
}

/**
 * Phase-appropriate bonus:
 * - confrontation: reward confrontational moves (DISTINGUISH, COUNTEREXAMPLE, etc.)
 * - argumentation: reward crux identification and engagement depth
 * - concluding: reward constructive moves (INTEGRATE, CONCEDE-AND-PIVOT) and clarifies_taxonomy
 */
function computePhaseBonus(
  tv: TurnValidation,
  cs: ConvergenceSignals,
  phase: DebatePhase,
): number {
  switch (phase) {
    case 'confrontation': {
      // Reward strong engagement and clear positions
      const confrontational = cs.move_polarity.ratio < 0.5 ? 0.7 : 0.4; // low ratio = more confrontational
      return clamp(confrontational + (cs.dialectical_engagement.ratio > 0.5 ? 0.3 : 0));
    }
    case 'argumentation': {
      // Reward crux identification and concession handling
      const cruxBonus = cs.crux_engagement_rate.used_this_turn ? 0.5 : 0;
      const concessionBonus = cs.concession_opportunity.outcome === 'taken' ? 0.3 : 0;
      const engagementBonus = cs.dialectical_engagement.ratio > 0.6 ? 0.2 : 0;
      return clamp(cruxBonus + concessionBonus + engagementBonus);
    }
    case 'concluding': {
      // Reward collaborative moves and taxonomy clarification
      const collaborative = cs.move_polarity.ratio > 0.5 ? 0.5 : 0.2;
      const clarifiesBonus = tv.clarifies_taxonomy.length > 0 ? 0.3 : 0;
      const concessionBonus = cs.concession_opportunity.outcome === 'taken' ? 0.2 : 0;
      return clamp(collaborative + clarifiesBonus + concessionBonus);
    }
    default:
      return 0.5;
  }
}
