// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type {
  SpeakerId,
  DebatePhase,
  TranscriptEntry,
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  ConvergenceSignals,
  ProcessRewardEntry,
  TurnValidation,
  TrackedCrux,
} from './types.js';
import { wordOverlap, getMoveName, ATTACK_MOVES, SUPPORT_MOVES } from './helpers.js';
import type { MoveAnnotation } from './helpers.js';
import { computeQbafStrengths } from './qbaf.js';
import type { QbafNode, QbafEdge } from './qbaf.js';
import { cosineSimilarity } from './taxonomyRelevance.js';

export const SEMANTIC_RECYCLING_THRESHOLD = 0.85;
export const ARCO_DRIFT_THRESHOLD = 0.5;
/** Below this max-clause-similarity, the turn is considered to engage with
 *  no clause of the resolution — i.e., a candidate for redirect. */
export const CLAUSE_ENGAGEMENT_FLOOR = 0.45;

export function computeConvergenceSignals(
  entryId: string,
  speaker: SpeakerId,
  transcript: TranscriptEntry[],
  nodes: ArgumentNetworkNode[],
  edges: ArgumentNetworkEdge[],
  existingSignals: ConvergenceSignals[],
  turnEmbeddings?: Map<string, number[]>,
  precomputedStrengths?: Map<string, number>,
  topicEmbedding?: number[],
  clauseEmbeddings?: number[][],
  cruxTracker?: TrackedCrux[],
): ConvergenceSignals {
  const entryIdx = transcript.findIndex(e => e.id === entryId);
  const entry = transcript[entryIdx];
  const meta = entry?.metadata as Record<string, unknown> | undefined;
  const moveTypes: (string | MoveAnnotation)[] = (meta?.move_types as (string | MoveAnnotation)[]) ?? [];
  const moveNames = moveTypes.map(m => getMoveName(m));

  const round = entryIdx + 1;

  // 1. Move disposition — uses canonical ATTACK_MOVES / SUPPORT_MOVES from helpers.ts
  let confrontational = 0;
  let collaborative = 0;
  for (const m of moveNames) {
    const normalized = m.toUpperCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
    const hyphenated = normalized.replace(/ /g, '-');
    if (ATTACK_MOVES.has(normalized) || ATTACK_MOVES.has(hyphenated)) confrontational++;
    if (SUPPORT_MOVES.has(normalized) || SUPPORT_MOVES.has(hyphenated)) collaborative++;
  }
  const total = confrontational + collaborative;
  const moveRatio = total > 0 ? collaborative / total : 0;

  // 2. Engagement depth — targeted (edges from this turn's nodes to others) vs standalone
  const turnNodes = nodes.filter(n => n.source_entry_id === entryId);
  const turnNodeIds = new Set(turnNodes.map(n => n.id));
  let targeted = 0;
  let standalone = 0;
  for (const n of turnNodes) {
    const hasEdge = edges.some(e =>
      (e.source === n.id && !turnNodeIds.has(e.target)) ||
      (e.target === n.id && !turnNodeIds.has(e.source)),
    );
    if (hasEdge) targeted++;
    else standalone++;
  }
  const engagementRatio = (targeted + standalone) > 0 ? targeted / (targeted + standalone) : 0;

  // 3. Recycling rate — word overlap of this turn's content vs previous turns by same speaker
  const RECYCLING_LOOKBACK = 10;
  const allPriorSpeaker = transcript.slice(0, entryIdx).filter(e => e.speaker === speaker);
  const priorSpeakerEntries = allPriorSpeaker.slice(-RECYCLING_LOOKBACK);
  let avgSelfOverlap = 0;
  let maxSelfOverlap = 0;
  if (priorSpeakerEntries.length > 0 && entry) {
    let sumOverlap = 0;
    for (const prev of priorSpeakerEntries) {
      const o = wordOverlap(entry.content, prev.content);
      sumOverlap += o;
      if (o > maxSelfOverlap) maxSelfOverlap = o;
    }
    avgSelfOverlap = sumOverlap / priorSpeakerEntries.length;
  }

  // 3b. Semantic recycling — embedding-based similarity between same-speaker turns
  let semanticMaxSimilarity: number | undefined;
  let semanticallyRecycled: boolean | undefined;
  if (turnEmbeddings && entry) {
    const currentEmbed = turnEmbeddings.get(entryId);
    if (currentEmbed) {
      let maxSim = 0;
      for (const prev of priorSpeakerEntries) {
        const prevEmbed = turnEmbeddings.get(prev.id);
        if (prevEmbed) {
          const sim = cosineSimilarity(currentEmbed, prevEmbed);
          if (sim > maxSim) maxSim = sim;
        }
      }
      if (maxSim > 0) {
        semanticMaxSimilarity = maxSim;
        semanticallyRecycled = maxSim >= SEMANTIC_RECYCLING_THRESHOLD;
      }
    }
  }

  // 4. Strongest opposing argument — find the strongest attack against this speaker's nodes
  const speakerNodeIds = new Set(nodes.filter(n => n.speaker === speaker).map(n => n.id));
  let strengths: Map<string, number>;
  if (precomputedStrengths) {
    strengths = precomputedStrengths;
  } else {
    const qbafNodes: QbafNode[] = nodes.map(n => ({ id: n.id, base_strength: n.base_strength ?? 0.5 }));
    const qbafEdges: QbafEdge[] = edges.map(e => ({
      source: e.source, target: e.target,
      type: e.type as 'attacks' | 'supports',
      weight: e.weight ?? 0.5,
      attack_type: e.attack_type,
    }));
    strengths = computeQbafStrengths(qbafNodes, qbafEdges).strengths;
  }

  let strongestOpposing: ConvergenceSignals['dominant_counterargument'] = null;
  const attacksOnSpeaker = edges.filter(e => e.type === 'attacks' && speakerNodeIds.has(e.target));
  for (const atk of attacksOnSpeaker) {
    const s = strengths.get(atk.source) ?? 0.5;
    const attackerNode = nodes.find(n => n.id === atk.source);
    if (!strongestOpposing || s > strongestOpposing.strength) {
      strongestOpposing = {
        node_id: atk.source,
        strength: s,
        attacker: (attackerNode?.speaker as string) ?? 'unknown',
        bdi_category: attackerNode?.bdi_category,
      };
    }
  }

  // 5. Concession opportunity — did speaker face strong attacks and use a concession move?
  const strongAttacksFaced = attacksOnSpeaker.filter(e => (strengths.get(e.source) ?? 0.5) >= 0.6).length;
  const concessionUsed = moveNames.some(m => {
    const normalized = m.toUpperCase().replace(/[_]/g, '-').trim();
    return SUPPORT_MOVES.has(normalized) || SUPPORT_MOVES.has(normalized.replace(/-/g, ' '));
  });
  const concessionOutcome: ConvergenceSignals['concession_opportunity']['outcome'] =
    strongAttacksFaced === 0 ? 'none' : concessionUsed ? 'taken' : 'missed';

  // 6. Position delta — word overlap between this turn and speaker's opening statement
  const openingEntry = transcript.find(e => e.speaker === speaker && e.type === 'opening');
  const overlapWithOpening = (openingEntry && entry) ? wordOverlap(entry.content, openingEntry.content) : 0;
  const priorDelta = existingSignals.filter(s => s.speaker === speaker).slice(-1)[0]?.position_drift;
  const drift = priorDelta ? Math.abs(overlapWithOpening - priorDelta.overlap_with_opening) : 0;

  // 7. Crux rate — structural detection: did this turn's AN nodes engage any tracked crux?
  // A crux is "engaged this turn" if:
  //   (a) any of its attacking_claim_ids were produced in this entry, OR
  //   (b) a crux transitioned state at the current turn number, OR
  //   (c) any edge connects a turn node to a crux node (covers new attackers
  //       added after crux identification — attacking_claim_ids is frozen at
  //       identification time and misses later engagement).
  let cruxUsedThisTurn = false;
  if (cruxTracker && cruxTracker.length > 0) {
    const currentTurn = turnNodes.length > 0 ? turnNodes[0].turn_number : round;
    const cruxIds = new Set(cruxTracker.map(c => c.id));
    cruxUsedThisTurn = cruxTracker.some(crux =>
      crux.attacking_claim_ids.some(cid => turnNodeIds.has(cid)) ||
      crux.history.some(h => h.turn === currentTurn),
    ) || edges.some(e =>
      (turnNodeIds.has(e.source) && cruxIds.has(e.target)) ||
      (turnNodeIds.has(e.target) && cruxIds.has(e.source)),
    );
  }
  const priorCruxSignals = existingSignals.filter(s => s.speaker === speaker);
  const cumulativeCruxCount = priorCruxSignals.reduce((c, s) => c + (s.crux_engagement_rate.used_this_turn ? 1 : 0), 0) + (cruxUsedThisTurn ? 1 : 0);
  const priorFollowThrough = priorCruxSignals.length > 0
    ? priorCruxSignals[priorCruxSignals.length - 1].crux_engagement_rate.cumulative_follow_through
    : 0;
  const followedThroughThisTurn = cruxUsedThisTurn && collaborative > 0 ? 1 : 0;
  const cumulativeFollowThrough = priorFollowThrough + followedThroughThisTurn;

  // 8. ArCo (Argument Coherence) — semantic relevance to debate topic
  let arco: ConvergenceSignals['arco'];
  if (topicEmbedding && turnEmbeddings) {
    const currentEmbed = turnEmbeddings.get(entryId);
    if (currentEmbed) {
      const turnSimilarity = cosineSimilarity(currentEmbed, topicEmbedding);

      // Phase mean: find the current phase from the most recent transcript metadata
      const currentPhase = (meta?.debate_phase as string) ?? (meta?.phase as string);
      // Collect ArCo values from same-phase signals (all speakers)
      const samePhaseArcos: number[] = [];
      for (const sig of existingSignals) {
        if (sig.arco) {
          const sigEntry = transcript.find(e => e.id === sig.entry_id);
          const sigMeta = sigEntry?.metadata as Record<string, unknown> | undefined;
          const sigPhase = (sigMeta?.debate_phase as string) ?? (sigMeta?.phase as string);
          if (sigPhase === currentPhase || (!currentPhase && !sigPhase)) {
            samePhaseArcos.push(sig.arco.turn_similarity);
          }
        }
      }
      samePhaseArcos.push(turnSimilarity);
      const phaseMean = samePhaseArcos.reduce((a, b) => a + b, 0) / samePhaseArcos.length;

      arco = {
        turn_similarity: turnSimilarity,
        phase_mean: phaseMean,
        drift_warning: phaseMean < ARCO_DRIFT_THRESHOLD,
      };
    }
  }

  // 9. Clause coverage — which decomposed clause this turn most closely engages.
  let clauseCoverage: ConvergenceSignals['clause_coverage'];
  if (clauseEmbeddings && clauseEmbeddings.length > 0 && turnEmbeddings) {
    const currentEmbed = turnEmbeddings.get(entryId);
    if (currentEmbed) {
      let bestId: number | null = null;
      let bestSim = -Infinity;
      for (let i = 0; i < clauseEmbeddings.length; i++) {
        const sim = cosineSimilarity(currentEmbed, clauseEmbeddings[i]);
        if (sim > bestSim) {
          bestSim = sim;
          bestId = i;
        }
      }
      const noClauseEngaged = bestSim < CLAUSE_ENGAGEMENT_FLOOR;
      clauseCoverage = {
        best_clause_id: noClauseEngaged ? null : bestId,
        best_similarity: bestSim,
        no_clause_engaged: noClauseEngaged,
      };
    }
  }

  return {
    entry_id: entryId,
    round,
    speaker,
    move_polarity: { confrontational, collaborative, ratio: moveRatio },
    dialectical_engagement: { targeted, standalone, ratio: engagementRatio },
    argument_redundancy: { avg_self_overlap: avgSelfOverlap, max_self_overlap: maxSelfOverlap, semantic_max_similarity: semanticMaxSimilarity, semantically_recycled: semanticallyRecycled },
    dominant_counterargument: strongestOpposing,
    concession_opportunity: { strong_attacks_faced: strongAttacksFaced, concession_used: concessionUsed, outcome: concessionOutcome },
    position_drift: { overlap_with_opening: overlapWithOpening, drift },
    crux_engagement_rate: { used_this_turn: cruxUsedThisTurn, cumulative_count: cumulativeCruxCount, cumulative_follow_through: cumulativeFollowThrough },
    arco,
    clause_coverage: clauseCoverage,
  };
}

