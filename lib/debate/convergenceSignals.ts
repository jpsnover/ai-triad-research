// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type {
  PoverId,
  TranscriptEntry,
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  ConvergenceSignals,
} from './types';
import { wordOverlap, getMoveName, ATTACK_MOVES, SUPPORT_MOVES } from './helpers';
import type { MoveAnnotation } from './helpers';
import { computeQbafStrengths } from './qbaf';
import type { QbafNode, QbafEdge } from './qbaf';

export function computeConvergenceSignals(
  entryId: string,
  speaker: PoverId,
  transcript: TranscriptEntry[],
  nodes: ArgumentNetworkNode[],
  edges: ArgumentNetworkEdge[],
  existingSignals: ConvergenceSignals[],
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
  const priorSpeakerEntries = transcript.slice(0, entryIdx).filter(e => e.speaker === speaker);
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

  // 4. Strongest opposing argument — find the strongest attack against this speaker's nodes
  const speakerNodeIds = new Set(nodes.filter(n => n.speaker === speaker).map(n => n.id));
  const qbafNodes: QbafNode[] = nodes.map(n => ({ id: n.id, base_strength: n.base_strength ?? 0.5 }));
  const qbafEdges: QbafEdge[] = edges.map(e => ({
    source: e.source, target: e.target,
    type: e.type as 'attacks' | 'supports',
    weight: e.weight ?? 0.5,
    attack_type: e.attack_type,
  }));
  const strengths = computeQbafStrengths(qbafNodes, qbafEdges).strengths;

  let strongestOpposing: ConvergenceSignals['strongest_opposing'] = null;
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
  const priorDelta = existingSignals.filter(s => s.speaker === speaker).slice(-1)[0]?.position_delta;
  const drift = priorDelta ? Math.abs(overlapWithOpening - priorDelta.overlap_with_opening) : 0;

  // 7. Crux rate — did this turn use IDENTIFY-CRUX, and cumulative tracking
  const cruxUsedThisTurn = moveNames.some(m => {
    const upper = m.toUpperCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
    return upper === 'IDENTIFY CRUX' || upper === 'IDENTIFY-CRUX';
  });
  const priorCruxSignals = existingSignals.filter(s => s.speaker === speaker);
  const cumulativeCruxCount = priorCruxSignals.reduce((c, s) => c + (s.crux_rate.used_this_turn ? 1 : 0), 0) + (cruxUsedThisTurn ? 1 : 0);
  const priorFollowThrough = priorCruxSignals.length > 0
    ? priorCruxSignals[priorCruxSignals.length - 1].crux_rate.cumulative_follow_through
    : 0;
  const followedThroughThisTurn = cruxUsedThisTurn && collaborative > 0 ? 1 : 0;
  const cumulativeFollowThrough = priorFollowThrough + followedThroughThisTurn;

  return {
    entry_id: entryId,
    round,
    speaker,
    move_disposition: { confrontational, collaborative, ratio: moveRatio },
    engagement_depth: { targeted, standalone, ratio: engagementRatio },
    recycling_rate: { avg_self_overlap: avgSelfOverlap, max_self_overlap: maxSelfOverlap },
    strongest_opposing: strongestOpposing,
    concession_opportunity: { strong_attacks_faced: strongAttacksFaced, concession_used: concessionUsed, outcome: concessionOutcome },
    position_delta: { overlap_with_opening: overlapWithOpening, drift },
    crux_rate: { used_this_turn: cruxUsedThisTurn, cumulative_count: cumulativeCruxCount, cumulative_follow_through: cumulativeFollowThrough },
  };
}
