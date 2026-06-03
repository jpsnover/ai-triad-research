// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { computeTreePriority, assignDesirePriorities } from './desirePriority.js';
import type { PovNode } from './taxonomyTypes.js';

function makeDesireNode(id: string, parentId: string | null, children: string[] = []): PovNode {
  return {
    id,
    category: 'Desires',
    label: `Desire ${id}`,
    description: `A Desire within test discourse that ${id}`,
    parent_id: parentId,
    children,
    situation_refs: [],
  };
}

// ── computeTreePriority ─────────────────────────────────

describe('computeTreePriority', () => {
  it('root-level Desire (no parent) → 4', () => {
    const node = makeDesireNode('acc-desires-001', null, ['acc-desires-002']);
    expect(computeTreePriority(node)).toBe(4);
  });

  it('mid-tree Desire (parent + children) → 3', () => {
    const node = makeDesireNode('acc-desires-002', 'acc-desires-001', ['acc-desires-003']);
    expect(computeTreePriority(node)).toBe(3);
  });

  it('leaf Desire (parent, no children) → 2', () => {
    const node = makeDesireNode('acc-desires-003', 'acc-desires-002', []);
    expect(computeTreePriority(node)).toBe(2);
  });

  it('root with no children → 4 (still root)', () => {
    const node = makeDesireNode('acc-desires-001', null, []);
    expect(computeTreePriority(node)).toBe(4);
  });
});

// ── assignDesirePriorities ──────────────────────────────

describe('assignDesirePriorities', () => {
  it('assigns priority based on tree position', () => {
    const root = makeDesireNode('d-001', null, ['d-002']);
    const mid = makeDesireNode('d-002', 'd-001', ['d-003']);
    const leaf = makeDesireNode('d-003', 'd-002', []);

    const results = assignDesirePriorities([root, mid, leaf], new Set(), '2026-05-24');

    expect(results).toHaveLength(3);
    expect(root.priority).toBe(4);
    expect(mid.priority).toBe(3);
    expect(leaf.priority).toBe(2);
  });

  it('doctrinal boundary overrides to priority 5', () => {
    const leaf = makeDesireNode('d-003', 'd-002', []);
    const doctrinalIds = new Set(['d-003']);

    const results = assignDesirePriorities([leaf], doctrinalIds, '2026-05-24');

    expect(results[0].priority).toBe(5);
    expect(results[0].isDoctrinalBoundary).toBe(true);
    expect(leaf.priority).toBe(5);
  });

  it('creates priority_history with initial entry', () => {
    const node = makeDesireNode('d-001', null);
    assignDesirePriorities([node], new Set(), '2026-05-24');

    expect(node.priority_history).toHaveLength(1);
    expect(node.priority_history![0].date).toBe('2026-05-24');
    expect(node.priority_history![0].delta).toBe(0);
    expect(node.priority_history![0].reason).toContain('root-level');
  });

  it('hardcoded boundary history says so', () => {
    const node = makeDesireNode('d-001', null);
    assignDesirePriorities([node], new Set(['d-001']), '2026-05-24');

    expect(node.priority_history![0].reason).toContain('hardcoded boundary');
  });

  it('skips non-Desire nodes', () => {
    const belief: PovNode = {
      id: 'acc-beliefs-001',
      category: 'Beliefs',
      label: 'Test',
      description: 'A Belief within test discourse that tests',
      parent_id: null,
      children: [],
      situation_refs: [],
    };
    const results = assignDesirePriorities([belief], new Set(), '2026-05-24');

    expect(results).toHaveLength(0);
    expect(belief.priority).toBeUndefined();
  });

  it('handles mixed Desire and non-Desire nodes', () => {
    const desire = makeDesireNode('d-001', null);
    const belief: PovNode = {
      id: 'b-001',
      category: 'Beliefs',
      label: 'Test',
      description: 'A Belief within test discourse that tests',
      parent_id: null,
      children: [],
      situation_refs: [],
    };
    const intention: PovNode = {
      id: 'i-001',
      category: 'Intentions',
      label: 'Test',
      description: 'An Intention within test discourse that tests',
      parent_id: null,
      children: [],
      situation_refs: [],
    };

    const results = assignDesirePriorities([desire, belief, intention], new Set(), '2026-05-24');

    expect(results).toHaveLength(1);
    expect(results[0].nodeId).toBe('d-001');
  });

  it('returns correct result structure', () => {
    const node = makeDesireNode('d-001', 'd-000', ['d-002']);
    const results = assignDesirePriorities([node], new Set(), '2026-05-24');

    expect(results[0]).toEqual({
      nodeId: 'd-001',
      priority: 3,
      isDoctrinalBoundary: false,
    });
  });

  it('handles empty nodes array', () => {
    const results = assignDesirePriorities([], new Set(), '2026-05-24');
    expect(results).toHaveLength(0);
  });

  it('softcoded boundary maps to priority 4', () => {
    const leaf = makeDesireNode('d-003', 'd-002', []);
    const results = assignDesirePriorities(
      [leaf], new Set(), '2026-05-24', new Set(['d-003']),
    );

    expect(results[0].priority).toBe(4);
    expect(results[0].boundaryType).toBe('softcoded');
    expect(results[0].isDoctrinalBoundary).toBe(true);
    expect(leaf.priority).toBe(4);
    expect(leaf.priority_history![0].reason).toContain('softcoded boundary');
  });

  it('hardcoded takes precedence over softcoded when both match', () => {
    const node = makeDesireNode('d-001', null);
    const results = assignDesirePriorities(
      [node], new Set(['d-001']), '2026-05-24', new Set(['d-001']),
    );

    expect(results[0].priority).toBe(5);
    expect(results[0].boundaryType).toBe('hardcoded');
  });

  it('non-boundary node has no boundaryType', () => {
    const node = makeDesireNode('d-001', null);
    const results = assignDesirePriorities([node], new Set(), '2026-05-24');

    expect(results[0].boundaryType).toBeUndefined();
    expect(results[0].isDoctrinalBoundary).toBe(false);
  });

  it('softcoded boundary overrides tree position to 4', () => {
    const leaf = makeDesireNode('d-003', 'd-002', []);
    expect(leaf.children).toHaveLength(0);
    const results = assignDesirePriorities(
      [leaf], new Set(), '2026-05-24', new Set(['d-003']),
    );
    expect(results[0].priority).toBe(4);
  });
});
