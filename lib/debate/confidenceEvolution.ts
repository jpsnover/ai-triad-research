// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Post-debate Bayesian confidence evolution.
 *
 * Updates Belief confidence and Desire priority based on debate outcomes.
 * Conservative updating — single debates produce small changes, accumulated
 * evidence gradually shifts scores.
 *
 * Three-condition gate for confidence reduction:
 *   1. attribution_confidence > 0.60 (claim genuinely instantiates the Belief)
 *   2. Attack type is 'undermine' (targets evidential foundation)
 *   3. Attack computed_strength > 0.5 (strong enough to matter)
 *
 * See docs/weighted-bdi-proposal.md §"Evolution Through Debates"
 */

import type { WeightHistoryEntry, PovNode } from './taxonomyTypes.js';
import type {
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  ClaimTaxonomyAttribution,
} from './types.js';

// ── Configuration ───────────────────────────────────────

export const ATTRIBUTION_THRESHOLD = 0.60;
export const ATTACK_STRENGTH_THRESHOLD = 0.5;
export const STRENGTH_DROP_THRESHOLD = 0.3;
export const STRENGTH_SURVIVE_THRESHOLD = 0.7;
export const MAX_DRIFT = 0.3;
export const HUMAN_REVIEW_THRESHOLD = 0.2;
export const HISTORY_MAX_ENTRIES = 30;
export const HISTORY_MAX_AGE_MONTHS = 12;

// ── Gate condition types ────────────────────────────────

export type GateCondition = 'attribution' | 'undermine_type' | 'attack_strength';

export interface GateResult {
  passed: boolean;
  conditions_met: GateCondition[];
  conditions_missed: GateCondition[];
  attribution_confidence?: number;
  attack_type?: string;
  attack_strength?: number;
}

export interface NearMiss {
  belief_id: string;
  claim_id: string;
  conditions_met: GateCondition[];
  missing: GateCondition;
}

// ── Confidence update types ─────────────────────────────

export type UpdateReason =
  | 'undermined'         // claim strength dropped below 0.3 after undermine attack
  | 'survived'           // claim maintained strength > 0.7 despite attacks
  | 'cross_pov'          // opposing camp cited this Belief as evidence
  | 'document_contradiction'; // source document directly contradicts

export interface ConfidenceUpdate {
  belief_id: string;
  reason: UpdateReason;
  delta: number;
  new_value: number;
  debate_id: string;
  claim_id?: string;
  attack_claim?: string;
  requires_human_review: boolean;
  gate?: GateResult;
}

export interface PriorityUpdate {
  desire_id: string;
  reason: 'reflection_concession' | 'crux_of_disagreement';
  delta: number;
  new_value: number;
  debate_id: string;
}

export interface EvolutionResult {
  confidence_updates: ConfidenceUpdate[];
  priority_updates: PriorityUpdate[];
  near_misses: NearMiss[];
  history_pruned: PruneResult[];
}

// ── Three-condition gate ────────────────────────────────

/**
 * Evaluate the three-condition gate for a single attack on an attributed claim.
 */
export function evaluateGate(
  attribution: ClaimTaxonomyAttribution | undefined,
  attackEdge: ArgumentNetworkEdge,
  attackNode: ArgumentNetworkNode | undefined,
): GateResult {
  const conditions_met: GateCondition[] = [];
  const conditions_missed: GateCondition[] = [];

  const attrConf = attribution?.attribution_confidence ?? 0;
  if (attrConf > ATTRIBUTION_THRESHOLD) {
    conditions_met.push('attribution');
  } else {
    conditions_missed.push('attribution');
  }

  if (attackEdge.attack_type === 'undermine') {
    conditions_met.push('undermine_type');
  } else {
    conditions_missed.push('undermine_type');
  }

  const attackStrength = attackNode?.computed_strength ?? 0;
  if (attackStrength > ATTACK_STRENGTH_THRESHOLD) {
    conditions_met.push('attack_strength');
  } else {
    conditions_missed.push('attack_strength');
  }

  return {
    passed: conditions_met.length === 3,
    conditions_met,
    conditions_missed,
    attribution_confidence: attrConf,
    attack_type: attackEdge.attack_type,
    attack_strength: attackStrength,
  };
}

// ── Update magnitude computation ────────────────────────

/**
 * Compute delta from an undermine attack that passed the gate.
 * - Claim strength drops below 0.3 → reduce by 0.05-0.10 (scaled by how far below)
 * - Claim survives (strength > 0.7) → increase by 0.05
 */
