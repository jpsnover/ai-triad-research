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
import { getGlobalRecorder } from '../flight-recorder/index.js';
import { ActionableError } from './errors.js';

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

export function transitionCrux(
  crux: TrackedCrux,
  newState: CruxResolutionState,
  turn: number,
  trigger: string,
): TrackedCrux {
  const transition: CruxStateTransition = { from: crux.state, to: newState, turn, trigger };
  getGlobalRecorder()?.record({
    type: 'debate.crux_transition', component: 'crux-resolution', level: 'info',
    message: `Crux ${crux.id}: ${crux.state} → ${newState}`,
    data: { crux_id: crux.id, from_state: crux.state, to_state: newState, turn, trigger },
  });
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
      // >= (not >) because the cross-POV edges that caused crux detection
      // are themselves evidence of engagement — requiring strictly later
      // edges causes cruxes to stall in 'identified' indefinitely (t/284)
      const edgesOnCrux = edges.filter(e =>
        (e.source === crux.id || e.target === crux.id) &&
        (nodes.find(n => n.id === (e.source === crux.id ? e.target : e.source))?.turn_number ?? 0) >= crux.identified_turn
      );
      if (edgesOnCrux.length > 0) {
        updated = transitionCrux(updated, 'engaged', currentTurn, `${edgesOnCrux.length} edge(s) engaging with crux`);
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
    case 'undecided':
      // Terminal states (t/1676): no further per-turn evaluation. `undecided` is only ever
      // reached via the debate-end finalization sweep, never from the live state machine.
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
  const detected = detectCruxNodes(
    nodes as unknown as Parameters<typeof detectCruxNodes>[0],
    edges as unknown as Parameters<typeof detectCruxNodes>[1],
  );
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

    const newCrux: TrackedCrux = {
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
    };
    tracker.push(newCrux);
    trackedIds.add(crux.id);
    getGlobalRecorder()?.record({
      type: 'debate.crux', component: 'crux-resolution', level: 'info',
      message: `New crux identified: "${cruxNode.text.slice(0, 80)}"`,
      data: {
        crux_id: crux.id,
        description: cruxNode.text,
        disagreement_type: newCrux.disagreement_type,
        speakers_involved: newCrux.speakers_involved,
        polarity: newCrux.support_polarity,
      },
    });
  }

  // Evaluate state transitions for all tracked cruxes
  return tracker.map(crux =>
    // Terminal states skip live re-evaluation. `undecided` (t/1676) is terminal too — a
    // finalized crux must not be re-opened on resume() re-runs of the tracker. Routed through
    // the exhaustiveness-guarded classifier so a future terminal state can't be missed here.
    isTerminalCruxState(crux.state)
      ? { ...crux, last_computed_strength: nodes.find(n => n.id === crux.id)?.computed_strength ?? crux.last_computed_strength }
      : evaluateCruxState(crux, nodes, edges, commitments, currentTurn)
  );
}

/**
 * Debate-end finalization (t/1676). Transitions each crux still in the non-adjudicated
 * `identified` state to the terminal `undecided` verdict, writing the LITERAL state so every
 * downstream consumer (calibration, resolution_summary, cross-debate registry) reads it
 * directly rather than re-deriving "terminal + identified" — a persisted `undecided` is the
 * single source of truth (TL t/1676#4/#6).
 *
 * A crux reaches `identified` when it was surfaced (cross-POV attackers detected) but no
 * opposing turn ever engaged it — the debate never adjudicated it (cap reached, or the crux
 * was never surfaced as an explicit point of disagreement). Cruxes that advanced to
 * `engaged` / `one_side_conceded` / `resolved` / `irreducible` WERE adjudicated (both sides
 * engaged the proposition), so per the sufficiency gate (CL t/1669#2) they are NOT eligible
 * for `undecided`. This structural condition IS the sufficiency gate: `identified` == "no turn
 * pair where both debaters engaged the crux proposition."
 *
 * Idempotent and single-point (TL guard 1): safe to call once at debate end and again on
 * resume() — a crux already `undecided` is no longer `identified`, so re-running is a no-op.
 */
