// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runNliDirectionGate, buildNliNodeProp } from './nliDirectionGate.js';
import type { ArgumentNetworkNode } from '../types.js';

// Create the fn inside the factory so it's available when vi.mock is hoisted.
// Both the default and named export reference the same fn for cross-env compat.
vi.mock('child_process', () => {
  const fn = vi.fn();
  return { default: { spawnSync: fn }, spawnSync: fn };
});

import { spawnSync } from 'child_process';
const mockSpawn = vi.mocked(spawnSync);

function makeNode(id: string, primaryRef: string | null, text = 'some claim'): ArgumentNetworkNode {
  return {
    id,
    text,
    speaker: 'accelerationist',
    source_entry_id: 'e1',
    taxonomy_refs: [],
    turn_number: 1,
    claim_taxonomy_attribution: primaryRef
      ? { primary_ref: primaryRef, attribution_confidence: 0.7 }
      : undefined,
  } as unknown as ArgumentNetworkNode;
}

function spawnResult(stdout: object, status = 0) {
  return { stdout: JSON.stringify(stdout), stderr: '', status, error: undefined };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('buildNliNodeProp — rich node prop for NLI (t/2744#7)', () => {
  it('joins label and core description with em-dash', () => {
    expect(buildNliNodeProp('Rapid Deployment', 'Faster deployment helps society.')).toBe('Rapid Deployment — Faster deployment helps society.');
  });

  it('strips Encompasses tail from description', () => {
    const desc = 'AI accelerates progress. Encompasses: narrow AI, AGI research.';
    expect(buildNliNodeProp('AI Progress', desc)).toBe('AI Progress — AI accelerates progress.');
  });

  it('strips Excludes tail from description', () => {
    const desc = 'Regulation slows development. Excludes: safety-critical domains.';
    expect(buildNliNodeProp('Regulation Risk', desc)).toBe('Regulation Risk — Regulation slows development.');
  });

  it('falls back to label-only when description is empty', () => {
    expect(buildNliNodeProp('Bare Label', '')).toBe('Bare Label');
  });

  it('falls back to label-only when core is empty after strip', () => {
    const desc = 'Encompasses: everything, nothing.';
    expect(buildNliNodeProp('Label Only', desc)).toBe('Label Only');
  });

  it('richness arm — label-only would not match V1; label+Core does (t/2744#8)', () => {
    // Demonstrates the load-bearing contrast: stripping Encompasses produces the
    // same core text that tau_contra=1.0 was calibrated on (CL 4-variant test).
    const fullDesc = 'Existing laws are insufficient for AI. Encompasses: tort law, liability.';
    const labelOnly = 'Existing Laws Insufficient';
    const labelPlusCore = buildNliNodeProp(labelOnly, fullDesc);
    expect(labelPlusCore).toBe('Existing Laws Insufficient — Existing laws are insufficient for AI.');
    // Bare label (what a naive caller would pass) is shorter and loses the proposition
    expect(labelOnly).not.toContain('insufficient for AI');
    // Rich form preserves the asserted proposition (the inversion-catchable content)
    expect(labelPlusCore).toContain('insufficient for AI');
  });
});

describe('runNliDirectionGate — V4 direction gate (t/2746)', () => {
  it('returns empty result when no nodes are attributed', () => {
    const nodes = [makeNode('AN-1', null)];
    const result = runNliDirectionGate(nodes, new Map(), 'acc');
    expect(result.opposingIds.size).toBe(0);
    expect(result.counts).toEqual({ opposes: 0, agrees: 0, unrelated: 0, unresolved: 0 });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('returns empty result when nodeTextById has no entry for the ref', () => {
    const nodes = [makeNode('AN-1', 'acc-bel-001')];
    const result = runNliDirectionGate(nodes, new Map(), 'acc');
    expect(result.opposingIds.size).toBe(0);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('demotes claim when engine returns opposes', () => {
    const nodes = [makeNode('AN-1', 'acc-bel-001')];
    const nodeMap = new Map([['acc-bel-001', 'AI regulation accelerates progress']]);
    mockSpawn.mockReturnValue(spawnResult([
      { id: 'AN-1', direction: 'opposes', confidence: 1.4, method: 'nli-deberta' },
    ]) as any);

    const result = runNliDirectionGate(nodes, nodeMap, 'acc');
    expect(result.opposingIds.has('AN-1')).toBe(true);
    expect(result.counts.opposes).toBe(1);
    expect(result.counts.agrees).toBe(0);
  });

  it('keeps claim when engine returns unrelated', () => {
    const nodes = [makeNode('AN-1', 'acc-bel-001')];
    const nodeMap = new Map([['acc-bel-001', 'AI regulation accelerates progress']]);
    mockSpawn.mockReturnValue(spawnResult([
      { id: 'AN-1', direction: 'unrelated', confidence: 0.2, method: 'nli-deberta' },
    ]) as any);

    const result = runNliDirectionGate(nodes, nodeMap, 'acc');
    expect(result.opposingIds.has('AN-1')).toBe(false);
    expect(result.counts.unrelated).toBe(1);
  });

  it('keeps claim when engine returns unresolved (fail-safe output)', () => {
    const nodes = [makeNode('AN-1', 'acc-bel-001')];
    const nodeMap = new Map([['acc-bel-001', 'AI regulation accelerates progress']]);
    mockSpawn.mockReturnValue(spawnResult([
      { id: 'AN-1', direction: 'unresolved', confidence: 0.0, method: 'nli-deberta' },
    ]) as any);

    const result = runNliDirectionGate(nodes, nodeMap, 'acc');
    expect(result.opposingIds.size).toBe(0);
    expect(result.counts.unresolved).toBe(1);
  });

  it('keeps claim when engine returns agrees', () => {
    const nodes = [makeNode('AN-1', 'acc-bel-001')];
    const nodeMap = new Map([['acc-bel-001', 'AI regulation accelerates progress']]);
    mockSpawn.mockReturnValue(spawnResult([
      { id: 'AN-1', direction: 'agrees', confidence: 0.5, method: 'nli-deberta' },
    ]) as any);

    const result = runNliDirectionGate(nodes, nodeMap, 'acc');
    expect(result.opposingIds.size).toBe(0);
    expect(result.counts.agrees).toBe(1);
  });

  it('returns empty result (fail-safe) when subprocess exits non-zero', () => {
    const nodes = [makeNode('AN-1', 'acc-bel-001')];
    const nodeMap = new Map([['acc-bel-001', 'some node text']]);
    mockSpawn.mockReturnValue({ stdout: '', stderr: 'ImportError', status: 1, error: undefined } as any);

    const result = runNliDirectionGate(nodes, nodeMap, 'acc');
    expect(result.opposingIds.size).toBe(0);
    expect(result.counts).toEqual({ opposes: 0, agrees: 0, unrelated: 0, unresolved: 0 });
  });

  it('returns empty result (fail-safe) when subprocess throws', () => {
    const nodes = [makeNode('AN-1', 'acc-bel-001')];
    const nodeMap = new Map([['acc-bel-001', 'some node text']]);
    mockSpawn.mockReturnValue({ stdout: '', stderr: '', status: 0, error: new Error('ENOENT') } as any);

    const result = runNliDirectionGate(nodes, nodeMap, 'acc');
    expect(result.opposingIds.size).toBe(0);
  });

  it('returns empty result (fail-safe) when subprocess output is malformed JSON', () => {
    const nodes = [makeNode('AN-1', 'acc-bel-001')];
    const nodeMap = new Map([['acc-bel-001', 'some node text']]);
    mockSpawn.mockReturnValue({ stdout: 'not json', stderr: '', status: 0, error: undefined } as any);

    const result = runNliDirectionGate(nodes, nodeMap, 'acc');
    expect(result.opposingIds.size).toBe(0);
  });

  it('handles mixed batch — demotes only the opposes claim, counts all', () => {
    const nodes = [
      makeNode('AN-1', 'acc-bel-001', 'AI is beneficial'),
      makeNode('AN-2', 'acc-bel-002', 'AI is dangerous'),
    ];
    const nodeMap = new Map([
      ['acc-bel-001', 'AI accelerates progress'],
      ['acc-bel-002', 'AI reduces risk'],
    ]);
    mockSpawn.mockReturnValue(spawnResult([
      { id: 'AN-1', direction: 'agrees', confidence: 0.8, method: 'nli-deberta' },
      { id: 'AN-2', direction: 'opposes', confidence: 1.3, method: 'nli-deberta' },
    ]) as any);

    const result = runNliDirectionGate(nodes, nodeMap, 'acc');
    expect(result.opposingIds.has('AN-1')).toBe(false);
    expect(result.opposingIds.has('AN-2')).toBe(true);
    expect(result.counts).toEqual({ opposes: 1, agrees: 1, unrelated: 0, unresolved: 0 });
  });

  it('passes claim_pov, node_pov, and rich node_prop to the subprocess', () => {
    const desc = 'AI cannot be regulated. Encompasses: AI safety, AGI policy.';
    const nodes = [makeNode('AN-1', 'saf-bel-001', 'safety first')];
    const nodeMap = new Map([['saf-bel-001', buildNliNodeProp('Unregulatable AI', desc)]]);
    mockSpawn.mockReturnValue(spawnResult([
      { id: 'AN-1', direction: 'unrelated', confidence: 0.1, method: 'nli-deberta' },
    ]) as any);

    runNliDirectionGate(nodes, nodeMap, 'safetyist');

    const callArgs = mockSpawn.mock.calls[0];
    const stdin = callArgs[2]?.input as string;
    const parsed = JSON.parse(stdin);
    expect(parsed[0].claim_pov).toBe('safetyist');
    expect(parsed[0].node_pov).toBe('safetyist');
    // Rich node_prop: label+Core with Encompasses stripped
    expect(parsed[0].node_prop).toBe('Unregulatable AI — AI cannot be regulated.');
    expect(parsed[0].node_prop).not.toContain('Encompasses');
  });
});
