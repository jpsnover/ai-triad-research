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

function makeNode(id: string, label = id, pov_tags?: string[]): PovNode {
  return {
    id,
    category: 'beliefs',
    label,
    description: `description of ${label}`,
    parent_id: null,
    children: [],
    ...(pov_tags !== undefined ? { pov_tags } : {}),
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
    const { envelope } = await buildGroundingEnvelope('test question', makeTaxonomy(), flatEmbed);
    expect(envelope.nodesByCamp).toBeDefined();
  });

  it('groups nodes by camp', async () => {
    const { envelope } = await buildGroundingEnvelope('test question', makeTaxonomy(), flatEmbed);
    const camps = Object.keys(envelope.nodesByCamp);
    expect(camps).toContain('acc');
    expect(camps).toContain('saf');
    expect(camps).toContain('skp');
    expect(camps).toContain('cc');
  });

  it('respects topNodesPerCamp limit', async () => {
    const { envelope } = await buildGroundingEnvelope('q', makeTaxonomy(), flatEmbed, { topNodesPerCamp: 1 });
    for (const refs of Object.values(envelope.nodesByCamp)) {
      expect((refs ?? []).length).toBeLessThanOrEqual(1);
    }
  });

  it('NodeRef carries nodeId, label, and camp', async () => {
    const { envelope } = await buildGroundingEnvelope('q', makeTaxonomy(), flatEmbed);
    const accRefs = envelope.nodesByCamp['acc'] ?? [];
    expect(accRefs.length).toBeGreaterThan(0);
    const ref = accRefs[0]!;
    expect(ref.nodeId).toMatch(/^acc-/);
    expect(typeof ref.label).toBe('string');
    expect(ref.camp).toBe('acc');
  });

  it('appliedTag is undefined when no tagSelection provided', async () => {
    const { appliedTag } = await buildGroundingEnvelope('q', makeTaxonomy(), flatEmbed);
    expect(appliedTag).toBeUndefined();
  });
});

// ── Anchor selection ─────────────────────────────────────────────────────────

describe('buildGroundingEnvelope — anchor situation', () => {
  it('sets anchorSituationId when situations are available', async () => {
    const { envelope } = await buildGroundingEnvelope('ai safety question', makeTaxonomy(), flatEmbed);
    expect(envelope.anchorSituationId).toBeDefined();
  });

  it('uses pinned situationId when provided', async () => {
    const { envelope } = await buildGroundingEnvelope('q', makeTaxonomy(), flatEmbed, { situationId: 'sit-002' });
    expect(envelope.anchorSituationId).toBe('sit-002');
  });

  it('derives anchor from similarity when no situationId pinned', async () => {
    // With distinct embed: question gets vec[0], sit-001 gets vec[0] → highest similarity
    const { envelope } = await buildGroundingEnvelope('q', makeTaxonomy(), distinctEmbed);
    expect(envelope.anchorSituationId).toBe('sit-001');
  });

  it('falls back gracefully when pinned id is not found', async () => {
    const { envelope } = await buildGroundingEnvelope('q', makeTaxonomy(), flatEmbed, { situationId: 'nonexistent' });
    // Should still return an envelope, possibly with a derived anchor
    expect(envelope.nodesByCamp).toBeDefined();
  });
});

// ── ADR-001 graceful-empty cases ─────────────────────────────────────────────

describe('buildGroundingEnvelope — ADR-001 graceful empty', () => {
  it('returns empty envelope when no povNodes', async () => {
    const taxonomy = makeTaxonomy({ povNodes: [], nodeEmbeddings: {} });
    const { envelope } = await buildGroundingEnvelope('q', taxonomy, flatEmbed);
    expect(envelope.nodesByCamp).toEqual({});
    expect(envelope.anchorSituationId).toBeUndefined();
  });

  it('returns empty envelope when embed throws', async () => {
    const failEmbed = async () => { throw new Error('embed failure'); };
    const { envelope } = await buildGroundingEnvelope('q', makeTaxonomy(), failEmbed);
    expect(envelope.nodesByCamp).toEqual({});
  });

  it('returns empty envelope when embed returns empty vector', async () => {
    const emptyVecEmbed = async (texts: string[]): Promise<number[][]> => texts.map(() => []);
    const { envelope } = await buildGroundingEnvelope('q', makeTaxonomy(), emptyVecEmbed);
    expect(envelope.nodesByCamp).toEqual({});
  });

  it('omits anchor when no situationNodes', async () => {
    const taxonomy = makeTaxonomy({ situationNodes: [] });
    const { envelope } = await buildGroundingEnvelope('q', taxonomy, flatEmbed);
    expect(envelope.anchorSituationId).toBeUndefined();
  });
});

// ── Similarity selection ─────────────────────────────────────────────────────

describe('buildGroundingEnvelope — similarity ordering', () => {
  it('places the node most similar to the question first', async () => {
    // acc-beliefs-001 has vec[0], question has vec[0] → similarity 1.0
    // acc-beliefs-002 has vec[1], question has vec[0] → similarity 0.0
    const { envelope } = await buildGroundingEnvelope('q', makeTaxonomy(), distinctEmbed);
    const accRefs = envelope.nodesByCamp['acc'] ?? [];
    expect(accRefs[0]?.nodeId).toBe('acc-beliefs-001');
  });
});