// ── Process reward computation (PRM) ─────────────────────
// Computes a continuous [0,1] per-turn quality score from convergence signals
// and turn validation grounding. This is the "process reward" in PRM terms:
// each debate turn is an intermediate reasoning step evaluated independently
// of the final debate outcome.

/** Default component weights for the process reward composite. */
export const PROCESS_REWARD_WEIGHTS = {
  engagement: 0.25,
  novelty: 0.25,
  consistency: 0.20,
  grounding: 0.15,
  move_quality: 0.15,
} as const;

export interface ProcessRewardInput {
  convergenceSignals: ConvergenceSignals;
  turnValidation: TurnValidation;
  phase: DebatePhase;
  /** Number of dialectical moves in this turn. */
  moveCount: number;
  /** Number of moves in the prior turn by the same speaker (for diversity). */
  priorMoveCount?: number;
  /** Number of taxonomy refs attached to this turn. */
  taxonomyRefCount: number;
}

/**
 * Compute a continuous process reward from convergence signals, turn
 * validation, and move metadata.
 *
 * Components (each in [0,1]):
 *  - engagement:    dialectical_engagement.ratio (are claims targeting prior arguments?)
 *  - novelty:       1 - argument_redundancy (is the turn saying something new?)
 *  - consistency:   concession coherence (did the debater concede when warranted?)
 *  - grounding:     taxonomy ref density, boosted by validation grounding pass
 *  - move_quality:  move diversity + phase-appropriate disposition
 */
