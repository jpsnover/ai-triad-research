// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { computeConvergenceSignals, SEMANTIC_RECYCLING_THRESHOLD, ARCO_DRIFT_THRESHOLD, computeUncertaintyMetric, boostConvergenceOnConcession, CONCESSION_CONVERGENCE_BOOST, boostConvergenceFromTaxonomyEdges, CONVERGES_WITH_BOOST } from './convergenceSignals.js';
import type {
  SpeakerId,
  TranscriptEntry,
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  ConvergenceSignals,
  ConvergenceTracker,
  ConvergenceIssue,
  TrackedCrux,
} from './types.js';

// ── Factory helpers ────────────────────────────────────────

let _idCounter = 0;
function uid(): string {
  return `entry-${++_idCounter}`;
}

function makeEntry(overrides: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    id: uid(),
    type: 'cross-respond',
    speaker: 'accelerationist',
    content: 'Default content for testing purposes.',
    ...overrides,
  };
}

function makeNode(overrides: Partial<ArgumentNetworkNode> = {}): ArgumentNetworkNode {
  return {
    id: `node-${++_idCounter}`,
    text: 'Default node text',
    speaker: 'accelerationist',
    base_strength: 0.5,
    computed_strength: 0.5,
    ...overrides,
  };
}

function makeEdge(
  source: string,
  target: string,
  type: 'attacks' | 'supports' = 'attacks',
  overrides: Partial<ArgumentNetworkEdge> = {},
): ArgumentNetworkEdge {
  return { source, target, type, weight: 0.5, ...overrides };
}

/** Create a simple embedding vector of given dimension with a seed value */
function makeEmbedding(seed: number, dim = 4): number[] {
  const v: number[] = [];
  for (let i = 0; i < dim; i++) v.push(Math.sin(seed + i));
  return v;
}

/** Create an identical-direction embedding (high cosine similarity to seed) */
function makeSimilarEmbedding(seed: number, dim = 4): number[] {
  // Scale up the same direction: cosine similarity will be ~1.0
  return makeEmbedding(seed, dim).map(v => v * 1.2);
}

/** Create an embedding with low but non-zero cosine similarity to makeEmbedding(seed) */
function makeDissimilarEmbedding(seed: number, dim = 4): number[] {
  // Mix a small fraction of the original direction with a perpendicular one to get ~0.2 cosine sim
  const base = makeEmbedding(seed, dim);
  const perp: number[] = new Array(dim);
  for (let i = 0; i < dim; i += 2) {
    perp[i] = -(base[i + 1] ?? 0);
    perp[i + 1] = base[i];
  }
  // 0.1 * base + 0.9 * perp => cosine similarity ~ 0.1, well below 0.85
  return base.map((v, i) => 0.1 * v + 0.9 * perp[i]);
}

function makeSignals(overrides: Partial<ConvergenceSignals> = {}): ConvergenceSignals {
  return {
    entry_id: 'prev-entry',
    round: 1,
    speaker: 'accelerationist',
    move_polarity: { confrontational: 0, collaborative: 0, ratio: 0 },
    dialectical_engagement: { targeted: 0, standalone: 0, ratio: 0 },
    argument_redundancy: { avg_self_overlap: 0, max_self_overlap: 0 },
    dominant_counterargument: null,
    concession_opportunity: { strong_attacks_faced: 0, concession_used: false, outcome: 'none' },
    position_drift: { overlap_with_opening: 0.5, drift: 0 },
    crux_engagement_rate: { used_this_turn: false, cumulative_count: 0, cumulative_follow_through: 0 },
    ...overrides,
  };
}

// ── Constants ──────────────────────────────────────────────

describe('SEMANTIC_RECYCLING_THRESHOLD', () => {
  it('is exported as 0.85', () => {
    expect(SEMANTIC_RECYCLING_THRESHOLD).toBe(0.85);
  });
});

// ── Empty / minimal inputs ─────────────────────────────────

describe('computeConvergenceSignals — empty inputs', () => {
  it('returns zeroed signals when transcript is empty', () => {
    const result = computeConvergenceSignals(
      'missing-id', 'accelerationist', [], [], [], [],
    );
    expect(result.entry_id).toBe('missing-id');
    expect(result.speaker).toBe('accelerationist');
    expect(result.move_polarity.ratio).toBe(0);
    expect(result.dialectical_engagement.ratio).toBe(0);
    expect(result.argument_redundancy.avg_self_overlap).toBe(0);
    expect(result.dominant_counterargument).toBeNull();
    expect(result.concession_opportunity.outcome).toBe('none');
    expect(result.position_drift.overlap_with_opening).toBe(0);
    expect(result.crux_engagement_rate.used_this_turn).toBe(false);
  });

  it('returns zeroed signals when no nodes or edges exist', () => {
    const entry = makeEntry({ id: 'e1' });
    const result = computeConvergenceSignals(
      'e1', 'accelerationist', [entry], [], [], [],
    );
    expect(result.dialectical_engagement).toEqual({ targeted: 0, standalone: 0, ratio: 0 });
    expect(result.dominant_counterargument).toBeNull();
  });

  it('handles entry not found in transcript gracefully', () => {
    const entry = makeEntry({ id: 'other' });
    const result = computeConvergenceSignals(
      'nonexistent', 'accelerationist', [entry], [], [], [],
    );
    expect(result.round).toBe(0); // findIndex returns -1, round = -1 + 1 = 0
    expect(result.move_polarity.ratio).toBe(0);
  });
});

// ── Round calculation ──────────────────────────────────────

describe('computeConvergenceSignals — round', () => {
  it('sets round to 1-based index of entry in transcript', () => {
    const e1 = makeEntry({ id: 'e1' });
    const e2 = makeEntry({ id: 'e2' });
    const e3 = makeEntry({ id: 'e3' });
    const result = computeConvergenceSignals(
      'e3', 'accelerationist', [e1, e2, e3], [], [], [],
    );
    expect(result.round).toBe(3);
  });

  it('sets round to 1 for first entry', () => {
    const e1 = makeEntry({ id: 'first' });
    const result = computeConvergenceSignals(
      'first', 'accelerationist', [e1], [], [], [],
    );
    expect(result.round).toBe(1);
  });
});

// ── Move disposition ───────────────────────────────────────

describe('computeConvergenceSignals — move disposition', () => {
  it('counts only attack moves as confrontational', () => {
    const entry = makeEntry({
      id: 'atk',
      metadata: { move_types: ['COUNTEREXAMPLE', 'UNDERCUT', 'DISTINGUISH'] },
    });
    const result = computeConvergenceSignals(
      'atk', 'accelerationist', [entry], [], [], [],
    );
    expect(result.move_polarity.confrontational).toBe(3);
    expect(result.move_polarity.collaborative).toBe(0);
    expect(result.move_polarity.ratio).toBe(0);
  });

  it('counts only support moves as collaborative', () => {
    const entry = makeEntry({
      id: 'sup',
      metadata: { move_types: ['CONCEDE', 'INTEGRATE', 'EXTEND'] },
    });
    const result = computeConvergenceSignals(
      'sup', 'accelerationist', [entry], [], [], [],
    );
    expect(result.move_polarity.confrontational).toBe(0);
    expect(result.move_polarity.collaborative).toBe(3);
    expect(result.move_polarity.ratio).toBe(1);
  });

  it('computes ratio for mixed attack and support moves', () => {
    const entry = makeEntry({
      id: 'mixed',
      metadata: { move_types: ['COUNTEREXAMPLE', 'CONCEDE', 'UNDERCUT', 'INTEGRATE'] },
    });
    const result = computeConvergenceSignals(
      'mixed', 'accelerationist', [entry], [], [], [],
    );
    expect(result.move_polarity.confrontational).toBe(2);
    expect(result.move_polarity.collaborative).toBe(2);
    expect(result.move_polarity.ratio).toBe(0.5);
  });

  it('returns ratio 0 when no moves are present', () => {
    const entry = makeEntry({ id: 'nomoves', metadata: {} });
    const result = computeConvergenceSignals(
      'nomoves', 'accelerationist', [entry], [], [], [],
    );
    expect(result.move_polarity.ratio).toBe(0);
    expect(result.move_polarity.confrontational).toBe(0);
    expect(result.move_polarity.collaborative).toBe(0);
  });

  it('ignores neutral moves (IDENTIFY-CRUX, SPECIFY, etc.) in disposition counts', () => {
    const entry = makeEntry({
      id: 'neutral',
      metadata: { move_types: ['IDENTIFY-CRUX', 'SPECIFY', 'GROUND-CHECK'] },
    });
    const result = computeConvergenceSignals(
      'neutral', 'accelerationist', [entry], [], [], [],
    );
    expect(result.move_polarity.confrontational).toBe(0);
    expect(result.move_polarity.collaborative).toBe(0);
    expect(result.move_polarity.ratio).toBe(0);
  });

  it('handles MoveAnnotation objects in move_types', () => {
    const entry = makeEntry({
      id: 'annot',
      metadata: {
        move_types: [
          { move: 'COUNTEREXAMPLE', detail: 'test', target: 'n1' },
          { move: 'CONCEDE', detail: 'agreed', target: 'n2' },
        ],
      },
    });
    const result = computeConvergenceSignals(
      'annot', 'accelerationist', [entry], [], [], [],
    );
    expect(result.move_polarity.confrontational).toBe(1);
    expect(result.move_polarity.collaborative).toBe(1);
    expect(result.move_polarity.ratio).toBe(0.5);
  });

  it('normalizes hyphenated and underscored move names', () => {
    const entry = makeEntry({
      id: 'norm',
      metadata: { move_types: ['CONCEDE_AND_PIVOT', 'EMPIRICAL-CHALLENGE'] },
    });
    const result = computeConvergenceSignals(
      'norm', 'accelerationist', [entry], [], [], [],
    );
    // CONCEDE-AND-PIVOT is support (dual), EMPIRICAL CHALLENGE is attack
    expect(result.move_polarity.collaborative).toBeGreaterThanOrEqual(1);
    expect(result.move_polarity.confrontational).toBeGreaterThanOrEqual(1);
  });
});

// ── Engagement depth ───────────────────────────────────────

