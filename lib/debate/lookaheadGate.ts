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
import { computeAgentUtility } from './agentUtility.js';
import type { AgentUtility } from './agentUtility.js';

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
  /** Indices of tentative claims identified as concessions (exempted from gate delta). */
  concession_indices?: number[];
}

export interface LookaheadDiagnostics {
  /** Stage identifier for StageDiagnostics compatibility. */
  stage: 'lookahead';
  /** First attempt result. */
  first_attempt: LookaheadGateResult;
  /** Whether regeneration was triggered. */
  regen_triggered: boolean;
  /** @deprecated Use regen_attempts[0] instead. Kept for backwards compat with existing debate files. */
  regen_attempt?: LookaheadGateResult;
  /** All regen attempt results in order (empty if no regen triggered). */
  regen_attempts?: LookaheadGateResult[];
  /** Per-claim marginal utility analysis (v2). One entry per retry attempt, indexed same as regen_attempts. */
  per_claim_analysis?: { perClaim: PerClaimResult[]; analysis: ClaimAnalysis }[];
  /** Final pass status (true if any attempt passed). */
  final_pass: boolean;
  /** Total wall-clock time for the lookahead evaluation (ms). */
  elapsed_ms: number;
  /** Texts of WEAK-classified claims filtered before AN commit (t/459). */
  filtered_weak_claims?: string[];
}

// ── Constants ─────────────────────────────────────────────

/** Default utility delta threshold. Allows micro-negative moves (defensive responses,
 *  clarifying claims) that are strategically neutral but don't strictly improve composite
 *  utility. At 0.0, ~47% of moves triggered regen in a 30-round debate (t/588). */
const DEFAULT_THRESHOLD = -0.01;

// ── Concession detection ──────────────────────────────────

/**
 * A tentative claim is a concession when it has a `supports` edge from the
 * speaker's new claim to an opponent's existing node. This identifies
 * intellectual honesty moves (CONCEDE-AND-PIVOT) that should not penalize
 * the utility delta.
 */
function isConcessionClaim(
  claimNodeId: string,
  speaker: SpeakerId,
  tentativeEdges: readonly ArgumentNetworkEdge[],
  existingNodes: readonly ArgumentNetworkNode[],
): boolean {
  return tentativeEdges.some(e =>
    e.source === claimNodeId &&
    e.type === 'supports' &&
    existingNodes.some(n => n.id === e.target && n.speaker !== speaker && n.speaker !== 'system' && n.speaker !== 'document')
  );
}

// ── Core evaluation ───────────────────────────────────────

/**
 * Evaluate a set of tentative claims against the current argument network.
 *
 * Pure function — does not mutate the existing network. Creates a temporary
 * copy with the tentative claims added, runs QBAF, and computes utility delta.
 *
 * Concession claims (supports edges to opponent nodes) are exempted from
 * the gate delta to avoid penalizing intellectual honesty.
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
  const allTentativeEdges = [...input.existingEdges, ...input.tentativeEdges];

  // Identify concession claims — supports edges to opponent nodes
  const tentativeNodeIds = buildTentativeNodeIds(input.existingNodes, input.tentativeClaims);
  const concessionIndices: number[] = [];
  for (let i = 0; i < input.tentativeClaims.length; i++) {
    if (isConcessionClaim(tentativeNodeIds[i], input.speaker, input.tentativeEdges as ArgumentNetworkEdge[], input.existingNodes as ArgumentNetworkNode[])) {
      concessionIndices.push(i);
    }
  }

  // Gate-evaluation network: exclude concession nodes and their edges
  // so concessions don't penalize the delta. The full network is still
  // used for the actual argument network (concessions are real moves).
  let utility_after: AgentUtility;
  if (concessionIndices.length > 0 && concessionIndices.length === input.tentativeClaims.length) {
    // All claims are concessions — nothing to gate. Delta is 0, pass.
    utility_after = utility_before;
  } else if (concessionIndices.length > 0) {
    const concessionNodeIds = new Set(concessionIndices.map(i => tentativeNodeIds[i]));
    const gateClaims = input.tentativeClaims.filter((_, i) => !concessionIndices.includes(i));
    const gateEdges = input.tentativeEdges.filter(
      e => !concessionNodeIds.has(e.source) && !concessionNodeIds.has(e.target),
    );
    const gateNodes = buildTentativeNodes(input.existingNodes, gateClaims, input.speaker);
    const gateAllEdges = [...input.existingEdges, ...gateEdges];
    const gateStrengths = runQbaf(gateNodes, gateAllEdges, input.qbafOptions);
    const gateWithStrengths = applyStrengths(gateNodes, gateStrengths);
    const augmentedCruxes = augmentCruxesForTentative(
      input.cruxes, gateEdges as ArgumentNetworkEdge[], gateNodes, input.speaker,
    );
    utility_after = computeAgentUtility(
      input.speaker,
      gateWithStrengths,
      gateAllEdges as ArgumentNetworkEdge[],
      augmentedCruxes,
    );
  } else {
    // No concessions (or all concessions) — use full tentative network
    const tentativeStrengths = runQbaf(tentativeNodes, allTentativeEdges, input.qbafOptions);
    const tentativeWithStrengths = applyStrengths(tentativeNodes, tentativeStrengths);
    const augmentedCruxes = augmentCruxesForTentative(
      input.cruxes, input.tentativeEdges, tentativeNodes, input.speaker,
    );
    utility_after = computeAgentUtility(
      input.speaker,
      tentativeWithStrengths,
      allTentativeEdges as ArgumentNetworkEdge[],
      augmentedCruxes,
    );
  }

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
      edges: allTentativeEdges.length,
    },
    concession_indices: concessionIndices.length > 0 ? concessionIndices : undefined,
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

// ── Per-claim marginal utility (v2) ───────────────────────

export interface ClaimEdgeContext {
  type: 'supports' | 'attacks';
  target_id: string;
  target_text: string;
  target_speaker: SpeakerId;
  is_own: boolean;
}

export interface PerClaimResult {
  /** Index in the original tentativeClaims array. */
  index: number;
  /** Claim text. */
  text: string;
  /** Base strength assigned during extraction. */
  base_strength: number;
  /** Marginal utility delta: utility(all claims) − utility(all claims except this one). */
  marginal_delta: number;
  /** Classification based on marginal contribution. PRESERVE = concession claim exempted from gate. */
  classification: 'STRONG' | 'WEAK' | 'PRESERVE';
  /** Which utility component this claim impacts most (for reason generation). */
  dominant_component: 'position_strength' | 'attack_effectiveness' | 'crux_engagement';
  /** Edges connecting this claim to existing argument network nodes. */
  edges_context?: ClaimEdgeContext[];
}

