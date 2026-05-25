// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { computeClaimTaxonomyAttribution } from './argumentNetwork.js';
import type { ArgumentNetworkNode } from './types.js';

// Helper: create a unit vector in a specific direction (dimension index)
function makeEmbedding(dim: number, size = 384): number[] {
  const v = new Array(size).fill(0);
  v[dim % size] = 1;
  return v;
}

// Helper: create a vector with controlled similarity to a reference
function makeSimilarEmbedding(base: number[], similarity: number, size = 384): number[] {
  // Mix base direction with an orthogonal direction to achieve target similarity
  const ortho = new Array(size).fill(0);
  ortho[(size - 1)] = 1; // orthogonal direction
  const v = new Array(size).fill(0);
  for (let i = 0; i < size; i++) {
    v[i] = similarity * base[i] + Math.sqrt(1 - similarity * similarity) * ortho[i];
  }
  // Normalize
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map(x => x / norm);
}

function makeNode(id: string, speaker: string, embedding?: number[]): ArgumentNetworkNode {
  return {
    id,
    text: `Claim ${id}`,
    speaker: speaker as ArgumentNetworkNode['speaker'],
    source_entry_id: 'e1',
    taxonomy_refs: [],
    turn_number: 1,
    embedding,
  };
}

const BELIEF_IDS = new Set(['acc-B-001', 'acc-B-002', 'acc-B-003']);

// ── Basic attribution ─────────────────────────────────