describe('computeConvergenceSignals — engagement depth', () => {
  it('counts nodes with cross-turn edges as targeted', () => {
    const entryId = 'eng1';
    const n1 = makeNode({ id: 'n1', source_entry_id: entryId, speaker: 'accelerationist' });
    const n2 = makeNode({ id: 'n2', source_entry_id: 'other-entry', speaker: 'safetyist' });
    const edge = makeEdge('n1', 'n2', 'attacks');
    const entry = makeEntry({ id: entryId });

    const result = computeConvergenceSignals(
      entryId, 'accelerationist', [entry], [n1, n2], [edge], [],
    );
    expect(result.dialectical_engagement.targeted).toBe(1);
    expect(result.dialectical_engagement.standalone).toBe(0);
    expect(result.dialectical_engagement.ratio).toBe(1);
  });

  it('counts nodes with no cross-turn edges as standalone', () => {
    const entryId = 'eng2';
    const n1 = makeNode({ id: 'n1', source_entry_id: entryId, speaker: 'accelerationist' });
    const entry = makeEntry({ id: entryId });

    const result = computeConvergenceSignals(
      entryId, 'accelerationist', [entry], [n1], [], [],
    );
    expect(result.dialectical_engagement.targeted).toBe(0);
    expect(result.dialectical_engagement.standalone).toBe(1);
    expect(result.dialectical_engagement.ratio).toBe(0);
  });

  it('ignores intra-turn edges for engagement depth', () => {
    const entryId = 'eng3';
    const n1 = makeNode({ id: 'na', source_entry_id: entryId, speaker: 'accelerationist' });
    const n2 = makeNode({ id: 'nb', source_entry_id: entryId, speaker: 'accelerationist' });
    const edge = makeEdge('na', 'nb', 'supports');
    const entry = makeEntry({ id: entryId });

    const result = computeConvergenceSignals(
      entryId, 'accelerationist', [entry], [n1, n2], [edge], [],
    );
    // Both edges are intra-turn, so both nodes are standalone
    expect(result.dialectical_engagement.targeted).toBe(0);
    expect(result.dialectical_engagement.standalone).toBe(2);
    expect(result.dialectical_engagement.ratio).toBe(0);
  });

  it('computes ratio for mixed targeted and standalone', () => {
    const entryId = 'eng4';
    const n1 = makeNode({ id: 'nx', source_entry_id: entryId, speaker: 'accelerationist' });
    const n2 = makeNode({ id: 'ny', source_entry_id: entryId, speaker: 'accelerationist' });
    const n3 = makeNode({ id: 'nz', source_entry_id: 'other', speaker: 'safetyist' });
    const edge = makeEdge('nx', 'nz', 'attacks');
    const entry = makeEntry({ id: entryId });

    const result = computeConvergenceSignals(
      entryId, 'accelerationist', [entry], [n1, n2, n3], [edge], [],
    );
    expect(result.dialectical_engagement.targeted).toBe(1);
    expect(result.dialectical_engagement.standalone).toBe(1);
    expect(result.dialectical_engagement.ratio).toBe(0.5);
  });

  it('handles incoming edges (target is turn node, source is external)', () => {
    const entryId = 'eng5';
    const n1 = makeNode({ id: 'n-in', source_entry_id: entryId, speaker: 'accelerationist' });
    const n2 = makeNode({ id: 'n-ext', source_entry_id: 'other', speaker: 'safetyist' });
    const edge = makeEdge('n-ext', 'n-in', 'attacks');
    const entry = makeEntry({ id: entryId });

    const result = computeConvergenceSignals(
      entryId, 'accelerationist', [entry], [n1, n2], [edge], [],
    );
    expect(result.dialectical_engagement.targeted).toBe(1);
    expect(result.dialectical_engagement.standalone).toBe(0);
  });

  it('returns ratio 0 when turn has no nodes', () => {
    const entry = makeEntry({ id: 'eng6' });
    const result = computeConvergenceSignals(
      'eng6', 'accelerationist', [entry], [], [], [],
    );
    expect(result.dialectical_engagement.ratio).toBe(0);
  });
});

// ── Recycling rate (word overlap) ──────────────────────────

describe('computeConvergenceSignals — recycling rate', () => {
  it('returns 0 overlap when speaker has no prior turns', () => {
    const entry = makeEntry({
      id: 'rec1',
      content: 'This is the first turn with some words.',
    });
    const result = computeConvergenceSignals(
      'rec1', 'accelerationist', [entry], [], [], [],
    );
    expect(result.argument_redundancy.avg_self_overlap).toBe(0);
    expect(result.argument_redundancy.max_self_overlap).toBe(0);
  });

  it('computes high overlap when repeating same words', () => {
    const prior = makeEntry({
      id: 'r-prior',
      speaker: 'safetyist',
      content: 'regulation safety governance alignment policy',
    });
    const current = makeEntry({
      id: 'r-current',
      speaker: 'safetyist',
      content: 'regulation safety governance alignment policy',
    });
    const result = computeConvergenceSignals(
      'r-current', 'safetyist', [prior, current], [], [], [],
    );
    expect(result.argument_redundancy.avg_self_overlap).toBe(1);
    expect(result.argument_redundancy.max_self_overlap).toBe(1);
  });

  it('computes low overlap with different vocabulary', () => {
    const prior = makeEntry({
      id: 'r-low-prior',
      speaker: 'skeptic',
      content: 'regulation safety governance alignment policy',
    });
    const current = makeEntry({
      id: 'r-low-current',
      speaker: 'skeptic',
      content: 'innovation disruption acceleration technology progress',
    });
    const result = computeConvergenceSignals(
      'r-low-current', 'skeptic', [prior, current], [], [], [],
    );
    expect(result.argument_redundancy.avg_self_overlap).toBe(0);
    expect(result.argument_redundancy.max_self_overlap).toBe(0);
  });

  it('averages overlap across multiple prior turns by same speaker', () => {
    const prior1 = makeEntry({
      id: 'rm1',
      speaker: 'accelerationist',
      content: 'innovation progress acceleration technology growth',
    });
    const prior2 = makeEntry({
      id: 'rm2',
      speaker: 'accelerationist',
      content: 'completely different words about regulation safety alignment',
    });
    const current = makeEntry({
      id: 'rm3',
      speaker: 'accelerationist',
      content: 'innovation progress acceleration technology growth',
    });
    const result = computeConvergenceSignals(
      'rm3', 'accelerationist', [prior1, prior2, current], [], [], [],
    );
    // Perfect overlap with prior1 (1.0), zero with prior2 (0.0), avg = 0.5
    expect(result.argument_redundancy.max_self_overlap).toBe(1);
    expect(result.argument_redundancy.avg_self_overlap).toBeCloseTo(0.5, 1);
  });

  it('ignores prior entries by different speakers', () => {
    const other = makeEntry({
      id: 'ro-other',
      speaker: 'safetyist',
      content: 'innovation progress acceleration technology growth',
    });
    const current = makeEntry({
      id: 'ro-curr',
      speaker: 'accelerationist',
      content: 'innovation progress acceleration technology growth',
    });
    const result = computeConvergenceSignals(
      'ro-curr', 'accelerationist', [other, current], [], [], [],
    );
    expect(result.argument_redundancy.avg_self_overlap).toBe(0);
  });
});

// ── Semantic recycling ─────────────────────────────────────

describe('computeConvergenceSignals — semantic recycling', () => {
  it('returns undefined semantic fields when no embeddings provided', () => {
    const entry = makeEntry({ id: 'sem1' });
    const result = computeConvergenceSignals(
      'sem1', 'accelerationist', [entry], [], [], [],
    );
    expect(result.argument_redundancy.semantic_max_similarity).toBeUndefined();
    expect(result.argument_redundancy.semantically_recycled).toBeUndefined();
  });

  it('returns undefined when current entry has no embedding', () => {
    const prior = makeEntry({ id: 'sem-prior', speaker: 'accelerationist' });
    const entry = makeEntry({ id: 'sem2', speaker: 'accelerationist' });
    const embeddings = new Map<string, number[]>();
    embeddings.set('sem-prior', makeEmbedding(1));
    // No embedding for 'sem2'

    const result = computeConvergenceSignals(
      'sem2', 'accelerationist', [prior, entry], [], [], [], embeddings,
    );
    expect(result.argument_redundancy.semantic_max_similarity).toBeUndefined();
    expect(result.argument_redundancy.semantically_recycled).toBeUndefined();
  });

  it('detects high semantic similarity (above threshold)', () => {
    const prior = makeEntry({ id: 'sh-prior', speaker: 'accelerationist' });
    const entry = makeEntry({ id: 'sh-curr', speaker: 'accelerationist' });
    const embeddings = new Map<string, number[]>();
    const e = makeEmbedding(42);
    embeddings.set('sh-prior', e);
    embeddings.set('sh-curr', makeSimilarEmbedding(42)); // same direction, scaled

    const result = computeConvergenceSignals(
      'sh-curr', 'accelerationist', [prior, entry], [], [], [], embeddings,
    );
    expect(result.argument_redundancy.semantic_max_similarity).toBeGreaterThan(SEMANTIC_RECYCLING_THRESHOLD);
    expect(result.argument_redundancy.semantically_recycled).toBe(true);
  });

  it('detects low semantic similarity (below threshold)', () => {
    const prior = makeEntry({ id: 'sl-prior', speaker: 'safetyist' });
    const entry = makeEntry({ id: 'sl-curr', speaker: 'safetyist' });
    const embeddings = new Map<string, number[]>();
    embeddings.set('sl-prior', makeEmbedding(1));
    embeddings.set('sl-curr', makeDissimilarEmbedding(1));

    const result = computeConvergenceSignals(
      'sl-curr', 'safetyist', [prior, entry], [], [], [], embeddings,
    );
    expect(result.argument_redundancy.semantic_max_similarity).toBeDefined();
    expect(result.argument_redundancy.semantically_recycled).toBe(false);
  });

  it('returns undefined when speaker has no prior turns with embeddings', () => {
    const entry = makeEntry({ id: 'sn-curr', speaker: 'accelerationist' });
    const embeddings = new Map<string, number[]>();
    embeddings.set('sn-curr', makeEmbedding(5));

    const result = computeConvergenceSignals(
      'sn-curr', 'accelerationist', [entry], [], [], [], embeddings,
    );
    // No prior same-speaker entries, so maxSim stays 0 and fields are undefined
    expect(result.argument_redundancy.semantic_max_similarity).toBeUndefined();
    expect(result.argument_redundancy.semantically_recycled).toBeUndefined();
  });

  it('picks the maximum similarity across multiple prior turns', () => {
    const p1 = makeEntry({ id: 'sm-p1', speaker: 'skeptic' });
    const p2 = makeEntry({ id: 'sm-p2', speaker: 'skeptic' });
    const curr = makeEntry({ id: 'sm-curr', speaker: 'skeptic' });
    const embeddings = new Map<string, number[]>();
    embeddings.set('sm-p1', makeDissimilarEmbedding(1));    // low sim
    embeddings.set('sm-p2', makeSimilarEmbedding(7));        // high sim
    embeddings.set('sm-curr', makeEmbedding(7));             // matches p2

    const result = computeConvergenceSignals(
      'sm-curr', 'skeptic', [p1, p2, curr], [], [], [], embeddings,
    );
    expect(result.argument_redundancy.semantic_max_similarity).toBeDefined();
    // The similarity with p2 should be higher than with p1
    const simP2 = result.argument_redundancy.semantic_max_similarity!;
    expect(simP2).toBeGreaterThan(0.5);
  });
});

// ── Strongest opposing argument ────────────────────────────

