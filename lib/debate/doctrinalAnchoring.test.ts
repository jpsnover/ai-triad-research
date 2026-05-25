// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  computeDoctrinalAnchoring,
  embedDoctrinalBoundaries,
  calibrateDoctrinalThresholds,
  checkThresholdAnomalies,
  DEFAULT_ANCHORING_CONFIG,
} from './doctrinalAnchoring.js';
import type { DoctrinalAnchoringConfig, AnchoringResult } from './doctrinalAnchoring.js';
import type { PovNode } from './taxonomyTypes.js';

// Helper: create a unit vector in a specific direction
function makeEmbedding(dim: number, size = 384): number[] {
  const v = new Array(size).fill(0);
  v[dim % size] = 1;
  return v;
}

// Helper: create a vector with controlled similarity to a reference
function makeSimilarEmbedding(base: number[], similarity: number, size = 384): number[] {
  const ortho = new Array(size).fill(0);
  ortho[size - 1] = 1;
  const v = new Array(size).fill(0);
  for (let i = 0; i < size; i++) {
    v[i] = similarity * base[i] + Math.sqrt(Math.max(0, 1 - similarity * similarity)) * ortho[i];
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map(x => x / norm);
}

function makeBeliefNode(id: string, confidence?: number): PovNode {
  return {
    id,
    category: 'Beliefs',
    label: `Belief ${id}`,
    description: `A Belief within test discourse that ${id}`,
    parent_id: null,
    children: [],
    situation_refs: [],
    confidence,
  };
}

// ── computeDoctrinalAnchoring ───────────────────────────

describe('computeDoctrinalAnchoring', () => {
  it('anchors a Belief with high similarity to boundary', () => {
    const base = makeEmbedding(0);
    const node = makeBeliefNode('b-001', 0.50);
    const nodeEmbs = { 'b-001': { pov: 'accelerationist', vector: base } };
    const boundaryVecs = [base]; // exact match → sim = 1.0

    const results = computeDoctrinalAnchoring([node], boundaryVecs, nodeEmbs);

    expect(results).toHaveLength(1);
    expect(results[0].anchored).toBe(true);
    expect(results[0].maxSimilarity).toBeCloseTo(1.0);
    expect(node.doctrinally_anchored).toBe(true);
  });

  it('does not anchor a Belief with low similarity', () => {
    const node = makeBeliefNode('b-001', 0.50);
    const nodeEmbs = { 'b-001': { pov: 'accelerationist', vector: makeEmbedding(0) } };
    const boundaryVecs = [makeEmbedding(5)]; // orthogonal → sim ≈ 0

    const results = computeDoctrinalAnchoring([node], boundaryVecs, nodeEmbs);

    expect(results[0].anchored).toBe(false);
    expect(node.doctrinally_anchored).toBeUndefined();
  });

  it('applies confidence floor when anchored and confidence < floor', () => {
    const base = makeEmbedding(0);
    const node = makeBeliefNode('b-001', 0.30);
    const nodeEmbs = { 'b-001': { pov: 'accelerationist', vector: base } };

    computeDoctrinalAnchoring([node], [base], nodeEmbs);

    expect(node.doctrinally_anchored).toBe(true);
    expect(node.confidence).toBe(0.60); // floor applied
    expect(node.evidential_confidence).toBe(0.30); // original preserved
  });

  it('does not apply floor when confidence >= floor', () => {
    const base = makeEmbedding(0);
    const node = makeBeliefNode('b-001', 0.80);
    const nodeEmbs = { 'b-001': { pov: 'accelerationist', vector: base } };

    const results = computeDoctrinalAnchoring([node], [base], nodeEmbs);

    expect(node.doctrinally_anchored).toBe(true);
    expect(node.confidence).toBe(0.80); // unchanged
    expect(node.evidential_confidence).toBeUndefined();
    expect(results[0].floorApplied).toBe(false);
  });

  it('uses configurable threshold and floor', () => {
    const base = makeEmbedding(0);
    const similar = makeSimilarEmbedding(base, 0.50); // sim ≈ 0.50
    const node = makeBeliefNode('b-001', 0.20);
    const nodeEmbs = { 'b-001': { pov: 'accelerationist', vector: similar } };

    // With threshold 0.45: should anchor (0.50 > 0.45)
    const config: DoctrinalAnchoringConfig = { threshold: 0.45, confidenceFloor: 0.70 };
    const results = computeDoctrinalAnchoring([node], [base], nodeEmbs, config);

    expect(results[0].anchored).toBe(true);
    expect(node.confidence).toBe(0.70); // custom floor
    expect(node.evidential_confidence).toBe(0.20);
  });

  it('picks the best boundary when multiple exist', () => {
    const base = makeEmbedding(0);
    const node = makeBeliefNode('b-001', 0.50);
    const nodeEmbs = { 'b-001': { pov: 'accelerationist', vector: base } };
    const boundaries = [
      makeEmbedding(5), // orthogonal
      base,             // exact match
      makeEmbedding(7), // orthogonal
    ];

    const results = computeDoctrinalAnchoring([node], boundaries, nodeEmbs);

    expect(results[0].bestBoundaryIndex).toBe(1);
    expect(results[0].maxSimilarity).toBeCloseTo(1.0);
  });

  it('handles node without embedding', () => {
    const node = makeBeliefNode('b-001', 0.50);
    const nodeEmbs: Record<string, { pov: string; vector: number[] }> = {};

    const results = computeDoctrinalAnchoring([node], [makeEmbedding(0)], nodeEmbs);

    expect(results[0].anchored).toBe(false);
    expect(results[0].maxSimilarity).toBe(0);
  });

  it('skips non-Belief nodes', () => {
    const desire: PovNode = {
      id: 'd-001', category: 'Desires', label: 'Test',
      description: 'A Desire within test discourse that tests',
      parent_id: null, children: [], situation_refs: [],
    };
    const results = computeDoctrinalAnchoring([desire], [makeEmbedding(0)], {});
    expect(results).toHaveLength(0);
  });

  it('returns empty when no boundary vectors', () => {
    const node = makeBeliefNode('b-001', 0.50);
    const nodeEmbs = { 'b-001': { pov: 'accelerationist', vector: makeEmbedding(0) } };
    const results = computeDoctrinalAnchoring([node], [], nodeEmbs);
    expect(results).toHaveLength(0);
  });

  it('handles node with confidence undefined (no floor applied)', () => {
    const base = makeEmbedding(0);
    const node = makeBeliefNode('b-001'); // no confidence
    const nodeEmbs = { 'b-001': { pov: 'accelerationist', vector: base } };

    const results = computeDoctrinalAnchoring([node], [base], nodeEmbs);

    expect(results[0].anchored).toBe(true);
    expect(results[0].floorApplied).toBe(false);
    expect(node.confidence).toBeUndefined(); // can't apply floor without confidence
  });
});

// ── embedDoctrinalBoundaries ────────────────────────────

describe('embedDoctrinalBoundaries', () => {
  it('embeds boundary strings for each POV', async () => {
    const boundaries = {
      accelerationist: ['REJECT: precautionary principle', 'REJECT: capability limits'],
      safetyist: ['REJECT: dismissing risk'],
    };
    const embedFn = async (text: string) => {
      const v = new Array(384).fill(0);
      v[0] = text.length / 100; // deterministic based on length
      return v;
    };

    const result = await embedDoctrinalBoundaries(boundaries, embedFn);

    expect(result.accelerationist).toHaveLength(2);
    expect(result.safetyist).toHaveLength(1);
    expect(result.accelerationist[0]).toHaveLength(384);
  });

  it('strips REJECT: prefix before embedding', async () => {
    const boundaries = {
      test: ['REJECT: precautionary principle', 'REJECT:  capability limits', 'No prefix here'],
    };
    const receivedTexts: string[] = [];
    const embedFn = async (text: string) => {
      receivedTexts.push(text);
      return new Array(384).fill(0.1);
    };

    await embedDoctrinalBoundaries(boundaries, embedFn);

    expect(receivedTexts).toEqual([
      'precautionary principle',
      'capability limits',
      'No prefix here',
    ]);
  });

  it('handles embedding failures gracefully', async () => {
    const boundaries = { test: ['a', 'b', 'c'] };
    let callCount = 0;
    const embedFn = async (_text: string) => {
      callCount++;
      if (callCount === 2) throw new Error('fail');
      return new Array(384).fill(0.1);
    };

    const result = await embedDoctrinalBoundaries(boundaries, embedFn);
    expect(result.test).toHaveLength(2); // 1 failed, 2 succeeded
  });
});

// ── calibrateDoctrinalThresholds ────────────────────────

describe('calibrateDoctrinalThresholds', () => {
  it('reports anchored counts at multiple thresholds', () => {
    const base = makeEmbedding(0);
    const similar = makeSimilarEmbedding(base, 0.50);
    const nodes = {
      acc: [
        { ...makeBeliefNode('b-001'), },
        { ...makeBeliefNode('b-002'), },
      ],
    };
    const nodeEmbs = {
      'b-001': { pov: 'acc', vector: base },      // sim=1.0 to boundary
      'b-002': { pov: 'acc', vector: similar },    // sim≈0.50 to boundary
    };
    const boundaryEmbs = { acc: [base] };

    const rows = calibrateDoctrinalThresholds(nodes, boundaryEmbs, nodeEmbs, [0.45, 0.55, 0.90]);

    // At 0.45: both anchored (1.0 > 0.45, 0.50 > 0.45)
    expect(rows[0].counts.acc).toBe(2);
    // At 0.55: only b-001 (1.0 > 0.55, 0.50 < 0.55)
    expect(rows[1].counts.acc).toBe(1);
    // At 0.90: only b-001 (1.0 > 0.90)
    expect(rows[2].counts.acc).toBe(1);
  });

  it('handles POV with no boundary embeddings', () => {
    const nodes = { acc: [makeBeliefNode('b-001')] };
    const nodeEmbs = { 'b-001': { pov: 'acc', vector: makeEmbedding(0) } };

    const rows = calibrateDoctrinalThresholds(nodes, {}, nodeEmbs);

    expect(rows[0].counts.acc).toBe(0);
  });
});

// ── checkThresholdAnomalies ─────────────────────────────

describe('checkThresholdAnomalies', () => {
  it('warns when fewer than 3 anchored', () => {
    const results: AnchoringResult[] = [
      { nodeId: 'b-001', anchored: true, maxSimilarity: 0.7, bestBoundaryIndex: 0, floorApplied: false },
      { nodeId: 'b-002', anchored: false, maxSimilarity: 0.3, bestBoundaryIndex: 0, floorApplied: false },
    ];
    const anomaly = checkThresholdAnomalies(results, 100);
    expect(anomaly).not.toBeNull();
    expect(anomaly!.warning).toContain('<3');
  });

  it('warns when >30% anchored', () => {
    const results: AnchoringResult[] = Array.from({ length: 40 }, (_, i) => ({
      nodeId: `b-${i}`, anchored: true, maxSimilarity: 0.7,
      bestBoundaryIndex: 0, floorApplied: false,
    }));
    const anomaly = checkThresholdAnomalies(results, 100);
    expect(anomaly).not.toBeNull();
    expect(anomaly!.warning).toContain('>30%');
  });

  it('returns null when anchored count is normal', () => {
    const results: AnchoringResult[] = Array.from({ length: 10 }, (_, i) => ({
      nodeId: `b-${i}`, anchored: true, maxSimilarity: 0.7,
      bestBoundaryIndex: 0, floorApplied: false,
    }));
    const anomaly = checkThresholdAnomalies(results, 100);
    expect(anomaly).toBeNull();
  });
});

// ── DEFAULT_ANCHORING_CONFIG ────────────────────────────

describe('DEFAULT_ANCHORING_CONFIG', () => {
  it('has threshold 0.55 and floor 0.60', () => {
    expect(DEFAULT_ANCHORING_CONFIG.threshold).toBe(0.55);
    expect(DEFAULT_ANCHORING_CONFIG.confidenceFloor).toBe(0.60);
  });
});
