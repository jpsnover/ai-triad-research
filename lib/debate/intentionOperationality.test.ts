// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  computeTreeBase,
  falsifiabilityModifier,
  computeOperationality,
  assignIntentionOperationality,
} from './intentionOperationality.js';
import type { PovNode } from './taxonomyTypes.js';

function makeIntentionNode(
  id: string,
  opts: {
    parent_id?: string | null;
    children?: string[];
    falsifiability?: string;
    situation_refs?: string[];
  } = {},
): PovNode {
  return {
    id,
    category: 'Intentions',
    label: `Intention ${id}`,
    description: `An Intention within test discourse that ${id}`,
    parent_id: opts.parent_id ?? null,
    children: opts.children ?? [],
    situation_refs: opts.situation_refs ?? [],
    graph_attributes: opts.falsifiability ? { falsifiability: opts.falsifiability } : undefined,
  };
}

// ── computeTreeBase ─────────────────────────────────────

describe('computeTreeBase', () => {
  it('returns 4 for leaf node (no children)', () => {
    const node = makeIntentionNode('i-001', { parent_id: 'i-000', children: [] });
    expect(computeTreeBase(node)).toBe(4);
  });

  it('returns 3 for mid-tree node (parent + children)', () => {
    const node = makeIntentionNode('i-001', { parent_id: 'i-000', children: ['i-002'] });
    expect(computeTreeBase(node)).toBe(3);
  });

  it('returns 2 for root node (no parent)', () => {
    const node = makeIntentionNode('i-001', { parent_id: null, children: ['i-002'] });
    expect(computeTreeBase(node)).toBe(2);
  });

  it('returns 4 for root leaf (no parent, no children)', () => {
    // Edge case: root with no children is still a leaf
    const node = makeIntentionNode('i-001', { parent_id: null, children: [] });
    expect(computeTreeBase(node)).toBe(4);
  });
});

// ── falsifiabilityModifier ──────────────────────────────

describe('falsifiabilityModifier', () => {
  it('returns +1 for high falsifiability', () => {
    const node = makeIntentionNode('i-001', { falsifiability: 'high' });
    expect(falsifiabilityModifier(node)).toBe(1);
  });

  it('returns -1 for low falsifiability', () => {
    const node = makeIntentionNode('i-001', { falsifiability: 'low' });
    expect(falsifiabilityModifier(node)).toBe(-1);
  });

  it('returns 0 for medium falsifiability', () => {
    const node = makeIntentionNode('i-001', { falsifiability: 'medium' });
    expect(falsifiabilityModifier(node)).toBe(0);
  });

  it('returns 0 when no graph_attributes', () => {
    const node = makeIntentionNode('i-001');
    expect(falsifiabilityModifier(node)).toBe(0);
  });

  it('returns 0 when falsifiability is absent', () => {
    const node = makeIntentionNode('i-001');
    node.graph_attributes = { epistemic_type: 'strategic_recommendation' };
    expect(falsifiabilityModifier(node)).toBe(0);
  });
});

// ── computeOperationality ───────────────────────────────

