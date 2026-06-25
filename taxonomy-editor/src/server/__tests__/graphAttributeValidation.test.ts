// @vitest-environment node

/**
 * t/768 — load-time type validation of node.graph_attributes. Pure detector;
 * the recorder logging in readTaxonomyFile is a thin wrapper over this.
 */

import { describe, it, expect } from 'vitest';
import { findGraphAttributeMismatches } from '../storage/fileIO.js';

const wrap = (graph_attributes: Record<string, unknown>, id = 'acc-bel-001') => ({ nodes: [{ id, graph_attributes }] });

describe('findGraphAttributeMismatches (t/768)', () => {
  it('returns nothing for well-typed graph_attributes', () => {
    expect(findGraphAttributeMismatches(wrap({
      epistemic_type: 'empirical', audience: 'policymakers',
      assumes: ['a', 'b'], intellectual_lineage: ['kant'],
    }))).toEqual([]);
  });

  it('flags a non-string where a string is expected', () => {
    expect(findGraphAttributeMismatches(wrap({ epistemic_type: 42 }))).toEqual([
      { nodeId: 'acc-bel-001', key: 'epistemic_type', expected: 'string', actual: 'number' },
    ]);
  });

  it('flags a non-string element in a string[] attribute', () => {
    expect(findGraphAttributeMismatches(wrap({ assumes: ['ok', 7] }))).toEqual([
      { nodeId: 'acc-bel-001', key: 'assumes', expected: 'string[]', actual: 'array with number element' },
    ]);
  });

  it('flags a non-array where a string[] is expected', () => {
    expect(findGraphAttributeMismatches(wrap({ intellectual_lineage: 'kant' }))).toEqual([
      { nodeId: 'acc-bel-001', key: 'intellectual_lineage', expected: 'string[]', actual: 'string' },
    ]);
  });

  it('ignores null/absent attributes and nodes without graph_attributes', () => {
    expect(findGraphAttributeMismatches(wrap({ audience: null, assumes: null }))).toEqual([]);
    expect(findGraphAttributeMismatches({ nodes: [{ id: 'x' }] })).toEqual([]);
  });

  it('uses (unknown) for a missing node id and tolerates malformed input', () => {
    expect(findGraphAttributeMismatches({ nodes: [{ graph_attributes: { audience: 1 } }] })).toEqual([
      { nodeId: '(unknown)', key: 'audience', expected: 'string', actual: 'number' },
    ]);
    expect(findGraphAttributeMismatches(null)).toEqual([]);
    expect(findGraphAttributeMismatches({})).toEqual([]);
  });
});
