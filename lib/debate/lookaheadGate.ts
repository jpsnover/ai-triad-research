// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * One-step move-quality lookahead gate for the debate pipeline.
 *
 * After the LLM generates a draft turn and claims are extracted:
 * 1. Tentatively add extracted claims to the argument network.
 * 2. Run QBAF propagation on the tentative graph.
 * 3. Compute utility delta: Δu = utility_after − utility_before.
 * 4. If Δu < threshold → signal regeneration with adjusted hint (1 retry max).
 * 5. If retry also fails → commit anyway + log low_utility_turn event.
 *
 * Reference: t/21 — "Add one-step move-quality lookahead to debate pipeline"
 * Based on: game-theory-layer4-integration.md §3.3
 */

import type {
  SpeakerId,
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  TrackedCrux,
} from './types.js';
import { computeQbafStrengths } from './qbaf.js';
import type { QbafOptions } from './qbaf.js';
import { computeAgentUtility } from './calibrationLogger.js';
import type { AgentUtility } from './calibrationLogger.js';

// ── Types ─────────────────────────────────────────────────

export interface LookaheadTentativeClaim {
  /** Claim text. */
  text: string;
  /** Tentative QBAF base strength. */
  base_strength: number;
}

export interface LookaheadGateInput {
  /** Speaker whose draft is being evaluated. */
  speaker: SpeakerId;
  /** Current argument network nodes (before this turn). */
  existingNodes: readonly ArgumentNetworkNode[];
  /** Current argument network edges (before this turn). */
  existingEdges: readonly ArgumentNetworkEdge[];
  /** Claims extracted from the draft (tentative — not yet committed). */
  tentativeClaims: LookaheadTentativeClaim[];
  /** Tentative edges that would connect the new claims to existing nodes. */
  tentativeEdges: readonly ArgumentNetworkEdge[];
  /** Active cruxes for utility computation. */
  cruxes?: readonly TrackedCrux[];
  /** QBAF options override. */
  qbafOptions?: QbafOptions;
  /** Utility delta threshold below which the gate fails. Default: 0.0 (any positive delta passes). */
  threshold?: number;
}

export interface LookaheadGateResult {
  /** Whether the gate passed (utility improved enough). */
  pass: boolean;
  /** Utility score before tentative claims. */
  utility_before: AgentUtility;
  /** Utility score after tentative claims. */
  utility_after: AgentUtility;
  /** Composite utility delta: after − before. */
  utility_delta: number;
  /** The configured threshold. */
  threshold: number;
  /** Tentative claims that were evaluated. */
  tentative_claims: { text: string; strength: number }[];
  /** Size of the tentative network (after adding claims). */
  tentative_network_size: { nodes: number; edges: number };
}

export interface LookaheadDiagnostics {
  /** Stage identifier for StageDiagnostics compatibility. */
  stage: 'lookahead';
  /** First attempt result. */
  first_attempt: LookaheadGateResult;
  /** Whether regeneration was triggered. */
  regen_triggered: boolean;
  /** Second attempt result (only if regen triggered). */
  regen_attempt?: LookaheadGateResult;
  /** Final pass status (true if either attempt passed). */
  final_pass: boolean;
  /** Total wall-clock time for the lookahead evaluation (ms). */
  elapsed_ms: number;
}

// ── Constants ─────────────────────────────────────────────

/** Default utility delta threshold. Any non-negative delta passes. */
const DEFAULT_THRESHOLD = 0.0;

// ── Core evaluation ───────────────────────────────────────

/**
 * Evaluate a set of tentative claims against the current argument network.
 *
 * Pure function — does not mutate the existing network. Creates a temporary
 * copy with the tentative claims added, runs QBAF, and computes utility delta.
 *
 * Performance: one extra QBAF propagation per call. For a 100-node network
 * this takes <10ms — negligible compared to LLM call latency.
 */