describe('computeConvergenceSignals — strongest opposing', () => {
  it('returns null when no attacks target speaker nodes', () => {
    const entry = makeEntry({ id: 'op1' });
    const n1 = makeNode({ id: 'sn1', speaker: 'accelerationist' });
    const result = computeConvergenceSignals(
      'op1', 'accelerationist', [entry], [n1], [], [],
    );
    expect(result.dominant_counterargument).toBeNull();
  });

  it('identifies the strongest attack on speaker nodes using precomputedStrengths', () => {
    const entry = makeEntry({ id: 'op2' });
    const speakerNode = makeNode({ id: 'sp1', speaker: 'accelerationist' });
    const attackerNode1 = makeNode({ id: 'at1', speaker: 'safetyist', bdi_category: 'belief' });
    const attackerNode2 = makeNode({ id: 'at2', speaker: 'skeptic', bdi_category: 'desire' });
    const edge1 = makeEdge('at1', 'sp1', 'attacks');
    const edge2 = makeEdge('at2', 'sp1', 'attacks');

    const strengths = new Map<string, number>();
    strengths.set('at1', 0.3);
    strengths.set('at2', 0.9);

    const result = computeConvergenceSignals(
      'op2', 'accelerationist', [entry],
      [speakerNode, attackerNode1, attackerNode2],
      [edge1, edge2], [], undefined, strengths,
    );
    expect(result.dominant_counterargument).not.toBeNull();
    expect(result.dominant_counterargument!.node_id).toBe('at2');
    expect(result.dominant_counterargument!.strength).toBe(0.9);
    expect(result.dominant_counterargument!.attacker).toBe('skeptic');
    expect(result.dominant_counterargument!.bdi_category).toBe('desire');
  });

  it('defaults to 0.5 strength when node is not in precomputed strengths', () => {
    const entry = makeEntry({ id: 'op3' });
    const sp = makeNode({ id: 'sp3', speaker: 'accelerationist' });
    const at = makeNode({ id: 'at3', speaker: 'safetyist' });
    const edge = makeEdge('at3', 'sp3', 'attacks');
    const strengths = new Map<string, number>(); // at3 not in map

    const result = computeConvergenceSignals(
      'op3', 'accelerationist', [entry], [sp, at], [edge], [], undefined, strengths,
    );
    expect(result.dominant_counterargument).not.toBeNull();
    expect(result.dominant_counterargument!.strength).toBe(0.5);
  });

  it('ignores support edges for strongest opposing', () => {
    const entry = makeEntry({ id: 'op4' });
    const sp = makeNode({ id: 'sp4', speaker: 'accelerationist' });
    const sup = makeNode({ id: 'sup4', speaker: 'safetyist' });
    const edge = makeEdge('sup4', 'sp4', 'supports');

    const strengths = new Map<string, number>();
    strengths.set('sup4', 0.99);

    const result = computeConvergenceSignals(
      'op4', 'accelerationist', [entry], [sp, sup], [edge], [], undefined, strengths,
    );
    expect(result.dominant_counterargument).toBeNull();
  });

  it('uses QBAF computation when no precomputed strengths provided', () => {
    const entry = makeEntry({ id: 'op5' });
    const sp = makeNode({ id: 'sp5', speaker: 'accelerationist', base_strength: 0.5 });
    const at = makeNode({ id: 'at5', speaker: 'safetyist', base_strength: 0.7 });
    const edge = makeEdge('at5', 'sp5', 'attacks');

    const result = computeConvergenceSignals(
      'op5', 'accelerationist', [entry], [sp, at], [edge], [],
    );
    expect(result.dominant_counterargument).not.toBeNull();
    expect(result.dominant_counterargument!.node_id).toBe('at5');
    // QBAF should compute a strength close to the base_strength
    expect(result.dominant_counterargument!.strength).toBeGreaterThan(0);
  });

  it('sets attacker to "unknown" when attacker node is not found', () => {
    const entry = makeEntry({ id: 'op6' });
    const sp = makeNode({ id: 'sp6', speaker: 'accelerationist' });
    // attacker node referenced in edge but not in nodes array
    const edge = makeEdge('phantom', 'sp6', 'attacks');

    const strengths = new Map<string, number>();
    strengths.set('phantom', 0.8);

    const result = computeConvergenceSignals(
      'op6', 'accelerationist', [entry], [sp], [edge], [], undefined, strengths,
    );
    expect(result.dominant_counterargument).not.toBeNull();
    expect(result.dominant_counterargument!.attacker).toBe('unknown');
  });
});

// ── Concession opportunity ─────────────────────────────────

describe('computeConvergenceSignals — concession opportunity', () => {
  it('returns outcome "none" when no strong attacks faced', () => {
    const entry = makeEntry({ id: 'con1', metadata: { move_types: ['CONCEDE'] } });
    const result = computeConvergenceSignals(
      'con1', 'accelerationist', [entry], [], [], [],
    );
    expect(result.concession_opportunity.outcome).toBe('none');
    expect(result.concession_opportunity.strong_attacks_faced).toBe(0);
  });

  it('returns outcome "taken" when strong attacks faced and concession used', () => {
    const entry = makeEntry({
      id: 'con2',
      metadata: { move_types: ['CONCEDE-AND-PIVOT'] },
    });
    const sp = makeNode({ id: 'c-sp', speaker: 'accelerationist' });
    const at = makeNode({ id: 'c-at', speaker: 'safetyist' });
    const edge = makeEdge('c-at', 'c-sp', 'attacks');
    const strengths = new Map<string, number>();
    strengths.set('c-at', 0.8); // >= 0.6 threshold

    const result = computeConvergenceSignals(
      'con2', 'accelerationist', [entry], [sp, at], [edge], [], undefined, strengths,
    );
    expect(result.concession_opportunity.outcome).toBe('taken');
    expect(result.concession_opportunity.strong_attacks_faced).toBe(1);
    expect(result.concession_opportunity.concession_used).toBe(true);
  });

  it('returns outcome "missed" when strong attacks faced but no concession', () => {
    const entry = makeEntry({
      id: 'con3',
      metadata: { move_types: ['COUNTEREXAMPLE', 'UNDERCUT'] },
    });
    const sp = makeNode({ id: 'cm-sp', speaker: 'safetyist' });
    const at = makeNode({ id: 'cm-at', speaker: 'accelerationist' });
    const edge = makeEdge('cm-at', 'cm-sp', 'attacks');
    const strengths = new Map<string, number>();
    strengths.set('cm-at', 0.7); // >= 0.6

    const result = computeConvergenceSignals(
      'con3', 'safetyist', [entry], [sp, at], [edge], [], undefined, strengths,
    );
    expect(result.concession_opportunity.outcome).toBe('missed');
    expect(result.concession_opportunity.concession_used).toBe(false);
  });

  it('does not count attacks below 0.6 as strong', () => {
    const entry = makeEntry({
      id: 'con4',
      metadata: { move_types: ['COUNTEREXAMPLE'] },
    });
    const sp = makeNode({ id: 'cw-sp', speaker: 'accelerationist' });
    const at = makeNode({ id: 'cw-at', speaker: 'safetyist' });
    const edge = makeEdge('cw-at', 'cw-sp', 'attacks');
    const strengths = new Map<string, number>();
    strengths.set('cw-at', 0.5); // below 0.6

    const result = computeConvergenceSignals(
      'con4', 'accelerationist', [entry], [sp, at], [edge], [], undefined, strengths,
    );
    expect(result.concession_opportunity.strong_attacks_faced).toBe(0);
    expect(result.concession_opportunity.outcome).toBe('none');
  });

  it('counts multiple strong attacks', () => {
    const entry = makeEntry({
      id: 'con5',
      metadata: { move_types: ['DISTINGUISH'] },
    });
    const sp = makeNode({ id: 'ms-sp', speaker: 'skeptic' });
    const at1 = makeNode({ id: 'ms-at1', speaker: 'accelerationist' });
    const at2 = makeNode({ id: 'ms-at2', speaker: 'safetyist' });
    const e1 = makeEdge('ms-at1', 'ms-sp', 'attacks');
    const e2 = makeEdge('ms-at2', 'ms-sp', 'attacks');
    const strengths = new Map<string, number>();
    strengths.set('ms-at1', 0.9);
    strengths.set('ms-at2', 0.7);

    const result = computeConvergenceSignals(
      'con5', 'skeptic', [entry], [sp, at1, at2], [e1, e2], [], undefined, strengths,
    );
    expect(result.concession_opportunity.strong_attacks_faced).toBe(2);
  });
});

// ── Position delta ─────────────────────────────────────────

describe('computeConvergenceSignals — position delta', () => {
  it('computes overlap with opening statement', () => {
    const opening = makeEntry({
      id: 'pd-open',
      speaker: 'accelerationist',
      type: 'opening',
      content: 'innovation progress acceleration technology growth',
    });
    const current = makeEntry({
      id: 'pd-curr',
      speaker: 'accelerationist',
      content: 'innovation progress acceleration technology growth',
    });
    const result = computeConvergenceSignals(
      'pd-curr', 'accelerationist', [opening, current], [], [], [],
    );
    expect(result.position_drift.overlap_with_opening).toBe(1);
  });

  it('returns 0 overlap when no opening statement exists', () => {
    const current = makeEntry({
      id: 'pd-noopen',
      speaker: 'accelerationist',
      content: 'some content here',
    });
    const result = computeConvergenceSignals(
      'pd-noopen', 'accelerationist', [current], [], [], [],
    );
    expect(result.position_drift.overlap_with_opening).toBe(0);
  });

  it('computes drift from prior signal overlap value', () => {
    const opening = makeEntry({
      id: 'pd-d-open',
      speaker: 'safetyist',
      type: 'opening',
      content: 'regulation safety governance alignment policy',
    });
    const current = makeEntry({
      id: 'pd-d-curr',
      speaker: 'safetyist',
      content: 'innovation disruption acceleration technology progress',
    });
    const priorSignals: ConvergenceSignals[] = [
      makeSignals({
        speaker: 'safetyist',
        position_drift: { overlap_with_opening: 0.8, drift: 0 },
      }),
    ];
    const result = computeConvergenceSignals(
      'pd-d-curr', 'safetyist', [opening, current], [], [], priorSignals,
    );
    // drift = |current_overlap - 0.8|
    expect(result.position_drift.drift).toBeCloseTo(
      Math.abs(result.position_drift.overlap_with_opening - 0.8),
      5,
    );
  });

  it('sets drift to 0 when no prior signals for this speaker', () => {
    const opening = makeEntry({
      id: 'pd-nd-open',
      speaker: 'accelerationist',
      type: 'opening',
      content: 'some opening content here',
    });
    const current = makeEntry({
      id: 'pd-nd-curr',
      speaker: 'accelerationist',
      content: 'some opening content here',
    });
    const result = computeConvergenceSignals(
      'pd-nd-curr', 'accelerationist', [opening, current], [], [], [],
    );
    expect(result.position_drift.drift).toBe(0);
  });

  it('uses the last prior signal for drift calculation', () => {
    const opening = makeEntry({
      id: 'pd-last-open',
      speaker: 'accelerationist',
      type: 'opening',
      content: 'alpha bravo charlie delta echo foxtrot',
    });
    const current = makeEntry({
      id: 'pd-last-curr',
      speaker: 'accelerationist',
      content: 'alpha bravo charlie delta echo foxtrot',
    });
    const priorSignals: ConvergenceSignals[] = [
      makeSignals({ speaker: 'accelerationist', position_drift: { overlap_with_opening: 0.9, drift: 0 } }),
      makeSignals({ speaker: 'accelerationist', position_drift: { overlap_with_opening: 0.3, drift: 0.6 } }),
    ];
    const result = computeConvergenceSignals(
      'pd-last-curr', 'accelerationist', [opening, current], [], [], priorSignals,
    );
    // Should use last signal's overlap_with_opening (0.3)
    expect(result.position_drift.drift).toBeCloseTo(
      Math.abs(result.position_drift.overlap_with_opening - 0.3),
      5,
    );
  });
});

