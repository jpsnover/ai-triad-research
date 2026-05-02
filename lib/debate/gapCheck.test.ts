import { describe, it, expect } from 'vitest';
import {
  findUnengagedHighRelevanceNodes,
  shouldRunGapCheck,
  collectEngagedNodeIds,
  GAP_RELEVANCE_THRESHOLD,
  GAP_CHECK_INTERVAL,
  MAX_GAP_INJECTIONS,
} from './gapCheck.js';

const makeNode = (id: string, label: string, desc = '') => ({
  id, label, description: desc,
});

describe('findUnengagedHighRelevanceNodes', () => {
  it('returns empty for empty inputs', () => {
    expect(findUnengagedHighRelevanceNodes([], new Set(), new Map())).toEqual([]);
  });

  it('filters out already-engaged nodes', () => {
    const nodes = [makeNode('acc-beliefs-001', 'AI capabilities', 'Growing fast')];
    const engaged = new Set(['acc-beliefs-001']);
    const scores = new Map([['acc-beliefs-001', 0.9]]);
    expect(findUnengagedHighRelevanceNodes(nodes, engaged, scores)).toEqual([]);
  });

  it('filters out low-relevance nodes', () => {
    const nodes = [makeNode('acc-beliefs-001', 'AI capabilities', 'Growing fast')];
    const scores = new Map([['acc-beliefs-001', 0.3]]);
    expect(findUnengagedHighRelevanceNodes(nodes, new Set(), scores)).toEqual([]);
  });

  it('returns high-relevance unengaged nodes sorted by score', () => {
    const nodes = [
      makeNode('acc-beliefs-001', 'AI capabilities', 'Growing fast'),
      makeNode('saf-beliefs-002', 'Alignment risk', 'Critical safety'),
      makeNode('skp-desires-003', 'Democratic oversight', 'Public control'),
    ];
    const engaged = new Set(['saf-beliefs-002']);
    const scores = new Map([
      ['acc-beliefs-001', 0.85],
      ['saf-beliefs-002', 0.95],
      ['skp-desires-003', 0.75],
    ]);
    const result = findUnengagedHighRelevanceNodes(nodes, engaged, scores);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('acc-beliefs-001');
    expect(result[0].score).toBe(0.85);
    expect(result[1].id).toBe('skp-desires-003');
  });

  it('uses default threshold of 0.7', () => {
    const nodes = [
      makeNode('a', 'A', ''),
      makeNode('b', 'B', ''),
    ];
    const scores = new Map([['a', 0.69], ['b', 0.71]]);
    const result = findUnengagedHighRelevanceNodes(nodes, new Set(), scores);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('b');
  });

  it('respects custom threshold', () => {
    const nodes = [makeNode('a', 'A', '')];
    const scores = new Map([['a', 0.5]]);
    expect(findUnengagedHighRelevanceNodes(nodes, new Set(), scores, 0.4)).toHaveLength(1);
    expect(findUnengagedHighRelevanceNodes(nodes, new Set(), scores, 0.6)).toHaveLength(0);
  });

  it('handles nodes with no relevance score', () => {
    const nodes = [makeNode('a', 'A', '')];
    const result = findUnengagedHighRelevanceNodes(nodes, new Set(), new Map());
    expect(result).toEqual([]);
  });
});

describe('shouldRunGapCheck', () => {
  it('returns false when budget exhausted', () => {
    expect(shouldRunGapCheck(9, 5, 3, 3, 3)).toBe(false);
  });

  it('returns false before initial gap round', () => {
    expect(shouldRunGapCheck(3, 5, 1, 3, 3)).toBe(false);
  });

  it('returns false on the initial gap round itself', () => {
    expect(shouldRunGapCheck(5, 5, 1, 3, 3)).toBe(false);
  });

  it('returns true at correct interval after initial gap round', () => {
    expect(shouldRunGapCheck(8, 5, 1, 3, 3)).toBe(true);
    expect(shouldRunGapCheck(11, 5, 1, 3, 3)).toBe(true);
  });

  it('returns false between intervals', () => {
    expect(shouldRunGapCheck(6, 5, 1, 3, 3)).toBe(false);
    expect(shouldRunGapCheck(7, 5, 1, 3, 3)).toBe(false);
    expect(shouldRunGapCheck(9, 5, 1, 3, 3)).toBe(false);
  });

  it('uses default constants', () => {
    expect(shouldRunGapCheck(
      5 + GAP_CHECK_INTERVAL, 5, 1, MAX_GAP_INJECTIONS, GAP_CHECK_INTERVAL,
    )).toBe(true);
  });

  it('stops once max injections reached mid-debate', () => {
    expect(shouldRunGapCheck(8, 5, 2, 3, 3)).toBe(true);
    expect(shouldRunGapCheck(11, 5, 3, 3, 3)).toBe(false);
  });
});

describe('collectEngagedNodeIds', () => {
  it('returns empty set for empty inputs', () => {
    expect(collectEngagedNodeIds([], []).size).toBe(0);
  });

  it('collects from AN nodes', () => {
    const anNodes = [
      { taxonomy_refs: [{ node_id: 'acc-beliefs-001' }, { node_id: 'saf-desires-002' }] },
      { taxonomy_refs: [{ node_id: 'acc-beliefs-001' }] },
    ];
    const ids = collectEngagedNodeIds(anNodes, []);
    expect(ids.size).toBe(2);
    expect(ids.has('acc-beliefs-001')).toBe(true);
    expect(ids.has('saf-desires-002')).toBe(true);
  });

  it('collects from transcript entries', () => {
    const entries = [
      { taxonomy_refs: [{ node_id: 'skp-intentions-003' }] },
    ];
    const ids = collectEngagedNodeIds([], entries);
    expect(ids.has('skp-intentions-003')).toBe(true);
  });

  it('deduplicates across sources', () => {
    const anNodes = [{ taxonomy_refs: [{ node_id: 'acc-beliefs-001' }] }];
    const entries = [{ taxonomy_refs: [{ node_id: 'acc-beliefs-001' }] }];
    expect(collectEngagedNodeIds(anNodes, entries).size).toBe(1);
  });
});
