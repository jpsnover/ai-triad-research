// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { countDanglingReferences, formatDanglingWarning } from './danglingReferences';
import type { PovTaxonomyFile, SituationsFile, EdgesFile, PovNode, SituationNode, Edge } from '../types/taxonomy';

function povNode(overrides: Partial<PovNode> = {}): PovNode {
  return {
    id: 'acc-beliefs-001',
    category: 'Beliefs',
    label: 'Test node',
    description: 'd',
    parent_id: null,
    children: [],
    situation_refs: [],
    ...overrides,
  } as PovNode;
}

function situationNode(overrides: Partial<SituationNode> = {}): SituationNode {
  return {
    id: 'sit-001',
    label: 'Test situation',
    description: 'd',
    linked_nodes: [],
    conflict_ids: [],
    ...overrides,
  } as SituationNode;
}

function edge(source: string, target: string): Edge {
  return { source, target, type: 'supports', bidirectional: false, confidence: 1 } as Edge;
}

function povFile(nodes: PovNode[]): PovTaxonomyFile {
  return { _schema_version: '1', _doc: '', pov: 'accelerationist', color_hex: '#000', last_modified: '', nodes };
}

function situationsFile(nodes: SituationNode[]): SituationsFile {
  return { _schema_version: '1', _doc: '', last_modified: '', nodes };
}

function edgesFile(edges: Edge[]): EdgesFile {
  return { _schema_version: '1', _doc: '', last_modified: '', edge_types: [], edges };
}

describe('countDanglingReferences', () => {
  it('returns all-zero counts when the node has no references anywhere', () => {
    const counts = countDanglingReferences('acc-beliefs-001', [povFile([povNode()])], situationsFile([]), edgesFile([]));
    expect(counts).toEqual({ edges: 0, situationRefs: 0, children: 0 });
  });

  it('counts edges in either direction', () => {
    const counts = countDanglingReferences(
      'acc-beliefs-001',
      [povFile([povNode()])],
      situationsFile([]),
      edgesFile([edge('acc-beliefs-001', 'saf-beliefs-002'), edge('skp-beliefs-003', 'acc-beliefs-001'), edge('x', 'y')]),
    );
    expect(counts.edges).toBe(2);
  });

  it('counts situations whose linked_nodes reference the (POV) node being deleted', () => {
    const counts = countDanglingReferences(
      'acc-beliefs-001',
      [povFile([povNode()])],
      situationsFile([situationNode({ linked_nodes: ['acc-beliefs-001'] }), situationNode({ id: 'sit-002', linked_nodes: ['other'] })]),
      edgesFile([]),
    );
    expect(counts.situationRefs).toBe(1);
  });

  it('counts POV nodes whose situation_refs reference the (situation) node being deleted', () => {
    const counts = countDanglingReferences(
      'sit-001',
      [povFile([povNode({ id: 'acc-beliefs-001', situation_refs: ['sit-001'] }), povNode({ id: 'acc-beliefs-002', situation_refs: [] })])],
      situationsFile([situationNode()]),
      edgesFile([]),
    );
    expect(counts.situationRefs).toBe(1);
  });

  it('counts children losing their parent, plus the parent whose children[] still lists this node', () => {
    const parent = povNode({ id: 'acc-beliefs-001', children: ['acc-beliefs-002'] });
    const child = povNode({ id: 'acc-beliefs-002', parent_id: 'acc-beliefs-001' });
    const counts = countDanglingReferences('acc-beliefs-002', [povFile([parent, child])], situationsFile([]), edgesFile([]));
    // child-of-the-deleted-node direction is irrelevant here (the deleted node IS the child);
    // what dangles is the parent's stale children[] entry.
    expect(counts.children).toBe(1);
  });

  it('counts both the deleted node\'s own children and its parent\'s stale entry', () => {
    const grandparent = povNode({ id: 'acc-beliefs-000', children: ['acc-beliefs-001'] });
    const target = povNode({ id: 'acc-beliefs-001', parent_id: 'acc-beliefs-000', children: ['acc-beliefs-002'] });
    const child = povNode({ id: 'acc-beliefs-002', parent_id: 'acc-beliefs-001' });
    const counts = countDanglingReferences('acc-beliefs-001', [povFile([grandparent, target, child])], situationsFile([]), edgesFile([]));
    // grandparent's children[] entry (1) + child's parent_id (1) = 2
    expect(counts.children).toBe(2);
  });

  it('counts situations whose parent_id references the (situation) node being deleted (t/3852#3)', () => {
    const parent = situationNode({ id: 'sit-001' });
    const child = situationNode({ id: 'sit-002', parent_id: 'sit-001' });
    const counts = countDanglingReferences('sit-001', [povFile([povNode()])], situationsFile([parent, child]), edgesFile([]));
    // SituationNode has no `children` array (unlike PovNode) — only the child's stale parent_id dangles.
    expect(counts.children).toBe(1);
  });

  it('handles null stores gracefully (file not yet loaded)', () => {
    const counts = countDanglingReferences('acc-beliefs-001', [null, null, null], null, null);
    expect(counts).toEqual({ edges: 0, situationRefs: 0, children: 0 });
  });

  it('is exhaustive, not sampled — counts every match across a large set', () => {
    const edges = Array.from({ length: 194 }, (_, i) => edge('acc-intentions-003', `x-${i}`));
    const situationRefNodes = Array.from({ length: 22 }, (_, i) => situationNode({ id: `sit-${i}`, linked_nodes: ['acc-intentions-003'] }));
    const counts = countDanglingReferences('acc-intentions-003', [povFile([povNode({ id: 'acc-intentions-003' })])], situationsFile(situationRefNodes), edgesFile(edges));
    expect(counts.edges).toBe(194);
    expect(counts.situationRefs).toBe(22);
  });
});

describe('formatDanglingWarning', () => {
  it('returns undefined when nothing dangles', () => {
    expect(formatDanglingWarning({ edges: 0, situationRefs: 0, children: 0 })).toBeUndefined();
  });

  it('pluralizes correctly for singular counts', () => {
    expect(formatDanglingWarning({ edges: 1, situationRefs: 1, children: 1 })).toBe(
      'This will orphan 1 edge, 1 situation reference, 1 child/parent link.',
    );
  });

  it('matches the t/3852 incident numbers', () => {
    expect(formatDanglingWarning({ edges: 194, situationRefs: 22, children: 0 })).toBe(
      'This will orphan 194 edges, 22 situation references.',
    );
  });

  it('omits zero-valued categories but keeps non-zero ones', () => {
    expect(formatDanglingWarning({ edges: 0, situationRefs: 5, children: 0 })).toBe(
      'This will orphan 5 situation references.',
    );
  });
});
