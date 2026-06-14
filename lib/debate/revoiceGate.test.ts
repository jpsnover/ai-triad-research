import { describe, it, expect } from 'vitest';
import { runPropositionalGate } from './revoiceGate.js';
import type { ArgumentNetworkNode, RevoiceGateResult } from './types.js';

function makeVector(seed: number, dim = 384): number[] {
  const v = new Array(dim).fill(0);
  for (let i = 0; i < dim; i++) {
    v[i] = Math.sin(seed * (i + 1) * 0.1);
  }
  const norm = Math.sqrt(v.reduce((s: number, x: number) => s + x * x, 0));
  return v.map((x: number) => x / norm);
}

/**
 * Create a sparse vector with energy at given dimensions.
 * weights maps dimension index → weight. Normalized to unit length.
 */
function makeSparseVector(weights: Record<number, number>, dim = 384): number[] {
  const v = new Array(dim).fill(0);
  for (const [i, w] of Object.entries(weights)) v[Number(i)] = w;
  const norm = Math.sqrt(v.reduce((s: number, x: number) => s + x * x, 0));
  return norm > 0 ? v.map((x: number) => x / norm) : v;
}

function makeTaxonomyEmbeddings(ids: string[], seeds: number[]): Record<string, { vector: number[] }> {
  const result: Record<string, { vector: number[] }> = {};
  for (let i = 0; i < ids.length; i++) {
    result[ids[i]] = { vector: makeVector(seeds[i]) };
  }
  return result;
}

function makeANNode(overrides: Partial<ArgumentNetworkNode> & { id: string }): ArgumentNetworkNode {
  return {
    text: 'test claim',
    speaker: 'accelerationist',
    source_entry_id: 'entry-1',
    taxonomy_refs: [],
    turn_number: 1,
    ...overrides,
  };
}

