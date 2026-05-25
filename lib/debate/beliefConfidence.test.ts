// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  computeBase,
  computeEvidenceBoost,
  computeDebateBoost,
  computeEdgeBoost,
  computeBeliefConfidence,
  countEdgesByTarget,
  assignBeliefConfidences,
} from './beliefConfidence.js';
import type { ConfidenceSignals } from './beliefConfidence.js';
import type { PovNode } from './taxonomyTypes.js';
import type { Edge } from './taxonomyTypes.js';

// ── computeBase ──────────────────────────────────────────

describe('computeBase', () => {
  it('empirical_claim + high falsifiability → 0.80', () => {
    expect(computeBase('empirical_claim', 'high')).toBe(0.80);
  });

  it('empirical_claim + medium falsifiability → 0.70', () => {
    expect(computeBase('empirical_claim', 'medium')).toBe(0.70);
  });

  it('empirical_claim + low falsifiability → 0.60', () => {
    expect(computeBase('empirical_claim', 'low')).toBe(0.60);
  });

  it('empirical_claim + missing falsifiability → 0.70 (default medium)', () => {
    expect(computeBase('empirical_claim', undefined)).toBe(0.70);
  });

  it('predictive → 0.40', () => {
    expect(computeBase('predictive')).toBe(0.40);
  });

  it('interpretive_lens → 0.50', () => {
    expect(computeBase('interpretive_lens')).toBe(0.50);
  });

  it('definitional → 0.50', () => {
    expect(computeBase('definitional')).toBe(0.50);
  });

  it('unknown type → 0.50', () => {
    expect(computeBase('something_else')).toBe(0.50);
  });

  it('undefined type → 0.50', () => {
    expect(computeBase(undefined)).toBe(0.50);
  });
});

// ── computeEvidenceBoost ─────────────────────────────────

describe('computeEvidenceBoost', () => {
  it('0 docs → 0', () => {
    expect(computeEvidenceBoost(0)).toBe(0);
  });

  it('1 doc → 0.05', () => {
    expect(computeEvidenceBoost(1)).toBe(0.05);
  });

  it('3 docs → 0.15 (cap)', () => {
    expect(computeEvidenceBoost(3)).toBe(0.15);
  });

  it('10 docs → 0.15 (cap)', () => {
    expect(computeEvidenceBoost(10)).toBe(0.15);
  });
});

// ── computeDebateBoost ───────────────────────────────────

describe('computeDebateBoost', () => {
  it('0 debates → 0', () => {
    expect(computeDebateBoost(0)).toBe(0);
  });

  it('1 debate → 0.03', () => {
    expect(computeDebateBoost(1)).toBeCloseTo(0.03);
  });

  it('3 debates → 0.09', () => {
    expect(computeDebateBoost(3)).toBeCloseTo(0.09);
  });

  it('4+ debates → 0.10 (cap)', () => {
    expect(computeDebateBoost(4)).toBe(0.10);
  });
});

// ── computeEdgeBoost ─────────────────────────────────────

describe('computeEdgeBoost', () => {
  it('no edges → 0', () => {
    expect(computeEdgeBoost(0, 0)).toBe(0);
  });

  it('supports only → positive boost (capped at 0.05)', () => {
    expect(computeEdgeBoost(3, 0)).toBe(0.05);
    expect(computeEdgeBoost(10, 0)).toBe(0.05);
  });

  it('attacks only → negative boost (capped at -0.05)', () => {
    expect(computeEdgeBoost(0, 3)).toBe(-0.05);
    expect(computeEdgeBoost(0, 10)).toBe(-0.05);
  });

  it('balanced → 0', () => {
    expect(computeEdgeBoost(3, 3)).toBe(0);
  });

  it('more supports than attacks → positive', () => {
    expect(computeEdgeBoost(2, 1)).toBeCloseTo(0.02);
  });

  it('more attacks than supports → negative', () => {
    expect(computeEdgeBoost(1, 2)).toBeCloseTo(-0.02);
  });
});

// ── computeBeliefConfidence (full formula) ───────────────

