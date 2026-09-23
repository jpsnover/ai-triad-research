// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  makeINode,
  makeCaNode,
  makeRaNode,
  makeAifGraph,
  iNodeId,
  caNodeId,
  raNodeId,
} from './graph.js';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function acc(id = 'i-0') {
  return makeINode(id, 'accelerationist', 0, 1, 'AI will transform the economy.', false);
}

function saf(id = 'i-1') {
  return makeINode(id, 'safetyist', 1, 1, 'Alignment is unsolved.', false);
}

function skp(id = 'i-2') {
  return makeINode(id, 'skeptic', 2, 1, 'Evidence is weak.', false);
}

function usr(id = 'i-3') {
  return makeINode(id, 'user', 3, 2, 'What is your evidence?', false);
}

// ── ID helpers ────────────────────────────────────────────────────────────────

describe('ID helpers', () => {
  it('produces expected prefixes', () => {
    expect(iNodeId(0)).toBe('i-0');
    expect(caNodeId(3)).toBe('ca-3');
    expect(raNodeId(7)).toBe('ra-7');
  });
});

// ── makeINode ─────────────────────────────────────────────────────────────────

describe('makeINode', () => {
  it('produces a claim token with all fields', () => {
    const n = makeINode('i-0', 'accelerationist', 0, 1, 'text', false);
    expect(n).toEqual({ id: 'i-0', type: 'claim', speaker: 'accelerationist', turn: 0, round: 1, text: 'text', held: false });
  });

  it('accepts user as a speaker', () => {
    const n = makeINode('i-0', 'user', 5, 2, 'user claim', true);
    expect(n.speaker).toBe('user');
    expect(n.held).toBe(true);
  });

  it('held=true records a retained_hold token', () => {
    const n = makeINode('i-1', 'safetyist', 2, 1, 'still true', true);
    expect(n.held).toBe(true);
  });
});

// ── makeCaNode ────────────────────────────────────────────────────────────────

describe('makeCaNode', () => {
  it('creates a cross-agent conflict edge', () => {
    const nodes = [acc(), saf()];
    const ca = makeCaNode('ca-0', nodes, 'i-0', 'i-1');
    expect(ca).toEqual({ id: 'ca-0', type: 'conflict', attacker: 'i-0', target: 'i-1' });
  });

  it('allows accelerationist attacking safetyist', () => {
    const nodes = [acc(), saf()];
    expect(() => makeCaNode('ca-0', nodes, 'i-0', 'i-1')).not.toThrow();
  });

  it('allows user attacking a debater', () => {
    const nodes = [acc(), usr()];
    expect(() => makeCaNode('ca-0', nodes, 'i-3', 'i-0')).not.toThrow();
  });

  it('allows a debater attacking user', () => {
    const nodes = [acc(), usr()];
    expect(() => makeCaNode('ca-0', nodes, 'i-0', 'i-3')).not.toThrow();
  });

  it('throws on same-speaker conflict (CA cross-agent invariant)', () => {
    const nodes = [acc('i-0'), acc('i-4')];
    expect(() => makeCaNode('ca-0', nodes, 'i-0', 'i-4')).toThrowError(/cross-agent invariant/i);
  });

  it('throws when attacker id is not in nodes', () => {
    const nodes = [saf()];
    expect(() => makeCaNode('ca-0', nodes, 'i-99', 'i-1')).toThrowError(/referential integrity/i);
  });

  it('throws when target id is not in nodes', () => {
    const nodes = [acc()];
    expect(() => makeCaNode('ca-0', nodes, 'i-0', 'i-99')).toThrowError(/referential integrity/i);
  });

  it('same-speaker invariant error names the speaker', () => {
    const nodes = [acc('i-0'), acc('i-4')];
    expect(() => makeCaNode('ca-0', nodes, 'i-0', 'i-4')).toThrowError(/accelerationist/);
  });
});

// ── makeRaNode ────────────────────────────────────────────────────────────────

