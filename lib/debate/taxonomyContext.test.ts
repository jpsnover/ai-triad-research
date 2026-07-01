// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { formatTaxonomyContext } from './taxonomyContext.js';
import type { PovNode, SituationNode } from './taxonomyTypes.js';

function makeSit(id: string, label: string, parentId?: string | null): SituationNode {
  return {
    id, label, description: `Desc for ${id}`,
    parent_id: parentId ?? null,
    interpretations: { accelerationist: 'a-interp', safetyist: 's-interp', skeptic: 'k-interp' },
    linked_nodes: [], conflict_ids: [],
  };
}

describe('formatTaxonomyContext — hierarchy-grouped situations', () => {
  it('groups situations by parent category with Lost-in-the-Middle ordering (4 categories)', () => {
    // 4 root categories with 1 child each, scored in descending order
    const nodes = [
      makeSit('sit-A', 'Category A', null),
      makeSit('sit-A1', 'Child A1', 'sit-A'),
      makeSit('sit-B', 'Category B', null),
      makeSit('sit-B1', 'Child B1', 'sit-B'),
      makeSit('sit-C', 'Category C', null),
      makeSit('sit-C1', 'Child C1', 'sit-C'),
      makeSit('sit-D', 'Category D', null),
      makeSit('sit-D1', 'Child D1', 'sit-D'),
    ];

    const nodeScores = new Map<string, number>([
      ['sit-A', 0.90], ['sit-A1', 0.88],  // #1 highest
      ['sit-B', 0.80], ['sit-B1', 0.78],  // #2
      ['sit-C', 0.70], ['sit-C1', 0.68],  // #3
      ['sit-D', 0.60], ['sit-D1', 0.58],  // #4 lowest
    ]);

    const output = formatTaxonomyContext(
      { povNodes: [], situationNodes: nodes, nodeScores },
      'accelerationist',
      50,
    );

    // LitM ordering: #1(A) first, #2(B) last, #3(C) second, #4(D) third
    // So headers should appear in order: A, C, D, B
    const headerPositions = [
      { label: 'Category A', pos: output.indexOf('## Category A') },
      { label: 'Category B', pos: output.indexOf('## Category B') },
      { label: 'Category C', pos: output.indexOf('## Category C') },
      { label: 'Category D', pos: output.indexOf('## Category D') },
    ];

    for (const h of headerPositions) {
      expect(h.pos).toBeGreaterThan(-1);
    }

    // Verify LitM order: A < C < D < B
    expect(headerPositions[0].pos).toBeLessThan(headerPositions[2].pos); // A before C
    expect(headerPositions[2].pos).toBeLessThan(headerPositions[3].pos); // C before D
    expect(headerPositions[3].pos).toBeLessThan(headerPositions[1].pos); // D before B
  });

  it('renders root nodes within their category group', () => {
    const nodes = [
      makeSit('sit-100', 'Root Category', null),
      makeSit('sit-001', 'Child Node', 'sit-100'),
    ];
    const nodeScores = new Map([['sit-100', 0.60], ['sit-001', 0.55]]);
    const output = formatTaxonomyContext(
      { povNodes: [], situationNodes: nodes, nodeScores },
      'accelerationist',
      50,
    );

    // Root node should appear in the output (not dropped)
    expect(output).toContain('[sit-100]');
    expect(output).toContain('[sit-001]');
    expect(output).toContain('## Root Category');
  });

  it('handles null confidence/priority/operationality without throwing (t/1243)', () => {
    const povNodes: PovNode[] = [
      {
        id: 'acc-beliefs-001', label: 'Null-confidence belief', description: 'desc',
        pov: 'accelerationist', category: 'Beliefs', bdi_layer: 'belief',
        parent_id: null, children: [], situation_refs: [],
        confidence: null as unknown as number,
      },
      {
        id: 'acc-desires-001', label: 'Null-priority desire', description: 'desc',
        pov: 'accelerationist', category: 'Desires', bdi_layer: 'desire',
        parent_id: null, children: [], situation_refs: [],
        priority: null as unknown as number,
      },
      {
        id: 'acc-intentions-001', label: 'Null-operationality intention', description: 'desc',
        pov: 'accelerationist', category: 'Intentions', bdi_layer: 'intention',
        parent_id: null, children: [], situation_refs: [],
        operationality: null as unknown as number,
      },
    ];
    const nodeScores = new Map([
      ['acc-beliefs-001', 0.8], ['acc-desires-001', 0.7], ['acc-intentions-001', 0.6],
    ]);

    expect(() => formatTaxonomyContext(
      { povNodes, situationNodes: [], nodeScores },
      'accelerationist',
      50,
    )).not.toThrow();

    const output = formatTaxonomyContext(
      { povNodes, situationNodes: [], nodeScores },
      'accelerationist',
      50,
    );
    expect(output).toContain('[acc-beliefs-001]');
    expect(output).not.toContain('confidence:');
    expect(output).not.toContain('priority:');
    expect(output).not.toContain('operationality:');
  });

  it('falls back to flat rendering when nodes lack parent_id', () => {
    const nodes = [
      makeSit('sit-001', 'Flat Node A', null),
      makeSit('sit-002', 'Flat Node B', null),
    ];
    // Remove parent_id to simulate legacy data
    delete (nodes[0] as Record<string, unknown>).parent_id;
    delete (nodes[1] as Record<string, unknown>).parent_id;

    const nodeScores = new Map([['sit-001', 0.60], ['sit-002', 0.55]]);
    const output = formatTaxonomyContext(
      { povNodes: [], situationNodes: nodes, nodeScores },
      'accelerationist',
      50,
    );

    // Should render without category headers
    expect(output).toContain('[sit-001]');
    expect(output).toContain('[sit-002]');
    expect(output).not.toContain('## ');
  });
});