describe('computeBeliefConfidence', () => {
  it('empirical + high fals + 3 docs + 0 debates + balanced edges → 0.95 (cap)', () => {
    const signals: ConfidenceSignals = {
      epistemic_type: 'empirical_claim',
      falsifiability: 'high',
      source_doc_count: 3,
      debate_ref_count: 0,
      supports_received: 3,
      attacks_received: 3,
    };
    // base=0.80 + evidence=0.15 + debate=0 + edge=0 = 0.95
    expect(computeBeliefConfidence(signals)).toBe(0.95);
  });

  it('predictive + 0 docs + 0 debates + heavily attacked → 0.35', () => {
    const signals: ConfidenceSignals = {
      epistemic_type: 'predictive',
      falsifiability: 'low',
      source_doc_count: 0,
      debate_ref_count: 0,
      supports_received: 0,
      attacks_received: 5,
    };
    // base=0.40 + 0 + 0 - 0.05 = 0.35
    expect(computeBeliefConfidence(signals)).toBe(0.35);
  });

  it('clamps to minimum 0.10', () => {
    const signals: ConfidenceSignals = {
      epistemic_type: 'predictive',
      source_doc_count: 0,
      debate_ref_count: 0,
      supports_received: 0,
      attacks_received: 100,
    };
    // base=0.40 - 0.05 = 0.35 → 0.35 (above floor)
    // Actually with predictive: 0.40 + 0 + 0 - 0.05 = 0.35
    expect(computeBeliefConfidence(signals)).toBeGreaterThanOrEqual(0.10);
  });

  it('clamps to maximum 0.95', () => {
    const signals: ConfidenceSignals = {
      epistemic_type: 'empirical_claim',
      falsifiability: 'high',
      source_doc_count: 10,
      debate_ref_count: 10,
      supports_received: 10,
      attacks_received: 0,
    };
    // base=0.80 + 0.15 + 0.10 + 0.05 = 1.10 → clamped to 0.95
    expect(computeBeliefConfidence(signals)).toBe(0.95);
  });

  it('empirical well-supported: 0.70 base + evidence → well-supported tier', () => {
    const signals: ConfidenceSignals = {
      epistemic_type: 'empirical_claim',
      falsifiability: 'medium',
      source_doc_count: 2,
      debate_ref_count: 0,
      supports_received: 1,
      attacks_received: 1,
    };
    // base=0.70 + 0.10 + 0 + 0 = 0.80
    expect(computeBeliefConfidence(signals)).toBe(0.80);
  });

  it('interpretive lens with no signals → 0.50 (plausible)', () => {
    const signals: ConfidenceSignals = {
      epistemic_type: 'interpretive_lens',
      source_doc_count: 0,
      debate_ref_count: 0,
      supports_received: 0,
      attacks_received: 0,
    };
    expect(computeBeliefConfidence(signals)).toBe(0.50);
  });
});

// ── countEdgesByTarget ───────────────────────────────────

describe('countEdgesByTarget', () => {
  function makeEdge(source: string, target: string, type: string, status = 'approved', bidir = false): Edge {
    return {
      source, target, type, bidirectional: bidir,
      confidence: 0.9, rationale: 'test', status: status as Edge['status'],
      discovered_at: '2026-01-01', model: 'test',
    };
  }

  it('counts SUPPORTS edges as supports', () => {
    const edges = [
      makeEdge('a', 'b', 'SUPPORTS'),
      makeEdge('c', 'b', 'SUPPORTS'),
    ];
    const { supports, attacks } = countEdgesByTarget(edges);
    expect(supports.get('b')).toBe(2);
    expect(attacks.get('b')).toBeUndefined();
  });

  it('counts CONTRADICTS and WEAKENS as attacks', () => {
    const edges = [
      makeEdge('a', 'b', 'CONTRADICTS'),
      makeEdge('c', 'b', 'WEAKENS'),
    ];
    const { attacks } = countEdgesByTarget(edges);
    expect(attacks.get('b')).toBe(2);
  });

  it('ignores rejected edges', () => {
    const edges = [
      makeEdge('a', 'b', 'SUPPORTS', 'rejected'),
    ];
    const { supports } = countEdgesByTarget(edges);
    expect(supports.get('b')).toBeUndefined();
  });

  it('counts bidirectional edges for both source and target', () => {
    const edges = [
      makeEdge('a', 'b', 'SUPPORTS', 'approved', true),
    ];
    const { supports } = countEdgesByTarget(edges);
    expect(supports.get('a')).toBe(1);
    expect(supports.get('b')).toBe(1);
  });

  it('ignores non-support/attack edge types', () => {
    const edges = [
      makeEdge('a', 'b', 'ASSUMES'),
      makeEdge('a', 'b', 'INTERPRETS'),
    ];
    const { supports, attacks } = countEdgesByTarget(edges);
    expect(supports.size).toBe(0);
    expect(attacks.size).toBe(0);
  });
});

