import { describe, it, expect } from 'vitest';
import { diffNodes, changedFields } from '../editMeta';

function makeNode(id: string, label: string, extra?: Record<string, unknown>) {
  return { id, label, description: `desc-${id}`, ...extra };
}

function buildNodeDiffResponse(
  mainJson: string | null,
  branchJson: string | null,
  filePath: string,
) {
  const mainNodes: Array<{ id: string; label?: string; [k: string]: unknown }> =
    mainJson ? (JSON.parse(mainJson.replace(/^﻿/, '')).nodes ?? []) : [];
  const branchNodes: Array<{ id: string; label?: string; [k: string]: unknown }> =
    branchJson ? (JSON.parse(branchJson.replace(/^﻿/, '')).nodes ?? []) : [];

  const diff = diffNodes(mainNodes, branchNodes);
  if (diff.added.length === 0 && diff.modified.length === 0 && diff.deleted.length === 0) return null;

  const mainMap = new Map(mainNodes.map(n => [n.id, n]));
  const branchMap = new Map(branchNodes.map(n => [n.id, n]));

  const added = diff.added.map(id => ({ id, label: branchMap.get(id)?.label }));
  const removed = diff.deleted.map(id => ({ id, label: mainMap.get(id)?.label }));
  const modified = diff.modified.map(id => {
    const oldNode = mainMap.get(id)!;
    const newNode = branchMap.get(id)!;
    const fields = changedFields(oldNode, newNode).map(field => ({
      field,
      old: oldNode[field],
      new: newNode[field],
    }));
    return { id, label: newNode.label ?? oldNode.label, fields };
  });

  return { path: filePath, added, removed, modified };
}

describe('node-diff response builder', () => {
  it('detects added nodes with labels', () => {
    const mainJson = JSON.stringify({ nodes: [makeNode('a-1', 'Alpha')] });
    const branchJson = JSON.stringify({ nodes: [makeNode('a-1', 'Alpha'), makeNode('a-2', 'Beta')] });

    const result = buildNodeDiffResponse(mainJson, branchJson, 'taxonomy/Origin/accelerationist.json');
    expect(result).not.toBeNull();
    expect(result!.added).toEqual([{ id: 'a-2', label: 'Beta' }]);
    expect(result!.removed).toEqual([]);
    expect(result!.modified).toEqual([]);
  });

  it('detects removed nodes with labels', () => {
    const mainJson = JSON.stringify({ nodes: [makeNode('a-1', 'Alpha'), makeNode('a-2', 'Beta')] });
    const branchJson = JSON.stringify({ nodes: [makeNode('a-1', 'Alpha')] });

    const result = buildNodeDiffResponse(mainJson, branchJson, 'taxonomy/Origin/safetyist.json');
    expect(result).not.toBeNull();
    expect(result!.added).toEqual([]);
    expect(result!.removed).toEqual([{ id: 'a-2', label: 'Beta' }]);
    expect(result!.modified).toEqual([]);
  });

  it('detects modified nodes with field-level old/new values', () => {
    const mainJson = JSON.stringify({ nodes: [makeNode('a-1', 'Alpha', { confidence: 0.5 })] });
    const branchJson = JSON.stringify({ nodes: [makeNode('a-1', 'Alpha Updated', { confidence: 0.9 })] });

    const result = buildNodeDiffResponse(mainJson, branchJson, 'taxonomy/Origin/skeptic.json');
    expect(result).not.toBeNull();
    expect(result!.added).toEqual([]);
    expect(result!.removed).toEqual([]);
    expect(result!.modified).toHaveLength(1);

    const mod = result!.modified[0];
    expect(mod.id).toBe('a-1');
    expect(mod.label).toBe('Alpha Updated');
    expect(mod.fields).toEqual(expect.arrayContaining([
      { field: 'confidence', old: 0.5, new: 0.9 },
      { field: 'label', old: 'Alpha', new: 'Alpha Updated' },
    ]));
  });

  it('returns null when no changes exist', () => {
    const same = JSON.stringify({ nodes: [makeNode('a-1', 'Alpha')] });
    const result = buildNodeDiffResponse(same, same, 'taxonomy/Origin/accelerationist.json');
    expect(result).toBeNull();
  });

  it('handles added + modified + removed in one file', () => {
    const mainJson = JSON.stringify({
      nodes: [makeNode('a-1', 'Alpha'), makeNode('a-2', 'Beta'), makeNode('a-3', 'Gamma')],
    });
    const branchJson = JSON.stringify({
      nodes: [makeNode('a-1', 'Alpha'), makeNode('a-2', 'Beta Edited'), makeNode('a-4', 'Delta')],
    });

    const result = buildNodeDiffResponse(mainJson, branchJson, 'taxonomy/Origin/accelerationist.json');
    expect(result).not.toBeNull();
    expect(result!.added.map(n => n.id)).toEqual(['a-4']);
    expect(result!.removed.map(n => n.id)).toEqual(['a-3']);
    expect(result!.modified.map(n => n.id)).toEqual(['a-2']);
    expect(result!.modified[0].fields).toEqual([
      { field: 'label', old: 'Beta', new: 'Beta Edited' },
    ]);
  });

  it('handles main file being null (new file on branch)', () => {
    const branchJson = JSON.stringify({ nodes: [makeNode('a-1', 'Alpha')] });
    const result = buildNodeDiffResponse(null, branchJson, 'taxonomy/Origin/accelerationist.json');
    expect(result).not.toBeNull();
    expect(result!.added).toEqual([{ id: 'a-1', label: 'Alpha' }]);
    expect(result!.removed).toEqual([]);
  });

  it('handles branch file being null (deleted on branch)', () => {
    const mainJson = JSON.stringify({ nodes: [makeNode('a-1', 'Alpha')] });
    const result = buildNodeDiffResponse(mainJson, null, 'taxonomy/Origin/accelerationist.json');
    expect(result).not.toBeNull();
    expect(result!.removed).toEqual([{ id: 'a-1', label: 'Alpha' }]);
    expect(result!.added).toEqual([]);
  });

  it('strips BOM from JSON before parsing', () => {
    const mainJson = '﻿' + JSON.stringify({ nodes: [makeNode('a-1', 'Alpha')] });
    const branchJson = JSON.stringify({ nodes: [makeNode('a-1', 'Alpha'), makeNode('a-2', 'Beta')] });
    const result = buildNodeDiffResponse(mainJson, branchJson, 'taxonomy/Origin/accelerationist.json');
    expect(result).not.toBeNull();
    expect(result!.added).toHaveLength(1);
  });
});
