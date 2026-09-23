// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { buildGroundingEnvelope, type GroundingTaxonomy } from './inquiryGrounding.js';
import type { NodeEmbeddingMap } from './relevanceSelection.js';
import type { PovNode } from './taxonomyTypes.js';

// ── Fixture helpers ──────────────────────────────────────────────────────────

function unitVec(dim: number, hotIndex: number): number[] {
  const v = new Array<number>(dim).fill(0);
  v[hotIndex] = 1;
  return v;
}

/** Embed that returns identical vectors for all inputs (worst-case similarity = all equal). */
const flatEmbed = async (texts: string[]): Promise<number[][]> =>
  texts.map(() => unitVec(4, 0));

/** Embed that returns distinct orthogonal unit vectors per position. */
const distinctEmbed = async (texts: string[]): Promise<number[][]> =>
  texts.map((_, i) => unitVec(Math.max(texts.length, 8), i));

function makeNode(id: string, label = id): PovNode {
  return {
    id,
    category: 'beliefs',
    label,
    description: `description of ${label}`,
    parent_id: null,
    children: [],
  } as unknown as PovNode;
}

function makeTaxonomy(overrides: Partial<GroundingTaxonomy> = {}): GroundingTaxonomy {
  const povNodes: PovNode[] = [
    makeNode('acc-beliefs-001', 'A1'),
    makeNode('acc-beliefs-002', 'A2'),
    makeNode('saf-beliefs-001', 'S1'),
    makeNode('saf-beliefs-002', 'S2'),
    makeNode('skp-beliefs-001', 'K1'),
    makeNode('cc-beliefs-001',  'C1'),
  ];

  const nodeEmbeddings: NodeEmbeddingMap = {
    'acc-beliefs-001': { pov: 'acc', vector: unitVec(8, 0) },
    'acc-beliefs-002': { pov: 'acc', vector: unitVec(8, 1) },
    'saf-beliefs-001': { pov: 'saf', vector: unitVec(8, 2) },
    'saf-beliefs-002': { pov: 'saf', vector: unitVec(8, 3) },
    'skp-beliefs-001': { pov: 'skp', vector: unitVec(8, 4) },
    'cc-beliefs-001':  { pov: 'cc',  vector: unitVec(8, 5) },
  };

  return {
    povNodes,
    situationNodes: [
      { id: 'sit-001', label: 'AI Safety Situation', description: 'Overview of AI safety concerns' } as any,
      { id: 'sit-002', label: 'Autonomy Situation', description: 'Autonomous systems overview' } as any,
    ],
    nodeEmbeddings,
    ...overrides,
  };
}

// ── Basic behavior ───────────────────────────────────────────────────────────

describe('buildGroundingEnvelope — basic', () => {
  it('returns an envelope with nodesByCamp when corpus is populated', async () => {
    const result = await buildGroundingEnvelope('test question', makeTaxonomy(), flatEmbed);
    expect(result.nodesByCamp).toBeDefined();
  });

  it('groups nodes by camp', async () => {
    const result = await buildGroundingEnvelope('test question', makeTaxonomy(), flatEmbed);
    const camps = Object.keys(result.nodesByCamp);
    expect(camps).toContain('acc');
    expect(camps).toContain('saf');
    expect(camps).toContain('skp');
    expect(camps).toContain('cc');
  });

  it('respects topNodesPerCamp limit', async () => {
    const result = await buildGroundingEnvelope('q', makeTaxonomy(), flatEmbed, { topNodesPerCamp: 1 });
    for (const refs of Object.values(result.nodesByCamp)) {
      expect((refs ?? []).length).toBeLessThanOrEqual(1);
    }
  });

  it('NodeRef carries nodeId, label, and camp', async () => {
    const result = await buildGroundingEnvelope('q', makeTaxonomy(), flatEmbed);
    const accRefs = result.nodesByCamp['acc'] ?? [];
    expect(accRefs.length).toBeGreaterThan(0);
    const ref = accRefs[0]!;
    expect(ref.nodeId).toMatch(/^acc-/);
    expect(typeof ref.label).toBe('string');
    expect(ref.camp).toBe('acc');
  });
});

// ── Anchor selection ─────────────────────────────────────────────────────────

describe('buildGroundingEnvelope — anchor situation', () => {
  it('sets anchorSituationId when situations are available', async () => {
    const result = await buildGroundingEnvelope('ai safety question', makeTaxonomy(), flatEmbed);
    expect(result.anchorSituationId).toBeDefined();
  });

  it('uses pinned situationId when provided', async () => {
    const result = await buildGroundingEnvelope('q', makeTaxonomy(), flatEmbed, { situationId: 'sit-002' });
    expect(result.anchorSituationId).toBe('sit-002');
  });

  it('derives anchor from similarity when no situationId pinned', async () => {
    // With distinct embed: question gets vec[0], sit-001 gets vec[0] → highest similarity
    const result = await buildGroundingEnvelope('q', makeTaxonomy(), distinctEmbed);
    expect(result.anchorSituationId).toBe('sit-001');
  });

  it('falls back gracefully when pinned id is not found', async () => {
    const result = await buildGroundingEnvelope('q', makeTaxonomy(), flatEmbed, { situationId: 'nonexistent' });
    // Should still return an envelope, possibly with a derived anchor
    expect(result.nodesByCamp).toBeDefined();
  });
});

// ── ADR-001 graceful-empty cases ─────────────────────────────────────────────

describe('buildGroundingEnvelope — ADR-001 graceful empty', () => {
  it('returns empty envelope when no povNodes', async () => {
    const taxonomy = makeTaxonomy({ povNodes: [], nodeEmbeddings: {} });
    const result = await buildGroundingEnvelope('q', taxonomy, flatEmbed);
    expect(result.nodesByCamp).toEqual({});
    expect(result.anchorSituationId).toBeUndefined();
  });

  it('returns empty envelope when embed throws', async () => {
    const failEmbed = async () => { throw new Error('embed failure'); };
    const result = await buildGroundingEnvelope('q', makeTaxonomy(), failEmbed);
    expect(result.nodesByCamp).toEqual({});
  });

  it('returns empty envelope when embed returns empty vector', async () => {
    const emptyVecEmbed = async (texts: string[]): Promise<number[][]> => texts.map(() => []);
    const result = await buildGroundingEnvelope('q', makeTaxonomy(), emptyVecEmbed);
    expect(result.nodesByCamp).toEqual({});
  });

  it('omits anchor when no situationNodes', async () => {
    const taxonomy = makeTaxonomy({ situationNodes: [] });
    const result = await buildGroundingEnvelope('q', taxonomy, flatEmbed);
    expect(result.anchorSituationId).toBeUndefined();
  });
});

// ── Similarity selection ─────────────────────────────────────────────────────

describe('buildGroundingEnvelope — similarity ordering', () => {
  it('places the node most similar to the question first', async () => {
    // acc-beliefs-001 has vec[0], question has vec[0] → similarity 1.0
    // acc-beliefs-002 has vec[1], question has vec[0] → similarity 0.0
    const result = await buildGroundingEnvelope('q', makeTaxonomy(), distinctEmbed);
    const accRefs = result.nodesByCamp['acc'] ?? [];
    expect(accRefs[0]?.nodeId).toBe('acc-beliefs-001');
  });
});
