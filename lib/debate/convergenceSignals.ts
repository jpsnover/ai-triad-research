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
} from './types.js';
import { wordOverlap, getMoveName, ATTACK_MOVES, SUPPORT_MOVES } from './helpers.js';
import type { MoveAnnotation } from './helpers.js';
import { computeQbafStrengths } from './qbaf.js';
import type { QbafNode, QbafEdge } from './qbaf.js';
import { cosineSimilarity } from './taxonomyRelevance.js';

export const SEMANTIC_RECYCLING_THRESHOLD = 0.85;
export const ARCO_DRIFT_THRESHOLD = 0.5;

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

  // 7. Crux rate — did this turn use IDENTIFY-CRUX, and cumulative tracking
  const cruxUsedThisTurn = moveNames.some(m => {
    const upper = m.toUpperCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
    return upper === 'IDENTIFY CRUX' || upper === 'IDENTIFY-CRUX';
  });
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