// ── Crux rate (structural detection via crux_tracker) ─────

function makeCrux(overrides: Partial<TrackedCrux> & { id: string }): TrackedCrux {
  return {
    description: 'Test crux',
    identified_turn: 1,
    state: 'identified',
    history: [],
    attacking_claim_ids: [],
    speakers_involved: ['accelerationist', 'safetyist'],
    last_computed_strength: 0.5,
    support_polarity: 0.0,
    ...overrides,
  };
}

describe('computeConvergenceSignals — crux rate', () => {
  it('detects crux engagement when turn node matches attacking_claim_ids', () => {
    const entry = makeEntry({ id: 'cr1' });
    const node = makeNode({ id: 'AN-10', source_entry_id: 'cr1', turn_number: 1 });
    const tracker = [makeCrux({ id: 'crux-1', attacking_claim_ids: ['AN-10'] })];
    const result = computeConvergenceSignals(
      'cr1', 'accelerationist', [entry], [node], [], [], undefined, undefined, undefined, undefined, tracker,
    );
    expect(result.crux_engagement_rate.used_this_turn).toBe(true);
    expect(result.crux_engagement_rate.cumulative_count).toBe(1);
  });

  it('detects crux engagement via state transition at current turn', () => {
    const entry = makeEntry({ id: 'cr2' });
    const node = makeNode({ id: 'AN-20', source_entry_id: 'cr2', turn_number: 3 });
    const tracker = [makeCrux({
      id: 'crux-2',
      state: 'engaged',
      history: [{ from: 'identified', to: 'engaged', turn: 3, trigger: 'claim_overlap' }],
    })];
    const result = computeConvergenceSignals(
      'cr2', 'accelerationist', [entry], [node], [], [], undefined, undefined, undefined, undefined, tracker,
    );
    expect(result.crux_engagement_rate.used_this_turn).toBe(true);
  });

  it('returns false when no crux tracker provided', () => {
    const entry = makeEntry({ id: 'cr3' });
    const result = computeConvergenceSignals(
      'cr3', 'accelerationist', [entry], [], [], [],
    );
    expect(result.crux_engagement_rate.used_this_turn).toBe(false);
    expect(result.crux_engagement_rate.cumulative_count).toBe(0);
  });

  it('returns false when crux tracker is empty', () => {
    const entry = makeEntry({ id: 'cr3b' });
    const result = computeConvergenceSignals(
      'cr3b', 'accelerationist', [entry], [], [], [], undefined, undefined, undefined, undefined, [],
    );
    expect(result.crux_engagement_rate.used_this_turn).toBe(false);
  });

  it('returns false when turn nodes do not match any crux', () => {
    const entry = makeEntry({ id: 'cr4' });
    const node = makeNode({ id: 'AN-30', source_entry_id: 'cr4', turn_number: 2 });
    const tracker = [makeCrux({ id: 'crux-3', attacking_claim_ids: ['AN-99'] })];
    const result = computeConvergenceSignals(
      'cr4', 'accelerationist', [entry], [node], [], [], undefined, undefined, undefined, undefined, tracker,
    );
    expect(result.crux_engagement_rate.used_this_turn).toBe(false);
  });

  it('accumulates crux count from prior signals', () => {
    const entry = makeEntry({ id: 'cr5' });
    const node = makeNode({ id: 'AN-40', source_entry_id: 'cr5', turn_number: 2 });
    const tracker = [makeCrux({ id: 'crux-4', attacking_claim_ids: ['AN-40'] })];
    const priorSignals: ConvergenceSignals[] = [
      makeSignals({
        speaker: 'accelerationist',
        crux_engagement_rate: { used_this_turn: true, cumulative_count: 2, cumulative_follow_through: 1 },
      }),
    ];
    const result = computeConvergenceSignals(
      'cr5', 'accelerationist', [entry], [node], [], priorSignals, undefined, undefined, undefined, undefined, tracker,
    );
    expect(result.crux_engagement_rate.cumulative_count).toBe(2);
  });

  it('tracks follow-through when crux engaged with collaborative move', () => {
    const entry = makeEntry({ id: 'cr6', metadata: { move_types: ['INTEGRATE'] } });
    const node = makeNode({ id: 'AN-50', source_entry_id: 'cr6', turn_number: 1 });
    const tracker = [makeCrux({ id: 'crux-5', attacking_claim_ids: ['AN-50'] })];
    const result = computeConvergenceSignals(
      'cr6', 'accelerationist', [entry], [node], [], [], undefined, undefined, undefined, undefined, tracker,
    );
    expect(result.crux_engagement_rate.used_this_turn).toBe(true);
    expect(result.crux_engagement_rate.cumulative_follow_through).toBe(1);
  });

  it('does not count follow-through when crux engaged without collaborative move', () => {
    const entry = makeEntry({ id: 'cr7', metadata: { move_types: ['COUNTEREXAMPLE'] } });
    const node = makeNode({ id: 'AN-60', source_entry_id: 'cr7', turn_number: 1 });
    const tracker = [makeCrux({ id: 'crux-6', attacking_claim_ids: ['AN-60'] })];
    const result = computeConvergenceSignals(
      'cr7', 'accelerationist', [entry], [node], [], [], undefined, undefined, undefined, undefined, tracker,
    );
    expect(result.crux_engagement_rate.used_this_turn).toBe(true);
    expect(result.crux_engagement_rate.cumulative_follow_through).toBe(0);
  });

  it('does not count follow-through when no crux engaged even with collaborative move', () => {
    const entry = makeEntry({ id: 'cr8', metadata: { move_types: ['INTEGRATE'] } });
    const node = makeNode({ id: 'AN-70', source_entry_id: 'cr8', turn_number: 1 });
    const tracker = [makeCrux({ id: 'crux-7', attacking_claim_ids: ['AN-99'] })];
    const result = computeConvergenceSignals(
      'cr8', 'accelerationist', [entry], [node], [], [], undefined, undefined, undefined, undefined, tracker,
    );
    expect(result.crux_engagement_rate.used_this_turn).toBe(false);
    expect(result.crux_engagement_rate.cumulative_follow_through).toBe(0);
  });

  it('accumulates follow-through from prior signals', () => {
    const entry = makeEntry({ id: 'cr9', metadata: { move_types: ['EXTEND'] } });
    const node = makeNode({ id: 'AN-80', source_entry_id: 'cr9', turn_number: 2 });
    const tracker = [makeCrux({ id: 'crux-8', attacking_claim_ids: ['AN-80'] })];
    const priorSignals: ConvergenceSignals[] = [
      makeSignals({
        speaker: 'accelerationist',
        crux_engagement_rate: { used_this_turn: true, cumulative_count: 1, cumulative_follow_through: 1 },
      }),
    ];
    const result = computeConvergenceSignals(
      'cr9', 'accelerationist', [entry], [node], [], priorSignals, undefined, undefined, undefined, undefined, tracker,
    );
    expect(result.crux_engagement_rate.cumulative_follow_through).toBe(2);
  });

  it('detects crux engagement via edges when attacking_claim_ids is stale (t/497)', () => {
    // Scenario: crux identified at turn 1 with attacking_claim_ids=['AN-100'].
    // At turn 3, a new node AN-200 attacks the crux via an edge, but AN-200 is
    // NOT in attacking_claim_ids (the tracker is stale). The edge-based check
    // should still detect engagement.
    const entry = makeEntry({ id: 'cr-edge' });
    const turnNode = makeNode({ id: 'AN-200', source_entry_id: 'cr-edge', turn_number: 3, speaker: 'safetyist' });
    const cruxNode = makeNode({ id: 'crux-stale', speaker: 'accelerationist', source_entry_id: 'old-entry' });
    const attackEdge = makeEdge('AN-200', 'crux-stale', 'attacks');
    const tracker = [makeCrux({
      id: 'crux-stale',
      attacking_claim_ids: ['AN-100'], // stale — does NOT include AN-200
      speakers_involved: ['accelerationist'],
    })];

    const result = computeConvergenceSignals(
      'cr-edge', 'safetyist', [entry],
      [turnNode, cruxNode],
      [attackEdge],
      [],
      undefined, undefined, undefined, undefined, tracker,
    );
    expect(result.crux_engagement_rate.used_this_turn).toBe(true);
    expect(result.crux_engagement_rate.cumulative_count).toBe(1);
  });

  it('detects crux engagement via support edges to crux nodes (t/497)', () => {
    const entry = makeEntry({ id: 'cr-sup-edge' });
    const turnNode = makeNode({ id: 'AN-300', source_entry_id: 'cr-sup-edge', turn_number: 4, speaker: 'skeptic' });
    const cruxNode = makeNode({ id: 'crux-sup', speaker: 'accelerationist' });
    const supportEdge = makeEdge('AN-300', 'crux-sup', 'supports');
    const tracker = [makeCrux({ id: 'crux-sup', attacking_claim_ids: [] })];

    const result = computeConvergenceSignals(
      'cr-sup-edge', 'skeptic', [entry],
      [turnNode, cruxNode],
      [supportEdge],
      [],
      undefined, undefined, undefined, undefined, tracker,
    );
    expect(result.crux_engagement_rate.used_this_turn).toBe(true);
  });

  it('multi-turn crux integration: engagement detected across turns with stale tracker (t/497)', () => {
    // Turn 1: acc opening
    const opening = makeEntry({ id: 'mt-open', speaker: 'accelerationist', type: 'opening', content: 'innovation drives progress' });
    // Turn 2: saf response, crux identified
    const safTurn = makeEntry({ id: 'mt-saf1', speaker: 'safetyist', content: 'alignment is critical' });
    // Turn 3: acc engages crux with new claim via edge (not in attacking_claim_ids)
    const accTurn = makeEntry({ id: 'mt-acc2', speaker: 'accelerationist', content: 'alignment can coexist with speed', metadata: { move_types: ['INTEGRATE'] } });

    const cruxNode = makeNode({ id: 'crux-mt', speaker: 'safetyist', source_entry_id: 'mt-saf1', turn_number: 2 });
    const safNode = makeNode({ id: 'AN-saf1', speaker: 'safetyist', source_entry_id: 'mt-saf1', turn_number: 2 });
    const accNode = makeNode({ id: 'AN-acc2', speaker: 'accelerationist', source_entry_id: 'mt-acc2', turn_number: 3 });

    const edgeToCrux = makeEdge('AN-acc2', 'crux-mt', 'attacks');
    const edgeToSaf = makeEdge('AN-acc2', 'AN-saf1', 'attacks');

    const tracker = [makeCrux({
      id: 'crux-mt',
      identified_turn: 2,
      attacking_claim_ids: ['AN-saf1'], // frozen at turn 2 — does NOT include AN-acc2
      speakers_involved: ['safetyist'],
    })];

    // Turn 2 signal (saf — crux engaged via attacking_claim_ids match)
    const sig1 = computeConvergenceSignals(
      'mt-saf1', 'safetyist', [opening, safTurn],
      [cruxNode, safNode],
      [],
      [],
      undefined, undefined, undefined, undefined, tracker,
    );
    expect(sig1.crux_engagement_rate.used_this_turn).toBe(true);

    // Turn 3 signal (acc — crux engaged via NEW edge, not via attacking_claim_ids)
    const sig2 = computeConvergenceSignals(
      'mt-acc2', 'accelerationist', [opening, safTurn, accTurn],
      [cruxNode, safNode, accNode],
      [edgeToCrux, edgeToSaf],
      [sig1],
      undefined, undefined, undefined, undefined, tracker,
    );
    expect(sig2.crux_engagement_rate.used_this_turn).toBe(true);
    expect(sig2.crux_engagement_rate.cumulative_count).toBe(1); // first acc engagement
    // INTEGRATE is collaborative, so follow-through should count
    expect(sig2.crux_engagement_rate.cumulative_follow_through).toBe(1);
  });
});