export function computeUndermineDelta(
  claimStrength: number,
): number {
  if (claimStrength < STRENGTH_DROP_THRESHOLD) {
    // Scale: 0.0 → -0.10, 0.3 → -0.05
    return -(0.10 - (claimStrength / STRENGTH_DROP_THRESHOLD) * 0.05);
  }
  if (claimStrength > STRENGTH_SURVIVE_THRESHOLD) {
    return 0.05;
  }
  // Middle ground (0.3-0.7): no update
  return 0;
}

/** Cross-POV validation: opposing camp cited Belief as evidence → +0.10 */
export const CROSS_POV_DELTA = 0.10;

/** Document-level contradiction → -0.15 */
export const DOCUMENT_CONTRADICTION_DELTA = -0.15;

// ── Drift cap ───────────────────────────────────────────

/**
 * Apply drift cap: total change from initial assignment capped at ±MAX_DRIFT.
 * Returns the clamped delta.
 */
export function applyDriftCap(
  currentConfidence: number,
  initialConfidence: number,
  proposedDelta: number,
): number {
  const currentDrift = currentConfidence - initialConfidence;
  const newDrift = currentDrift + proposedDelta;

  if (newDrift > MAX_DRIFT) {
    return MAX_DRIFT - currentDrift;
  }
  if (newDrift < -MAX_DRIFT) {
    return -MAX_DRIFT - currentDrift;
  }
  return proposedDelta;
}

/**
 * Clamp confidence to valid range [0.10, 0.95].
 */
function clampConfidence(value: number): number {
  return Math.max(0.10, Math.min(0.95, value));
}

// ── Core evolution logic ────────────────────────────────

export interface DebateEvolutionInput {
  debate_id: string;
  nodes: ArgumentNetworkNode[];
  edges: ArgumentNetworkEdge[];
  /** Belief nodes from the taxonomy, keyed by node ID. */
  beliefs: Map<string, PovNode>;
  /** Initial confidence values (from first assignment), keyed by node ID. */
  initial_confidences: Map<string, number>;
}

/**
 * Compute all confidence updates from a single debate's argument network.
 * Does NOT mutate nodes — returns proposed updates for the caller to apply.
 */
export function computeConfidenceUpdates(
  input: DebateEvolutionInput,
): { updates: ConfidenceUpdate[]; near_misses: NearMiss[] } {
  const updates: ConfidenceUpdate[] = [];
  const near_misses: NearMiss[] = [];

  const nodeMap = new Map(input.nodes.map(n => [n.id, n]));

  // Find all attack edges
  const attackEdges = input.edges.filter(e => e.type === 'attacks');

  for (const edge of attackEdges) {
    const targetNode = nodeMap.get(edge.target);
    const attackNode = nodeMap.get(edge.source);
    if (!targetNode || !attackNode) continue;

    const attribution = targetNode.claim_taxonomy_attribution;
    if (!attribution?.primary_ref) continue;

    const beliefId = attribution.primary_ref;
    const belief = input.beliefs.get(beliefId);
    if (!belief || belief.category !== 'Beliefs') continue;

    // Evaluate the 3-condition gate
    const gate = evaluateGate(attribution, edge, attackNode);

    if (!gate.passed) {
      // Near-miss: exactly 1 condition missed
      if (gate.conditions_missed.length === 1) {
        near_misses.push({
          belief_id: beliefId,
          claim_id: targetNode.id,
          conditions_met: gate.conditions_met,
          missing: gate.conditions_missed[0],
        });
      }
      continue;
    }

    // Gate passed — compute magnitude
    const claimStrength = targetNode.computed_strength ?? 0.5;
    const rawDelta = computeUndermineDelta(claimStrength);
    if (rawDelta === 0) continue;

    const currentConf = belief.confidence ?? 0.5;
    const initialConf = input.initial_confidences.get(beliefId) ?? currentConf;
    const cappedDelta = applyDriftCap(currentConf, initialConf, rawDelta);
    if (cappedDelta === 0) continue;

    const newValue = clampConfidence(currentConf + cappedDelta);
    const actualDelta = newValue - currentConf;
    if (Math.abs(actualDelta) < 0.001) continue;

    updates.push({
      belief_id: beliefId,
      reason: claimStrength < STRENGTH_DROP_THRESHOLD ? 'undermined' : 'survived',
      delta: actualDelta,
      new_value: newValue,
      debate_id: input.debate_id,
      claim_id: targetNode.id,
      attack_claim: attackNode.text,
      requires_human_review: Math.abs(actualDelta) > HUMAN_REVIEW_THRESHOLD,
      gate,
    });
  }

  // Check for survived claims (strength > 0.7 despite being attacked)
  for (const node of input.nodes) {
    const attribution = node.claim_taxonomy_attribution;
    if (!attribution?.primary_ref) continue;
    if (attribution.attribution_confidence <= ATTRIBUTION_THRESHOLD) continue;

    const beliefId = attribution.primary_ref;
    const belief = input.beliefs.get(beliefId);
    if (!belief || belief.category !== 'Beliefs') continue;

    const strength = node.computed_strength ?? 0.5;
    if (strength <= STRENGTH_SURVIVE_THRESHOLD) continue;

    // Check if this node was actually attacked
    const wasAttacked = attackEdges.some(e => e.target === node.id);
    if (!wasAttacked) continue;

    // Already have an update for this belief from the attack loop?
    if (updates.some(u => u.belief_id === beliefId)) continue;

    const currentConf = belief.confidence ?? 0.5;
    const initialConf = input.initial_confidences.get(beliefId) ?? currentConf;
    const cappedDelta = applyDriftCap(currentConf, initialConf, 0.05);
    if (cappedDelta === 0) continue;

    const newValue = clampConfidence(currentConf + cappedDelta);
    const actualDelta = newValue - currentConf;
    if (Math.abs(actualDelta) < 0.001) continue;

    updates.push({
      belief_id: beliefId,
      reason: 'survived',
      delta: actualDelta,
      new_value: newValue,
      debate_id: input.debate_id,
      claim_id: node.id,
      requires_human_review: false,
    });
  }

  return { updates, near_misses };
}

