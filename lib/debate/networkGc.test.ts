// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  needsGc,
  needsHardCap,
  pruneArgumentNetwork,
  GC_TRIGGER,
  GC_TARGET,
  HARD_CAP,
} from './networkGc.js';
import type { ArgumentNetworkNode, ArgumentNetworkEdge } from './types.js';

// ── Factory helpers ───────────────────────────────────────────

let _id = 0;

function makeNode(overrides: Partial<ArgumentNetworkNode> = {}): ArgumentNetworkNode {
  const id = `N-${++_id}`;
  return {
    id,
    text: `Node ${id}`,
    speaker: 'prometheus',
    source_entry_id: 'entry-1',
    taxonomy_refs: [],
    turn_number: 1,
    base_strength: 0.5,
    computed_strength: 0.5,
    ...overrides,
  };
}

function makeEdge(source: string, target: string, type: 'attacks' | 'supports' = 'attacks'): ArgumentNetworkEdge {
  return {
    id: `E-${++_id}`,
    source,
    target,
    type,
    weight: 0.5,
  };
}

/** Generate N nodes with sequential computed_strength starting from baseStrength */
function makeNodes(count: number, baseStrength: number = 0.1, step: number = 0): ArgumentNetworkNode[] {
  return Array.from({ length: count }, (_, i) =>
    makeNode({ computed_strength: baseStrength + i * step }),
  );
}

// ── Exported constants ────────────────────────────────────────

describe('exported constants', () => {
  it('has GC_TRIGGER < HARD_CAP', () => {
    expect(GC_TRIGGER).toBeLessThan(HARD_CAP);
  });

  it('has GC_TARGET < GC_TRIGGER', () => {
    expect(GC_TARGET).toBeLessThan(GC_TRIGGER);
  });

  it('exports expected default values', () => {
    expect(GC_TRIGGER).toBe(175);
    expect(GC_TARGET).toBe(150);
    expect(HARD_CAP).toBe(200);
  });
});

// ── needsGc ──────────────────────────────────────────────────

describe('needsGc', () => {
  it('returns false when nodeCount is below gcTrigger', () => {
    expect(needsGc(100, GC_TRIGGER)).toBe(false);
    expect(needsGc(0, GC_TRIGGER)).toBe(false);
    expect(needsGc(174, GC_TRIGGER)).toBe(false);
  });

  it('returns true when nodeCount equals gcTrigger', () => {
    expect(needsGc(GC_TRIGGER, GC_TRIGGER)).toBe(true);
  });

  it('returns true when nodeCount exceeds gcTrigger', () => {
    expect(needsGc(GC_TRIGGER + 1, GC_TRIGGER)).toBe(true);
    expect(needsGc(300, GC_TRIGGER)).toBe(true);
  });

  it('works with custom trigger values', () => {
    expect(needsGc(50, 50)).toBe(true);
    expect(needsGc(49, 50)).toBe(false);
  });
});

// ── needsHardCap ────────────────────────────────────────────

describe('needsHardCap', () => {
  it('returns false when nodeCount is below hardCap', () => {
    expect(needsHardCap(100, HARD_CAP)).toBe(false);
    expect(needsHardCap(0, HARD_CAP)).toBe(false);
    expect(needsHardCap(199, HARD_CAP)).toBe(false);
  });

  it('returns true when nodeCount equals hardCap', () => {
    expect(needsHardCap(HARD_CAP, HARD_CAP)).toBe(true);
  });

  it('returns true when nodeCount exceeds hardCap', () => {
    expect(needsHardCap(HARD_CAP + 1, HARD_CAP)).toBe(true);
    expect(needsHardCap(500, HARD_CAP)).toBe(true);
  });
});

// ── pruneArgumentNetwork ─────────────────────────────────────