export function computeProcessReward(input: ProcessRewardInput): { score: number; components: ProcessRewardEntry['components'] } {
  const w = PROCESS_REWARD_WEIGHTS;
  const sig = input.convergenceSignals;

  // 1. Engagement — ratio of targeted to standalone claims
  const engagement = sig.dialectical_engagement?.ratio ?? 0;

  // 2. Novelty — inverse of recycling rate (prefer semantic if available)
  const recycling = sig.argument_redundancy?.semantic_max_similarity
    ?? sig.argument_redundancy?.avg_self_overlap
    ?? 0;
  const novelty = Math.max(0, 1 - recycling);

  // 3. Consistency — concession coherence
  //    taken = 1.0 (conceded under pressure), missed = 0.3 (ignored strong attack),
  //    none = 0.7 (no pressure, neutral)
  const concessionOutcome = sig.concession_opportunity?.outcome ?? 'none';
  const consistency = concessionOutcome === 'taken' ? 1.0
    : concessionOutcome === 'missed' ? 0.3
    : 0.7;

  // 4. Grounding — taxonomy ref density clamped to [0,1], boosted if validation
  //    grounding dimension passed
  const refDensity = Math.min(1, input.taxonomyRefCount / 5);
  const groundingBoost = input.turnValidation.dimensions.grounding.pass ? 0.2 : 0;
  const grounding = Math.min(1, refDensity + groundingBoost);

  // 5. Move quality — phase-appropriate disposition + diversity bonus
  const moveRatio = sig.move_polarity?.ratio ?? 0.5;
  const phaseAppropriate = input.phase === 'concluding'
    ? moveRatio  // collaboration valued in concluding
    : input.phase === 'confrontation'
    ? 1 - moveRatio  // confrontation expected in confrontation
    : 0.5 + 0.5 * (moveRatio - 0.5);  // neutral in argumentation

  // Diversity bonus: having a different number of moves from prior turn
  const diversityBonus = input.priorMoveCount != null && input.moveCount !== input.priorMoveCount ? 0.1 : 0;
  const move_quality = Math.min(1, phaseAppropriate + diversityBonus);

  const score =
    w.engagement * engagement +
    w.novelty * novelty +
    w.consistency * consistency +
    w.grounding * grounding +
    w.move_quality * move_quality;

  return { score, components: { engagement, novelty, consistency, grounding, move_quality } };
}