describe('makeRaNode', () => {
  it('creates a support edge (non-concession)', () => {
    const nodes = [acc(), saf()];
    const ra = makeRaNode('ra-0', nodes, 'i-0', 'i-1', false);
    expect(ra).toEqual({ id: 'ra-0', type: 'support', from: 'i-0', to: 'i-1', concession: false });
  });

  it('creates a concession edge', () => {
    const nodes = [acc(), saf()];
    const ra = makeRaNode('ra-1', nodes, 'i-1', 'i-0', true);
    expect(ra.concession).toBe(true);
  });

  it('does NOT enforce cross-agent constraint (same-speaker support allowed)', () => {
    const nodes = [acc('i-0'), acc('i-4')];
    expect(() => makeRaNode('ra-0', nodes, 'i-0', 'i-4', false)).not.toThrow();
  });

  it('throws when from id is not in nodes', () => {
    const nodes = [saf()];
    expect(() => makeRaNode('ra-0', nodes, 'i-99', 'i-1', false)).toThrowError(/referential integrity/i);
  });

  it('throws when to id is not in nodes', () => {
    const nodes = [acc()];
    expect(() => makeRaNode('ra-0', nodes, 'i-0', 'i-99', false)).toThrowError(/referential integrity/i);
  });
});

// ── makeAifGraph ──────────────────────────────────────────────────────────────

describe('makeAifGraph', () => {
  it('assembles a valid graph', () => {
    const nodes = [acc(), saf()];
    const conflicts = [makeCaNode('ca-0', nodes, 'i-0', 'i-1')];
    const supports = [makeRaNode('ra-0', nodes, 'i-0', 'i-1', false)];
    const g = makeAifGraph('debate-1', nodes, conflicts, supports);
    expect(g.debateId).toBe('debate-1');
    expect(g.nodes).toHaveLength(2);
    expect(g.conflicts).toHaveLength(1);
    expect(g.supports).toHaveLength(1);
  });

  it('accepts an empty graph (no edges)', () => {
    const g = makeAifGraph('debate-empty', [], [], []);
    expect(g.nodes).toHaveLength(0);
    expect(g.conflicts).toHaveLength(0);
    expect(g.supports).toHaveLength(0);
  });

  it('throws on CA-node with missing attacker in final graph', () => {
    const nodes = [acc()];
    const badConflict = { id: 'ca-0', type: 'conflict' as const, attacker: 'i-99', target: 'i-0' };
    expect(() => makeAifGraph('debate-1', nodes, [badConflict], [])).toThrowError(/referential integrity/i);
  });

  it('throws on CA-node with missing target in final graph', () => {
    const nodes = [acc()];
    const badConflict = { id: 'ca-0', type: 'conflict' as const, attacker: 'i-0', target: 'i-99' };
    expect(() => makeAifGraph('debate-1', nodes, [badConflict], [])).toThrowError(/referential integrity/i);
  });

  it('throws on RA-node with missing from in final graph', () => {
    const nodes = [acc()];
    const badSupport = { id: 'ra-0', type: 'support' as const, from: 'i-99', to: 'i-0', concession: false };
    expect(() => makeAifGraph('debate-1', nodes, [], [badSupport])).toThrowError(/referential integrity/i);
  });

  it('throws on RA-node with missing to in final graph', () => {
    const nodes = [acc()];
    const badSupport = { id: 'ra-0', type: 'support' as const, from: 'i-0', to: 'i-99', concession: false };
    expect(() => makeAifGraph('debate-1', nodes, [], [badSupport])).toThrowError(/referential integrity/i);
  });

  it('includes all four speaker types as valid I-node speakers', () => {
    const nodes = [acc('i-0'), saf('i-1'), skp('i-2'), usr('i-3')];
    const g = makeAifGraph('debate-full', nodes, [], []);
    expect(g.nodes.map(n => n.speaker)).toEqual(['accelerationist', 'safetyist', 'skeptic', 'user']);
  });
});

// ── turn/round semantics ──────────────────────────────────────────────────────

describe('I-node claim-token semantics', () => {
  it('two I-nodes for the same text at different turns are distinct tokens', () => {
    const n0 = makeINode('i-0', 'accelerationist', 2, 1, 'AI is safe.', false);
    const n5 = makeINode('i-5', 'accelerationist', 5, 2, 'AI is safe.', true);
    expect(n0.id).not.toBe(n5.id);
    expect(n0.turn).toBe(2);
    expect(n5.turn).toBe(5);
    expect(n5.held).toBe(true);
  });

  it('sustained CA-node: attacker and target in different rounds', () => {
    const nodes = [
      makeINode('i-0', 'accelerationist', 0, 1, 'claim A', false),
      makeINode('i-1', 'safetyist', 4, 2, 'claim B', false),
    ];
    const ca = makeCaNode('ca-0', nodes, 'i-1', 'i-0');
    const attackerNode = nodes.find(n => n.id === ca.attacker)!;
    const targetNode = nodes.find(n => n.id === ca.target)!;
    expect(attackerNode.round).not.toBe(targetNode.round);
  });
});
