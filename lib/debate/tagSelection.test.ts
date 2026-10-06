// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { checkTagScope, applyTagSelection } from './relevanceSelection.js';
import type { PovNode } from './taxonomyTypes.js';

function makeNode(id: string, tags?: string[]): PovNode {
  return { id, pov: 'accelerationist', category: 'Beliefs', label: id, description: id, pov_tags: tags } as unknown as PovNode;
}

const TAGGED = [makeNode('a1', ['ea']), makeNode('a2', ['ea']), makeNode('a3', ['ea', 'other'])];
const UNTAGGED = [makeNode('b1'), makeNode('b2', ['other']), makeNode('b3')];
const NODES = [...TAGGED, ...UNTAGGED];

describe('checkTagScope', () => {
  it('separates in-scope and excluded nodes', () => {
    const { inScope, excluded } = checkTagScope(NODES, { tag: 'ea', mode: 'scope' });
    expect(inScope.map(n => n.id).sort()).toEqual(['a1', 'a2', 'a3']);
    expect(excluded.map(n => n.id).sort()).toEqual(['b1', 'b2', 'b3']);
  });

  it('sufficient is true when ≥5 in-scope', () => {
    const manyTagged = Array.from({ length: 5 }, (_, i) => makeNode(`t${i}`, ['ea']));
    const { sufficient } = checkTagScope(manyTagged, { tag: 'ea', mode: 'scope' });
    expect(sufficient).toBe(true);
  });

  it('sufficient is false when <5 in-scope', () => {
    const { sufficient } = checkTagScope(NODES, { tag: 'ea', mode: 'scope' });
    expect(sufficient).toBe(false); // 3 tagged
  });

  it('returns empty in-scope when no node has the tag', () => {
    const { inScope, sufficient } = checkTagScope(NODES, { tag: 'unknown-tag', mode: 'scope' });
    expect(inScope).toHaveLength(0);
    expect(sufficient).toBe(false);
  });
});

describe('applyTagSelection — SCOPE mode', () => {
  it('filters to only tagged nodes', () => {
    const { filteredNodes, excludedCount, boostIds } = applyTagSelection(NODES, { tag: 'ea', mode: 'scope' });
    expect(filteredNodes.map(n => n.id).sort()).toEqual(['a1', 'a2', 'a3']);
    expect(excludedCount).toBe(3);
    expect(boostIds).toHaveLength(0);
  });

  it('returns empty filteredNodes when no tag matches', () => {
    const { filteredNodes, excludedCount } = applyTagSelection(NODES, { tag: 'missing', mode: 'scope' });
    expect(filteredNodes).toHaveLength(0);
    expect(excludedCount).toBe(NODES.length);
  });
});

describe('applyTagSelection — PRIORITIZE mode', () => {
  it('keeps all nodes and returns tagged ids as boostIds', () => {
    const { filteredNodes, excludedCount, boostIds } = applyTagSelection(NODES, { tag: 'ea', mode: 'prioritize' });
    expect(filteredNodes).toHaveLength(NODES.length);
    expect(excludedCount).toBe(0);
    expect(boostIds.sort()).toEqual(['a1', 'a2', 'a3']);
  });

  it('boostIds is empty when no nodes match the tag', () => {
    const { boostIds } = applyTagSelection(NODES, { tag: 'missing', mode: 'prioritize' });
    expect(boostIds).toHaveLength(0);
  });
});
