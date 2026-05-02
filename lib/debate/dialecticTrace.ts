// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * dialecticTrace.ts — Generate minimal argument paths explaining
 * why a position prevailed in a debate.
 *
 * A dialectic trace walks the argument network (AN) to produce a
 * human-readable chain of moves: assertion → attack → defense → defeat.
 * It answers "why did this position win?" not just "what score did it get?"
 *
 * Based on insights from Loui (1995) "Workshop on Computational Dialectics":
 * dialectic structure itself serves as explanation — the depth of the
 * exchange proportional to the depth of explanation generated.
 */

import type {
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  DebateSession,
  PreferenceEntry,
  PoverId,
} from './types';

// ── Types ─────────────────────────────────────────────────

export interface DialecticTraceStep {
  /** Step number (1-indexed). */
  step: number;
  /** The AN node ID for this step's claim. */
  claim_id: string;
  /** Speaker who made the claim (pover ID or 'system'/'document'). */
  speaker: string;
  /** The claim text. */
  claim: string;
  /** What dialectical action this step represents. */
  action: 'asserted' | 'attacked' | 'supported' | 'conceded' | 'unaddressed';
  /** The dialectical move used (DISTINGUISH, EMPIRICAL_CHALLENGE, etc.). */
  scheme?: string;
  /** AIF attack type when action is 'attacked'. */
  attack_type?: 'rebut' | 'undercut' | 'undermine';
  /** The AN node ID of the claim this step responds to. */
  responds_to?: string;
  /** QBAF computed strength at time of this step. */
  strength?: number;
  /** BDI category of the claim. */
  bdi_category?: 'belief' | 'desire' | 'intention';
  /** Turn number in the debate. */
  turn?: number;
}

export interface DialecticTrace {
  /** The preference/verdict this trace explains. */
  conflict: string;
  /** Which position prevailed. */
  prevailing: string;
  /** Resolution criterion. */
  criterion: string;
  /** The argument chain explaining the resolution. */
  steps: DialecticTraceStep[];
  /** ID of the debate session that produced this trace. */
  debate_id: string;
  /** When the trace was generated. */
  generated_at: string;
}

// ── Trace generation ──────────────────────────────────────

/**
 * Generate dialectic traces from a debate session's argument network
 * and synthesis preferences.
 *
 * For each preference (verdict), traces the argument path from the
 * losing position(s) through the attacks/defenses to the prevailing one.
 *
 * Algorithm:
 * 1. Find the AN nodes referenced by the preference (via claim_ids or text matching)
 * 2. Identify the "prevailing" claims (highest QBAF strength) and "defeated" claims
 * 3. Walk edges backward from the prevailing claim to find the critical path
 * 4. Sort by turn order to produce a narrative sequence
 */
export function generateDialecticTraces(session: DebateSession): DialecticTrace[] {
  const an = session.argument_network;
  if (!an || an.nodes.length === 0) return [];

  const synthEntry = session.transcript.find(e => e.type === 'synthesis');
  if (!synthEntry?.metadata?.synthesis) return [];

  const synthesis = synthEntry.metadata.synthesis as { preferences?: PreferenceEntry[] } | undefined;
  const preferences = synthesis?.preferences;
  if (!preferences || preferences.length === 0) return [];

  const traces: DialecticTrace[] = [];

  for (const pref of preferences) {
    const trace = tracePreference(pref, an.nodes, an.edges, session);
    if (trace && trace.steps.length >= 2) {
      traces.push(trace);
    }
  }

  return traces;
}

/**
 * Trace a single preference entry through the argument network.
 */
