// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Browser-safe agent utility computation (pure math, no Node.js deps).
// Extracted from calibrationLogger.ts so lookaheadGate.ts can be imported
// in renderer code without pulling in node:fs/node:path.

import type {
  SpeakerId,
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  TrackedCrux,
} from './types.js';

export interface AgentUtility {
  /** Mean computed_strength of agent's undefeated nodes. */
  position_strength: number;
  /** Fraction of opponent nodes weakened below 0.3. */
  attack_effectiveness: number;
  /** Fraction of identified cruxes this agent has addressed. */
  crux_engagement: number;
  /** Persona-weighted composite score. */
  composite: number;
  /** Attack target strength minus conceded strength. High asymmetry may indicate strategic concession. */
  concession_asymmetry: number;
}

/** Persona-specific utility weights: [position, attack, crux]. */
export const PERSONA_UTILITY_WEIGHTS: Record<string, { position: number; attack: number; crux: number }> = {
  accelerationist: { position: 0.45, attack: 0.30, crux: 0.25 },
  safetyist:       { position: 0.30, attack: 0.25, crux: 0.45 },
  skeptic:         { position: 0.20, attack: 0.25, crux: 0.55 },
};

/**
 * Compute the utility score for a single agent at a point in the debate.
 * Pure function — no side effects.
 */
export function computeAgentUtility(
  speaker: SpeakerId,
  nodes: readonly ArgumentNetworkNode[],
  edges: readonly ArgumentNetworkEdge[],
  cruxNodes?: readonly TrackedCrux[],
  weights?: { position: number; attack: number; crux: number },
): AgentUtility {
  const w = weights ?? PERSONA_UTILITY_WEIGHTS[speaker] ?? { position: 0.33, attack: 0.34, crux: 0.33 };

  const agentNodes = nodes.filter(n => n.speaker === speaker);
  const undefeated = agentNodes.filter(n => (n.computed_strength ?? n.base_strength ?? 0.5) >= 0.3);
  const position_strength = undefeated.length > 0
    ? undefeated.reduce((sum, n) => sum + (n.computed_strength ?? n.base_strength ?? 0.5), 0) / undefeated.length
    : 0;

  const opponentNodes = nodes.filter(n => n.speaker !== speaker && n.speaker !== 'system' && n.speaker !== 'document');
  const weakenedOpponents = opponentNodes.filter(n => (n.computed_strength ?? n.base_strength ?? 0.5) < 0.3);
  const attack_effectiveness = opponentNodes.length > 0
    ? weakenedOpponents.length / opponentNodes.length
    : 0;

  let crux_engagement = 0;
  if (cruxNodes && cruxNodes.length > 0) {
    const addressedCount = cruxNodes.filter(crux =>
      crux.speakers_involved.includes(speaker) ||
      crux.attacking_claim_ids.some(claimId =>
        nodes.some(n => n.id === claimId && n.speaker === speaker)
      )
    ).length;
    crux_engagement = addressedCount / cruxNodes.length;
  }

  const CRUX_CONCESSION_WEIGHT = 1.5;
  const cruxClaimIds = new Set(cruxNodes?.flatMap(c => c.attacking_claim_ids) ?? []);
  const concededNodeIds = new Set(
    edges.filter(e => e.type === 'supports' && nodes.find(n => n.id === e.source)?.speaker === speaker)
      .map(e => e.target),
  );
  const agentAttackTargetIds = new Set(
    edges.filter(e => e.type === 'attacks' && nodes.find(n => n.id === e.source)?.speaker === speaker)
      .map(e => e.target),
  );
  let concededWeightedSum = 0;
  let concededWeightTotal = 0;
  for (const id of concededNodeIds) {
    const n = nodes.find(nd => nd.id === id);
    const strength = n ? (n.computed_strength ?? n.base_strength ?? 0.5) : 0.5;
    const w_c = cruxClaimIds.has(id) ? CRUX_CONCESSION_WEIGHT : 1.0;
    concededWeightedSum += strength * w_c;
    concededWeightTotal += w_c;
  }
  const concededStrength = concededWeightTotal > 0 ? concededWeightedSum / concededWeightTotal : 0.5;
  const attackTargetStrength = agentAttackTargetIds.size > 0
    ? [...agentAttackTargetIds].reduce((sum, id) => {
        const n = nodes.find(nd => nd.id === id);
        return sum + (n ? (n.computed_strength ?? n.base_strength ?? 0.5) : 0.5);
      }, 0) / agentAttackTargetIds.size
    : 0.5;
  const concession_asymmetry = attackTargetStrength - concededStrength;

  const composite = w.position * position_strength + w.attack * attack_effectiveness + w.crux * crux_engagement;

  return { position_strength, attack_effectiveness, crux_engagement, composite, concession_asymmetry };
}
