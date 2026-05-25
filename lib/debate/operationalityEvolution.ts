// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Post-debate operationality evolution for Intention nodes.
 *
 * Updates Intention operationality based on debate outcomes — specifically
 * SPECIFY and EMPIRICAL CHALLENGE moves that test whether a strategy can
 * be made concrete under pressure.
 *
 * Three-condition gate:
 *   1. attribution_confidence > 0.60 (claim genuinely instantiates the Intention)
 *   2. Claim was targeted by SPECIFY or EMPIRICAL CHALLENGE move
 *   3. Outcome is decisive (strength > 0.7 or < 0.3)
 *
 * Updates: ±1 integer steps. Drift cap: ±2 from initial assignment.
 *
 * See research/comp-linguist/docs/intention-operationality-design.md §"Post-Debate Evolution"
 */

import type { WeightHistoryEntry, PovNode } from './taxonomyTypes.js';
import type {
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  ClaimTaxonomyAttribution,
} from './types.js';

// ── Configuration ───────────────────────────────────────

export const ATTRIBUTION_THRESHOLD = 0.60;
export const STRENGTH_DROP_THRESHOLD = 0.3;
export const STRENGTH_SURVIVE_THRESHOLD = 0.7;
export const MAX_DRIFT = 2;
export const SPECIFY_SCHEMES = ['SPECIFY', 'EMPIRICAL CHALLENGE'];

// ── Gate types ──────────────────────────────────────────

export type OperationalityGateCondition = 'attribution' | 'specify_challenge' | 'decisive_outcome';

export interface OperationalityGateResult {
  passed: boolean;
  direction: 'up' | 'down' | 'none';
  conditions_met: OperationalityGateCondition[];
  conditions_missed: OperationalityGateCondition[];
  attribution_confidence?: number;
  challenge_scheme?: string;
  claim_strength?: number;
}

// ── Update types ────────────────────────────────────────

export type OperationalityUpdateReason =
  | 'survived_specify'     // claim survived SPECIFY challenge (strength > 0.7) → +1
  | 'failed_specify'       // claim fell to SPECIFY challenge (strength < 0.3) → -1
  | 'productive_strategy'  // grounded 3+ claims, avg strength > 0.5 → +1
  | 'self_concession'      // advocate conceded the strategy → -1
  | 'cross_pov_adoption';  // opponent adopted the strategy → +1

export interface OperationalityUpdate {
  intention_id: string;
  reason: OperationalityUpdateReason;
  delta: number;
  new_value: number;
  debate_id: string;
  claim_id?: string;
  attack_claim?: string;
  gate?: OperationalityGateResult;
}

// ── Gate evaluation ─────────────────────────────────────

/**
 * Evaluate the three-condition gate for a single challenge on an attributed claim.
 */
export function evaluateOperationalityGate(
  attribution: ClaimTaxonomyAttribution | undefined,
  challengeEdges: ArgumentNetworkEdge[],
  claimNode: ArgumentNetworkNode,
): OperationalityGateResult {
  const conditions_met: OperationalityGateCondition[] = [];
  const conditions_missed: OperationalityGateCondition[] = [];

  // 1. Attribution check
  const attrConf = attribution?.attribution_confidence ?? 0;
  if (attrConf > ATTRIBUTION_THRESHOLD) {
    conditions_met.push('attribution');
  } else {
    conditions_missed.push('attribution');
  }

  // 2. SPECIFY or EMPIRICAL CHALLENGE move
  const specifyEdge = challengeEdges.find(e =>
    SPECIFY_SCHEMES.includes(e.scheme ?? ''),
  );
  if (specifyEdge) {
    conditions_met.push('specify_challenge');
  } else {
    conditions_missed.push('specify_challenge');
  }

  // 3. Decisive outcome
  const strength = claimNode.computed_strength ?? claimNode.base_strength ?? 0.5;
  let direction: 'up' | 'down' | 'none' = 'none';
  if (strength > STRENGTH_SURVIVE_THRESHOLD) {
    conditions_met.push('decisive_outcome');
    direction = 'up';
  } else if (strength < STRENGTH_DROP_THRESHOLD) {
    conditions_met.push('decisive_outcome');
    direction = 'down';
  } else {
    conditions_missed.push('decisive_outcome');
  }

  return {
    passed: conditions_met.length === 3,
    direction: conditions_met.length === 3 ? direction : 'none',
    conditions_met,
    conditions_missed,
    attribution_confidence: attrConf,
    challenge_scheme: specifyEdge?.scheme,
    claim_strength: strength,
  };
}

// ── Drift cap ───────────────────────────────────────────

/**
 * Apply drift cap: total change from initial assignment capped at ±MAX_DRIFT.
 * Clamps to [1, 5] range.
 */
export function applyOperationalityDriftCap(
  currentOp: number,
  initialOp: number,
  proposedDelta: number,
): number {
  const currentDrift = currentOp - initialOp;
  const newDrift = currentDrift + proposedDelta;

  let cappedDelta = proposedDelta;
  if (newDrift > MAX_DRIFT) {
    cappedDelta = MAX_DRIFT - currentDrift;
  } else if (newDrift < -MAX_DRIFT) {
    cappedDelta = -MAX_DRIFT - currentDrift;
  }

  // Also clamp to valid range [1, 5]
  const newValue = currentOp + cappedDelta;
  if (newValue > 5) return 5 - currentOp;
  if (newValue < 1) return 1 - currentOp;
  return cappedDelta;
}

