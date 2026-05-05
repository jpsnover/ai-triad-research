// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  classifyOutcome,
  countReferences,
  classifyClaimOutcomes,
  summarizeOutcomes,
} from './claimOutcomes.js';
import type { ArgumentNetworkNode, ArgumentNetworkEdge } from './types.js';

// ── Helpers ───────────────────────────────────────────────

function makeNode(overrides: Partial<ArgumentNetworkNode> = {}): ArgumentNetworkNode {
  return {
    id: 'n1',
    text: 'Test claim about AI regulation',
    speaker: 'prometheus',
    source_entry_id: 'e1',
    taxonomy_refs: [],
    turn_number: 1,
    base_strength: 0.5,
    computed_strength: 0.5,
    ...overrides,
  };
}

function makeEdge(source: string, target: string): ArgumentNetworkEdge {
  return { id: `${source}-${target}`, source, target, type: 'attacks' };
}

// ── classifyOutcome ──────────────────────────────────────

describe('classifyOutcome', () => {
  it('classifies as thrived when strength ≥ 0.5 and refs ≥ 2', () => {
    const node = makeNode({ computed_strength: 0.7 });
    expect(classifyOutcome(node, 3)).toBe('thrived');
  });

  it('classifies as thrived at boundary (0.5 strength, 2 refs)', () => {
    const node = makeNode({ computed_strength: 0.5 });
    expect(classifyOutcome(node, 2)).toBe('thrived');
  });

  it('classifies as survived when strength ≥ 0.3 but refs < 2', () => {
    const node = makeNode({ computed_strength: 0.4 });
    expect(classifyOutcome(node, 1)).toBe('survived');
  });

  it('classifies as survived when strength < 0.3 but has refs', () => {
    const node = makeNode({ computed_strength: 0.2 });
    expect(classifyOutcome(node, 1)).toBe('survived');
  });

  it('classifies as died when strength < 0.3 and no refs', () => {
    const node = makeNode({ computed_strength: 0.1 });
    expect(classifyOutcome(node, 0)).toBe('died');
  });

  it('uses base_strength when computed_strength is absent', () => {
    const node = makeNode({ computed_strength: undefined, base_strength: 0.6 });
    expect(classifyOutcome(node, 2)).toBe('thrived');
  });

  it('defaults to 0.5 when both strengths are absent', () => {
    const node = makeNode({ computed_strength: undefined, base_strength: undefined });
    expect(classifyOutcome(node, 2)).toBe('thrived');
  });
});

// ── countReferences ──────────────────────────────────────

describe('countReferences', () => {
  it('counts edges where node is source or target', () => {
    const edges = [
      makeEdge('n1', 'n2'),
      makeEdge('n3', 'n1'),
      makeEdge('n2', 'n3'),
    ];
    expect(countReferences('n1', edges)).toBe(2);
  });

  it('returns 0 for unconnected node', () => {
    const edges = [makeEdge('n2', 'n3')];
    expect(countReferences('n1', edges)).toBe(0);
  });
});

// ── classifyClaimOutcomes ────────────────────────────────

describe('classifyClaimOutcomes', () => {
  it('excludes system and document nodes', () => {
    const nodes = [
      makeNode({ id: 'n1', speaker: 'prometheus' }),
      makeNode({ id: 'n2', speaker: 'system' }),
      makeNode({ id: 'n3', speaker: 'document' }),
    ];
    const outcomes = classifyClaimOutcomes(nodes, []);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].claim_id).toBe('n1');
  });

  it('classifies multiple nodes correctly', () => {
    const nodes = [
      makeNode({ id: 'n1', computed_strength: 0.8 }),
      makeNode({ id: 'n2', computed_strength: 0.4 }),
      makeNode({ id: 'n3', computed_strength: 0.1 }),
    ];
    const edges = [
      makeEdge('n1', 'n2'),
      makeEdge('n2', 'n1'),
      makeEdge('n1', 'n3'),
    ];
    const outcomes = classifyClaimOutcomes(nodes, edges);
    expect(outcomes[0].outcome).toBe('thrived');  // n1: 0.8, 3 refs
    expect(outcomes[1].outcome).toBe('survived'); // n2: 0.4, 2 refs
    expect(outcomes[2].outcome).toBe('survived'); // n3: 0.1, 1 ref
  });
});

// ── summarizeOutcomes ────────────────────────────────────

describe('summarizeOutcomes', () => {
  it('computes correct aggregate stats', () => {
    const outcomes = [
      { outcome: 'thrived' as const },
      { outcome: 'thrived' as const },
      { outcome: 'survived' as const },
      { outcome: 'died' as const },
    ].map(o => ({
      claim_id: '', speaker: '', text_length: 100,
      base_strength: 0.5, final_computed_strength: 0.5, reference_count: 0,
      ...o,
    }));

    const summary = summarizeOutcomes(outcomes);
    expect(summary.total).toBe(4);
    expect(summary.thrived).toBe(2);
    expect(summary.survived).toBe(1);
    expect(summary.died).toBe(1);
    expect(summary.thrived_rate).toBe(0.5);
    expect(summary.died_rate).toBe(0.25);
  });

  it('handles empty input', () => {
    const summary = summarizeOutcomes([]);
    expect(summary.total).toBe(0);
    expect(summary.thrived_rate).toBe(0);
    expect(summary.died_rate).toBe(0);
  });
});