/**
 * Compute cross-POV validation updates.
 * When an opposing camp cites a Belief as evidence, increase confidence by 0.10.
 */
export function computeCrossPovUpdates(
  nodes: ArgumentNetworkNode[],
  beliefs: Map<string, PovNode>,
  initial_confidences: Map<string, number>,
  debate_id: string,
  speakerPovMap: Record<string, string>,
): ConfidenceUpdate[] {
  const updates: ConfidenceUpdate[] = [];

  for (const node of nodes) {
    const attribution = node.claim_taxonomy_attribution;
    if (!attribution?.primary_ref) continue;

    const beliefId = attribution.primary_ref;
    const belief = beliefs.get(beliefId);
    if (!belief || belief.category !== 'Beliefs') continue;

    // Determine POV of the belief's owner from its ID prefix
    const beliefPov = beliefId.startsWith('acc-') ? 'accelerationist'
      : beliefId.startsWith('saf-') ? 'safetyist'
      : beliefId.startsWith('skp-') ? 'skeptic'
      : null;
    if (!beliefPov) continue;

    // Determine POV of the speaker
    const speakerPov = speakerPovMap[node.speaker];
    if (!speakerPov || speakerPov === beliefPov) continue;

    // Cross-POV: opposing camp cited this Belief
    if (attribution.attribution_confidence <= ATTRIBUTION_THRESHOLD) continue;

    const currentConf = belief.confidence ?? 0.5;
    const initialConf = initial_confidences.get(beliefId) ?? currentConf;
    const cappedDelta = applyDriftCap(currentConf, initialConf, CROSS_POV_DELTA);
    if (cappedDelta === 0) continue;

    const newValue = clampConfidence(currentConf + cappedDelta);
    const actualDelta = newValue - currentConf;
    if (Math.abs(actualDelta) < 0.001) continue;

    // Don't duplicate if already updated this belief
    if (updates.some(u => u.belief_id === beliefId)) continue;

    updates.push({
      belief_id: beliefId,
      reason: 'cross_pov',
      delta: actualDelta,
      new_value: newValue,
      debate_id,
      claim_id: node.id,
      requires_human_review: false,
    });
  }

  return updates;
}

// ── Priority updates ────────────────────────────────────

/**
 * Compute priority updates from reflection concessions.
 * Priority NEVER changes from debate outcomes alone — requires the camp's own reflection.
 */
