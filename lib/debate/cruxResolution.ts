// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type {
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  CommitmentStore,
  TrackedCrux,
  CruxResolutionState,
  CruxStateTransition,
  ArgumentationScheme,
} from './types.js';
import { detectCruxNodes } from './phaseTransitions.js';

const POLARITY_RESOLVED_THRESHOLD = 0.85;
const STRENGTH_CONCESSION_THRESHOLD = 0.3;
const IRREDUCIBLE_STABLE_TURNS = 3;
const POLARITY_STABILITY_EPSILON = 0.05;

export function computeCruxPolarity(
  cruxNodeId: string,
  nodes: ReadonlyArray<ArgumentNetworkNode>,
  edges: ReadonlyArray<ArgumentNetworkEdge>,
): number {
  const cruxNode = nodes.find(n => n.id === cruxNodeId);
  if (!cruxNode) return 0.5;

  const cruxSpeaker = cruxNode.speaker;
  const crossPovEdges = edges.filter(e => {
    if (e.target !== cruxNodeId && e.source !== cruxNodeId) return false;
    const otherId = e.source === cruxNodeId ? e.target : e.source;
    const otherNode = nodes.find(n => n.id === otherId);
    return otherNode && otherNode.speaker !== cruxSpeaker;
  });

  if (crossPovEdges.length === 0) return 0.5;

  const supportCount = crossPovEdges.filter(e => e.type === 'supports').length;
  return supportCount / crossPovEdges.length;
}

export function checkOneSideConceded(
  crux: TrackedCrux,
  nodes: ReadonlyArray<ArgumentNetworkNode>,
  edges: ReadonlyArray<ArgumentNetworkEdge>,
  commitments: Record<string, CommitmentStore>,
): { conceded: boolean; conceding_speaker?: string; trigger: string } {
  // Check commitment stores for explicit concessions
  for (const speaker of crux.speakers_involved) {
    const store = commitments[speaker];
    if (!store) continue;
    const concededSet = new Set(store.conceded.map(s => s.toLowerCase()));
    const cruxTextLower = crux.description.toLowerCase();

    if (concededSet.has(cruxTextLower) || store.conceded.some(c => c.toLowerCase().includes(cruxTextLower.slice(0, 40)))) {
      return { conceded: true, conceding_speaker: speaker, trigger: `${speaker} conceded the crux claim` };
    }

    for (const claimId of crux.attacking_claim_ids) {
      const claimNode = nodes.find(n => n.id === claimId);
      if (!claimNode || claimNode.speaker !== speaker) continue;
      const claimTextLower = claimNode.text.toLowerCase();
      if (concededSet.has(claimTextLower) || store.conceded.some(c => c.toLowerCase().includes(claimTextLower.slice(0, 40)))) {
        return { conceded: true, conceding_speaker: speaker, trigger: `${speaker} conceded attacking claim ${claimId}` };
      }
    }
  }

  // Check if all attacking claims from one speaker have been weakened
  for (const speaker of crux.speakers_involved) {
    const speakerAttacks = crux.attacking_claim_ids
      .map(id => nodes.find(n => n.id === id))
      .filter((n): n is ArgumentNetworkNode => !!n && n.speaker === speaker);

    if (speakerAttacks.length > 0 && speakerAttacks.every(n => (n.computed_strength ?? 0.5) < STRENGTH_CONCESSION_THRESHOLD)) {
      return { conceded: true, conceding_speaker: speaker, trigger: `All of ${speaker}'s attacking claims weakened below ${STRENGTH_CONCESSION_THRESHOLD}` };
    }
  }

  return { conceded: false, trigger: '' };
}

const EMPIRICAL_SCHEMES: ArgumentationScheme[] = [
  'ARGUMENT_FROM_EVIDENCE', 'ARGUMENT_FROM_EXPERT_OPINION', 'ARGUMENT_FROM_PRECEDENT',
];
const VALUES_SCHEMES: ArgumentationScheme[] = [
  'ARGUMENT_FROM_VALUES', 'ARGUMENT_FROM_FAIRNESS',
];
const DEFINITIONAL_SCHEMES: ArgumentationScheme[] = [
  'ARGUMENT_FROM_DEFINITION',
];

