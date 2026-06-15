import { describe, it, expect, beforeEach } from 'vitest';
import {
  createProvisionalMutation,
  getEffectiveAN,
  hardenProvisionalMutations,
  rollbackMutation,
  discardContradictedMutations,
  isProvisionalMove,
  resetMutationIdCounter,
} from './provisionalMutations.js';
import type { ANMutation, ArgumentNetworkNode, ArgumentNetworkEdge } from './types.js';

function makeNode(id: string, baseStrength = 0.5): ArgumentNetworkNode {
  return {
    id,
    text: `claim ${id}`,
    speaker: 'accelerationist',
    source_entry_id: 'e-1',
    taxonomy_refs: [],
    turn_number: 1,
    base_strength: baseStrength,
  };
}

function makeEdge(id: string, source: string, target: string): ArgumentNetworkEdge {
  return { id, source, target, type: 'attacks', weight: 0.5 };
}

beforeEach(() => {
  resetMutationIdCounter();
});

describe('isProvisionalMove', () => {
  it('returns true for intervention moves that produce provisional mutations', () => {
    expect(isProvisionalMove('PIN')).toBe(true);
    expect(isProvisionalMove('PROBE')).toBe(true);
    expect(isProvisionalMove('CHALLENGE')).toBe(true);
    expect(isProvisionalMove('CLARIFY')).toBe(true);
    expect(isProvisionalMove('CHECK')).toBe(true);
    expect(isProvisionalMove('META-REFLECT')).toBe(true);
  });

  it('returns false for non-provisional moves', () => {
    expect(isProvisionalMove('ACKNOWLEDGE')).toBe(false);
    expect(isProvisionalMove('COMPRESS')).toBe(false);
    expect(isProvisionalMove('COMMIT')).toBe(false);
    expect(isProvisionalMove('REVOICE')).toBe(false);
  });
});

describe('createProvisionalMutation', () => {
  it('creates a provisional mutation with correct fields', () => {
    const mut = createProvisionalMutation('modify_strength', 'PIN', 3, {
      target_node_id: 'AN-5',
      old_value: 0.8,
      new_value: 0.56,
    });

    expect(mut.id).toBe('mut-1');
    expect(mut.type).toBe('modify_strength');
    expect(mut.source).toBe('intervention_response');
    expect(mut.provisional).toBe(true);
    expect(mut.provisional_round).toBe(3);
    expect(mut.hardened).toBe(false);
    expect(mut.move).toBe('PIN');
    expect(mut.target_node_id).toBe('AN-5');
    expect(mut.old_value).toBe(0.8);
    expect(mut.new_value).toBe(0.56);
  });

  it('assigns incrementing IDs', () => {
    const m1 = createProvisionalMutation('add_edge', 'PROBE', 2);
    const m2 = createProvisionalMutation('add_node', 'CHALLENGE', 2);
    expect(m1.id).toBe('mut-1');
    expect(m2.id).toBe('mut-2');
  });
});

describe('getEffectiveAN', () => {
  it('excludes current-round provisional add_node mutations', () => {
    const nodes = [makeNode('AN-1'), makeNode('AN-2')];
    const edges: ArgumentNetworkEdge[] = [];
    const mutations: ANMutation[] = [
      { id: 'mut-1', type: 'add_node', source: 'intervention_response', provisional: true, provisional_round: 5, hardened: false, target_node_id: 'AN-2' },
    ];

    const effective = getEffectiveAN(nodes, edges, mutations, 5);
    expect(effective.nodes).toHaveLength(1);
    expect(effective.nodes[0].id).toBe('AN-1');
  });

  it('excludes current-round provisional add_edge mutations', () => {
    const nodes = [makeNode('AN-1'), makeNode('AN-2')];
    const edges = [makeEdge('E-1', 'AN-1', 'AN-2')];
    const mutations: ANMutation[] = [
      { id: 'mut-1', type: 'add_edge', source: 'intervention_response', provisional: true, provisional_round: 5, hardened: false, target_edge_id: 'E-1' },
    ];

    const effective = getEffectiveAN(nodes, edges, mutations, 5);
    expect(effective.edges).toHaveLength(0);
  });

  it('reverts current-round provisional modify_strength to old_value', () => {
    const nodes = [makeNode('AN-1', 0.56)];
    const edges: ArgumentNetworkEdge[] = [];
    const mutations: ANMutation[] = [
      { id: 'mut-1', type: 'modify_strength', source: 'intervention_response', provisional: true, provisional_round: 5, hardened: false, target_node_id: 'AN-1', old_value: 0.8, new_value: 0.56 },
    ];

    const effective = getEffectiveAN(nodes, edges, mutations, 5);
    expect(effective.nodes[0].base_strength).toBe(0.8);
  });

  it('includes hardened provisional mutations', () => {
    const nodes = [makeNode('AN-1'), makeNode('AN-2')];
    const edges: ArgumentNetworkEdge[] = [];
    const mutations: ANMutation[] = [
      { id: 'mut-1', type: 'add_node', source: 'intervention_response', provisional: true, provisional_round: 4, hardened: true, target_node_id: 'AN-2' },
    ];

    const effective = getEffectiveAN(nodes, edges, mutations, 5);
    expect(effective.nodes).toHaveLength(2);
  });

  it('includes prior-round provisional mutations (not yet hardened)', () => {
    const nodes = [makeNode('AN-1'), makeNode('AN-2')];
    const edges: ArgumentNetworkEdge[] = [];
    const mutations: ANMutation[] = [
      { id: 'mut-1', type: 'add_node', source: 'intervention_response', provisional: true, provisional_round: 3, hardened: false, target_node_id: 'AN-2' },
    ];

    const effective = getEffectiveAN(nodes, edges, mutations, 5);
    expect(effective.nodes).toHaveLength(2);
  });

  it('returns unchanged AN when mutations is empty', () => {
    const nodes = [makeNode('AN-1')];
    const edges = [makeEdge('E-1', 'AN-1', 'AN-1')];
    const effective = getEffectiveAN(nodes, edges, [], 5);
    expect(effective.nodes).toHaveLength(1);
    expect(effective.edges).toHaveLength(1);
  });
});

