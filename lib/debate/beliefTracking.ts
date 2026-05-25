// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Bayesian belief tracking per BDI agent with moderator divergence checks.
 *
 * Maintains a belief distribution per agent over key claims, updated after each
 * round based on QBAF strength changes. The moderator uses belief divergence
 * (symmetric KL divergence) to decide whether further debate rounds have value.
 *
 * Based on: ECON "From Debate to Equilibrium" (arXiv:2506.08292) and
 * "Knowledge Divergence and the Value of Debate" (arXiv:2603.05293).
 *
 * Reference: t/28
 */

import type { SpeakerId, ArgumentNetworkNode, ArgumentNetworkEdge } from './types.js';
import { computeQbafStrengths } from './qbaf.js';
import type { QbafNode, QbafEdge, QbafOptions } from './qbaf.js';

// ── Types ─────────────────────────────────────────────────

export interface ClaimBelief {
  /** Prior belief (before this round's QBAF update). */
  prior: number;
  /** Posterior belief (after this round's QBAF update). */
  posterior: number;
  /** Confidence: 1 − entropy of [posterior, 1−posterior]. Range [0, 1]. */
  confidence: number;
}

export interface AgentBeliefState {
  /** Speaker ID for this agent. */
  speaker: SpeakerId;
  /** Per-claim beliefs. Keyed by claim (AN node) ID. */
  beliefs: Map<string, ClaimBelief>;
  /** Round at which this state was last updated. */
  round: number;
}

export interface BeliefDivergenceResult {
  /** Symmetric KL divergence between two agents' belief vectors. */
  symmetric_kl: number;
  /** Mean absolute difference in posteriors across shared claims. */
  mean_abs_diff: number;
  /** Number of claims compared (intersection of both agents' belief sets). */
  shared_claims: number;
  /** True when divergence is low enough that further debate is unlikely to help. */
  converged: boolean;
}

// ── Constants ─────────────────────────────────────────────

/** Prior belief for a claim the agent has never seen. */
const DEFAULT_PRIOR = 0.5;

/** Bayesian update learning rate — how much QBAF deltas shift beliefs. */
const LEARNING_RATE = 0.6;

/** Below this symmetric KL, agents are considered to have converged. */
const CONVERGENCE_THRESHOLD = 0.05;

/** Small epsilon to prevent log(0) in KL computation. */
const KL_EPSILON = 1e-10;

// ── Belief updates ────────────────────────────────────────

/**
 * Compute binary entropy for a probability p in [0, 1].
 * Returns 0 for p=0 or p=1 (maximum confidence), 1 for p=0.5 (maximum uncertainty).
 */
function binaryEntropy(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
}

/**
 * Initialize belief state for an agent. All claims start at the default prior.
 */
export function initAgentBeliefState(speaker: SpeakerId): AgentBeliefState {
  return { speaker, beliefs: new Map(), round: 0 };
}

/**
 * Update an agent's belief state based on observed QBAF strength changes.
 *
 * For each claim in the network:
 * 1. Look up the agent's prior for this claim (default 0.5 if unseen).
 * 2. Compute the QBAF-based "observation": the computed strength of the claim
 *    from this agent's perspective (claims owned by this speaker are weighted
 *    higher; opposing claims are inverted).
 * 3. Bayesian update: posterior = prior + LEARNING_RATE × (observation − prior).
 * 4. Clamp to [0.01, 0.99] and compute confidence = 1 − binaryEntropy(posterior).
 *
 * @param state - Current belief state (mutated in place, returned for chaining).
 * @param nodes - Current argument network nodes.
 * @param strengths - QBAF computed strengths (node ID → strength).
 * @param round - Current debate round number.
 * @returns The updated belief state.
 */
