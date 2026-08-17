// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runNliDirectionGate } from './nliDirectionGate.js';
import type { ArgumentNetworkNode } from '../types.js';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), spawnSync: vi.fn() };
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

describe('runNliDirectionGate — V4 direction gate (t/2746)', () => {
  it('returns empty set when no nodes are attributed', () => {
    const nodes = [makeNode('AN-1', null)];
    const result = runNliDirectionGate(nodes, new Map(), 'acc');
    expect(result.size).toBe(0);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('returns empty set when nodeTextById has no entry for the ref', () => {
    const nodes = [makeNode('AN-1', 'acc-bel-001')];
    const result = runNliDirectionGate(nodes, new Map(), 'acc');
    expect(result.size).toBe(0);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('demotes claim when engine returns opposes', () => {
    const nodes = [makeNode('AN-1', 'acc-bel-001')];
    const nodeMap = new Map([['acc-bel-001', 'AI regulation accelerates progress']]);
    mockSpawn.mockReturnValue(spawnResult([
      { id: 'AN-1', direction: 'opposes', confidence: 1.4, method: 'nli-deberta' },
    ]) as any);

    const result = runNliDirectionGate(nodes, nodeMap, 'acc');
    expect(result.has('AN-1')).toBe(true);
    expect(result.size).toBe(1);
  });

  it('keeps claim when engine returns unrelated', () => {
    const nodes = [makeNode('AN-1', 'acc-bel-001')];
    const nodeMap = new Map([['acc-bel-001', 'AI regulation accelerates progress']]);
    mockSpawn.mockReturnValue(spawnResult([
      { id: 'AN-1', direction: 'unrelated', confidence: 0.2, method: 'nli-deberta' },
    ]) as any);

    const result = runNliDirectionGate(nodes, nodeMap, 'acc');
    expect(result.has('AN-1')).toBe(false);
  });

  it('keeps claim when engine returns unresolved (fail-safe output)', () => {
    const nodes = [makeNode('AN-1', 'acc-bel-001')];
    const nodeMap = new Map([['acc-bel-001', 'AI regulation accelerates progress']]);
    mockSpawn.mockReturnValue(spawnResult([
      { id: 'AN-1', direction: 'unresolved', confidence: 0.0, method: 'nli-deberta' },
    ]) as any);

    const result = runNliDirectionGate(nodes, nodeMap, 'acc');
    expect(result.size).toBe(0);
  });

  it('keeps claim when engine returns agrees', () => {
    const nodes = [makeNode('AN-1', 'acc-bel-001')];
    const nodeMap = new Map([['acc-bel-001', 'AI regulation accelerates progress']]);
    mockSpawn.mockReturnValue(spawnResult([
      { id: 'AN-1', direction: 'agrees', confidence: 0.5, method: 'nli-deberta' },
    ]) as any);

    const result = runNliDirectionGate(nodes, nodeMap, 'acc');
    expect(result.size).toBe(0);
  });

  it('returns empty set (fail-safe) when subprocess exits non-zero', () => {
    const nodes = [makeNode('AN-1', 'acc-bel-001')];
    const nodeMap = new Map([['acc-bel-001', 'some node text']]);
    mockSpawn.mockReturnValue({ stdout: '', stderr: 'ImportError', status: 1, error: undefined } as any);

    const result = runNliDirectionGate(nodes, nodeMap, 'acc');
    expect(result.size).toBe(0);
  });

  it('returns empty set (fail-safe) when subprocess throws', () => {
    const nodes = [makeNode('AN-1', 'acc-bel-001')];
    const nodeMap = new Map([['acc-bel-001', 'some node text']]);
    mockSpawn.mockReturnValue({ stdout: '', stderr: '', status: 0, error: new Error('ENOENT') } as any);

    const result = runNliDirectionGate(nodes, nodeMap, 'acc');
    expect(result.size).toBe(0);
  });

  it('returns empty set (fail-safe) when subprocess output is malformed JSON', () => {
    const nodes = [makeNode('AN-1', 'acc-bel-001')];
    const nodeMap = new Map([['acc-bel-001', 'some node text']]);
    mockSpawn.mockReturnValue({ stdout: 'not json', stderr: '', status: 0, error: undefined } as any);

    const result = runNliDirectionGate(nodes, nodeMap, 'acc');
    expect(result.size).toBe(0);
  });

  it('handles mixed batch — demotes only the opposes claim', () => {
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
    expect(result.has('AN-1')).toBe(false);
    expect(result.has('AN-2')).toBe(true);
  });

  it('passes claim_pov and node_pov to the subprocess', () => {
    const nodes = [makeNode('AN-1', 'saf-bel-001', 'safety first')];
    const nodeMap = new Map([['saf-bel-001', 'safety matters']]);
    mockSpawn.mockReturnValue(spawnResult([
      { id: 'AN-1', direction: 'unrelated', confidence: 0.1, method: 'nli-deberta' },
    ]) as any);

    runNliDirectionGate(nodes, nodeMap, 'safetyist');

    const callArgs = mockSpawn.mock.calls[0];
    const stdin = callArgs[2]?.input as string;
    const parsed = JSON.parse(stdin);
    expect(parsed[0].claim_pov).toBe('safetyist');
    expect(parsed[0].node_pov).toBe('safetyist');
  });
});