describe('computeOperationality', () => {
  it('leaf + medium falsifiability → 4', () => {
    const node = makeIntentionNode('i-001', { parent_id: 'i-000' });
    expect(computeOperationality(node)).toBe(4);
  });

  it('leaf + high falsifiability → 5', () => {
    const node = makeIntentionNode('i-001', { parent_id: 'i-000', falsifiability: 'high' });
    expect(computeOperationality(node)).toBe(5);
  });

  it('leaf + low falsifiability → 3', () => {
    const node = makeIntentionNode('i-001', { parent_id: 'i-000', falsifiability: 'low' });
    expect(computeOperationality(node)).toBe(3);
  });

  it('leaf + situation grounding → 5 (clamped)', () => {
    const node = makeIntentionNode('i-001', { parent_id: 'i-000', situation_refs: ['sit-001'] });
    expect(computeOperationality(node)).toBe(5);
  });

  it('root + low falsifiability → 1', () => {
    const node = makeIntentionNode('i-001', { parent_id: null, children: ['i-002'], falsifiability: 'low' });
    expect(computeOperationality(node)).toBe(1);
  });

  it('root + high falsifiability → 3', () => {
    const node = makeIntentionNode('i-001', { parent_id: null, children: ['i-002'], falsifiability: 'high' });
    expect(computeOperationality(node)).toBe(3);
  });

  it('mid-tree + medium → 3', () => {
    const node = makeIntentionNode('i-001', { parent_id: 'i-000', children: ['i-002'] });
    expect(computeOperationality(node)).toBe(3);
  });

  it('mid-tree + high + situation → 5 (clamped)', () => {
    const node = makeIntentionNode('i-001', {
      parent_id: 'i-000', children: ['i-002'],
      falsifiability: 'high', situation_refs: ['sit-001'],
    });
    expect(computeOperationality(node)).toBe(5);
  });

  it('clamps to minimum 1', () => {
    // root (2) + low (-1) = 1, already minimum
    const node = makeIntentionNode('i-001', { parent_id: null, children: ['i-002'], falsifiability: 'low' });
    expect(computeOperationality(node)).toBe(1);
  });

  it('clamps to maximum 5', () => {
    // leaf (4) + high (+1) + situation (+1) = 6 → clamped to 5
    const node = makeIntentionNode('i-001', {
      parent_id: 'i-000',
      falsifiability: 'high',
      situation_refs: ['sit-001'],
    });
    expect(computeOperationality(node)).toBe(5);
  });
});

// ── assignIntentionOperationality ───────────────────────

describe('assignIntentionOperationality', () => {
  it('assigns operationality to Intention nodes only', () => {
    const nodes: PovNode[] = [
      makeIntentionNode('i-001', { parent_id: 'i-000' }),
      {
        id: 'b-001', category: 'Beliefs', label: 'Belief',
        description: 'A Belief within test discourse that tests',
        parent_id: null, children: [], situation_refs: [],
      },
      makeIntentionNode('i-002', { parent_id: null, children: ['i-001'] }),
    ];

    const results = assignIntentionOperationality(nodes, '2026-05-25');

    expect(results).toHaveLength(2);
    expect(results[0].nodeId).toBe('i-001');
    expect(results[0].operationality).toBe(4); // leaf
    expect(results[1].nodeId).toBe('i-002');
    expect(results[1].operationality).toBe(2); // root
  });

  it('mutates nodes in place', () => {
    const node = makeIntentionNode('i-001', { parent_id: 'i-000', falsifiability: 'high' });
    assignIntentionOperationality([node], '2026-05-25');

    expect(node.operationality).toBe(5);
    expect(node.operationality_history).toHaveLength(1);
    expect(node.operationality_history![0].value).toBe(5);
    expect(node.operationality_history![0].delta).toBe(0);
    expect(node.operationality_history![0].reason).toContain('leaf');
    expect(node.operationality_history![0].reason).toContain('falsifiability +1');
  });

  it('records situation grounding in reason', () => {
    const node = makeIntentionNode('i-001', { parent_id: 'i-000', situation_refs: ['sit-001'] });
    assignIntentionOperationality([node], '2026-05-25');

    expect(node.operationality_history![0].reason).toContain('situation grounded');
  });

  it('returns result details for each node', () => {
    const node = makeIntentionNode('i-001', {
      parent_id: 'i-000', falsifiability: 'low', situation_refs: ['sit-001'],
    });
    const [result] = assignIntentionOperationality([node], '2026-05-25');

    expect(result.treeBase).toBe(4);
    expect(result.falsifiabilityMod).toBe(-1);
    expect(result.situationBonus).toBe(1);
    expect(result.operationality).toBe(4); // 4 - 1 + 1 = 4
  });

  it('returns empty array when no Intentions', () => {
    const belief: PovNode = {
      id: 'b-001', category: 'Beliefs', label: 'B',
      description: 'A Belief within test discourse that tests',
      parent_id: null, children: [], situation_refs: [],
    };
    expect(assignIntentionOperationality([belief], '2026-05-25')).toHaveLength(0);
  });
});