// ── Core evolution logic ────────────────────────────────

export interface OperationalityEvolutionInput {
  debate_id: string;
  nodes: ArgumentNetworkNode[];
  edges: ArgumentNetworkEdge[];
  /** Intention nodes from the taxonomy, keyed by node ID. */
  intentions: Map<string, PovNode>;
  /** Initial operationality values (from first assignment), keyed by node ID. */
  initial_operationalities: Map<string, number>;
}

/**
 * Compute all operationality updates from a single debate's argument network.
 * Does NOT mutate nodes — returns proposed updates for the caller to apply.
 */
export function computeOperationalityUpdates(
  input: OperationalityEvolutionInput,
): OperationalityUpdate[] {
  const updates: OperationalityUpdate[] = [];
  const nodeMap = new Map(input.nodes.map(n => [n.id, n]));
  const updatedIntentions = new Set<string>();

  // Find all attack/challenge edges
  const attackEdges = input.edges.filter(e => e.type === 'attacks');

  for (const claimNode of input.nodes) {
    const attribution = claimNode.claim_taxonomy_attribution;
    if (!attribution?.primary_ref) continue;

    const intentionId = attribution.primary_ref;
    const intention = input.intentions.get(intentionId);
    if (!intention || intention.category !== 'Intentions') continue;
    if (updatedIntentions.has(intentionId)) continue;

    // Find challenge edges targeting this claim
    const challengeEdges = attackEdges.filter(e => e.target === claimNode.id);
    if (challengeEdges.length === 0) continue;

    const gate = evaluateOperationalityGate(attribution, challengeEdges, claimNode);
    if (!gate.passed) continue;

    const delta = gate.direction === 'up' ? 1 : -1;
    const currentOp = intention.operationality ?? 3;
    const initialOp = input.initial_operationalities.get(intentionId) ?? currentOp;
    const cappedDelta = applyOperationalityDriftCap(currentOp, initialOp, delta);
    if (cappedDelta === 0) continue;

    const attackNode = challengeEdges.length > 0 ? nodeMap.get(challengeEdges[0].source) : undefined;

    updates.push({
      intention_id: intentionId,
      reason: gate.direction === 'up' ? 'survived_specify' : 'failed_specify',
      delta: cappedDelta,
      new_value: currentOp + cappedDelta,
      debate_id: input.debate_id,
      claim_id: claimNode.id,
      attack_claim: attackNode?.text,
      gate,
    });
    updatedIntentions.add(intentionId);
  }

  return updates;
}

/**
 * Compute cross-POV adoption updates.
 * When an opposing camp adopts an Intention's strategy (supports edge), increase by +1.
 */
export function computeCrossPovAdoption(
  nodes: ArgumentNetworkNode[],
  edges: ArgumentNetworkEdge[],
  intentions: Map<string, PovNode>,
  initial_operationalities: Map<string, number>,
  debate_id: string,
  speakerPovMap: Record<string, string>,
): OperationalityUpdate[] {
  const updates: OperationalityUpdate[] = [];

  // Find support edges between claims from different POVs
  const supportEdges = edges.filter(e => e.type === 'supports');
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  for (const edge of supportEdges) {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    if (!sourceNode || !targetNode) continue;

    const targetAttr = targetNode.claim_taxonomy_attribution;
    if (!targetAttr?.primary_ref) continue;
    if (targetAttr.attribution_confidence <= ATTRIBUTION_THRESHOLD) continue;

    const intentionId = targetAttr.primary_ref;
    const intention = intentions.get(intentionId);
    if (!intention || intention.category !== 'Intentions') continue;

    // Check cross-POV
    const intentionPov = intentionId.startsWith('acc-') ? 'accelerationist'
      : intentionId.startsWith('saf-') ? 'safetyist'
      : intentionId.startsWith('skp-') ? 'skeptic'
      : null;
    if (!intentionPov) continue;

    const supporterPov = speakerPovMap[sourceNode.speaker];
    if (!supporterPov || supporterPov === intentionPov) continue;

    if (updates.some(u => u.intention_id === intentionId)) continue;

    const currentOp = intention.operationality ?? 3;
    const initialOp = initial_operationalities.get(intentionId) ?? currentOp;
    const cappedDelta = applyOperationalityDriftCap(currentOp, initialOp, 1);
    if (cappedDelta === 0) continue;

    updates.push({
      intention_id: intentionId,
      reason: 'cross_pov_adoption',
      delta: cappedDelta,
      new_value: currentOp + cappedDelta,
      debate_id,
      claim_id: targetNode.id,
    });
  }

  return updates;
}

// ── History entry builder ───────────────────────────────

/**
 * Build a WeightHistoryEntry from an operationality update.
 */
export function buildOperationalityHistoryEntry(
  update: OperationalityUpdate,
  date: string,
): WeightHistoryEntry {
  const entry: WeightHistoryEntry = {
    date,
    value: update.new_value,
    delta: update.delta,
    reason: `Debate ${update.debate_id}: ${update.reason}`,
  };

  if (update.attack_claim) {
    entry.attack_claim = update.attack_claim;
  }

  return entry;
}
