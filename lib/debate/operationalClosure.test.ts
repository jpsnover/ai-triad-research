import { describe, it, expect } from 'vitest';
import { computeOperationalClosure } from './operationalClosure.js';
import type { ArgumentNetworkNode, ArgumentNetworkEdge } from './types.js';

function makeNode(id: string, speaker: string): ArgumentNetworkNode {
  return {
    id, text: `claim ${id}`, speaker: speaker as ArgumentNetworkNode['speaker'],
    source_entry_id: 'e1', taxonomy_refs: [], turn_number: 1,
  };
}

function makeEdge(source: string, target: string, type: 'supports' | 'attacks' = 'supports'): ArgumentNetworkEdge {
  return { id: `${source}->${target}`, source, target, type };
}

describe('computeOperationalClosure', () => {
  it('self-sealing: all self-targeted → closure_rate 1.0', () => {
    const nodes = [
      makeNode('A1', 'accelerationist'), makeNode('A2', 'accelerationist'),
      makeNode('S1', 'safetyist'), makeNode('S2', 'safetyist'),
    ];
    const edges = [
      makeEdge('A1', 'A2', 'supports'),
      makeEdge('S1', 'S2', 'supports'),
    ];

    const result = computeOperationalClosure(nodes, edges);
    expect(result.perSpeaker['accelerationist'].closure_rate).toBe(1.0);
    expect(result.perSpeaker['safetyist'].closure_rate).toBe(1.0);
    expect(result.debateMean).toBe(1.0);
  });

  it('fully coupled: all opponent-targeted → closure_rate 0.0', () => {
    const nodes = [
      makeNode('A1', 'accelerationist'),
      makeNode('S1', 'safetyist'),
      makeNode('K1', 'skeptic'),
    ];
    const edges = [
      makeEdge('A1', 'S1', 'attacks'),
      makeEdge('S1', 'K1', 'attacks'),
      makeEdge('K1', 'A1', 'attacks'),
    ];

    const result = computeOperationalClosure(nodes, edges);
    expect(result.perSpeaker['accelerationist'].closure_rate).toBe(0.0);
    expect(result.perSpeaker['safetyist'].closure_rate).toBe(0.0);
    expect(result.perSpeaker['skeptic'].closure_rate).toBe(0.0);
    expect(result.debateMean).toBe(0.0);
  });

  it('mixed: partial self-targeting yields fractional rate', () => {
    const nodes = [
      makeNode('A1', 'accelerationist'), makeNode('A2', 'accelerationist'),
      makeNode('S1', 'safetyist'),
    ];
    const edges = [
      makeEdge('A1', 'A2', 'supports'),
      makeEdge('A1', 'S1', 'attacks'),
    ];

    const result = computeOperationalClosure(nodes, edges);
    expect(result.perSpeaker['accelerationist'].closure_rate).toBe(0.5);
    expect(result.perSpeaker['accelerationist'].closure_edges).toBe(1);
    expect(result.perSpeaker['accelerationist'].coupling_edges).toBe(1);
  });

  it('all-standalone: denominator 0 yields no entry, debateMean null — no NaN', () => {
    const nodes = [
      makeNode('A1', 'accelerationist'),
      makeNode('S1', 'safetyist'),
    ];
    const edges: ArgumentNetworkEdge[] = [];

    const result = computeOperationalClosure(nodes, edges);
    expect(result.perSpeaker['accelerationist']).toBeUndefined();
    expect(result.perSpeaker['safetyist']).toBeUndefined();
    expect(result.debateMean).toBeNull();

    const json = JSON.stringify(result);
    expect(json).not.toContain('NaN');
  });

  it('excludes revoice_of edges from closure computation', () => {
    const nodes = [
      makeNode('A1', 'accelerationist'), makeNode('A2', 'accelerationist'),
      makeNode('S1', 'safetyist'),
    ];
    const edges: ArgumentNetworkEdge[] = [
      makeEdge('A1', 'S1', 'attacks'),
      { id: 'rev', source: 'A1', target: 'A2', type: 'revoice_of' },
    ];

    const result = computeOperationalClosure(nodes, edges);
    expect(result.perSpeaker['accelerationist'].closure_rate).toBe(0.0);
    expect(result.perSpeaker['accelerationist'].coupling_edges).toBe(1);
    expect(result.perSpeaker['accelerationist'].closure_edges).toBe(0);
  });

  it('standalone_rate reflects nodes with no outgoing edges', () => {
    const nodes = [
      makeNode('A1', 'accelerationist'), makeNode('A2', 'accelerationist'),
      makeNode('S1', 'safetyist'),
    ];
    const edges = [makeEdge('A1', 'S1', 'attacks')];

    const result = computeOperationalClosure(nodes, edges);
    expect(result.perSpeaker['accelerationist'].standalone_rate).toBe(0.5);
  });
});