function tracePreference(
  pref: PreferenceEntry,
  nodes: ArgumentNetworkNode[],
  edges: ArgumentNetworkEdge[],
  session: DebateSession,
): DialecticTrace | null {
  // Step 1: Find relevant AN nodes
  // If pref has claim_ids, use those directly
  // Otherwise, find nodes whose text overlaps with the preference conflict text
  let relevantNodeIds: Set<string>;

  if (pref.claim_ids && pref.claim_ids.length > 0) {
    relevantNodeIds = new Set(pref.claim_ids);
  } else {
    // Text-match fallback: find nodes related to this conflict
    const conflictWords = new Set(
      pref.conflict.toLowerCase().split(/\s+/).filter(w => w.length > 4)
    );
    relevantNodeIds = new Set<string>();
    for (const node of nodes) {
      const nodeWords = node.text.toLowerCase().split(/\s+/);
      const overlap = nodeWords.filter(w => conflictWords.has(w)).length;
      if (overlap >= 3 || overlap / Math.max(1, conflictWords.size) > 0.3) {
        relevantNodeIds.add(node.id);
      }
    }
  }

  if (relevantNodeIds.size === 0) return null;

  // Step 2: Expand to include nodes connected by edges (1 hop)
  const expandedIds = new Set(relevantNodeIds);
  for (const edge of edges) {
    if (relevantNodeIds.has(edge.source)) expandedIds.add(edge.target);
    if (relevantNodeIds.has(edge.target)) expandedIds.add(edge.source);
  }

  // Step 3: Build the subgraph of relevant nodes
  const subNodes = nodes.filter(n => expandedIds.has(n.id));
  const subEdges = edges.filter(e => expandedIds.has(e.source) && expandedIds.has(e.target));

  if (subNodes.length < 2) return null;

  // Step 4: Identify key claims — sort by computed_strength descending
  const sorted = [...subNodes].sort(
    (a, b) => (b.computed_strength ?? b.base_strength ?? 0.5) -
              (a.computed_strength ?? a.base_strength ?? 0.5)
  );

  // Step 5: Build the trace as a narrative
  // Strategy: walk edges to find attack chains, then sort by turn order
  const steps: DialecticTraceStep[] = [];
  const visited = new Set<string>();

  // Start with seed nodes (the original relevant ones), sorted by turn
  const seeds = subNodes
    .filter(n => relevantNodeIds.has(n.id))
    .sort((a, b) => a.turn_number - b.turn_number);

  // BFS from seeds following edges to build the argument chain
  const queue: string[] = seeds.map(n => n.id);
  const nodeMap = new Map(subNodes.map(n => [n.id, n]));
  // Build adjacency (both directions for tracing)
  const outEdges = new Map<string, ArgumentNetworkEdge[]>();
  const inEdges = new Map<string, ArgumentNetworkEdge[]>();
  for (const edge of subEdges) {
    if (!outEdges.has(edge.source)) outEdges.set(edge.source, []);
    outEdges.get(edge.source)!.push(edge);
    if (!inEdges.has(edge.target)) inEdges.set(edge.target, []);
    inEdges.get(edge.target)!.push(edge);
  }

  // Collect all nodes reachable from seeds via edges
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    const node = nodeMap.get(id);
    if (!node) continue;

    // Find if this node is responding to something
    const incoming = inEdges.get(id) ?? [];
    const outgoing = outEdges.get(id) ?? [];

    // Determine action based on edges
    let action: DialecticTraceStep['action'] = 'asserted';
    let respondsTo: string | undefined;
    let scheme: string | undefined;
    let attackType: DialecticTraceStep['attack_type'];

    // Check outgoing edges (this node attacks/supports something)
    for (const edge of outgoing) {
      if (edge.type === 'attacks') {
        action = 'attacked';
        respondsTo = edge.target;
        attackType = edge.attack_type;
        scheme = edge.scheme ?? edge.argumentation_scheme;
        break;
      } else if (edge.type === 'supports' && !respondsTo) {
        action = 'supported';
        respondsTo = edge.target;
        scheme = edge.scheme ?? edge.argumentation_scheme;
      }
    }

    // Check if this node was conceded
    const commitments = session.commitments;
    if (commitments) {
      for (const [, store] of Object.entries(commitments)) {
        if (store.conceded.includes(id)) {
          action = 'conceded';
          break;
        }
      }
    }

    // Check if unaddressed (in unanswered ledger)
    if (session.unanswered_claims_ledger) {
      const unaddressed = session.unanswered_claims_ledger.find(
        u => u.claim_id === id && !u.addressed_round
      );
      if (unaddressed) {
        action = 'unaddressed';
      }
    }

    steps.push({
      step: 0, // numbered after sorting
      claim_id: id,
      speaker: node.speaker,
      claim: node.text,
      action,
      scheme,
      attack_type: attackType,
      responds_to: respondsTo,
      strength: node.computed_strength ?? node.base_strength,
      bdi_category: node.bdi_category,
      turn: node.turn_number,
    });

    // Expand to connected nodes
    for (const edge of [...outgoing, ...incoming]) {
      const neighbor = edge.source === id ? edge.target : edge.source;
      if (!visited.has(neighbor)) queue.push(neighbor);
    }
  }

  if (steps.length < 2) return null;

  // Sort by turn number for narrative ordering
  steps.sort((a, b) => (a.turn ?? 0) - (b.turn ?? 0));

  // Number the steps
  for (let i = 0; i < steps.length; i++) {
    steps[i].step = i + 1;
  }

  // Cap at 12 steps for readability — keep first 4, last 4, and 4 strongest-delta middle steps
  const capped = capSteps(steps, 12);

  return {
    conflict: pref.conflict,
    prevailing: pref.prevails,
    criterion: pref.criterion,
    steps: capped,
    debate_id: session.id,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Cap trace steps to maxSteps for readability while preserving narrative structure.
 * Keeps the first few, last few, and the most important middle steps.
 */
function capSteps(steps: DialecticTraceStep[], maxSteps: number): DialecticTraceStep[] {
  if (steps.length <= maxSteps) return steps;

  const keep = Math.floor(maxSteps / 3);
  const head = steps.slice(0, keep);
  const tail = steps.slice(-keep);

  // Middle: pick steps with attacks or lowest strength (most dramatic changes)
  const middle = steps.slice(keep, -keep);
  const middleSorted = [...middle].sort((a, b) => {
    // Prioritize attacks, then lowest strength
    const aScore = (a.action === 'attacked' ? 0 : 1) + (a.strength ?? 1);
    const bScore = (b.action === 'attacked' ? 0 : 1) + (b.strength ?? 1);
    return aScore - bScore;
  });
  const middleKeep = middleSorted.slice(0, maxSteps - keep * 2);
  // Re-sort by turn order
  middleKeep.sort((a, b) => (a.turn ?? 0) - (b.turn ?? 0));

  const result = [...head, ...middleKeep, ...tail];
  // Renumber
  for (let i = 0; i < result.length; i++) {
    result[i].step = i + 1;
  }
  return result;
}