export function evaluateLookahead(input: LookaheadGateInput): LookaheadGateResult {
  const threshold = input.threshold ?? DEFAULT_THRESHOLD;

  // Compute baseline utility (existing network)
  const baselineStrengths = runQbaf(input.existingNodes, input.existingEdges, input.qbafOptions);
  const nodesWithStrengths = applyStrengths(input.existingNodes, baselineStrengths);
  const utility_before = computeAgentUtility(
    input.speaker,
    nodesWithStrengths,
    input.existingEdges as ArgumentNetworkEdge[],
    input.cruxes as TrackedCrux[] | undefined,
  );

  // Build tentative network: existing + new claims
  const tentativeNodes = buildTentativeNodes(
    input.existingNodes, input.tentativeClaims, input.speaker,
  );
  const tentativeEdges = [...input.existingEdges, ...input.tentativeEdges];

  // Compute tentative utility — augment crux tracker so new claims that
  // attack/support crux nodes are reflected in crux_engagement scoring.
  const tentativeStrengths = runQbaf(tentativeNodes, tentativeEdges, input.qbafOptions);
  const tentativeWithStrengths = applyStrengths(tentativeNodes, tentativeStrengths);
  const augmentedCruxes = augmentCruxesForTentative(
    input.cruxes, input.tentativeEdges, tentativeNodes, input.speaker,
  );
  const utility_after = computeAgentUtility(
    input.speaker,
    tentativeWithStrengths,
    tentativeEdges as ArgumentNetworkEdge[],
    augmentedCruxes,
  );

  const utility_delta = utility_after.composite - utility_before.composite;

  return {
    pass: utility_delta >= threshold,
    utility_before,
    utility_after,
    utility_delta,
    threshold,
    tentative_claims: input.tentativeClaims.map(c => ({
      text: c.text,
      strength: c.base_strength,
    })),
    tentative_network_size: {
      nodes: tentativeNodes.length,
      edges: tentativeEdges.length,
    },
  };
}

/**
 * Build a hint string for regeneration when the lookahead gate fails.
 * Injects the specific utility component breakdown so the LLM knows
 * which aspects of its move were weak, not just the composite delta.
 */
export function buildRegenHint(result: LookaheadGateResult): string {
  const parts = [
    `Your draft was evaluated for strategic quality and scored below threshold.`,
    `Utility delta: ${result.utility_delta.toFixed(3)} (threshold: ${result.threshold.toFixed(3)}).`,
  ];

  // Surface per-component breakdown so the LLM can target its weakness
  const before = result.utility_before;
  const after = result.utility_after;
  const components: { name: string; before: number; after: number; delta: number }[] = [
    { name: 'position_strength', before: before.position_strength, after: after.position_strength, delta: after.position_strength - before.position_strength },
    { name: 'attack_effectiveness', before: before.attack_effectiveness, after: after.attack_effectiveness, delta: after.attack_effectiveness - before.attack_effectiveness },
    { name: 'crux_engagement', before: before.crux_engagement, after: after.crux_engagement, delta: after.crux_engagement - before.crux_engagement },
  ];
  parts.push(`Component breakdown (before → after, Δ):`);
  for (const c of components) {
    const arrow = c.delta < 0 ? '↓' : c.delta > 0 ? '↑' : '→';
    parts.push(`  ${c.name}: ${c.before.toFixed(3)} → ${c.after.toFixed(3)} (${arrow}${Math.abs(c.delta).toFixed(3)})`);
  }

  // Identify the weakest component and give targeted advice
  const worst = components.reduce((a, b) => a.delta < b.delta ? a : b);

  if (result.utility_delta < 0) {
    parts.push(
      `Your claims would weaken your position. The biggest drop is in ${worst.name}.`,
    );
    if (worst.name === 'position_strength') {
      parts.push(`- Your claims may be self-undermining or too easily attacked. Make stronger, better-supported assertions.`);
    } else if (worst.name === 'attack_effectiveness') {
      parts.push(`- Your attacks are not landing effectively. Target specific weak points in opposing arguments (nodes below 0.3 strength).`);
    } else {
      parts.push(`- You are not engaging with the core cruxes. Address an active crux directly rather than tangential points.`);
    }
  } else {
    parts.push(
      `Your claims add marginal value. The weakest component is ${worst.name}.`,
    );
    if (worst.name === 'position_strength') {
      parts.push(`- Make more specific, falsifiable claims rather than broad assertions.`);
    } else if (worst.name === 'attack_effectiveness') {
      parts.push(`- Directly challenge the strongest opposing argument instead of adding new unsupported claims.`);
    } else {
      parts.push(`- Address an unresolved crux to maximize impact rather than opening new fronts.`);
    }
  }

  return parts.join('\n');
}