describe('computeClaimTaxonomyAttribution', () => {
  it('assigns primary_ref to the highest-similarity Belief node', () => {
    const nodeEmb = makeEmbedding(0);
    const nodes = [makeNode('AN-1', 'accelerationist', nodeEmb)];
    const embeddings: Record<string, { pov: string; vector: number[] }> = {
      'acc-B-001': { pov: 'accelerationist', vector: makeEmbedding(0) },   // exact match
      'acc-B-002': { pov: 'accelerationist', vector: makeEmbedding(1) },   // orthogonal
      'acc-B-003': { pov: 'accelerationist', vector: makeEmbedding(2) },   // orthogonal
    };

    const result = computeClaimTaxonomyAttribution(nodes, 'accelerationist', embeddings, BELIEF_IDS);

    expect(result.attributed).toBe(1);
    expect(result.unattributed).toBe(0);
    expect(nodes[0].claim_taxonomy_attribution).toBeDefined();
    expect(nodes[0].claim_taxonomy_attribution!.primary_ref).toBe('acc-B-001');
    expect(nodes[0].claim_taxonomy_attribution!.attribution_confidence).toBeCloseTo(1.0);
  });

  it('includes secondary_refs above 0.40 threshold', () => {
    const base = makeEmbedding(0);
    const similar = makeSimilarEmbedding(base, 0.6);
    const nodes = [makeNode('AN-1', 'accelerationist', base)];
    const embeddings: Record<string, { pov: string; vector: number[] }> = {
      'acc-B-001': { pov: 'accelerationist', vector: base },       // sim = 1.0
      'acc-B-002': { pov: 'accelerationist', vector: similar },    // sim ~ 0.6
      'acc-B-003': { pov: 'accelerationist', vector: makeEmbedding(5) }, // sim ~ 0
    };

    const result = computeClaimTaxonomyAttribution(nodes, 'accelerationist', embeddings, BELIEF_IDS);

    expect(nodes[0].claim_taxonomy_attribution!.primary_ref).toBe('acc-B-001');
    expect(nodes[0].claim_taxonomy_attribution!.secondary_refs).toBeDefined();
    expect(nodes[0].claim_taxonomy_attribution!.secondary_refs!.length).toBe(1);
    expect(nodes[0].claim_taxonomy_attribution!.secondary_refs![0].node_id).toBe('acc-B-002');
    expect(nodes[0].claim_taxonomy_attribution!.secondary_refs![0].similarity).toBeGreaterThan(0.40);
    expect(result.decisions[0].secondary_refs_count).toBe(1);
  });

  it('omits secondary_refs when none exceed 0.40', () => {
    const base = makeEmbedding(0);
    const nodes = [makeNode('AN-1', 'accelerationist', base)];
    const embeddings: Record<string, { pov: string; vector: number[] }> = {
      'acc-B-001': { pov: 'accelerationist', vector: base },           // sim = 1.0
      'acc-B-002': { pov: 'accelerationist', vector: makeEmbedding(1) }, // sim = 0
    };

    computeClaimTaxonomyAttribution(nodes, 'accelerationist', embeddings, BELIEF_IDS);

    expect(nodes[0].claim_taxonomy_attribution!.secondary_refs).toBeUndefined();
  });

  // ── Unattributed: novel argument ────────────────────

  it('marks claim as novel_argument when best similarity < 0.35', () => {
    const nodes = [makeNode('AN-1', 'accelerationist', makeEmbedding(0))];
    const embeddings: Record<string, { pov: string; vector: number[] }> = {
      'acc-B-001': { pov: 'accelerationist', vector: makeEmbedding(5) }, // orthogonal → sim ≈ 0
      'acc-B-002': { pov: 'accelerationist', vector: makeEmbedding(6) }, // orthogonal → sim ≈ 0
    };

    const result = computeClaimTaxonomyAttribution(nodes, 'accelerationist', embeddings, BELIEF_IDS);

    expect(result.unattributed).toBe(1);
    expect(result.novel_argument).toBe(1);
    expect(nodes[0].claim_taxonomy_attribution!.unattributed_reason).toBe('novel_argument');
    expect(nodes[0].claim_taxonomy_attribution!.primary_ref).toBe('');
  });

  // ── Unattributed: no embedding ──────────────────────

  it('marks claim as no_embedding when claim has no embedding', () => {
    const nodes = [makeNode('AN-1', 'accelerationist', undefined)];
    const embeddings: Record<string, { pov: string; vector: number[] }> = {
      'acc-B-001': { pov: 'accelerationist', vector: makeEmbedding(0) },
    };

    const result = computeClaimTaxonomyAttribution(nodes, 'accelerationist', embeddings, BELIEF_IDS);

    expect(result.unattributed).toBe(1);
    expect(result.missing_embedding).toBe(1);
    expect(nodes[0].claim_taxonomy_attribution!.unattributed_reason).toBe('no_embedding');
    expect(result.decisions[0].unattributed_reason).toBe('no_embedding');
  });

  it('marks claim as no_embedding when claim has empty embedding', () => {
    const nodes = [makeNode('AN-1', 'accelerationist', [])];
    const embeddings: Record<string, { pov: string; vector: number[] }> = {
      'acc-B-001': { pov: 'accelerationist', vector: makeEmbedding(0) },
    };

    const result = computeClaimTaxonomyAttribution(nodes, 'accelerationist', embeddings, BELIEF_IDS);

    expect(result.missing_embedding).toBe(1);
    expect(nodes[0].claim_taxonomy_attribution!.unattributed_reason).toBe('no_embedding');
  });

  it('marks all claims as no_embedding when no candidate nodes exist', () => {
    const nodes = [makeNode('AN-1', 'accelerationist', makeEmbedding(0))];
    // No embeddings for this POV
    const embeddings: Record<string, { pov: string; vector: number[] }> = {
      'saf-B-001': { pov: 'safetyist', vector: makeEmbedding(0) },
    };

    const result = computeClaimTaxonomyAttribution(nodes, 'accelerationist', embeddings, BELIEF_IDS);

    expect(result.missing_embedding).toBe(1);
    expect(result.unattributed).toBe(1);
  });

  // ── Same-POV filtering ─────────────────────────────

  it('only compares against same-POV nodes', () => {
    const emb = makeEmbedding(0);
    const nodes = [makeNode('AN-1', 'safetyist', emb)];
    const safBeliefs = new Set(['saf-B-001']);
    const embeddings: Record<string, { pov: string; vector: number[] }> = {
      'acc-B-001': { pov: 'accelerationist', vector: emb },   // exact match but wrong POV
      'saf-B-001': { pov: 'safetyist', vector: makeEmbedding(3) }, // right POV but orthogonal
    };

    const result = computeClaimTaxonomyAttribution(nodes, 'safetyist', embeddings, safBeliefs);

    // Should NOT match acc-B-001 despite identical embedding — wrong POV
    expect(nodes[0].claim_taxonomy_attribution!.unattributed_reason).toBe('novel_argument');
    expect(result.novel_argument).toBe(1);
  });

  // ── Belief-only filtering ──────────────────────────

  it('only compares against Belief nodes, not Desire/Intention', () => {
    const emb = makeEmbedding(0);
    const nodes = [makeNode('AN-1', 'accelerationist', emb)];
    const beliefOnly = new Set(['acc-B-001']); // acc-D-001 is not in belief set
    const embeddings: Record<string, { pov: string; vector: number[] }> = {
      'acc-B-001': { pov: 'accelerationist', vector: makeEmbedding(7) }, // orthogonal
      'acc-D-001': { pov: 'accelerationist', vector: emb },              // exact match but Desire
    };

    const result = computeClaimTaxonomyAttribution(nodes, 'accelerationist', embeddings, beliefOnly);

    // Should NOT match acc-D-001 (Desire node excluded from candidates)
    expect(nodes[0].claim_taxonomy_attribution!.unattributed_reason).toBe('novel_argument');
    expect(result.novel_argument).toBe(1);
  });

  // ── Multiple claims ────────────────────────────────

  it('processes multiple claims independently', () => {
    const nodes = [
      makeNode('AN-1', 'accelerationist', makeEmbedding(0)),
      makeNode('AN-2', 'accelerationist', makeEmbedding(1)),
      makeNode('AN-3', 'accelerationist', undefined), // no embedding
    ];
    const embeddings: Record<string, { pov: string; vector: number[] }> = {
      'acc-B-001': { pov: 'accelerationist', vector: makeEmbedding(0) },
      'acc-B-002': { pov: 'accelerationist', vector: makeEmbedding(1) },
    };

    const result = computeClaimTaxonomyAttribution(nodes, 'accelerationist', embeddings, BELIEF_IDS);

    expect(result.attributed).toBe(2);
    expect(result.unattributed).toBe(1);
    expect(result.missing_embedding).toBe(1);
    expect(result.decisions).toHaveLength(3);

    expect(nodes[0].claim_taxonomy_attribution!.primary_ref).toBe('acc-B-001');
    expect(nodes[1].claim_taxonomy_attribution!.primary_ref).toBe('acc-B-002');
    expect(nodes[2].claim_taxonomy_attribution!.unattributed_reason).toBe('no_embedding');
  });

  // ── Decision trace ─────────────────────────────────

  it('returns complete decision trace for diagnostics', () => {
    const nodes = [makeNode('AN-1', 'accelerationist', makeEmbedding(0))];
    const embeddings: Record<string, { pov: string; vector: number[] }> = {
      'acc-B-001': { pov: 'accelerationist', vector: makeEmbedding(0) },
    };

    const result = computeClaimTaxonomyAttribution(nodes, 'accelerationist', embeddings, BELIEF_IDS);

    expect(result.decisions).toHaveLength(1);
    const d = result.decisions[0];
    expect(d.claim_id).toBe('AN-1');
    expect(d.primary_ref).toBe('acc-B-001');
    expect(d.attribution_confidence).toBeCloseTo(1.0);
    expect(d.secondary_refs_count).toBe(0);
    expect(d.unattributed_reason).toBeUndefined();
  });

  // ── Edge case: empty nodes array ───────────────────

  it('handles empty nodes array', () => {
    const result = computeClaimTaxonomyAttribution([], 'accelerationist', {}, BELIEF_IDS);

    expect(result.attributed).toBe(0);
    expect(result.unattributed).toBe(0);
    expect(result.decisions).toHaveLength(0);
  });
});
