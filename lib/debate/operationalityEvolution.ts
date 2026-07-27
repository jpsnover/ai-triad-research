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
  CommitmentStore,
} from './types.js';

// ── Configuration ───────────────────────────────────────

export const ATTRIBUTION_THRESHOLD = 0.60;
export const STRENGTH_DROP_THRESHOLD = 0.3;
export const STRENGTH_SURVIVE_THRESHOLD = 0.7;
export const MAX_DRIFT = 2;
export const SPECIFY_SCHEMES = ['SPECIFY', 'EMPIRICAL CHALLENGE'];
export const PRODUCTIVE_MIN_CLAIMS = 3;
export const PRODUCTIVE_MIN_AVG_STRENGTH = 0.5;
const MIN_WORD_LENGTH = 5;
const MIN_OVERLAP_WORDS = 3;

/** Extract significant words from text for overlap matching. */
function significantWords(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/\s+/).filter(w => w.length >= MIN_WORD_LENGTH),
  );
}

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

// ── Productive strategy detection ────────────────────────

/**
 * Compute productive_strategy updates: Intention grounded 3+ claims in a
 * single debate with avg strength > 0.5 → +1.
 */
export function computeProductiveStrategy(
  nodes: ArgumentNetworkNode[],
  intentions: Map<string, PovNode>,
  initial_operationalities: Map<string, number>,
  debate_id: string,
  alreadyUpdated?: Set<string>,
): OperationalityUpdate[] {
  const updates: OperationalityUpdate[] = [];

  // Group claims by attributed Intention
  const claimsByIntention = new Map<string, ArgumentNetworkNode[]>();
  for (const node of nodes) {
    const attr = node.claim_taxonomy_attribution;
    if (!attr?.primary_ref) continue;
    if (attr.attribution_confidence <= ATTRIBUTION_THRESHOLD) continue;

    const intentionId = attr.primary_ref;
    const intention = intentions.get(intentionId);
    if (!intention || intention.category !== 'Intentions') continue;

    if (!claimsByIntention.has(intentionId)) claimsByIntention.set(intentionId, []);
    claimsByIntention.get(intentionId)!.push(node);
  }

  for (const [intentionId, claims] of claimsByIntention) {
    if (alreadyUpdated?.has(intentionId)) continue;
    if (claims.length < PRODUCTIVE_MIN_CLAIMS) continue;

    const avgStrength = claims.reduce((sum, c) =>
      sum + (c.computed_strength ?? c.base_strength ?? 0.5), 0) / claims.length;
    if (avgStrength <= PRODUCTIVE_MIN_AVG_STRENGTH) continue;

    const intention = intentions.get(intentionId)!;
    const currentOp = intention.operationality ?? 3;
    const initialOp = initial_operationalities.get(intentionId) ?? currentOp;
    const cappedDelta = applyOperationalityDriftCap(currentOp, initialOp, 1);
    if (cappedDelta === 0) continue;

    updates.push({
      intention_id: intentionId,
      reason: 'productive_strategy',
      delta: cappedDelta,
      new_value: currentOp + cappedDelta,
      debate_id,
    });
  }

  return updates;
}

// ── Self-concession detection ────────────────────────────

/**
 * Compute self_concession updates: Intention's advocate conceded the strategy → -1.
 * Matches conceded text against Intention node descriptions via significant word overlap.
 */
export function computeSelfConcession(
  nodes: ArgumentNetworkNode[],
  intentions: Map<string, PovNode>,
  initial_operationalities: Map<string, number>,
  commitments: Record<string, CommitmentStore>,
  debate_id: string,
  speakerPovMap: Record<string, string>,
  alreadyUpdated?: Set<string>,
): OperationalityUpdate[] {
  const updates: OperationalityUpdate[] = [];

  // Map Intention IDs to their owning POV
  const intentionPovMap = new Map<string, string>();
  for (const [id] of intentions) {
    if (id.startsWith('acc-')) intentionPovMap.set(id, 'accelerationist');
    else if (id.startsWith('saf-')) intentionPovMap.set(id, 'safetyist');
    else if (id.startsWith('skp-')) intentionPovMap.set(id, 'skeptic');
  }

  // Build reverse map: pov → speakers
  const povSpeakers = new Map<string, string[]>();
  for (const [speaker, pov] of Object.entries(speakerPovMap)) {
    if (!povSpeakers.has(pov)) povSpeakers.set(pov, []);
    povSpeakers.get(pov)!.push(speaker);
  }

  for (const [intentionId, intention] of intentions) {
    if (intention.category !== 'Intentions') continue;
    if (alreadyUpdated?.has(intentionId)) continue;

    const intPov = intentionPovMap.get(intentionId);
    if (!intPov) continue;

    // Get conceded texts from speakers of this Intention's POV
    const speakers = povSpeakers.get(intPov) ?? [];
    const concededTexts: string[] = [];
    for (const spk of speakers) {
      const store = commitments[spk];
      if (store?.conceded) concededTexts.push(...store.conceded);
    }
    if (concededTexts.length === 0) continue;

    // Check if any concession overlaps with the Intention's description
    const intentionWords = significantWords(intention.description ?? intention.label ?? '');
    if (intentionWords.size < MIN_OVERLAP_WORDS) continue;

    let matched = false;
    for (const concText of concededTexts) {
      const concWords = significantWords(concText);
      let overlap = 0;
      for (const w of concWords) {
        if (intentionWords.has(w)) overlap++;
      }
      if (overlap >= MIN_OVERLAP_WORDS) {
        matched = true;
        break;
      }
    }
    if (!matched) continue;

    const currentOp = intention.operationality ?? 3;
    const initialOp = initial_operationalities.get(intentionId) ?? currentOp;
    const cappedDelta = applyOperationalityDriftCap(currentOp, initialOp, -1);
    if (cappedDelta === 0) continue;

    updates.push({
      intention_id: intentionId,
      reason: 'self_concession',
      delta: cappedDelta,
      new_value: currentOp + cappedDelta,
      debate_id,
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

// ── Reflection proposal adapter ────────────────────────

import type { WeightChangeProposal } from './types.js';

export function operationalityUpdatesToProposals(
  updates: OperationalityUpdate[],
): WeightChangeProposal[] {
  return updates.map(u => ({
    kind: 'edit_existing' as const,
    source: 'operationality_evolution' as const,
    node_id: u.intention_id,
    field: 'operationality' as const,
    delta: u.delta,
    new_value: u.new_value,
    reason: `${u.reason}${u.attack_claim ? ` — "${u.attack_claim}"` : ''}`,
    debate_id: u.debate_id,
    requires_human_review: false,
    floor_violation: null,
    gate: u.gate ? { ...u.gate } : undefined,
  }));
}