// ── Helpers ───────────────────────────────────────────────

function runQbaf(
  nodes: readonly ArgumentNetworkNode[],
  edges: readonly (ArgumentNetworkEdge | { source: string; target: string; type: 'supports' | 'attacks'; weight?: number })[],
  options?: QbafOptions,
): Map<string, number> {
  const qNodes = nodes.map(n => ({
    id: n.id,
    base_strength: n.base_strength ?? 0.5,
  }));
  const qEdges = edges.map(e => ({
    source: e.source,
    target: e.target,
    type: e.type,
    weight: e.weight ?? 0.5,
    attack_type: (e as ArgumentNetworkEdge).attack_type,
  }));
  return computeQbafStrengths(qNodes, qEdges, options).strengths;
}

function applyStrengths(
  nodes: readonly ArgumentNetworkNode[],
  strengths: Map<string, number>,
): ArgumentNetworkNode[] {
  return nodes.map(n => ({
    ...n,
    computed_strength: strengths.get(n.id) ?? n.computed_strength ?? n.base_strength ?? 0.5,
  }));
}

/**
 * Augment crux tracker entries so that tentative edges targeting crux nodes
 * are reflected in crux_engagement scoring. Without this, crux_engagement
 * is identical before/after because the frozen tracker doesn't know about
 * the new claims' relationships to crux nodes.
 */
function augmentCruxesForTentative(
  cruxes: readonly TrackedCrux[] | undefined,
  tentativeEdges: readonly ArgumentNetworkEdge[],
  tentativeNodes: readonly ArgumentNetworkNode[],
  speaker: SpeakerId,
): TrackedCrux[] | undefined {
  if (!cruxes || cruxes.length === 0) return cruxes as TrackedCrux[] | undefined;

  const cruxIds = new Set(cruxes.map(c => c.id));

  // Find tentative edges that attack or support crux nodes
  const tentativeEdgesToCruxes = tentativeEdges.filter(e =>
    cruxIds.has(e.target) || cruxIds.has(e.source),
  );
  if (tentativeEdgesToCruxes.length === 0) return cruxes as TrackedCrux[] | undefined;

  // Build a set of tentative node IDs owned by this speaker
  const speakerTentativeIds = new Set(
    tentativeNodes.filter(n => n.speaker === speaker && n.source_entry_id === 'tentative').map(n => n.id),
  );

  return cruxes.map(crux => {
    // Check if any tentative edge connects a speaker's tentative node to this crux
    const engagesCrux = tentativeEdgesToCruxes.some(e => {
      const sourceIsSpeaker = speakerTentativeIds.has(e.source);
      const targetIsSpeaker = speakerTentativeIds.has(e.target);
      return (sourceIsSpeaker && e.target === crux.id) || (targetIsSpeaker && e.source === crux.id);
    });

    if (!engagesCrux) return crux;

    // Augment: add speaker to speakers_involved and tentative node IDs to attacking_claim_ids
    const newAttackIds = tentativeEdgesToCruxes
      .filter(e => e.target === crux.id && speakerTentativeIds.has(e.source))
      .map(e => e.source);

    return {
      ...crux,
      speakers_involved: crux.speakers_involved.includes(speaker)
        ? crux.speakers_involved
        : [...crux.speakers_involved, speaker],
      attacking_claim_ids: [...crux.attacking_claim_ids, ...newAttackIds],
    };
  });
}

function buildTentativeNodes(
  existing: readonly ArgumentNetworkNode[],
  claims: LookaheadTentativeClaim[],
  speaker: SpeakerId,
): ArgumentNetworkNode[] {
  const startId = existing.length > 0
    ? Math.max(...existing.map(n => {
        const match = n.id.match(/^AN-(\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
      })) + 1
    : 1;

  const newNodes: ArgumentNetworkNode[] = claims.map((claim, i) => ({
    id: `AN-${startId + i}`,
    text: claim.text,
    speaker,
    source_entry_id: 'tentative',
    taxonomy_refs: [],
    turn_number: 0,
    base_strength: claim.base_strength,
  }));

  return [...existing, ...newNodes];
}
