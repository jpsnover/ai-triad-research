// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type {
  ANMutation,
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  InterventionMove,
} from './types.js';

let nextMutationId = 1;

export function resetMutationIdCounter(): void {
  nextMutationId = 1;
}

export function createProvisionalMutation(
  type: ANMutation['type'],
  move: InterventionMove,
  currentRound: number,
  opts?: { target_node_id?: string; target_edge_id?: string; old_value?: number; new_value?: number },
): ANMutation {
  return {
    id: `mut-${nextMutationId++}`,
    type,
    source: 'intervention_response',
    provisional: true,
    provisional_round: currentRound,
    hardened: false,
    move,
    target_node_id: opts?.target_node_id,
    target_edge_id: opts?.target_edge_id,
    old_value: opts?.old_value,
    new_value: opts?.new_value,
  };
}

const PROVISIONAL_MOVES: Set<InterventionMove> = new Set([
  'PIN', 'PROBE', 'CHALLENGE', 'CLARIFY', 'CHECK', 'META-REFLECT', 'CRUX_FOCUS',
]);

export function isProvisionalMove(move: InterventionMove): boolean {
  return PROVISIONAL_MOVES.has(move);
}

export interface EffectiveAN {
  nodes: ArgumentNetworkNode[];
  edges: ArgumentNetworkEdge[];
}

export function getEffectiveAN(
  nodes: ReadonlyArray<ArgumentNetworkNode>,
  edges: ReadonlyArray<ArgumentNetworkEdge>,
  mutations: ReadonlyArray<ANMutation>,
  currentRound: number,
): EffectiveAN {
  const excludedNodeIds = new Set<string>();
  const excludedEdgeIds = new Set<string>();
  const strengthOverrides = new Map<string, number>();

  for (const mut of mutations) {
    if (!mut.provisional || mut.hardened) continue;
    if (mut.provisional_round !== undefined && mut.provisional_round >= currentRound) {
      if (mut.type === 'add_node' && mut.target_node_id) {
        excludedNodeIds.add(mut.target_node_id);
      } else if (mut.type === 'add_edge' && mut.target_edge_id) {
        excludedEdgeIds.add(mut.target_edge_id);
      } else if (mut.type === 'modify_strength' && mut.target_node_id && mut.old_value !== undefined) {
        strengthOverrides.set(mut.target_node_id, mut.old_value);
      }
    }
  }

  const filteredNodes = nodes
    .filter(n => !excludedNodeIds.has(n.id))
    .map(n => {
      const override = strengthOverrides.get(n.id);
      if (override !== undefined) {
        return { ...n, base_strength: override };
      }
      return n;
    });

  const filteredEdges = edges.filter(e => !excludedEdgeIds.has(e.id));

  return { nodes: filteredNodes, edges: filteredEdges };
}

export function hardenProvisionalMutations(
  mutations: ANMutation[],
  currentRound: number,
): { hardened: string[]; kept_provisional: string[] } {
  const hardened: string[] = [];
  const kept_provisional: string[] = [];

  for (const mut of mutations) {
    if (!mut.provisional || mut.hardened) continue;
    if (mut.provisional_round !== undefined && mut.provisional_round < currentRound) {
      mut.hardened = true;
      hardened.push(mut.id);
    } else {
      kept_provisional.push(mut.id);
    }
  }

  return { hardened, kept_provisional };
}

export function rollbackMutation(
  mutation: ANMutation,
  nodes: ArgumentNetworkNode[],
  edges: ArgumentNetworkEdge[],
): void {
  if (mutation.type === 'add_node' && mutation.target_node_id) {
    const idx = nodes.findIndex(n => n.id === mutation.target_node_id);
    if (idx >= 0) nodes.splice(idx, 1);
    // Remove edges connected to the rolled-back node
    for (let i = edges.length - 1; i >= 0; i--) {
      if (edges[i].source === mutation.target_node_id || edges[i].target === mutation.target_node_id) {
        edges.splice(i, 1);
      }
    }
  } else if (mutation.type === 'add_edge' && mutation.target_edge_id) {
    const idx = edges.findIndex(e => e.id === mutation.target_edge_id);
    if (idx >= 0) edges.splice(idx, 1);
  } else if (mutation.type === 'modify_strength' && mutation.target_node_id && mutation.old_value !== undefined) {
    const node = nodes.find(n => n.id === mutation.target_node_id);
    if (node) node.base_strength = mutation.old_value;
  }
}

export function discardContradictedMutations(
  mutations: ANMutation[],
  contradictedMutationIds: Set<string>,
  nodes: ArgumentNetworkNode[],
  edges: ArgumentNetworkEdge[],
): string[] {
  const discarded: string[] = [];

  for (let i = mutations.length - 1; i >= 0; i--) {
    const mut = mutations[i];
    if (contradictedMutationIds.has(mut.id) && mut.provisional && !mut.hardened) {
      rollbackMutation(mut, nodes, edges);
      mutations.splice(i, 1);
      discarded.push(mut.id);
    }
  }

  return discarded;
}