export function updateBeliefs(
  state: AgentBeliefState,
  nodes: ReadonlyArray<ArgumentNetworkNode>,
  strengths: Map<string, number>,
  round: number,
): AgentBeliefState {
  for (const node of nodes) {
    // Skip non-debater nodes
    if (node.speaker === 'system' || node.speaker === 'document' || node.speaker === 'user') continue;

    const claimId = node.id;
    const strength = strengths.get(claimId) ?? (node.computed_strength ?? node.base_strength ?? 0.5);

    // Perspective-adjusted observation: own claims use raw strength,
    // opponent claims invert (high strength of opponent = low belief for me)
    const observation = node.speaker === state.speaker ? strength : 1 - strength;

    const prior = state.beliefs.get(claimId)?.posterior ?? DEFAULT_PRIOR;
    const posterior = clamp(prior + LEARNING_RATE * (observation - prior), 0.01, 0.99);
    const confidence = 1 - binaryEntropy(posterior);

    state.beliefs.set(claimId, { prior, posterior, confidence });
  }

  state.round = round;
  return state;
}

// ── Divergence computation ────────────────────────────────

/**
 * Compute symmetric KL divergence between two agents' belief vectors.
 *
 * Only considers claims present in both agents' belief sets (shared claims).
 * Each claim is treated as an independent Bernoulli variable.
 *
 * Symmetric KL = 0.5 × (KL(P || Q) + KL(Q || P))
 *
 * Returns a BeliefDivergenceResult with the divergence metrics and
 * a convergence flag based on the CONVERGENCE_THRESHOLD.
 */
export function computeBeliefDivergence(
  stateA: AgentBeliefState,
  stateB: AgentBeliefState,
): BeliefDivergenceResult {
  // Find shared claims
  const sharedClaims: string[] = [];
  for (const claimId of stateA.beliefs.keys()) {
    if (stateB.beliefs.has(claimId)) {
      sharedClaims.push(claimId);
    }
  }

  if (sharedClaims.length === 0) {
    return { symmetric_kl: 0, mean_abs_diff: 0, shared_claims: 0, converged: true };
  }

  let klPQ = 0;
  let klQP = 0;
  let totalAbsDiff = 0;

  for (const claimId of sharedClaims) {
    const p = stateA.beliefs.get(claimId)!.posterior;
    const q = stateB.beliefs.get(claimId)!.posterior;

    // KL(P || Q) for Bernoulli: p*log(p/q) + (1-p)*log((1-p)/(1-q))
    klPQ += bernoulliKL(p, q);
    klQP += bernoulliKL(q, p);
    totalAbsDiff += Math.abs(p - q);
  }

  const symmetric_kl = (klPQ + klQP) / (2 * sharedClaims.length);
  const mean_abs_diff = totalAbsDiff / sharedClaims.length;

  return {
    symmetric_kl,
    mean_abs_diff,
    shared_claims: sharedClaims.length,
    converged: symmetric_kl < CONVERGENCE_THRESHOLD,
  };
}

/**
 * Compute pairwise divergence across all agent pairs and return
 * the maximum divergence. Used by the moderator to decide if further
 * debate rounds are productive.
 *
 * High max divergence = agents still disagree on key claims → more rounds valuable.
 * Low max divergence = convergence → debate may wrap up.
 */
export function computeMaxBeliefDivergence(
  states: AgentBeliefState[],
): BeliefDivergenceResult & { pair: [SpeakerId, SpeakerId] } {
  let maxResult: BeliefDivergenceResult = {
    symmetric_kl: 0, mean_abs_diff: 0, shared_claims: 0, converged: true,
  };
  let maxPair: [SpeakerId, SpeakerId] = [states[0]?.speaker ?? 'accelerationist', states[1]?.speaker ?? 'safetyist'];

  for (let i = 0; i < states.length; i++) {
    for (let j = i + 1; j < states.length; j++) {
      const result = computeBeliefDivergence(states[i], states[j]);
      if (result.symmetric_kl > maxResult.symmetric_kl) {
        maxResult = result;
        maxPair = [states[i].speaker, states[j].speaker];
      }
    }
  }

  return { ...maxResult, pair: maxPair };
}

// ── Helpers ───────────────────────────────────────────────

/** KL divergence for a single Bernoulli variable: KL(p || q). */
function bernoulliKL(p: number, q: number): number {
  const pSafe = clamp(p, KL_EPSILON, 1 - KL_EPSILON);
  const qSafe = clamp(q, KL_EPSILON, 1 - KL_EPSILON);
  return pSafe * Math.log(pSafe / qSafe) + (1 - pSafe) * Math.log((1 - pSafe) / (1 - qSafe));
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