export function inferDisagreementType(
  cruxNodeId: string,
  edges: ReadonlyArray<ArgumentNetworkEdge>,
): 'empirical' | 'values' | 'definitional' | undefined {
  const attackingEdges = edges.filter(e => e.target === cruxNodeId && e.type === 'attacks');
  if (attackingEdges.length === 0) return undefined;

  const schemeCounts = { empirical: 0, values: 0, definitional: 0 };
  for (const edge of attackingEdges) {
    const scheme = edge.argumentation_scheme;
    if (!scheme) continue;
    if (EMPIRICAL_SCHEMES.includes(scheme)) schemeCounts.empirical++;
    else if (VALUES_SCHEMES.includes(scheme)) schemeCounts.values++;
    else if (DEFINITIONAL_SCHEMES.includes(scheme)) schemeCounts.definitional++;
  }

  const max = Math.max(schemeCounts.empirical, schemeCounts.values, schemeCounts.definitional);
  if (max === 0) return undefined;
  if (schemeCounts.empirical === max) return 'empirical';
  if (schemeCounts.values === max) return 'values';
  return 'definitional';
}

function transitionCrux(
  crux: TrackedCrux,
  newState: CruxResolutionState,
  turn: number,
  trigger: string,
): TrackedCrux {
  const transition: CruxStateTransition = { from: crux.state, to: newState, turn, trigger };
  return { ...crux, state: newState, history: [...crux.history, transition] };
}

function evaluateCruxState(
  crux: TrackedCrux,
  nodes: ReadonlyArray<ArgumentNetworkNode>,
  edges: ReadonlyArray<ArgumentNetworkEdge>,
  commitments: Record<string, CommitmentStore>,
  currentTurn: number,
): TrackedCrux {
  const polarity = computeCruxPolarity(crux.id, nodes, edges);
  const cruxNode = nodes.find(n => n.id === crux.id);
  let updated: TrackedCrux = {
    ...crux,
    support_polarity: polarity,
    last_computed_strength: cruxNode?.computed_strength ?? crux.last_computed_strength,
    disagreement_type: crux.disagreement_type ?? inferDisagreementType(crux.id, edges),
  };

  // Update attacking_claim_ids with any new cross-POV attackers
  const cruxSpeaker = cruxNode?.speaker;
  const attackEdges = edges.filter(e => e.target === crux.id && e.type === 'attacks');
  const attackerIds = attackEdges.map(e => e.source)
    .filter(id => {
      const n = nodes.find(nd => nd.id === id);
      return n && n.speaker !== cruxSpeaker;
    });
  const existingIds = new Set(updated.attacking_claim_ids);
  const newAttackers = attackerIds.filter(id => !existingIds.has(id));
  if (newAttackers.length > 0) {
    updated = { ...updated, attacking_claim_ids: [...updated.attacking_claim_ids, ...newAttackers] };
  }

  // Update speakers_involved
  const allSpeakers = new Set(updated.speakers_involved);
  for (const id of updated.attacking_claim_ids) {
    const n = nodes.find(nd => nd.id === id);
    if (n && typeof n.speaker === 'string') allSpeakers.add(n.speaker);
  }
  if (cruxSpeaker) allSpeakers.add(cruxSpeaker);
  updated = { ...updated, speakers_involved: [...allSpeakers] };

  const isResolved = polarity >= POLARITY_RESOLVED_THRESHOLD || polarity <= (1 - POLARITY_RESOLVED_THRESHOLD);

  switch (updated.state) {
    case 'identified': {
      const edgesOnCrux = edges.filter(e =>
        (e.source === crux.id || e.target === crux.id) &&
        nodes.find(n => n.id === (e.source === crux.id ? e.target : e.source))?.turn_number > crux.identified_turn
      );
      if (edgesOnCrux.length > 0) {
        updated = transitionCrux(updated, 'engaged', currentTurn, `${edgesOnCrux.length} new edge(s) addressing crux`);
        // Fall through to check further transitions
        return evaluateCruxState(updated, nodes, edges, commitments, currentTurn);
      }
      break;
    }

    case 'engaged': {
      if (isResolved) {
        const direction = polarity >= POLARITY_RESOLVED_THRESHOLD ? 'support' : 'attack';
        updated = transitionCrux(updated, 'resolved', currentTurn, `Cross-POV edges converged to ${direction} (polarity ${polarity.toFixed(2)})`);
        break;
      }
      const concessionCheck = checkOneSideConceded(updated, nodes, edges, commitments);
      if (concessionCheck.conceded) {
        updated = transitionCrux(updated, 'one_side_conceded', currentTurn, concessionCheck.trigger);
        return evaluateCruxState(updated, nodes, edges, commitments, currentTurn);
      }
      // Check for irreducible
      if (updated.disagreement_type === 'values' || updated.disagreement_type === 'definitional') {
        const recentHistory = updated.history.filter(h => h.turn >= currentTurn - IRREDUCIBLE_STABLE_TURNS);
        const polarityStable = recentHistory.length === 0 && (currentTurn - updated.identified_turn) >= IRREDUCIBLE_STABLE_TURNS;
        if (polarityStable && Math.abs(polarity - 0.5) < POLARITY_STABILITY_EPSILON * 2) {
          updated = transitionCrux(updated, 'irreducible', currentTurn,
            `${updated.disagreement_type} disagreement with stable polarity for ${IRREDUCIBLE_STABLE_TURNS}+ turns`);
        }
      }
      break;
    }

    case 'one_side_conceded': {
      if (isResolved) {
        const direction = polarity >= POLARITY_RESOLVED_THRESHOLD ? 'support' : 'attack';
        updated = transitionCrux(updated, 'resolved', currentTurn, `Post-concession convergence to ${direction} (polarity ${polarity.toFixed(2)})`);
      }
      break;
    }

    case 'resolved':
    case 'irreducible':
      break;
  }

  return updated;
}