// ── Tag selection — C5 equality and filtering (t/3965) ───────────────────────

describe('buildGroundingEnvelope — tag selection', () => {
  // Taxonomy with tagged nodes on skp only
  function makeTaggedTaxonomy(): GroundingTaxonomy {
    const povNodes: PovNode[] = [
      makeNode('acc-beliefs-001', 'A1'),
      makeNode('acc-beliefs-002', 'A2'),
      makeNode('saf-beliefs-001', 'S1'),
      makeNode('saf-beliefs-002', 'S2'),
      makeNode('skp-beliefs-001', 'K1', ['safety']),  // tagged
      makeNode('skp-beliefs-002', 'K2'),              // untagged
      makeNode('cc-beliefs-001',  'C1'),
    ];

    const nodeEmbeddings: NodeEmbeddingMap = {
      'acc-beliefs-001': { pov: 'acc', vector: unitVec(8, 0) },
      'acc-beliefs-002': { pov: 'acc', vector: unitVec(8, 1) },
      'saf-beliefs-001': { pov: 'saf', vector: unitVec(8, 2) },
      'saf-beliefs-002': { pov: 'saf', vector: unitVec(8, 3) },
      'skp-beliefs-001': { pov: 'skp', vector: unitVec(8, 4) },
      'skp-beliefs-002': { pov: 'skp', vector: unitVec(8, 5) },
      'cc-beliefs-001':  { pov: 'cc',  vector: unitVec(8, 6) },
    };

    return {
      povNodes,
      situationNodes: [],
      nodeEmbeddings,
    };
  }

  // C5: tag on 'skeptic' — Acc and Saf envelopes toEqual the untagged run (t/3965)
  it('C5: acc and saf nodesByCamp are identical to untagged run when tag scopes skeptic', async () => {
    const taxonomy = makeTaggedTaxonomy();
    const { envelope: untagged } = await buildGroundingEnvelope('q', taxonomy, flatEmbed);
    const { envelope: tagged } = await buildGroundingEnvelope('q', taxonomy, flatEmbed, {
      tagSelection: { pov: 'skeptic', tag: 'safety', mode: 'scope' },
    });

    // Other camps are byte-for-byte identical to the untagged run (POV-scoped correctness)
    expect(tagged.nodesByCamp['acc']).toEqual(untagged.nodesByCamp['acc']);
    expect(tagged.nodesByCamp['saf']).toEqual(untagged.nodesByCamp['saf']);
    expect(tagged.nodesByCamp['cc']).toEqual(untagged.nodesByCamp['cc']);
  });

  it('C5: acc and saf nodesByCamp are identical to untagged run when tag prioritizes skeptic', async () => {
    const taxonomy = makeTaggedTaxonomy();
    const { envelope: untagged } = await buildGroundingEnvelope('q', taxonomy, flatEmbed);
    const { envelope: tagged } = await buildGroundingEnvelope('q', taxonomy, flatEmbed, {
      tagSelection: { pov: 'skeptic', tag: 'safety', mode: 'prioritize' },
    });

    expect(tagged.nodesByCamp['acc']).toEqual(untagged.nodesByCamp['acc']);
    expect(tagged.nodesByCamp['saf']).toEqual(untagged.nodesByCamp['saf']);
    expect(tagged.nodesByCamp['cc']).toEqual(untagged.nodesByCamp['cc']);
  });

  it('scope mode: skp camp only contains tagged node', async () => {
    const taxonomy = makeTaggedTaxonomy();
    const { envelope } = await buildGroundingEnvelope('q', taxonomy, flatEmbed, {
      tagSelection: { pov: 'skeptic', tag: 'safety', mode: 'scope' },
    });
    const skpRefs = envelope.nodesByCamp['skp'] ?? [];
    expect(skpRefs.map(r => r.nodeId)).toEqual(['skp-beliefs-001']);
  });

  it('scope mode: appliedTag carries correct pov/tag/mode/included/excludedUntagged', async () => {
    const taxonomy = makeTaggedTaxonomy();
    const { appliedTag } = await buildGroundingEnvelope('q', taxonomy, flatEmbed, {
      tagSelection: { pov: 'skeptic', tag: 'safety', mode: 'scope' },
    });
    expect(appliedTag).toBeDefined();
    expect(appliedTag!.pov).toBe('skeptic');
    expect(appliedTag!.tag).toBe('safety');
    expect(appliedTag!.mode).toBe('scope');
    expect(appliedTag!.included).toBe(1);
    expect(appliedTag!.excludedUntagged).toBe(1);
  });

  it('prioritize mode: appliedTag has excludedUntagged=0', async () => {
    const taxonomy = makeTaggedTaxonomy();
    const { appliedTag } = await buildGroundingEnvelope('q', taxonomy, flatEmbed, {
      tagSelection: { pov: 'skeptic', tag: 'safety', mode: 'prioritize' },
    });
    expect(appliedTag).toBeDefined();
    expect(appliedTag!.mode).toBe('prioritize');
    expect(appliedTag!.excludedUntagged).toBe(0);
    expect(appliedTag!.included).toBe(1);
  });
});