// ── Speaker filtering ──────────────────────────────────────

describe('computeConvergenceSignals — speaker isolation', () => {
  it('only uses prior signals from the same speaker for drift', () => {
    const opening = makeEntry({
      id: 'iso-open',
      speaker: 'accelerationist',
      type: 'opening',
      content: 'innovation progress acceleration technology growth',
    });
    const current = makeEntry({
      id: 'iso-curr',
      speaker: 'accelerationist',
      content: 'innovation progress acceleration technology growth',
    });
    const otherSpeakerSignal = makeSignals({
      speaker: 'safetyist',
      position_drift: { overlap_with_opening: 0.1, drift: 0.9 },
    });
    const result = computeConvergenceSignals(
      'iso-curr', 'accelerationist', [opening, current], [], [], [otherSpeakerSignal],
    );
    // No prior accelerationist signals, so drift should be 0
    expect(result.position_drift.drift).toBe(0);
  });

  it('only counts prior crux signals from the same speaker', () => {
    const entry = makeEntry({ id: 'iso-crux' });
    const node = makeNode({ id: 'AN-iso', source_entry_id: 'iso-crux', turn_number: 1 });
    const tracker = [makeCrux({ id: 'crux-iso', attacking_claim_ids: ['AN-iso'] })];
    const otherSpeakerSignal = makeSignals({
      speaker: 'safetyist',
      crux_engagement_rate: { used_this_turn: true, cumulative_count: 5, cumulative_follow_through: 3 },
    });
    const result = computeConvergenceSignals(
      'iso-crux', 'accelerationist', [entry], [node], [], [otherSpeakerSignal],
      undefined, undefined, undefined, undefined, tracker,
    );
    // Should not inherit safetyist's crux counts
    expect(result.crux_engagement_rate.cumulative_count).toBe(1);
  });
});

// ── Full integration scenario ──────────────────────────────

describe('computeConvergenceSignals — integration', () => {
  it('computes all fields correctly for a realistic multi-turn scenario', () => {
    const opening = makeEntry({
      id: 'int-open',
      speaker: 'accelerationist',
      type: 'opening',
      content: 'We should accelerate innovation with minimal regulation because technology progress benefits humanity.',
    });
    const safetyistTurn = makeEntry({
      id: 'int-sent',
      speaker: 'safetyist',
      type: 'cross-respond',
      content: 'Regulation is essential for safety. Unchecked progress poses catastrophic alignment risks.',
    });
    const current = makeEntry({
      id: 'int-curr',
      speaker: 'accelerationist',
      type: 'cross-respond',
      content: 'While safety matters, innovation with minimal regulation drives progress. Technology benefits outweigh alignment risks.',
      metadata: {
        move_types: ['COUNTEREXAMPLE', 'CONCEDE-AND-PIVOT', 'IDENTIFY-CRUX'],
      },
    });

    const pNode = makeNode({ id: 'pn1', speaker: 'accelerationist', source_entry_id: 'int-curr', base_strength: 0.6 });
    const sNode = makeNode({ id: 'sn1', speaker: 'safetyist', source_entry_id: 'int-sent', base_strength: 0.7 });
    const edge = makeEdge('pn1', 'sn1', 'attacks');
    const atkEdge = makeEdge('sn1', 'pn1', 'attacks', { weight: 0.6 });

    const strengths = new Map<string, number>();
    strengths.set('pn1', 0.55);
    strengths.set('sn1', 0.75);

    const intTracker = [makeCrux({ id: 'crux-int', attacking_claim_ids: ['pn1'] })];
    const result = computeConvergenceSignals(
      'int-curr', 'accelerationist',
      [opening, safetyistTurn, current],
      [pNode, sNode],
      [edge, atkEdge],
      [],
      undefined,
      strengths,
      undefined,
      undefined,
      intTracker,
    );

    // Basic fields
    expect(result.entry_id).toBe('int-curr');
    expect(result.round).toBe(3);
    expect(result.speaker).toBe('accelerationist');

    // Move disposition: COUNTEREXAMPLE (attack) + CONCEDE-AND-PIVOT (support) + IDENTIFY-CRUX (neutral)
    expect(result.move_polarity.confrontational).toBe(1);
    expect(result.move_polarity.collaborative).toBe(1);
    expect(result.move_polarity.ratio).toBe(0.5);

    // Engagement depth: pn1 has cross-turn edge to sn1
    expect(result.dialectical_engagement.targeted).toBe(1);
    expect(result.dialectical_engagement.standalone).toBe(0);
    expect(result.dialectical_engagement.ratio).toBe(1);

    // Recycling rate: overlap between current and opening (same speaker)
    expect(result.argument_redundancy.avg_self_overlap).toBeGreaterThan(0);

    // Strongest opposing: sn1 attacks pn1 with strength 0.75
    expect(result.dominant_counterargument).not.toBeNull();
    expect(result.dominant_counterargument!.node_id).toBe('sn1');
    expect(result.dominant_counterargument!.strength).toBe(0.75);
    expect(result.dominant_counterargument!.attacker).toBe('safetyist');

    // Concession: sn1 has strength 0.75 >= 0.6, and CONCEDE-AND-PIVOT is a support move
    expect(result.concession_opportunity.strong_attacks_faced).toBe(1);
    expect(result.concession_opportunity.concession_used).toBe(true);
    expect(result.concession_opportunity.outcome).toBe('taken');

    // Position delta: some overlap with opening
    expect(result.position_drift.overlap_with_opening).toBeGreaterThan(0);
    expect(result.position_drift.drift).toBe(0); // no prior signals

    // Crux rate: IDENTIFY-CRUX used + CONCEDE-AND-PIVOT is collaborative
    expect(result.crux_engagement_rate.used_this_turn).toBe(true);
    expect(result.crux_engagement_rate.cumulative_count).toBe(1);
    expect(result.crux_engagement_rate.cumulative_follow_through).toBe(1);
  });

  it('produces correct signals across sequential calls', () => {
    const opening = makeEntry({
      id: 'seq-open',
      speaker: 'accelerationist',
      type: 'opening',
      content: 'innovation progress acceleration technology growth future',
    });
    const turn2 = makeEntry({
      id: 'seq-t2',
      speaker: 'accelerationist',
      content: 'innovation progress acceleration technology growth future',
      metadata: { move_types: ['CONCEDE-AND-PIVOT'] },
    });
    const turn3 = makeEntry({
      id: 'seq-t3',
      speaker: 'accelerationist',
      content: 'completely different vocabulary about regulation safety alignment',
      metadata: { move_types: ['COUNTEREXAMPLE'] },
    });

    const seqNode2 = makeNode({ id: 'AN-seq2', source_entry_id: 'seq-t2', turn_number: 2 });
    const seqNode3 = makeNode({ id: 'AN-seq3', source_entry_id: 'seq-t3', turn_number: 3 });
    const seqTracker = [makeCrux({ id: 'crux-seq', attacking_claim_ids: ['AN-seq2', 'AN-seq3'] })];

    // First call
    const sig1 = computeConvergenceSignals(
      'seq-t2', 'accelerationist', [opening, turn2], [seqNode2], [], [],
      undefined, undefined, undefined, undefined, seqTracker,
    );
    expect(sig1.crux_engagement_rate.cumulative_count).toBe(1);
    expect(sig1.crux_engagement_rate.cumulative_follow_through).toBe(1); // crux + CONCEDE-AND-PIVOT (support)

    // Second call uses first signal
    const sig2 = computeConvergenceSignals(
      'seq-t3', 'accelerationist', [opening, turn2, turn3], [seqNode2, seqNode3], [], [sig1],
      undefined, undefined, undefined, undefined, seqTracker,
    );
    expect(sig2.crux_engagement_rate.cumulative_count).toBe(2);
    expect(sig2.crux_engagement_rate.cumulative_follow_through).toBe(1); // crux + COUNTEREXAMPLE (attack, not support)
    // Position should drift more since vocabulary changed
    expect(sig2.position_drift.overlap_with_opening).toBeLessThan(sig1.position_drift.overlap_with_opening);
  });
});

// ── Edge cases ─────────────────────────────────────────────