export function updateCruxTracker(
  existingTracker: TrackedCrux[] | undefined,
  nodes: ReadonlyArray<ArgumentNetworkNode>,
  edges: ReadonlyArray<ArgumentNetworkEdge>,
  commitments: Record<string, CommitmentStore>,
  currentTurn: number,
): TrackedCrux[] {
  if (nodes.length === 0) return existingTracker ?? [];

  const tracker = [...(existingTracker ?? [])];
  const trackedIds = new Set(tracker.map(c => c.id));

  // Detect new structural cruxes
  const detected = detectCruxNodes(nodes, edges);
  for (const crux of detected) {
    if (trackedIds.has(crux.id)) continue;
    const cruxNode = nodes.find(n => n.id === crux.id);
    if (!cruxNode) continue;

    const attackEdges = edges.filter(e => e.target === crux.id && e.type === 'attacks');
    const attackerIds = attackEdges.map(e => e.source)
      .filter(id => {
        const n = nodes.find(nd => nd.id === id);
        return n && n.speaker !== cruxNode.speaker;
      });
    const speakers = new Set<string>();
    if (cruxNode.speaker) speakers.add(cruxNode.speaker);
    for (const id of attackerIds) {
      const n = nodes.find(nd => nd.id === id);
      if (n) speakers.add(n.speaker);
    }

    tracker.push({
      id: crux.id,
      description: cruxNode.text,
      identified_turn: currentTurn,
      state: 'identified',
      history: [],
      attacking_claim_ids: attackerIds,
      speakers_involved: [...speakers],
      last_computed_strength: crux.computedStrength,
      support_polarity: computeCruxPolarity(crux.id, nodes, edges),
      disagreement_type: inferDisagreementType(crux.id, edges),
    });
    trackedIds.add(crux.id);
  }

  // Evaluate state transitions for all tracked cruxes
  return tracker.map(crux =>
    crux.state === 'resolved' || crux.state === 'irreducible'
      ? { ...crux, last_computed_strength: nodes.find(n => n.id === crux.id)?.computed_strength ?? crux.last_computed_strength }
      : evaluateCruxState(crux, nodes, edges, commitments, currentTurn)
  );
}

export function formatCruxResolutionContext(tracker: TrackedCrux[]): string {
  if (tracker.length === 0) return '';

  const resolved = tracker.filter(c => c.state === 'resolved');
  const irreducible = tracker.filter(c => c.state === 'irreducible');
  const active = tracker.filter(c => c.state !== 'resolved' && c.state !== 'irreducible');

  const lines: string[] = [];

  if (resolved.length > 0) {
    lines.push('RESOLVED CRUXES (no longer contested):');
    for (const c of resolved) {
      const lastTransition = c.history[c.history.length - 1];
      lines.push(`- "${c.description}" (${c.id}) — resolved at turn ${lastTransition?.turn ?? '?'}, ${lastTransition?.trigger ?? 'unknown'}`);
    }
  }

  if (irreducible.length > 0) {
    lines.push('IRREDUCIBLE DISAGREEMENTS:');
    for (const c of irreducible) {
      const typeLabel = c.disagreement_type ?? 'unknown type';
      lines.push(`- "${c.description}" (${c.id}) — ${typeLabel} disagreement, stable since turn ${c.identified_turn}`);
    }
  }

  if (active.length > 0) {
    lines.push('ACTIVE CRUXES (still contested):');
    for (const c of active) {
      lines.push(`- "${c.description}" (${c.id}) — ${c.state}, polarity ${c.support_polarity.toFixed(2)}`);
    }
  }

  return lines.join('\n');
}