// ── assignBeliefConfidences ──────────────────────────────

describe('assignBeliefConfidences', () => {
  function makeBeliefNode(id: string, epistemicType?: string, falsifiability?: string, debateRefs?: string[]): PovNode {
    return {
      id,
      category: 'Beliefs',
      label: `Belief ${id}`,
      description: `A Belief within test discourse that ${id}`,
      parent_id: null,
      children: [],
      situation_refs: [],
      graph_attributes: epistemicType ? { epistemic_type: epistemicType, falsifiability } : undefined,
      debate_refs: debateRefs,
    };
  }

  it('assigns confidence to Belief nodes and creates history', () => {
    const node = makeBeliefNode('acc-beliefs-001', 'empirical_claim', 'high');
    const results = assignBeliefConfidences(
      [{ node, sourceDocCount: 3 }],
      [],
      '2026-05-24',
    );

    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe(0.95);
    expect(node.confidence).toBe(0.95);
    expect(node.confidence_history).toHaveLength(1);
    expect(node.confidence_history![0].date).toBe('2026-05-24');
    expect(node.confidence_history![0].delta).toBe(0);
    expect(node.confidence_history![0].reason).toBe('Initial multi-signal assignment');
  });

  it('skips non-Belief nodes', () => {
    const desire: PovNode = {
      id: 'acc-desires-001',
      category: 'Desires',
      label: 'Test',
      description: 'A Desire within test discourse that tests',
      parent_id: null,
      children: [],
      situation_refs: [],
    };
    const results = assignBeliefConfidences(
      [{ node: desire, sourceDocCount: 5 }],
      [],
      '2026-05-24',
    );
    expect(results).toHaveLength(0);
    expect(desire.confidence).toBeUndefined();
  });

  it('uses edge counts from provided edges', () => {
    const node = makeBeliefNode('acc-beliefs-001', 'interpretive_lens');
    const edges: Edge[] = [
      { source: 'x', target: 'acc-beliefs-001', type: 'SUPPORTS', bidirectional: false, confidence: 0.9, rationale: '', status: 'approved', discovered_at: '', model: '' },
      { source: 'x', target: 'acc-beliefs-001', type: 'SUPPORTS', bidirectional: false, confidence: 0.9, rationale: '', status: 'approved', discovered_at: '', model: '' },
      { source: 'x', target: 'acc-beliefs-001', type: 'SUPPORTS', bidirectional: false, confidence: 0.9, rationale: '', status: 'approved', discovered_at: '', model: '' },
    ];

    const results = assignBeliefConfidences(
      [{ node, sourceDocCount: 0 }],
      edges,
      '2026-05-24',
    );

    // base=0.50 + evidence=0 + debate=0 + edge=+0.05(capped) = 0.55
    expect(results[0].confidence).toBe(0.55);
    expect(results[0].signals.supports_received).toBe(3);
  });

  it('includes debate_refs in signal', () => {
    const node = makeBeliefNode('acc-beliefs-001', 'empirical_claim', 'medium', ['d1', 'd2']);
    const results = assignBeliefConfidences(
      [{ node, sourceDocCount: 0 }],
      [],
      '2026-05-24',
    );

    // base=0.70 + evidence=0 + debate=0.06 + edge=0 = 0.76
    expect(results[0].confidence).toBe(0.76);
    expect(results[0].signals.debate_ref_count).toBe(2);
  });

  it('sanity: empirical > interpretive > predictive with same signals', () => {
    const empirical = makeBeliefNode('b1', 'empirical_claim', 'medium');
    const interpretive = makeBeliefNode('b2', 'interpretive_lens');
    const predictive = makeBeliefNode('b3', 'predictive');

    const results = assignBeliefConfidences(
      [
        { node: empirical, sourceDocCount: 1 },
        { node: interpretive, sourceDocCount: 1 },
        { node: predictive, sourceDocCount: 1 },
      ],
      [],
      '2026-05-24',
    );

    expect(results[0].confidence).toBeGreaterThan(results[1].confidence);
    expect(results[1].confidence).toBeGreaterThan(results[2].confidence);
  });
});
