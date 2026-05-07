// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { computeEdgeAttribution } from './qbaf.js';
import type { QbafNode, QbafEdge } from './qbaf.js';

describe('computeEdgeAttribution', () => {
  it('identifies attack as negative attribution', () => {
    const nodes: QbafNode[] = [{ id: 'A', base_strength: 0.8 }, { id: 'B', base_strength: 0.7 }];
    const edges: QbafEdge[] = [{ source: 'B', target: 'A', type: 'attacks', weight: 0.6, attack_type: 'rebut' }];
    const attr = computeEdgeAttribution(nodes, edges, 'A');
    const val = attr.get('B→A');
    expect(val).toBeDefined();
    expect(val!).toBeLessThan(0);
  });

  it('identifies support as positive attribution', () => {
    const nodes: QbafNode[] = [{ id: 'A', base_strength: 0.5 }, { id: 'B', base_strength: 0.7 }];
    const edges: QbafEdge[] = [{ source: 'B', target: 'A', type: 'supports', weight: 0.8 }];
    const attr = computeEdgeAttribution(nodes, edges, 'A');
    const val = attr.get('B→A');
    expect(val).toBeDefined();
    expect(val!).toBeGreaterThan(0);
  });

  it('returns empty map for node with no edges', () => {
    const nodes: QbafNode[] = [{ id: 'A', base_strength: 0.8 }];
    const attr = computeEdgeAttribution(nodes, [], 'A');
    expect(attr.size).toBe(0);
  });

  it('ranks multiple edges by attribution magnitude', () => {
    const nodes: QbafNode[] = [
      { id: 'A', base_strength: 0.8 },
      { id: 'B', base_strength: 0.9 },
      { id: 'C', base_strength: 0.3 },
    ];
    const edges: QbafEdge[] = [
      { source: 'B', target: 'A', type: 'attacks', weight: 0.9, attack_type: 'rebut' },
      { source: 'C', target: 'A', type: 'attacks', weight: 0.2, attack_type: 'rebut' },
    ];
    const attr = computeEdgeAttribution(nodes, edges, 'A');
    const bAttr = Math.abs(attr.get('B→A') ?? 0);
    const cAttr = Math.abs(attr.get('C→A') ?? 0);
    expect(bAttr).toBeGreaterThan(cAttr);
  });
});