describe('hardenProvisionalMutations', () => {
  it('hardens mutations from prior rounds', () => {
    const mutations: ANMutation[] = [
      { id: 'mut-1', type: 'add_edge', source: 'intervention_response', provisional: true, provisional_round: 3, hardened: false },
      { id: 'mut-2', type: 'add_node', source: 'intervention_response', provisional: true, provisional_round: 4, hardened: false },
    ];

    const result = hardenProvisionalMutations(mutations, 5);
    expect(result.hardened).toEqual(['mut-1', 'mut-2']);
    expect(result.kept_provisional).toEqual([]);
    expect(mutations[0].hardened).toBe(true);
    expect(mutations[1].hardened).toBe(true);
  });

  it('keeps current-round mutations provisional', () => {
    const mutations: ANMutation[] = [
      { id: 'mut-1', type: 'add_edge', source: 'intervention_response', provisional: true, provisional_round: 5, hardened: false },
    ];

    const result = hardenProvisionalMutations(mutations, 5);
    expect(result.hardened).toEqual([]);
    expect(result.kept_provisional).toEqual(['mut-1']);
    expect(mutations[0].hardened).toBe(false);
  });

  it('skips already-hardened mutations', () => {
    const mutations: ANMutation[] = [
      { id: 'mut-1', type: 'add_edge', source: 'intervention_response', provisional: true, provisional_round: 2, hardened: true },
    ];

    const result = hardenProvisionalMutations(mutations, 5);
    expect(result.hardened).toEqual([]);
    expect(result.kept_provisional).toEqual([]);
  });
});

describe('rollbackMutation', () => {
  it('removes add_node mutation and connected edges', () => {
    const nodes = [makeNode('AN-1'), makeNode('AN-2')];
    const edges = [makeEdge('E-1', 'AN-1', 'AN-2'), makeEdge('E-2', 'AN-2', 'AN-1')];
    const mut: ANMutation = { id: 'mut-1', type: 'add_node', source: 'intervention_response', provisional: true, hardened: false, target_node_id: 'AN-2' };

    rollbackMutation(mut, nodes, edges);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe('AN-1');
    expect(edges).toHaveLength(0);
  });

  it('removes add_edge mutation', () => {
    const nodes = [makeNode('AN-1'), makeNode('AN-2')];
    const edges = [makeEdge('E-1', 'AN-1', 'AN-2')];
    const mut: ANMutation = { id: 'mut-1', type: 'add_edge', source: 'intervention_response', provisional: true, hardened: false, target_edge_id: 'E-1' };

    rollbackMutation(mut, nodes, edges);
    expect(edges).toHaveLength(0);
  });

  it('restores modify_strength to old_value', () => {
    const nodes = [makeNode('AN-1', 0.56)];
    const mut: ANMutation = { id: 'mut-1', type: 'modify_strength', source: 'intervention_response', provisional: true, hardened: false, target_node_id: 'AN-1', old_value: 0.8, new_value: 0.56 };

    rollbackMutation(mut, nodes, []);
    expect(nodes[0].base_strength).toBe(0.8);
  });
});

describe('discardContradictedMutations', () => {
  it('rolls back and removes contradicted mutations', () => {
    const nodes = [makeNode('AN-1'), makeNode('AN-2', 0.56)];
    const edges = [makeEdge('E-1', 'AN-1', 'AN-2')];
    const mutations: ANMutation[] = [
      { id: 'mut-1', type: 'add_edge', source: 'intervention_response', provisional: true, provisional_round: 3, hardened: false, target_edge_id: 'E-1' },
      { id: 'mut-2', type: 'modify_strength', source: 'intervention_response', provisional: true, provisional_round: 3, hardened: false, target_node_id: 'AN-2', old_value: 0.8, new_value: 0.56 },
    ];

    const discarded = discardContradictedMutations(mutations, new Set(['mut-1', 'mut-2']), nodes, edges);
    expect(discarded).toEqual(['mut-2', 'mut-1']);
    expect(mutations).toHaveLength(0);
    expect(edges).toHaveLength(0);
    expect(nodes[1].base_strength).toBe(0.8);
  });

  it('does not discard hardened mutations', () => {
    const nodes = [makeNode('AN-1')];
    const edges = [makeEdge('E-1', 'AN-1', 'AN-1')];
    const mutations: ANMutation[] = [
      { id: 'mut-1', type: 'add_edge', source: 'intervention_response', provisional: true, provisional_round: 2, hardened: true, target_edge_id: 'E-1' },
    ];

    const discarded = discardContradictedMutations(mutations, new Set(['mut-1']), nodes, edges);
    expect(discarded).toHaveLength(0);
    expect(mutations).toHaveLength(1);
    expect(edges).toHaveLength(1);
  });

  it('does not discard non-contradicted mutations', () => {
    const nodes = [makeNode('AN-1')];
    const edges: ArgumentNetworkEdge[] = [];
    const mutations: ANMutation[] = [
      { id: 'mut-1', type: 'add_node', source: 'intervention_response', provisional: true, provisional_round: 3, hardened: false, target_node_id: 'AN-1' },
    ];

    const discarded = discardContradictedMutations(mutations, new Set(['mut-99']), nodes, edges);
    expect(discarded).toHaveLength(0);
    expect(mutations).toHaveLength(1);
  });
});