describe('computeConvergenceSignals — edge cases', () => {
  it('handles metadata with empty move_types array', () => {
    const entry = makeEntry({ id: 'ec1', metadata: { move_types: [] } });
    const result = computeConvergenceSignals(
      'ec1', 'accelerationist', [entry], [], [], [],
    );
    expect(result.move_polarity.ratio).toBe(0);
    expect(result.crux_engagement_rate.used_this_turn).toBe(false);
  });

  it('handles metadata without move_types key', () => {
    const entry = makeEntry({ id: 'ec2', metadata: { other_key: 'value' } });
    const result = computeConvergenceSignals(
      'ec2', 'accelerationist', [entry], [], [], [],
    );
    expect(result.move_polarity.ratio).toBe(0);
  });

  it('handles entry with undefined metadata', () => {
    const entry = makeEntry({ id: 'ec3' });
    delete (entry as Record<string, unknown>).metadata;
    const result = computeConvergenceSignals(
      'ec3', 'accelerationist', [entry], [], [], [],
    );
    expect(result.move_polarity.ratio).toBe(0);
  });

  it('handles user speaker type for recycling', () => {
    const prior = makeEntry({ id: 'ec4-prior', speaker: 'user', content: 'user question about safety alignment' });
    const current = makeEntry({ id: 'ec4-curr', speaker: 'user', content: 'user question about safety alignment' });
    const result = computeConvergenceSignals(
      'ec4-curr', 'user', [prior, current], [], [], [],
    );
    expect(result.argument_redundancy.avg_self_overlap).toBe(1);
  });

  it('handles very short content for word overlap (words <= 3 chars filtered out)', () => {
    const prior = makeEntry({
      id: 'ec5-prior',
      speaker: 'accelerationist',
      content: 'a b c d e', // all words <= 3 chars
    });
    const current = makeEntry({
      id: 'ec5-curr',
      speaker: 'accelerationist',
      content: 'a b c d e',
    });
    const result = computeConvergenceSignals(
      'ec5-curr', 'accelerationist', [prior, current], [], [], [],
    );
    // wordOverlap filters words <= 3 chars, so overlap should be 0
    expect(result.argument_redundancy.avg_self_overlap).toBe(0);
  });

  it('correctly identifies opening of correct speaker type', () => {
    // Other speaker's opening should be ignored
    const safetyistOpening = makeEntry({
      id: 'ec6-sopen',
      speaker: 'safetyist',
      type: 'opening',
      content: 'regulation safety governance alignment',
    });
    const promOpening = makeEntry({
      id: 'ec6-popen',
      speaker: 'accelerationist',
      type: 'opening',
      content: 'innovation acceleration progress technology',
    });
    const current = makeEntry({
      id: 'ec6-curr',
      speaker: 'accelerationist',
      content: 'innovation acceleration progress technology',
    });
    const result = computeConvergenceSignals(
      'ec6-curr', 'accelerationist', [safetyistOpening, promOpening, current], [], [], [],
    );
    expect(result.position_drift.overlap_with_opening).toBe(1);
  });

  it('handles nodes with undefined base_strength (defaults to 0.5 in QBAF)', () => {
    const entry = makeEntry({ id: 'ec7' });
    const sp = makeNode({ id: 'ec7-sp', speaker: 'accelerationist', base_strength: undefined as unknown as number });
    const at = makeNode({ id: 'ec7-at', speaker: 'safetyist', base_strength: undefined as unknown as number });
    const edge = makeEdge('ec7-at', 'ec7-sp', 'attacks');

    // Should not throw; QBAF defaults base_strength to 0.5 via ?? operator
    const result = computeConvergenceSignals(
      'ec7', 'accelerationist', [entry], [sp, at], [edge], [],
    );
    expect(result.dominant_counterargument).not.toBeNull();
  });

  it('handles edges with undefined weight (defaults to 0.5)', () => {
    const entry = makeEntry({ id: 'ec8' });
    const sp = makeNode({ id: 'ec8-sp', speaker: 'accelerationist' });
    const at = makeNode({ id: 'ec8-at', speaker: 'safetyist' });
    const edge = makeEdge('ec8-at', 'ec8-sp', 'attacks', { weight: undefined });

    const result = computeConvergenceSignals(
      'ec8', 'accelerationist', [entry], [sp, at], [edge], [],
    );
    expect(result.dominant_counterargument).not.toBeNull();
  });
});

// ── ArCo (Argument Coherence) ──────────────────────────────

describe('ARCO_DRIFT_THRESHOLD', () => {
  it('is exported as 0.5', () => {
    expect(ARCO_DRIFT_THRESHOLD).toBe(0.5);
  });
});

describe('computeConvergenceSignals — arco', () => {
  it('is absent when no topicEmbedding provided', () => {
    const entry = makeEntry({ id: 'arco-1' });
    const embeddings = new Map([['arco-1', makeEmbedding(1)]]);
    const result = computeConvergenceSignals(
      'arco-1', 'accelerationist', [entry], [], [], [],
      embeddings, undefined, undefined,
    );
    expect(result.arco).toBeUndefined();
  });

  it('is absent when no turnEmbeddings provided', () => {
    const entry = makeEntry({ id: 'arco-2' });
    const topicEmbed = makeEmbedding(1);
    const result = computeConvergenceSignals(
      'arco-2', 'accelerationist', [entry], [], [], [],
      undefined, undefined, topicEmbed,
    );
    expect(result.arco).toBeUndefined();
  });

  it('is absent when current entry has no embedding', () => {
    const entry = makeEntry({ id: 'arco-3' });
    const embeddings = new Map([['other-entry', makeEmbedding(1)]]);
    const topicEmbed = makeEmbedding(1);
    const result = computeConvergenceSignals(
      'arco-3', 'accelerationist', [entry], [], [], [],
      embeddings, undefined, topicEmbed,
    );
    expect(result.arco).toBeUndefined();
  });

  it('computes high turn_similarity for similar embeddings', () => {
    const entry = makeEntry({ id: 'arco-4' });
    const topicEmbed = makeEmbedding(42);
    const turnEmbed = makeSimilarEmbedding(42);
    const embeddings = new Map([['arco-4', turnEmbed]]);
    const result = computeConvergenceSignals(
      'arco-4', 'accelerationist', [entry], [], [], [],
      embeddings, undefined, topicEmbed,
    );
    expect(result.arco).toBeDefined();
    expect(result.arco!.turn_similarity).toBeGreaterThan(0.99);
    expect(result.arco!.drift_warning).toBe(false);
  });

  it('computes low turn_similarity for dissimilar embeddings', () => {
    const entry = makeEntry({ id: 'arco-5' });
    const topicEmbed = makeEmbedding(42);
    const turnEmbed = makeDissimilarEmbedding(42);
    const embeddings = new Map([['arco-5', turnEmbed]]);
    const result = computeConvergenceSignals(
      'arco-5', 'accelerationist', [entry], [], [], [],
      embeddings, undefined, topicEmbed,
    );
    expect(result.arco).toBeDefined();
    expect(result.arco!.turn_similarity).toBeLessThan(0.5);
  });

  it('sets drift_warning when phase_mean < ARCO_DRIFT_THRESHOLD', () => {
    const entry = makeEntry({ id: 'arco-6' });
    const topicEmbed = makeEmbedding(42);
    const turnEmbed = makeDissimilarEmbedding(42);
    const embeddings = new Map([['arco-6', turnEmbed]]);
    const result = computeConvergenceSignals(
      'arco-6', 'accelerationist', [entry], [], [], [],
      embeddings, undefined, topicEmbed,
    );
    expect(result.arco).toBeDefined();
    expect(result.arco!.drift_warning).toBe(true);
  });

  it('phase_mean averages across same-phase signals', () => {
    const e1 = makeEntry({ id: 'arco-7a', metadata: { phase: 'argumentation' } });
    const e2 = makeEntry({ id: 'arco-7b', metadata: { phase: 'argumentation' } });
    const topicEmbed = makeEmbedding(10);
    // First turn: high similarity
    const embed1 = makeSimilarEmbedding(10);
    // Second turn: dissimilar
    const embed2 = makeDissimilarEmbedding(10);
    const embeddings = new Map([['arco-7a', embed1], ['arco-7b', embed2]]);

    // Compute first signal
    const sig1 = computeConvergenceSignals(
      'arco-7a', 'accelerationist', [e1, e2], [], [], [],
      embeddings, undefined, topicEmbed,
    );
    expect(sig1.arco).toBeDefined();
    const firstSim = sig1.arco!.turn_similarity;
    expect(firstSim).toBeGreaterThan(0.99);

    // Compute second signal with first as existing
    const sig2 = computeConvergenceSignals(
      'arco-7b', 'safetyist', [e1, e2], [], [], [sig1],
      embeddings, undefined, topicEmbed,
    );
    expect(sig2.arco).toBeDefined();
    const secondSim = sig2.arco!.turn_similarity;
    // Phase mean should be average of both
    expect(sig2.arco!.phase_mean).toBeCloseTo((firstSim + secondSim) / 2, 5);
  });

  it('phase_mean does not include signals from different phases', () => {
    const e1 = makeEntry({ id: 'arco-8a', metadata: { phase: 'confrontation' } });
    const e2 = makeEntry({ id: 'arco-8b', metadata: { phase: 'argumentation' } });
    const topicEmbed = makeEmbedding(20);
    const embed1 = makeDissimilarEmbedding(20); // low similarity
    const embed2 = makeSimilarEmbedding(20);     // high similarity
    const embeddings = new Map([['arco-8a', embed1], ['arco-8b', embed2]]);

    const sig1 = computeConvergenceSignals(
      'arco-8a', 'accelerationist', [e1, e2], [], [], [],
      embeddings, undefined, topicEmbed,
    );

    const sig2 = computeConvergenceSignals(
      'arco-8b', 'accelerationist', [e1, e2], [], [], [sig1],
      embeddings, undefined, topicEmbed,
    );
    // sig2 phase_mean should only reflect the current (argumentation) phase turn
    expect(sig2.arco).toBeDefined();
    expect(sig2.arco!.phase_mean).toBeCloseTo(sig2.arco!.turn_similarity, 5);
  });
});

// ── Uncertainty metric (anti-sycophancy) ───────────────────

function makeSignalInput(overrides: Partial<Parameters<typeof computeUncertaintyMetric>[2]> = {}) {
  return {
    argument_redundancy: { avg_self_overlap: 0, semantic_max_similarity: undefined as number | undefined },
    dialectical_engagement: { ratio: 0.5 },
    position_drift: { drift: 0 },
    concession_opportunity: { outcome: 'none', strong_attacks_faced: 0 },
    ...overrides,
  };
}

describe('computeUncertaintyMetric — basic', () => {
  it('returns all zero-ish metrics for empty inputs', () => {
    const result = computeUncertaintyMetric([], [], makeSignalInput(), 'argumentation');
    expect(result.intra_agent).toBe(0);
    // Inter-agent: supportRatio=0, lowEngagement=0.5, highRecycling=0 → (0+0.15+0)*1.2
    expect(result.inter_agent).toBeGreaterThan(0);
    // System-level: no nodes, meanStrength defaults to 0.5 → (1-0.5)*0.6 + 0*0.4 = 0.3
    expect(result.system_level).toBeCloseTo(0.3, 2);
    expect(result.collapse_warning).toBe(false);
  });

  it('composite is a weighted sum of three tiers', () => {
    const nodes = [
      { id: 'n1', speaker: 'accelerationist', computed_strength: 0.5 },
      { id: 'n2', speaker: 'safetyist', computed_strength: 0.5 },
    ];
    const result = computeUncertaintyMetric(nodes, [], makeSignalInput(), 'argumentation');
    const expected = 0.30 * result.intra_agent + 0.40 * result.inter_agent + 0.30 * result.system_level;
    expect(result.composite).toBeCloseTo(expected, 10);
  });
});