export function finalizeUndecidedCruxes(
  tracker: TrackedCrux[] | undefined,
  currentTurn: number,
): TrackedCrux[] {
  if (!tracker || tracker.length === 0) return tracker ?? [];
  return tracker.map(crux =>
    crux.state === 'identified'
      ? transitionCrux(
          crux,
          'undecided',
          currentTurn,
          'Debate ended without cross-engagement — crux surfaced but never adjudicated',
        )
      : crux,
  );
}

/**
 * Terminal-state classifier with a compile-time exhaustiveness guard (t/1676, TL guard 3).
 * Terminal = the per-turn state machine performs no further transitions. Adding a future
 * `CruxResolutionState` without updating this switch is a TYPE error (the `assertNever` arm),
 * so no consumer can silently miscount a new state — in particular `undecided` must never be
 * bucketed as addressed/unaddressed in the t/1796 crux-resolution metrics.
 */
export function isTerminalCruxState(state: CruxResolutionState): boolean {
  switch (state) {
    case 'resolved':
    case 'irreducible':
    case 'undecided':
      return true;
    case 'identified':
    case 'engaged':
    case 'one_side_conceded':
      return false;
    default:
      return assertNeverCruxState(state);
  }
}

/** Compile-time exhaustiveness sentinel for {@link CruxResolutionState} (t/1676). */
function assertNeverCruxState(state: never): never {
  throw new ActionableError({
    goal: 'Classify a crux resolution state',
    problem: `Unhandled CruxResolutionState: ${String(state)}`,
    location: 'lib/debate/cruxResolution.ts assertNeverCruxState',
    nextSteps: [
      'A new CruxResolutionState value was added without updating isTerminalCruxState.',
      'Add the new value to the terminal or non-terminal arm of the switch.',
    ],
  });
}

// ── Concession cascade detection ────────────────────────────────
const CASCADE_WINDOW = 3;
const CASCADE_MIN_CONCESSIONS = 2;

export interface ConcessionCascadeInfo {
  detected: boolean;
  concessions: { speaker: string; entry_id: string; round: number }[];
}

export function detectConcessionCascade(
  signals: ReadonlyArray<{ entry_id: string; round: number; speaker: string; concession_opportunity: { outcome: string } }>,
): ConcessionCascadeInfo {
  if (signals.length < CASCADE_MIN_CONCESSIONS) return { detected: false, concessions: [] };

  const recent = signals.slice(-CASCADE_WINDOW);
  const concessions = recent
    .filter(s => s.concession_opportunity.outcome === 'taken')
    .map(s => ({ speaker: s.speaker, entry_id: s.entry_id, round: s.round }));

  if (concessions.length < CASCADE_MIN_CONCESSIONS) return { detected: false, concessions: [] };

  const speakers = new Set(concessions.map(c => c.speaker));
  return { detected: speakers.size >= 2, concessions };
}

export function formatCruxResolutionContext(tracker: TrackedCrux[]): string {
  if (tracker.length === 0) return '';

  const resolved = tracker.filter(c => c.state === 'resolved');
  const irreducible = tracker.filter(c => c.state === 'irreducible');
  const undecided = tracker.filter(c => c.state === 'undecided');
  // `undecided` is terminal (t/1676) — exclude it from "active" so a cap-terminated /
  // never-cross-engaged crux is not reported to the synthesis LLM as still contested.
  const active = tracker.filter(c => !isTerminalCruxState(c.state));

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

  if (undecided.length > 0) {
    lines.push('UNDECIDED CRUXES (surfaced but never adjudicated — cap reached or never cross-engaged):');
    for (const c of undecided) {
      lines.push(`- "${c.description}" (${c.id}) — undecided, surfaced turn ${c.identified_turn}`);
    }
  }

  return lines.join('\n');
}