export interface ClaimAnalysisItem {
  /** Claim text. */
  text: string;
  /** Base strength from extraction scoring. */
  base_strength: number;
  /** Marginal utility delta. */
  marginal_delta: number;
  /** Human-readable reason for the classification. */
  reason: string;
}

export interface ClaimAnalysis {
  /** Claims with positive marginal utility — "base your argument on these." */
  strongFoundations: ClaimAnalysisItem[];
  /** Claims with negative marginal utility — "do not use these." */
  avoidClaims: ClaimAnalysisItem[];
  /** Concession claims exempted from the gate — "keep these in your revised response." */
  preserveConcessions: ClaimAnalysisItem[];
}

/**
 * Evaluate each tentative claim's marginal utility contribution.
 *
 * For each claim, computes utility with all claims vs utility without that
 * specific claim. The difference is the claim's marginal Δu — positive means
 * the claim helps, negative means it hurts.
 *
 * Performance: O(n) QBAF evaluations where n = number of tentative claims.
 * For 3-6 claims on a 100-node network, ~30-60ms.
 */
export function evaluateLookaheadPerClaim(input: LookaheadGateInput): {
  batchResult: LookaheadGateResult;
  perClaim: PerClaimResult[];
} {
  // First, compute the batch result (all claims together)
  const batchResult = evaluateLookahead(input);

  if (input.tentativeClaims.length === 0) {
    return { batchResult, perClaim: [] };
  }

  // For single claim, check concession first, then use batch delta
  if (input.tentativeClaims.length === 1) {
    const claim = input.tentativeClaims[0];
    const singleNodeIds = buildTentativeNodeIds(input.existingNodes, input.tentativeClaims);
    const isConcession = isConcessionClaim(singleNodeIds[0], input.speaker, input.tentativeEdges as ArgumentNetworkEdge[], input.existingNodes as ArgumentNetworkNode[]);
    if (isConcession) {
      return {
        batchResult,
        perClaim: [{
          index: 0,
          text: claim.text,
          base_strength: claim.base_strength,
          marginal_delta: 0,
          classification: 'PRESERVE',
          dominant_component: 'position_strength',
        }],
      };
    }
    const dominant = identifyDominantComponent(batchResult.utility_before, batchResult.utility_after);
    return {
      batchResult,
      perClaim: [{
        index: 0,
        text: claim.text,
        base_strength: claim.base_strength,
        marginal_delta: batchResult.utility_delta,
        classification: batchResult.utility_delta >= 0 ? 'STRONG' : 'WEAK',
        dominant_component: dominant,
      }],
    };
  }

  // Build tentative node IDs so we can map claims to edges
  const tentativeNodeIds = buildTentativeNodeIds(input.existingNodes, input.tentativeClaims);

  // Identify concession claims upfront
  const concessionSet = new Set<number>();
  for (let i = 0; i < input.tentativeClaims.length; i++) {
    if (isConcessionClaim(tentativeNodeIds[i], input.speaker, input.tentativeEdges as ArgumentNetworkEdge[], input.existingNodes as ArgumentNetworkNode[])) {
      concessionSet.add(i);
    }
  }

  const perClaim: PerClaimResult[] = [];

  for (let i = 0; i < input.tentativeClaims.length; i++) {
    // Concession claims are classified PRESERVE regardless of marginal delta
    if (concessionSet.has(i)) {
      perClaim.push({
        index: i,
        text: input.tentativeClaims[i].text,
        base_strength: input.tentativeClaims[i].base_strength,
        marginal_delta: 0, // Neutral — concessions are exempted
        classification: 'PRESERVE',
        dominant_component: 'position_strength',
      });
      continue;
    }

    // Leave-one-out: all claims except claim[i]
    const claimsWithout = input.tentativeClaims.filter((_, j) => j !== i);
    const excludedNodeId = tentativeNodeIds[i];

    // Filter edges: remove any edge touching the excluded node
    const edgesWithout = input.tentativeEdges.filter(
      e => e.source !== excludedNodeId && e.target !== excludedNodeId,
    );

    const withoutResult = evaluateLookahead({
      ...input,
      tentativeClaims: claimsWithout,
      tentativeEdges: edgesWithout,
    });

    // Marginal delta = utility(all) - utility(all except this one)
    const marginal_delta = batchResult.utility_after.composite - withoutResult.utility_after.composite;

    const dominant = identifyDominantComponent(withoutResult.utility_after, batchResult.utility_after);

    const nodeId = tentativeNodeIds[i];
    const nodeMap = new Map(input.existingNodes.map(n => [n.id, n]));
    const edgesContext: ClaimEdgeContext[] = (input.tentativeEdges as ArgumentNetworkEdge[])
      .filter(e => e.source === nodeId || e.target === nodeId)
      .map(e => {
        const isSource = e.source === nodeId;
        const targetId = isSource ? e.target : e.source;
        const targetNode = nodeMap.get(targetId);
        return {
          type: e.type as 'supports' | 'attacks',
          target_id: targetId,
          target_text: targetNode?.text ?? targetId,
          target_speaker: (targetNode?.speaker ?? 'unknown') as SpeakerId,
          is_own: targetNode?.speaker === input.speaker,
        };
      });

    perClaim.push({
      index: i,
      text: input.tentativeClaims[i].text,
      base_strength: input.tentativeClaims[i].base_strength,
      marginal_delta,
      classification: marginal_delta >= 0 ? 'STRONG' : 'WEAK',
      dominant_component: dominant,
      edges_context: edgesContext,
    });
  }

  return { batchResult, perClaim };
}