describe('computeUncertaintyMetric — intra-agent', () => {
  it('detects self-attacks (same speaker attacking own nodes)', () => {
    const nodes = [
      { id: 'n1', speaker: 'accelerationist', computed_strength: 0.5 },
      { id: 'n2', speaker: 'accelerationist', computed_strength: 0.5 },
    ];
    const edges = [{ source: 'n1', target: 'n2', type: 'attacks' as const }];
    const result = computeUncertaintyMetric(nodes, edges, makeSignalInput(), 'argumentation');
    // selfAttackRate = 1/1 = 1.0, intra = min(1, 1*3 + 0) = 1.0
    expect(result.intra_agent).toBe(1);
  });

  it('no self-attacks yields zero intra score (with no drift)', () => {
    const nodes = [
      { id: 'n1', speaker: 'accelerationist', computed_strength: 0.5 },
      { id: 'n2', speaker: 'safetyist', computed_strength: 0.5 },
    ];
    const edges = [{ source: 'n1', target: 'n2', type: 'attacks' as const }];
    const result = computeUncertaintyMetric(nodes, edges, makeSignalInput(), 'argumentation');
    expect(result.intra_agent).toBe(0);
  });

  it('position drift contributes to intra score', () => {
    const result = computeUncertaintyMetric(
      [], [],
      makeSignalInput({ position_drift: { drift: 1.0 } }),
      'argumentation',
    );
    // driftContribution = min(1, 1.0*2) = 1, intra = min(1, 0 + 1*0.3) = 0.3
    expect(result.intra_agent).toBeCloseTo(0.3, 2);
  });

  it('ignores system/document/user nodes for self-attack', () => {
    const nodes = [
      { id: 'n1', speaker: 'system', computed_strength: 0.5 },
      { id: 'n2', speaker: 'system', computed_strength: 0.5 },
    ];
    const edges = [{ source: 'n1', target: 'n2', type: 'attacks' as const }];
    const result = computeUncertaintyMetric(nodes, edges, makeSignalInput(), 'argumentation');
    // system nodes are excluded, so no self-attacks counted
    expect(result.intra_agent).toBe(0);
  });
});

describe('computeUncertaintyMetric — inter-agent', () => {
  it('high support ratio + low engagement raises inter score', () => {
    const nodes = [
      { id: 'n1', speaker: 'accelerationist', computed_strength: 0.5 },
      { id: 'n2', speaker: 'safetyist', computed_strength: 0.5 },
    ];
    const edges = [
      { source: 'n1', target: 'n2', type: 'supports' as const },
      { source: 'n2', target: 'n1', type: 'supports' as const },
    ];
    const signals = makeSignalInput({
      dialectical_engagement: { ratio: 0.0 }, // low engagement
      argument_redundancy: { avg_self_overlap: 0.8 }, // high recycling
    });
    const result = computeUncertaintyMetric(nodes, edges, signals, 'argumentation');
    // supportRatio = 1.0, lowEngagement = 1.0, highRecycling = 0.8
    // (1.0*0.4 + 1.0*0.3 + 0.8*0.3) * 1.2 = (0.4+0.3+0.24)*1.2 = 0.94*1.2 = 1.128 → clamped to 1
    expect(result.inter_agent).toBe(1);
  });

  it('confrontation phase uses higher multiplier than argumentation', () => {
    const nodes = [
      { id: 'n1', speaker: 'accelerationist', computed_strength: 0.5 },
      { id: 'n2', speaker: 'safetyist', computed_strength: 0.5 },
    ];
    const edges = [{ source: 'n1', target: 'n2', type: 'supports' as const }];
    const signals = makeSignalInput({ dialectical_engagement: { ratio: 0.5 } });

    const confResult = computeUncertaintyMetric(nodes, edges, signals, 'confrontation');
    const argResult = computeUncertaintyMetric(nodes, edges, signals, 'argumentation');
    // confrontation multiplier 1.5 > argumentation 1.2
    expect(confResult.inter_agent).toBeGreaterThan(argResult.inter_agent);
  });

  it('concluding phase uses lower multiplier', () => {
    const edges = [{ source: 'n1', target: 'n2', type: 'supports' as const }];
    const signals = makeSignalInput({ dialectical_engagement: { ratio: 0.5 } });
    const nodes = [
      { id: 'n1', speaker: 'accelerationist', computed_strength: 0.5 },
      { id: 'n2', speaker: 'safetyist', computed_strength: 0.5 },
    ];
    const concResult = computeUncertaintyMetric(nodes, edges, signals, 'concluding');
    const argResult = computeUncertaintyMetric(nodes, edges, signals, 'argumentation');
    expect(concResult.inter_agent).toBeLessThan(argResult.inter_agent);
  });

  it('prefers semantic_max_similarity over avg_self_overlap when present', () => {
    const signals1 = makeSignalInput({
      argument_redundancy: { avg_self_overlap: 0.1, semantic_max_similarity: 0.9 },
      dialectical_engagement: { ratio: 0.5 },
    });
    const signals2 = makeSignalInput({
      argument_redundancy: { avg_self_overlap: 0.1 },
      dialectical_engagement: { ratio: 0.5 },
    });
    const r1 = computeUncertaintyMetric([], [], signals1, 'argumentation');
    const r2 = computeUncertaintyMetric([], [], signals2, 'argumentation');
    // r1 uses 0.9 for recycling, r2 uses 0.1
    expect(r1.inter_agent).toBeGreaterThan(r2.inter_agent);
  });
});

describe('computeUncertaintyMetric — system-level', () => {
  it('low computed_strength yields high system uncertainty', () => {
    const nodes = [
      { id: 'n1', speaker: 'accelerationist', computed_strength: 0.1 },
      { id: 'n2', speaker: 'safetyist', computed_strength: 0.2 },
    ];
    const result = computeUncertaintyMetric(nodes, [], makeSignalInput(), 'argumentation');
    // meanStrength = 0.15, weakFraction = 2/2 = 1.0 (both < 0.3)
    // system = min(1, (1-0.15)*0.6 + 1.0*0.4) = min(1, 0.51 + 0.4) = 0.91
    expect(result.system_level).toBeCloseTo(0.91, 1);
  });

  it('high computed_strength yields low system uncertainty', () => {
    const nodes = [
      { id: 'n1', speaker: 'accelerationist', computed_strength: 0.9 },
      { id: 'n2', speaker: 'safetyist', computed_strength: 0.8 },
    ];
    const result = computeUncertaintyMetric(nodes, [], makeSignalInput(), 'argumentation');
    // meanStrength = 0.85, weakFraction = 0
    // system = (1-0.85)*0.6 + 0 = 0.09
    expect(result.system_level).toBeCloseTo(0.09, 2);
  });

  it('falls back to base_strength when computed_strength absent', () => {
    const nodes = [
      { id: 'n1', speaker: 'accelerationist', base_strength: 0.9 },
      { id: 'n2', speaker: 'safetyist', base_strength: 0.8 },
    ];
    const result = computeUncertaintyMetric(nodes, [], makeSignalInput(), 'argumentation');
    expect(result.system_level).toBeCloseTo(0.09, 2);
  });

  it('defaults to 0.5 when both strengths are missing', () => {
    const nodes = [
      { id: 'n1', speaker: 'accelerationist' },
      { id: 'n2', speaker: 'safetyist' },
    ];
    const result = computeUncertaintyMetric(nodes, [], makeSignalInput(), 'argumentation');
    // meanStrength = 0.5, weakFraction = 0
    // system = (1-0.5)*0.6 + 0 = 0.3
    expect(result.system_level).toBeCloseTo(0.3, 2);
  });

  it('excludes system/document/user nodes from QBAF analysis', () => {
    const nodes = [
      { id: 'n1', speaker: 'system', computed_strength: 0.1 },
      { id: 'n2', speaker: 'accelerationist', computed_strength: 0.9 },
    ];
    const result = computeUncertaintyMetric(nodes, [], makeSignalInput(), 'argumentation');
    // Only n2 (0.9) is counted
    // meanStrength = 0.9, system = (1-0.9)*0.6 + 0*0.4 = 0.06
    expect(result.system_level).toBeCloseTo(0.06, 2);
  });
});

describe('computeUncertaintyMetric — collapse_warning', () => {
  it('triggers when composite > 0.55 AND support ratio > 0.6', () => {
    // Engineer a scenario: all supports, low engagement, weak arguments
    const nodes = [
      { id: 'n1', speaker: 'accelerationist', computed_strength: 0.15 },
      { id: 'n2', speaker: 'safetyist', computed_strength: 0.15 },
    ];
    const edges = [
      { source: 'n1', target: 'n2', type: 'supports' as const },
      { source: 'n2', target: 'n1', type: 'supports' as const },
    ];
    const signals = makeSignalInput({
      dialectical_engagement: { ratio: 0.0 },
      argument_redundancy: { avg_self_overlap: 0.9 },
    });
    const result = computeUncertaintyMetric(nodes, edges, signals, 'argumentation');
    expect(result.composite).toBeGreaterThan(0.55);
    expect(result.collapse_warning).toBe(true);
  });

  it('does NOT trigger with low composite even if support ratio is high', () => {
    const nodes = [
      { id: 'n1', speaker: 'accelerationist', computed_strength: 0.9 },
      { id: 'n2', speaker: 'safetyist', computed_strength: 0.9 },
    ];
    const edges = [
      { source: 'n1', target: 'n2', type: 'supports' as const },
    ];
    const signals = makeSignalInput({
      dialectical_engagement: { ratio: 1.0 }, // high engagement
      argument_redundancy: { avg_self_overlap: 0.0 }, // no recycling
    });
    const result = computeUncertaintyMetric(nodes, edges, signals, 'concluding');
    // Strong arguments + high engagement + concluding phase (0.6x) → low composite
    expect(result.collapse_warning).toBe(false);
  });

  it('does NOT trigger when support ratio ≤ 0.6 even if composite is high', () => {
    const nodes = [
      { id: 'n1', speaker: 'accelerationist', computed_strength: 0.1 },
      { id: 'n2', speaker: 'safetyist', computed_strength: 0.1 },
      { id: 'n3', speaker: 'accelerationist', computed_strength: 0.1 },
    ];
    // More attacks than supports
    const edges = [
      { source: 'n1', target: 'n2', type: 'attacks' as const },
      { source: 'n2', target: 'n3', type: 'attacks' as const },
      { source: 'n3', target: 'n1', type: 'supports' as const },
    ];
    const signals = makeSignalInput({
      dialectical_engagement: { ratio: 0.0 },
      argument_redundancy: { avg_self_overlap: 0.8 },
      position_drift: { drift: 0.5 },
    });
    const result = computeUncertaintyMetric(nodes, edges, signals, 'argumentation');
    // Support ratio = 1/3 ≈ 0.33, below 0.6
    expect(result.collapse_warning).toBe(false);
  });
});

// ── boostConvergenceOnConcession ──────────────────────────