describe('runPropositionalGate', () => {
  const taxIds = ['acc-B-001', 'acc-B-002', 'acc-B-003', 'saf-B-001', 'saf-B-002'];
  const taxEmbeddings = makeTaxonomyEmbeddings(taxIds, [1, 2, 3, 4, 5]);

  it('passes when taxonomy top-3 overlap ≥2 and entities preserved', () => {
    const embedding = makeVector(1);
    const result = runPropositionalGate({
      originalText: 'OpenAI should publish safety evaluations',
      revoicedText: 'OpenAI must release safety evaluations',
      originalEmbedding: embedding,
      revoicedEmbedding: embedding,
      taxonomyEmbeddings: taxEmbeddings,
      anNodes: [],
      currentRound: 3,
    });

    expect(result.passed).toBe(true);
    expect(result.downgraded_to_check).toBe(false);
    expect(result.anchor_source).toBe('taxonomy');
    expect(result.taxonomy_overlap.overlap_count).toBe(3);
  });

  it('fails when taxonomy top-3 overlap < 2', () => {
    const result = runPropositionalGate({
      originalText: 'AI safety is important',
      revoicedText: 'Economic growth requires innovation',
      originalEmbedding: makeVector(1),
      revoicedEmbedding: makeVector(50),
      taxonomyEmbeddings: taxEmbeddings,
      anNodes: [],
      currentRound: 3,
    });

    expect(result.passed).toBe(false);
    expect(result.downgraded_to_check).toBe(true);
  });

  it('falls back to dynamic AN anchors when taxonomy overlap is zero', () => {
    const divergentTax: Record<string, { vector: number[] }> = {
      't-1': { vector: makeSparseVector({ 0: 1 }) },
      't-2': { vector: makeSparseVector({ 1: 1 }) },
      't-3': { vector: makeSparseVector({ 2: 1 }) },
      't-4': { vector: makeSparseVector({ 3: 1 }) },
      't-5': { vector: makeSparseVector({ 4: 1 }) },
      't-6': { vector: makeSparseVector({ 5: 1 }) },
    };
    const origEmb = makeSparseVector({ 0: 1, 1: 0.5, 2: 0.3 });
    const revoicedEmb = makeSparseVector({ 3: 1, 4: 0.5, 5: 0.3 });

    const anShared = makeSparseVector({ 10: 1 });
    const anNodes: ArgumentNetworkNode[] = [
      makeANNode({ id: 'an-1', embedding: anShared, taxonomy_refs: ['ref-a', 'ref-b'], turn_number: 2 }),
      makeANNode({ id: 'an-2', embedding: anShared, taxonomy_refs: ['ref-a'], turn_number: 2 }),
      makeANNode({ id: 'an-3', embedding: anShared, taxonomy_refs: [], turn_number: 3 }),
    ];

    const result = runPropositionalGate({
      originalText: 'novel concept',
      revoicedText: 'novel concept restated',
      originalEmbedding: origEmb,
      revoicedEmbedding: revoicedEmb,
      taxonomyEmbeddings: divergentTax,
      anNodes,
      currentRound: 3,
    });

    expect(result.anchor_source).toBe('dynamic_an');
  });

  it('fails when entities are dropped', () => {
    const embedding = makeVector(1);
    const result = runPropositionalGate({
      originalText: 'Deployment above 10^25 FLOPs should require safety audits',
      revoicedText: 'Large AI systems need safety checks before release',
      originalEmbedding: embedding,
      revoicedEmbedding: embedding,
      taxonomyEmbeddings: taxEmbeddings,
      anNodes: [],
      currentRound: 3,
    });

    expect(result.passed).toBe(false);
    expect(result.entity_preservation.preserved).toBe(false);
    expect(result.entity_preservation.missing_thresholds.length).toBeGreaterThan(0);
    expect(result.downgraded_to_check).toBe(true);
  });

  it('fails when named entities are dropped', () => {
    const embedding = makeVector(1);
    const result = runPropositionalGate({
      originalText: 'OpenAI should publish safety evaluations for GPT models',
      revoicedText: 'Companies should publish safety evaluations for their models',
      originalEmbedding: embedding,
      revoicedEmbedding: embedding,
      taxonomyEmbeddings: taxEmbeddings,
      anNodes: [],
      currentRound: 3,
    });

    expect(result.passed).toBe(false);
    expect(result.entity_preservation.preserved).toBe(false);
    expect(result.entity_preservation.missing_entities).toContain('openai');
  });

  it('passes when all entities and thresholds are preserved', () => {
    const embedding = makeVector(1);
    const result = runPropositionalGate({
      originalText: 'OpenAI should evaluate GPT models costing $1 billion',
      revoicedText: 'It is important that OpenAI evaluate GPT models that cost $1 billion',
      originalEmbedding: embedding,
      revoicedEmbedding: embedding,
      taxonomyEmbeddings: taxEmbeddings,
      anNodes: [],
      currentRound: 3,
    });

    expect(result.entity_preservation.preserved).toBe(true);
    expect(result.entity_preservation.missing_entities).toHaveLength(0);
  });

  it('returns null anchor_source when no anchors match at all', () => {
    const divergentTax: Record<string, { vector: number[] }> = {
      't-1': { vector: makeSparseVector({ 0: 1 }) },
      't-2': { vector: makeSparseVector({ 1: 1 }) },
      't-3': { vector: makeSparseVector({ 2: 1 }) },
      't-4': { vector: makeSparseVector({ 3: 1 }) },
      't-5': { vector: makeSparseVector({ 4: 1 }) },
      't-6': { vector: makeSparseVector({ 5: 1 }) },
    };

    const result = runPropositionalGate({
      originalText: 'something unique',
      revoicedText: 'completely different topic',
      originalEmbedding: makeSparseVector({ 0: 1, 1: 0.5, 2: 0.3 }),
      revoicedEmbedding: makeSparseVector({ 3: 1, 4: 0.5, 5: 0.3 }),
      taxonomyEmbeddings: divergentTax,
      anNodes: [],
      currentRound: 3,
    });

    expect(result.passed).toBe(false);
    expect(result.anchor_source).toBe(null);
  });
});