/**
 * Generate human-readable claim analysis from per-claim results.
 * Produces `strongFoundations` and `avoidClaims` arrays with natural
 * strategic guidance, not raw metric dumps.
 */
export function buildClaimAnalysis(perClaim: PerClaimResult[]): ClaimAnalysis {
  const strongFoundations: ClaimAnalysisItem[] = [];
  const avoidClaims: ClaimAnalysisItem[] = [];
  const preserveConcessions: ClaimAnalysisItem[] = [];

  for (const claim of perClaim) {
    const item: ClaimAnalysisItem = {
      text: claim.text,
      base_strength: claim.base_strength,
      marginal_delta: claim.marginal_delta,
      reason: generateClaimReason(claim),
    };

    if (claim.classification === 'PRESERVE') {
      preserveConcessions.push(item);
    } else if (claim.classification === 'STRONG') {
      strongFoundations.push(item);
    } else {
      avoidClaims.push(item);
    }
  }

  // Sort strong by delta descending, weak by delta ascending (most harmful first)
  strongFoundations.sort((a, b) => b.marginal_delta - a.marginal_delta);
  avoidClaims.sort((a, b) => a.marginal_delta - b.marginal_delta);

  return { strongFoundations, avoidClaims, preserveConcessions };
}

/** Identify which utility component changed most between two evaluations. */
function identifyDominantComponent(
  before: AgentUtility,
  after: AgentUtility,
): 'position_strength' | 'attack_effectiveness' | 'crux_engagement' {
  const deltas = [
    { name: 'position_strength' as const, delta: Math.abs(after.position_strength - before.position_strength) },
    { name: 'attack_effectiveness' as const, delta: Math.abs(after.attack_effectiveness - before.attack_effectiveness) },
    { name: 'crux_engagement' as const, delta: Math.abs(after.crux_engagement - before.crux_engagement) },
  ];
  return deltas.reduce((a, b) => a.delta >= b.delta ? a : b).name;
}