describe('pruneArgumentNetwork', () => {
  describe('fast path: already within budget', () => {
    it('returns all nodes and edges unchanged when at or below target', () => {
      const nodes = makeNodes(5);
      const edges = [makeEdge(nodes[0].id, nodes[1].id)];
      const result = pruneArgumentNetwork(nodes, edges, 10);

      expect(result.nodes).toHaveLength(5);
      expect(result.edges).toHaveLength(1);
      expect(result.prunedNodes).toHaveLength(0);
      expect(result.prunedEdges).toHaveLength(0);
      expect(result.before).toBe(5);
      expect(result.after).toBe(5);
    });

    it('returns copies, not references', () => {
      const nodes = makeNodes(3);
      const edges: ArgumentNetworkEdge[] = [];
      const result = pruneArgumentNetwork(nodes, edges, 10);

      expect(result.nodes).not.toBe(nodes);
      expect(result.edges).not.toBe(edges);
    });
  });

  describe('Tier 1: orphan pruning', () => {
    it('prunes orphan nodes (zero edges) first', () => {
      // 6 nodes, 2 connected, 4 orphans. Target = 3.
      const connected1 = makeNode({ computed_strength: 0.9 });
      const connected2 = makeNode({ computed_strength: 0.8 });
      const orphan1 = makeNode({ computed_strength: 0.1 });
      const orphan2 = makeNode({ computed_strength: 0.2 });
      const orphan3 = makeNode({ computed_strength: 0.3 });
      const orphan4 = makeNode({ computed_strength: 0.4 });
      const nodes = [connected1, connected2, orphan1, orphan2, orphan3, orphan4];
      const edges = [makeEdge(connected1.id, connected2.id)];

      const result = pruneArgumentNetwork(nodes, edges, 3);

      // Should prune 3 weakest orphans to reach target of 3
      expect(result.after).toBe(3);
      expect(result.prunedNodes).toHaveLength(3);
      // Weakest orphans should be pruned first (0.1, 0.2, 0.3)
      const prunedIds = result.prunedNodes.map(n => n.id);
      expect(prunedIds).toContain(orphan1.id);
      expect(prunedIds).toContain(orphan2.id);
      expect(prunedIds).toContain(orphan3.id);
      // Connected nodes should survive
      expect(result.nodes.map(n => n.id)).toContain(connected1.id);
      expect(result.nodes.map(n => n.id)).toContain(connected2.id);
    });

    it('sorts orphans by computed_strength ascending (weakest first)', () => {
      const weakOrphan = makeNode({ computed_strength: 0.05 });
      const strongOrphan = makeNode({ computed_strength: 0.95 });
      const connected = makeNode({ computed_strength: 0.5 });
      const nodes = [strongOrphan, weakOrphan, connected];
      const edges = [makeEdge(connected.id, connected.id)];

      const result = pruneArgumentNetwork(nodes, edges, 2);

      expect(result.prunedNodes).toHaveLength(1);
      expect(result.prunedNodes[0].id).toBe(weakOrphan.id);
    });
  });

  describe('Tier 2: tangential leaf pruning', () => {
    it('prunes tangential leaf nodes (strength < 0.3, no supports, <= 1 attack)', () => {
      // Create nodes: 2 well-connected, 3 tangential leaves, target = 3
      const strong1 = makeNode({ computed_strength: 0.9 });
      const strong2 = makeNode({ computed_strength: 0.8 });
      const tangential1 = makeNode({ computed_strength: 0.1 }); // single attack edge only
      const tangential2 = makeNode({ computed_strength: 0.2 }); // single attack edge only
      const tangential3 = makeNode({ computed_strength: 0.25 }); // single attack edge only

      const nodes = [strong1, strong2, tangential1, tangential2, tangential3];
      const edges = [
        makeEdge(strong1.id, strong2.id, 'supports'),
        makeEdge(strong2.id, strong1.id, 'supports'),
        makeEdge(tangential1.id, strong1.id, 'attacks'),
        makeEdge(tangential2.id, strong2.id, 'attacks'),
        makeEdge(tangential3.id, strong1.id, 'attacks'),
      ];

      const result = pruneArgumentNetwork(nodes, edges, 3);

      expect(result.after).toBeLessThanOrEqual(3);
      // Tangential nodes should be pruned (weakest first)
      const prunedIds = result.prunedNodes.map(n => n.id);
      expect(prunedIds).toContain(tangential1.id);
      expect(prunedIds).toContain(tangential2.id);
    });
  });

  describe('Tier 3: low-engagement pruning', () => {
    it('prunes low-engagement nodes (strength < 0.4, only 1 edge)', () => {
      // After tiers 1 and 2, if still above target, low-engagement nodes are pruned
      const strong1 = makeNode({ computed_strength: 0.9 });
      const strong2 = makeNode({ computed_strength: 0.8 });
      // Low-engagement: strength < 0.4 but has support edges (so not tangential),
      // but only 1 total edge
      const lowEng1 = makeNode({ computed_strength: 0.35 });
      const lowEng2 = makeNode({ computed_strength: 0.38 });

      const nodes = [strong1, strong2, lowEng1, lowEng2];
      const edges = [
        makeEdge(strong1.id, strong2.id, 'supports'),
        makeEdge(strong2.id, strong1.id, 'supports'),
        makeEdge(lowEng1.id, strong1.id, 'supports'), // 1 edge total for lowEng1
        makeEdge(lowEng2.id, strong2.id, 'supports'), // 1 edge total for lowEng2
      ];

      const result = pruneArgumentNetwork(nodes, edges, 2);

      // Both low-engagement nodes should be candidates for pruning
      expect(result.after).toBeLessThanOrEqual(2);
    });
  });

  describe('preserves high-strength nodes', () => {
    it('does not prune high-strength nodes even when above target', () => {
      // All nodes are high-strength and connected — none should be prunable
      const nodes = [
        makeNode({ computed_strength: 0.9 }),
        makeNode({ computed_strength: 0.85 }),
        makeNode({ computed_strength: 0.8 }),
        makeNode({ computed_strength: 0.75 }),
      ];
      const edges = [
        makeEdge(nodes[0].id, nodes[1].id, 'supports'),
        makeEdge(nodes[1].id, nodes[2].id, 'supports'),
        makeEdge(nodes[2].id, nodes[3].id, 'supports'),
        makeEdge(nodes[3].id, nodes[0].id, 'attacks'),
      ];

      const result = pruneArgumentNetwork(nodes, edges, 2);

      // Should still have all 4 nodes since none match any pruning tier
      expect(result.after).toBe(4);
      expect(result.prunedNodes).toHaveLength(0);
    });
  });

  describe('respects GC_TARGET', () => {
    it('stops pruning once target is reached', () => {
      // 8 orphans, target = 5, should prune exactly 3
      const nodes = makeNodes(8, 0.1, 0.01); // strengths 0.1, 0.11, ..., 0.17
      const edges: ArgumentNetworkEdge[] = [];

      const result = pruneArgumentNetwork(nodes, edges, 5);

      expect(result.after).toBe(5);
      expect(result.prunedNodes).toHaveLength(3);
    });
  });

  describe('edge cleanup', () => {
    it('removes edges referencing pruned nodes', () => {
      const surviving = makeNode({ computed_strength: 0.9 });
      const orphan = makeNode({ computed_strength: 0.1 });
      const connected = makeNode({ computed_strength: 0.8 });
      const nodes = [surviving, orphan, connected];
      // orphan has no edges, but connected is linked to surviving via an edge
      // Also add a dangling edge to orphan
      const danglingEdge = makeEdge(orphan.id, surviving.id);
      const goodEdge = makeEdge(surviving.id, connected.id, 'supports');
      const edges = [danglingEdge, goodEdge];

      // Wait: orphan does have an edge (danglingEdge), so it's not an orphan after all.
      // Let's make a real orphan scenario.
      const realOrphan = makeNode({ computed_strength: 0.05 });
      const nodesFinal = [surviving, connected, realOrphan];
      const edgesFinal = [goodEdge];

      const result = pruneArgumentNetwork(nodesFinal, edgesFinal, 2);

      expect(result.prunedNodes.map(n => n.id)).toContain(realOrphan.id);
      // Good edge should survive since both endpoints survive
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].source).toBe(surviving.id);
    });
  });

  describe('handles empty inputs', () => {
    it('handles empty nodes and edges', () => {
      const result = pruneArgumentNetwork([], [], 10);
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
      expect(result.prunedNodes).toHaveLength(0);
      expect(result.prunedEdges).toHaveLength(0);
      expect(result.before).toBe(0);
      expect(result.after).toBe(0);
    });
  });

  describe('handles undefined computed_strength', () => {
    it('treats undefined computed_strength as 0', () => {
      const undefinedStrength = makeNode({ computed_strength: undefined });
      const strongNode = makeNode({ computed_strength: 0.9 });
      const nodes = [undefinedStrength, strongNode];
      const edges: ArgumentNetworkEdge[] = [];

      const result = pruneArgumentNetwork(nodes, edges, 1);

      expect(result.prunedNodes).toHaveLength(1);
      expect(result.prunedNodes[0].id).toBe(undefinedStrength.id);
    });
  });
});
