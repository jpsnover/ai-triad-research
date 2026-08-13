// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  selectRelevantNodes,
  selectRelevantSituationNodes,
  scoreNodeRelevance,
} from '../debate/taxonomyRelevance.js';
import type { PovNode, SituationNode } from '../debate/taxonomyTypes.js';

// ── Fixture nodes ─────────────────────────────────────────────────────────────

function makePovNode(id: string, category: 'Belief' | 'Desire' | 'Intention', label: string): PovNode {
  return {
    id,
    category,
    label,
    description: `Description for ${label}`,
    parent_id: null,
    children: [],
  };
}

function makeSitNode(id: string, label: string): SituationNode {
  return {
    id,
    label,
    description: `Situation: ${label}`,
    parent_id: null,
    interpretations: {
      accelerationist: { summary: '' },
      safetyist: { summary: '' },
      skeptic: { summary: '' },
    },
  };
}

const POV_NODES: PovNode[] = [
  makePovNode('saf-bel-001', 'Belief', 'AI systems are dangerous'),
  makePovNode('saf-bel-002', 'Belief', 'Unaligned AI is existential'),
  makePovNode('saf-des-001', 'Desire', 'Slow AI deployment'),
  makePovNode('saf-des-002', 'Desire', 'Enforce safety standards'),
  makePovNode('saf-int-001', 'Intention', 'Advocate for regulation'),
  makePovNode('saf-int-002', 'Intention', 'Support interpretability research'),
];

const SIT_NODES: SituationNode[] = [
  makeSitNode('sit-001', 'Misuse of open-weight models'),
  makeSitNode('sit-002', 'Runaway autonomous agent'),
  makeSitNode('sit-003', 'Regulatory capture'),
];

// ── Fixture embeddings (deterministic — no actual model calls) ────────────────

// Simple unit vectors for cosine similarity: higher dot product = higher score
const EMBEDDINGS: Record<string, { pov: string; vector: number[] }> = {
  'saf-bel-001': { pov: 'safetyist', vector: [0.9, 0.1, 0.0] },  // highest
  'saf-bel-002': { pov: 'safetyist', vector: [0.8, 0.2, 0.0] },
  'saf-des-001': { pov: 'safetyist', vector: [0.5, 0.5, 0.0] },
  'saf-des-002': { pov: 'safetyist', vector: [0.4, 0.6, 0.0] },
  'saf-int-001': { pov: 'safetyist', vector: [0.3, 0.3, 0.1] },
  'saf-int-002': { pov: 'safetyist', vector: [0.2, 0.2, 0.1] },  // lowest
  'sit-001': { pov: 'situations', vector: [0.85, 0.15, 0.0] },
  'sit-002': { pov: 'situations', vector: [0.6,  0.4,  0.0] },
  'sit-003': { pov: 'situations', vector: [0.1,  0.1,  0.0] },   // lowest
};

// Query vector aligned with saf-bel-001 direction
const QUERY_VECTOR = [1.0, 0.0, 0.0];

describe('scoreNodeRelevance', () => {
  it('returns a score for every node in the embeddings map', () => {
    const scores = scoreNodeRelevance(QUERY_VECTOR, EMBEDDINGS);
    expect(scores.size).toBe(Object.keys(EMBEDDINGS).length);
  });

  it('produces the same Map on repeated calls with the same inputs', () => {
    const first = scoreNodeRelevance(QUERY_VECTOR, EMBEDDINGS);
    const second = scoreNodeRelevance(QUERY_VECTOR, EMBEDDINGS);
    for (const [id, score] of first) {
      expect(second.get(id)).toBe(score);
    }
  });

  it('scores saf-bel-001 higher than saf-int-002 for a query aligned with belief', () => {
    const scores = scoreNodeRelevance(QUERY_VECTOR, EMBEDDINGS);
    expect(scores.get('saf-bel-001')!).toBeGreaterThan(scores.get('saf-int-002')!);
  });
});

describe('selectRelevantNodes', () => {
  it('returns the same node ids in the same order on repeated calls', () => {
    const scores = scoreNodeRelevance(QUERY_VECTOR, EMBEDDINGS);
    const first = selectRelevantNodes(POV_NODES, scores, 0.0, 1, 6);
    const second = selectRelevantNodes(POV_NODES, scores, 0.0, 1, 6);
    const firstIds = first.map(n => n.node.id);
    const secondIds = second.map(n => n.node.id);
    expect(firstIds).toEqual(secondIds);
  });

  it('respects maxTotal — never returns more nodes than the cap', () => {
    const scores = scoreNodeRelevance(QUERY_VECTOR, EMBEDDINGS);
    const result = selectRelevantNodes(POV_NODES, scores, 0.0, 1, 3);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('ranks saf-bel-001 before saf-int-002 when both pass threshold', () => {
    const scores = scoreNodeRelevance(QUERY_VECTOR, EMBEDDINGS);
    const result = selectRelevantNodes(POV_NODES, scores, 0.0, 1, 6);
    const ids = result.map(n => n.node.id);
    const bel001Idx = ids.indexOf('saf-bel-001');
    const int002Idx = ids.indexOf('saf-int-002');
    if (bel001Idx !== -1 && int002Idx !== -1) {
      expect(bel001Idx).toBeLessThan(int002Idx);
    }
  });
});

describe('selectRelevantSituationNodes', () => {
  it('returns the same situation ids in the same order on repeated calls', () => {
    const scores = scoreNodeRelevance(QUERY_VECTOR, EMBEDDINGS);
    const first = selectRelevantSituationNodes(SIT_NODES, scores, 0.0, 1, 3);
    const second = selectRelevantSituationNodes(SIT_NODES, scores, 0.0, 1, 3);
    expect(first.map(n => n.node.id)).toEqual(second.map(n => n.node.id));
  });

  it('ranks sit-001 above sit-003 for the fixture query', () => {
    const scores = scoreNodeRelevance(QUERY_VECTOR, EMBEDDINGS);
    const result = selectRelevantSituationNodes(SIT_NODES, scores, 0.0, 1, 3);
    const ids = result.map(n => n.node.id);
    const sit001Idx = ids.indexOf('sit-001');
    const sit003Idx = ids.indexOf('sit-003');
    if (sit001Idx !== -1 && sit003Idx !== -1) {
      expect(sit001Idx).toBeLessThan(sit003Idx);
    }
  });
});