function truncateClaimText(text: string, max = 60): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

function describeEdgeImpact(edges: ClaimEdgeContext[] | undefined, filter: (e: ClaimEdgeContext) => boolean): string {
  if (!edges) return '';
  const matched = edges.filter(filter);
  if (matched.length === 0) return '';
  const first = matched[0];
  const verb = first.type === 'attacks' ? 'attacks' : 'supports';
  const owner = first.is_own ? 'your own' : 'opposing';
  const label = truncateClaimText(first.target_text);
  const extra = matched.length > 1 ? ` (and ${matched.length - 1} other${matched.length > 2 ? 's' : ''})` : '';
  return ` — ${verb} ${owner} claim "${label}"${extra}`;
}

/** Generate a human-readable reason for a claim's classification. */
function generateClaimReason(claim: PerClaimResult): string {
  const edges = claim.edges_context;

  if (claim.classification === 'PRESERVE') {
    return 'Concession to opponent — intellectual honesty that advances wisdom generation.';
  }
  if (claim.classification === 'STRONG') {
    if (claim.base_strength >= 0.8) {
      if (claim.dominant_component === 'crux_engagement') {
        return 'Directly engages a core crux — high-impact move that advances the debate.';
      }
      if (claim.dominant_component === 'attack_effectiveness') {
        const detail = describeEdgeImpact(edges, e => e.type === 'attacks' && !e.is_own);
        return `Effective attack on opposing position${detail || ' — weakens their strongest arguments'}.`;
      }
      return 'Strong declarative claim — anchors your position with high specificity.';
    }
    if (claim.dominant_component === 'crux_engagement') {
      return 'Engages an active crux — keeps the debate focused on key disagreements.';
    }
    if (claim.dominant_component === 'attack_effectiveness') {
      const detail = describeEdgeImpact(edges, e => e.type === 'attacks' && !e.is_own);
      return `Targets an opposing weak point${detail || ' — useful for shifting the balance'}.`;
    }
    return 'Concrete mechanism or evidence — advances the debate with actionable specificity.';
  }

  // WEAK claim reasons
  if (claim.base_strength < 0.3) {
    return 'Too vague to anchor your position — low specificity dilutes otherwise strong claims.';
  }
  if (claim.dominant_component === 'position_strength' && claim.marginal_delta < -0.005) {
    const selfAttacks = describeEdgeImpact(edges, e => e.type === 'attacks' && e.is_own);
    if (selfAttacks) {
      return `Undermines your own position${selfAttacks}, reducing network coherence by ${Math.abs(claim.marginal_delta * 100).toFixed(1)}%.`;
    }
    const selfSupports = edges?.filter(e => e.type === 'supports' && e.is_own) ?? [];
    if (selfSupports.length === 0 && edges && edges.length > 0) {
      const detail = describeEdgeImpact(edges, () => true);
      return `Undermines your own position${detail} — introduces tension without strengthening your network (Δu ${(claim.marginal_delta * 100).toFixed(1)}%).`;
    }
    return `Undermines your own position — weakens argument network coherence (Δu ${(claim.marginal_delta * 100).toFixed(1)}%).`;
  }
  if (claim.dominant_component === 'attack_effectiveness') {
    const detail = describeEdgeImpact(edges, e => e.type === 'attacks' && !e.is_own);
    return `Ineffective attack${detail || ' — targets a well-defended position'} without sufficient support.`;
  }
  if (claim.dominant_component === 'crux_engagement') {
    return 'Avoids the core cruxes — tangential argument that distracts from key disagreements.';
  }
  if (claim.marginal_delta < -0.005) {
    const detail = describeEdgeImpact(edges, () => true);
    return `Weakens overall position${detail} — the cost of this claim outweighs its contribution (Δu ${(claim.marginal_delta * 100).toFixed(1)}%).`;
  }
  return 'Marginal contribution — this claim adds little strategic value to your position.';
}

/** Build the tentative node IDs that would be created for the given claims. */
function buildTentativeNodeIds(
  existingNodes: readonly ArgumentNetworkNode[],
  claims: readonly LookaheadTentativeClaim[],
): string[] {
  const startId = existingNodes.length > 0
    ? Math.max(...existingNodes.map(n => {
        const match = n.id.match(/^AN-(\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
      })) + 1
    : 1;
  return claims.map((_, i) => `AN-${startId + i}`);
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
  const qEdges = edges
    .filter(e => e.type === 'supports' || e.type === 'attacks')
    .map(e => ({
      source: e.source,
      target: e.target,
      type: e.type as 'supports' | 'attacks',
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