// ── Anti-sycophancy: 3-tier uncertainty metric (t/26) ─────────────

/** Weights for the uncertainty composite. */
const UNCERTAINTY_WEIGHTS = {
  intra_agent: 0.30,
  inter_agent: 0.40,
  system_level: 0.30,
} as const;

/** Composite threshold above which agreement is considered suspicious. */
const COLLAPSE_THRESHOLD = 0.55;

export interface UncertaintyMetric {
  /** Self-contradiction score: agents attacking their own prior claims. */
  intra_agent: number;
  /** Premature agreement: all agents cooperative without genuine engagement. */
  inter_agent: number;
  /** Weak argumentation: low QBAF scores across the board. */
  system_level: number;
  /** Weighted composite of the three tiers. */
  composite: number;
  /** True when composite exceeds threshold AND agreement appears superficial. */
  collapse_warning: boolean;
}

/**
 * Compute a 3-tier uncertainty metric to detect premature consensus collapse.
 *
 * - Intra-agent: self-contradiction (same speaker's nodes attacking each other)
 * - Inter-agent: premature agreement (high support ratio + low engagement depth)
 * - System-level: weak arguments (low mean QBAF computed_strength)
 *
 * Uses only data already available in the convergence signal pipeline.
 */
export function computeUncertaintyMetric(
  nodes: readonly { id: string; speaker: string; computed_strength?: number; base_strength?: number }[],
  edges: readonly { source: string; target: string; type: 'supports' | 'attacks' }[],
  convergenceSignals: {
    argument_redundancy: { avg_self_overlap: number; semantic_max_similarity?: number };
    dialectical_engagement: { ratio: number };
    position_drift: { drift: number };
    concession_opportunity: { outcome: string; strong_attacks_faced: number };
  },
  phase: string,
): UncertaintyMetric {
  // Build speaker-to-nodes index
  const nodesBySpeaker = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.speaker === 'system' || n.speaker === 'document' || n.speaker === 'user') continue;
    if (!nodesBySpeaker.has(n.speaker)) nodesBySpeaker.set(n.speaker, []);
    nodesBySpeaker.get(n.speaker)!.push(n.id);
  }
  const speakerNodeSets = new Map<string, Set<string>>();
  for (const [sp, ids] of nodesBySpeaker) speakerNodeSets.set(sp, new Set(ids));

  // ── Tier 1: Intra-agent (self-contradiction) ──
  // Count edges where source and target belong to the same speaker
  let selfAttackCount = 0;
  let totalEdges = 0;
  for (const edge of edges) {
    totalEdges++;
    for (const [, nodeSet] of speakerNodeSets) {
      if (nodeSet.has(edge.source) && nodeSet.has(edge.target) && edge.type === 'attacks') {
        selfAttackCount++;
        break;
      }
    }
  }
  // Also factor in position drift: high drift = speaker diverging from own opening
  const driftContribution = Math.min(1, convergenceSignals.position_drift.drift * 2);
  const selfAttackRate = totalEdges > 0 ? selfAttackCount / totalEdges : 0;
  const intra_agent = Math.min(1, selfAttackRate * 3 + driftContribution * 0.3);

  // ── Tier 2: Inter-agent (premature agreement) ──
  // High support-to-attack ratio + low engagement depth = suspicious
  let supportEdges = 0;
  let attackEdges = 0;
  for (const edge of edges) {
    if (edge.type === 'supports') supportEdges++;
    else if (edge.type === 'attacks') attackEdges++;
  }
  const supportRatio = (supportEdges + attackEdges) > 0
    ? supportEdges / (supportEdges + attackEdges)
    : 0;
  const lowEngagement = 1 - convergenceSignals.dialectical_engagement.ratio;
  const highRecycling = convergenceSignals.argument_redundancy.semantic_max_similarity
    ?? convergenceSignals.argument_redundancy.avg_self_overlap;
  // Premature agreement = high support + low engagement + high recycling
  // In argumentation phase, this is more concerning than in concluding
  const phaseMultiplier = phase === 'argumentation' ? 1.2 : phase === 'confrontation' ? 1.5 : 0.6;
  const inter_agent = Math.min(1, (supportRatio * 0.4 + lowEngagement * 0.3 + highRecycling * 0.3) * phaseMultiplier);

  // ── Tier 3: System-level (weak QBAF) ──
  // Low mean computed_strength = arguments are superficial
  const debaterNodes = nodes.filter(n =>
    n.speaker !== 'system' && n.speaker !== 'document' && n.speaker !== 'user',
  );
  let meanStrength = 0.5;
  if (debaterNodes.length > 0) {
    const totalStrength = debaterNodes.reduce(
      (sum, n) => sum + (n.computed_strength ?? n.base_strength ?? 0.5), 0,
    );
    meanStrength = totalStrength / debaterNodes.length;
  }
  // Low strength = high system uncertainty. Also count fraction below 0.3
  const weakFraction = debaterNodes.length > 0
    ? debaterNodes.filter(n => (n.computed_strength ?? n.base_strength ?? 0.5) < 0.3).length / debaterNodes.length
    : 0;
  const system_level = Math.min(1, (1 - meanStrength) * 0.6 + weakFraction * 0.4);

  const composite =
    UNCERTAINTY_WEIGHTS.intra_agent * intra_agent +
    UNCERTAINTY_WEIGHTS.inter_agent * inter_agent +
    UNCERTAINTY_WEIGHTS.system_level * system_level;

  // Collapse warning: high uncertainty AND superficial agreement (high support ratio, low attacks)
  const collapse_warning = composite > COLLAPSE_THRESHOLD && supportRatio > 0.6;

  return { intra_agent, inter_agent, system_level, composite, collapse_warning };
}