export function computePriorityUpdates(
  concessions: { desire_id: string }[],
  cruxDesireIds: Set<string>,
  desires: Map<string, PovNode>,
  debate_id: string,
): PriorityUpdate[] {
  const updates: PriorityUpdate[] = [];

  // Concessions: reduce priority by 1
  for (const c of concessions) {
    const desire = desires.get(c.desire_id);
    if (!desire || desire.category !== 'Desires') continue;
    const current = desire.priority ?? 3;
    if (current <= 1) continue;

    updates.push({
      desire_id: c.desire_id,
      reason: 'reflection_concession',
      delta: -1,
      new_value: current - 1,
      debate_id,
    });
  }

  // Crux desires: increase priority by 1
  for (const id of cruxDesireIds) {
    const desire = desires.get(id);
    if (!desire || desire.category !== 'Desires') continue;
    // Don't double-update if concession already processed
    if (updates.some(u => u.desire_id === id)) continue;
    const current = desire.priority ?? 3;
    if (current >= 5) continue;

    updates.push({
      desire_id: id,
      reason: 'crux_of_disagreement',
      delta: 1,
      new_value: current + 1,
      debate_id,
    });
  }

  return updates;
}

// ── History retention ───────────────────────────────────

export interface PruneResult {
  node_id: string;
  pruned_count: number;
  earliest_pruned: string;
  net_delta_pruned: number;
}

/**
 * Prune confidence_history or priority_history to cap at HISTORY_MAX_ENTRIES
 * or HISTORY_MAX_AGE_MONTHS. Mutates the array in place.
 * Returns prune summary for audit.
 */
export function pruneHistory(
  nodeId: string,
  history: WeightHistoryEntry[],
  now: Date = new Date(),
): PruneResult | null {
  if (history.length <= HISTORY_MAX_ENTRIES) {
    // Check age-based pruning
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - HISTORY_MAX_AGE_MONTHS);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const oldEntries = history.filter(h => h.date < cutoffStr);
    if (oldEntries.length === 0) return null;

    const netDelta = oldEntries.reduce((sum, h) => sum + h.delta, 0);
    const earliest = oldEntries[0].date;
    const prunedCount = oldEntries.length;

    // Remove old entries
    const remaining = history.filter(h => h.date >= cutoffStr);
    history.length = 0;
    history.push(...remaining);

    return {
      node_id: nodeId,
      pruned_count: prunedCount,
      earliest_pruned: earliest,
      net_delta_pruned: Math.round(netDelta * 1000) / 1000,
    };
  }

  // Count-based pruning: keep the last HISTORY_MAX_ENTRIES
  const excess = history.length - HISTORY_MAX_ENTRIES;
  const pruned = history.splice(0, excess);
  const netDelta = pruned.reduce((sum, h) => sum + h.delta, 0);

  return {
    node_id: nodeId,
    pruned_count: pruned.length,
    earliest_pruned: pruned[0].date,
    net_delta_pruned: Math.round(netDelta * 1000) / 1000,
  };
}

// ── History entry builder ───────────────────────────────

/**
 * Build a WeightHistoryEntry from a confidence or priority update.
 */
export function buildEvolutionHistoryEntry(
  update: ConfidenceUpdate | PriorityUpdate,
  date: string,
): WeightHistoryEntry {
  const entry: WeightHistoryEntry = {
    date,
    value: update.new_value,
    delta: update.delta,
    reason: `Debate ${update.debate_id}: ${update.reason}`,
  };

  if ('attack_claim' in update && update.attack_claim) {
    entry.attack_claim = update.attack_claim;
  }

  return entry;
}

// ── Reflection proposal adapters ───────────────────────

import type { ReflectionProposal } from './types.js';

export function confidenceUpdatesToProposals(
  updates: ConfidenceUpdate[],
): ReflectionProposal[] {
  return updates.map(u => ({
    source: 'confidence_evolution' as const,
    node_id: u.belief_id,
    field: 'confidence' as const,
    delta: u.delta,
    new_value: u.new_value,
    reason: `${u.reason}${u.attack_claim ? ` — "${u.attack_claim}"` : ''}`,
    debate_id: u.debate_id,
    requires_human_review: u.requires_human_review,
    floor_violation: null,
    gate: u.gate ? { ...u.gate } : undefined,
  }));
}

export function priorityUpdatesToProposals(
  updates: PriorityUpdate[],
  doctrinalFloors?: Map<string, number>,
): ReflectionProposal[] {
  return updates.map(u => {
    const floor = doctrinalFloors?.get(u.desire_id);
    const violatesFloor = floor != null && u.new_value < floor;
    return {
      source: 'priority_evolution' as const,
      node_id: u.desire_id,
      field: 'priority' as const,
      delta: u.delta,
      new_value: u.new_value,
      reason: u.reason,
      debate_id: u.debate_id,
      requires_human_review: violatesFloor,
      floor_violation: violatesFloor ? { floor: floor!, raw_value: u.new_value } : null,
    };
  });
}