describe('boostConvergenceOnConcession', () => {
  function makeIssue(id: string, claimIds: string[], convergence: number, history?: { turn: number; value: number }[]): ConvergenceIssue {
    return {
      id,
      label: `Issue ${id}`,
      taxonomy_ref: null,
      convergence,
      claim_ids: claimIds,
      history: history ?? [],
    };
  }

  function makeTracker(issues: ConvergenceIssue[]): ConvergenceTracker {
    return { issues, available_issues: [], last_updated_turn: 0 };
  }

  function makeSig(outcome: 'taken' | 'missed' | 'none'): ConvergenceSignals {
    return {
      entry_id: 'e1', round: 5, speaker: 'skeptic' as SpeakerId,
      move_polarity: { confrontational: 0, collaborative: 1, ratio: 1 },
      dialectical_engagement: { targeted: 1, standalone: 0, ratio: 1 },
      argument_redundancy: { avg_self_overlap: 0, max_self_overlap: 0 },
      dominant_counterargument: null,
      concession_opportunity: { strong_attacks_faced: 1, concession_used: outcome === 'taken', outcome },
      position_drift: { overlap_with_opening: 0.5, drift: 0.1 },
      crux_engagement_rate: { used_this_turn: false, cumulative_count: 0, cumulative_follow_through: 0 },
    };
  }

  const turnNodes: ArgumentNetworkNode[] = [
    { id: 'c1', text: 'claim 1', speaker: 'skeptic', source_entry_id: 'e1', turn_number: 5, base_strength: 0.5 },
    { id: 'c2', text: 'claim 2', speaker: 'skeptic', source_entry_id: 'e1', turn_number: 5, base_strength: 0.5 },
  ] as ArgumentNetworkNode[];

  const priorNodes: ArgumentNetworkNode[] = [
    { id: 'p1', text: 'prior claim', speaker: 'accelerationist', source_entry_id: 'e0', turn_number: 4, base_strength: 0.6 },
  ] as ArgumentNetworkNode[];

  const edges: ArgumentNetworkEdge[] = [
    { source: 'c1', target: 'p1', type: 'supports', weight: 0.5 },
  ] as ArgumentNetworkEdge[];

  it('boosts engaged issues when concession is taken', () => {
    const issue = makeIssue('iss-1', ['p1', 'old-claim'], 0.0, [{ turn: 5, value: 0.0 }]);
    const tracker = makeTracker([issue]);

    const boosted = boostConvergenceOnConcession(
      tracker, makeSig('taken'), 'e1', 'skeptic' as SpeakerId,
      [...turnNodes, ...priorNodes], edges, 5,
    );

    expect(boosted).toEqual(['iss-1']);
    expect(issue.convergence).toBeCloseTo(CONCESSION_CONVERGENCE_BOOST);
    expect(issue.history[issue.history.length - 1].value).toBeCloseTo(CONCESSION_CONVERGENCE_BOOST);
  });

  it('does not boost when concession outcome is not taken', () => {
    const issue = makeIssue('iss-1', ['p1'], 0.0);
    const tracker = makeTracker([issue]);

    const missed = boostConvergenceOnConcession(
      tracker, makeSig('missed'), 'e1', 'skeptic' as SpeakerId,
      [...turnNodes, ...priorNodes], edges, 5,
    );
    expect(missed).toEqual([]);
    expect(issue.convergence).toBe(0.0);

    const none = boostConvergenceOnConcession(
      tracker, makeSig('none'), 'e1', 'skeptic' as SpeakerId,
      [...turnNodes, ...priorNodes], edges, 5,
    );
    expect(none).toEqual([]);
  });

  it('does not boost issues with no overlapping claims', () => {
    const issue = makeIssue('iss-1', ['unrelated-1', 'unrelated-2'], 0.0);
    const tracker = makeTracker([issue]);

    const boosted = boostConvergenceOnConcession(
      tracker, makeSig('taken'), 'e1', 'skeptic' as SpeakerId,
      [...turnNodes, ...priorNodes], edges, 5,
    );

    expect(boosted).toEqual([]);
    expect(issue.convergence).toBe(0.0);
  });

  it('updates existing history entry when turn matches', () => {
    const issue = makeIssue('iss-1', ['p1'], 0.2, [{ turn: 5, value: 0.2 }]);
    const tracker = makeTracker([issue]);

    boostConvergenceOnConcession(
      tracker, makeSig('taken'), 'e1', 'skeptic' as SpeakerId,
      [...turnNodes, ...priorNodes], edges, 5,
    );

    expect(issue.history).toHaveLength(1);
    expect(issue.history[0].value).toBeCloseTo(0.2 + CONCESSION_CONVERGENCE_BOOST);
  });

  it('appends new history entry when turn differs', () => {
    const issue = makeIssue('iss-1', ['p1'], 0.2, [{ turn: 4, value: 0.2 }]);
    const tracker = makeTracker([issue]);

    boostConvergenceOnConcession(
      tracker, makeSig('taken'), 'e1', 'skeptic' as SpeakerId,
      [...turnNodes, ...priorNodes], edges, 5,
    );

    expect(issue.history).toHaveLength(2);
    expect(issue.history[1]).toEqual({ turn: 5, value: 0.2 + CONCESSION_CONVERGENCE_BOOST });
  });

  it('caps convergence at 1.0', () => {
    const issue = makeIssue('iss-1', ['p1'], 0.95, [{ turn: 5, value: 0.95 }]);
    const tracker = makeTracker([issue]);

    boostConvergenceOnConcession(
      tracker, makeSig('taken'), 'e1', 'skeptic' as SpeakerId,
      [...turnNodes, ...priorNodes], edges, 5,
    );

    expect(issue.convergence).toBe(1.0);
  });

  it('engages via speaker node ownership (not just edges)', () => {
    const issue = makeIssue('iss-1', ['c1'], 0.0);
    const tracker = makeTracker([issue]);

    const boosted = boostConvergenceOnConcession(
      tracker, makeSig('taken'), 'e1', 'skeptic' as SpeakerId,
      turnNodes, [], 5,
    );

    expect(boosted).toEqual(['iss-1']);
    expect(issue.convergence).toBeCloseTo(CONCESSION_CONVERGENCE_BOOST);
  });

  it('boosts multiple issues when multiple are engaged', () => {
    const issue1 = makeIssue('iss-1', ['p1'], 0.0);
    const issue2 = makeIssue('iss-2', ['c2'], 0.1);
    const tracker = makeTracker([issue1, issue2]);

    const boosted = boostConvergenceOnConcession(
      tracker, makeSig('taken'), 'e1', 'skeptic' as SpeakerId,
      [...turnNodes, ...priorNodes], edges, 5,
    );

    expect(boosted).toEqual(['iss-1', 'iss-2']);
    expect(issue1.convergence).toBeCloseTo(CONCESSION_CONVERGENCE_BOOST);
    expect(issue2.convergence).toBeCloseTo(0.1 + CONCESSION_CONVERGENCE_BOOST);
  });
});

// ── boostConvergenceFromTaxonomyEdges ─────────────────────

describe('boostConvergenceFromTaxonomyEdges', () => {
  function makeANNode(id: string, taxonomyRefs: string[]): ArgumentNetworkNode {
    return {
      id,
      text: `node ${id}`,
      speaker: 'accelerationist',
      base_strength: 0.5,
      computed_strength: 0.5,
      taxonomy_refs: taxonomyRefs,
    };
  }

  function makeCvIssue(id: string, claimIds: string[], convergence = 0): ConvergenceIssue {
    return { id, label: id, claim_ids: claimIds, convergence, history: [] };
  }

  function makeCvTracker(issues: ConvergenceIssue[]): ConvergenceTracker {
    return { issues };
  }

  it('boosts issue when CONVERGES_WITH links AN nodes on both sides', () => {
    const anNodes = [
      makeANNode('an-1', ['acc-beliefs-001']),
      makeANNode('an-2', ['saf-beliefs-002']),
    ];
    const taxEdges = [
      { source: 'acc-beliefs-001', target: 'saf-beliefs-002', type: 'CONVERGES_WITH' },
    ];
    const issue = makeCvIssue('iss-1', ['an-1', 'an-2']);
    const tracker = makeCvTracker([issue]);

    const boosted = boostConvergenceFromTaxonomyEdges(tracker, taxEdges, anNodes, 3);

    expect(boosted).toEqual(['iss-1']);
    expect(issue.convergence).toBeCloseTo(CONVERGES_WITH_BOOST);
    expect(issue.history).toHaveLength(1);
    expect(issue.history[0].turn).toBe(3);
  });

  it('returns empty when no CONVERGES_WITH edges exist', () => {
    const anNodes = [makeANNode('an-1', ['acc-beliefs-001'])];
    const taxEdges = [
      { source: 'acc-beliefs-001', target: 'saf-beliefs-002', type: 'SUPPORTS' },
    ];
    const tracker = makeCvTracker([makeCvIssue('iss-1', ['an-1'])]);

    expect(boostConvergenceFromTaxonomyEdges(tracker, taxEdges, anNodes, 3)).toEqual([]);
  });

  it('skips rejected CONVERGES_WITH edges', () => {
    const anNodes = [
      makeANNode('an-1', ['acc-beliefs-001']),
      makeANNode('an-2', ['saf-beliefs-002']),
    ];
    const taxEdges = [
      { source: 'acc-beliefs-001', target: 'saf-beliefs-002', type: 'CONVERGES_WITH', status: 'rejected' },
    ];
    const issue = makeCvIssue('iss-1', ['an-1', 'an-2']);
    const tracker = makeCvTracker([issue]);

    expect(boostConvergenceFromTaxonomyEdges(tracker, taxEdges, anNodes, 3)).toEqual([]);
    expect(issue.convergence).toBe(0);
  });

  it('does not boost when issue only has nodes from one side', () => {
    const anNodes = [
      makeANNode('an-1', ['acc-beliefs-001']),
      makeANNode('an-2', ['acc-beliefs-001']),
    ];
    const taxEdges = [
      { source: 'acc-beliefs-001', target: 'saf-beliefs-002', type: 'CONVERGES_WITH' },
    ];
    const issue = makeCvIssue('iss-1', ['an-1', 'an-2']);
    const tracker = makeCvTracker([issue]);

    expect(boostConvergenceFromTaxonomyEdges(tracker, taxEdges, anNodes, 3)).toEqual([]);
  });

  it('caps convergence at 1.0', () => {
    const anNodes = [
      makeANNode('an-1', ['acc-beliefs-001']),
      makeANNode('an-2', ['saf-beliefs-002']),
    ];
    const taxEdges = [
      { source: 'acc-beliefs-001', target: 'saf-beliefs-002', type: 'CONVERGES_WITH' },
    ];
    const issue = makeCvIssue('iss-1', ['an-1', 'an-2'], 0.95);
    const tracker = makeCvTracker([issue]);

    boostConvergenceFromTaxonomyEdges(tracker, taxEdges, anNodes, 5);

    expect(issue.convergence).toBe(1.0);
  });

  it('updates existing history entry at same turn number', () => {
    const anNodes = [
      makeANNode('an-1', ['acc-beliefs-001']),
      makeANNode('an-2', ['saf-beliefs-002']),
    ];
    const taxEdges = [
      { source: 'acc-beliefs-001', target: 'saf-beliefs-002', type: 'CONVERGES_WITH' },
    ];
    const issue = makeCvIssue('iss-1', ['an-1', 'an-2'], 0.2);
    issue.history.push({ turn: 5, value: 0.2 });
    const tracker = makeCvTracker([issue]);

    boostConvergenceFromTaxonomyEdges(tracker, taxEdges, anNodes, 5);

    expect(issue.history).toHaveLength(1);
    expect(issue.history[0].value).toBeCloseTo(0.2 + CONVERGES_WITH_BOOST);
  });
});
