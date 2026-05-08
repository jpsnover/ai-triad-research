// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { computeConvergenceSignals, SEMANTIC_RECYCLING_THRESHOLD, ARCO_DRIFT_THRESHOLD } from './convergenceSignals.js';
import type {
  SpeakerId,
  TranscriptEntry,
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  ConvergenceSignals,
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
    speaker: 'prometheus',
    content: 'Default content for testing purposes.',
    ...overrides,
  };
}

function makeNode(overrides: Partial<ArgumentNetworkNode> = {}): ArgumentNetworkNode {
  return {
    id: `node-${++_idCounter}`,
    text: 'Default node text',
    speaker: 'prometheus',
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
    speaker: 'prometheus',
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
      'missing-id', 'prometheus', [], [], [], [],
    );
    expect(result.entry_id).toBe('missing-id');
    expect(result.speaker).toBe('prometheus');
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
      'e1', 'prometheus', [entry], [], [], [],
    );
    expect(result.dialectical_engagement).toEqual({ targeted: 0, standalone: 0, ratio: 0 });
    expect(result.dominant_counterargument).toBeNull();
  });

  it('handles entry not found in transcript gracefully', () => {
    const entry = makeEntry({ id: 'other' });
    const result = computeConvergenceSignals(
      'nonexistent', 'prometheus', [entry], [], [], [],
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
      'e3', 'prometheus', [e1, e2, e3], [], [], [],
    );
    expect(result.round).toBe(3);
  });

  it('sets round to 1 for first entry', () => {
    const e1 = makeEntry({ id: 'first' });
    const result = computeConvergenceSignals(
      'first', 'prometheus', [e1], [], [], [],
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
      'atk', 'prometheus', [entry], [], [], [],
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
      'sup', 'prometheus', [entry], [], [], [],
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
      'mixed', 'prometheus', [entry], [], [], [],
    );
    expect(result.move_polarity.confrontational).toBe(2);
    expect(result.move_polarity.collaborative).toBe(2);
    expect(result.move_polarity.ratio).toBe(0.5);
  });

  it('returns ratio 0 when no moves are present', () => {
    const entry = makeEntry({ id: 'nomoves', metadata: {} });
    const result = computeConvergenceSignals(
      'nomoves', 'prometheus', [entry], [], [], [],
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
      'neutral', 'prometheus', [entry], [], [], [],
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
      'annot', 'prometheus', [entry], [], [], [],
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
      'norm', 'prometheus', [entry], [], [], [],
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
    const n1 = makeNode({ id: 'n1', source_entry_id: entryId, speaker: 'prometheus' });
    const n2 = makeNode({ id: 'n2', source_entry_id: 'other-entry', speaker: 'sentinel' });
    const edge = makeEdge('n1', 'n2', 'attacks');
    const entry = makeEntry({ id: entryId });

    const result = computeConvergenceSignals(
      entryId, 'prometheus', [entry], [n1, n2], [edge], [],
    );
    expect(result.dialectical_engagement.targeted).toBe(1);
    expect(result.dialectical_engagement.standalone).toBe(0);
    expect(result.dialectical_engagement.ratio).toBe(1);
  });

  it('counts nodes with no cross-turn edges as standalone', () => {
    const entryId = 'eng2';
    const n1 = makeNode({ id: 'n1', source_entry_id: entryId, speaker: 'prometheus' });
    const entry = makeEntry({ id: entryId });

    const result = computeConvergenceSignals(
      entryId, 'prometheus', [entry], [n1], [], [],
    );
    expect(result.dialectical_engagement.targeted).toBe(0);
    expect(result.dialectical_engagement.standalone).toBe(1);
    expect(result.dialectical_engagement.ratio).toBe(0);
  });

  it('ignores intra-turn edges for engagement depth', () => {
    const entryId = 'eng3';
    const n1 = makeNode({ id: 'na', source_entry_id: entryId, speaker: 'prometheus' });
    const n2 = makeNode({ id: 'nb', source_entry_id: entryId, speaker: 'prometheus' });
    const edge = makeEdge('na', 'nb', 'supports');
    const entry = makeEntry({ id: entryId });

    const result = computeConvergenceSignals(
      entryId, 'prometheus', [entry], [n1, n2], [edge], [],
    );
    // Both edges are intra-turn, so both nodes are standalone
    expect(result.dialectical_engagement.targeted).toBe(0);
    expect(result.dialectical_engagement.standalone).toBe(2);
    expect(result.dialectical_engagement.ratio).toBe(0);
  });

  it('computes ratio for mixed targeted and standalone', () => {
    const entryId = 'eng4';
    const n1 = makeNode({ id: 'nx', source_entry_id: entryId, speaker: 'prometheus' });
    const n2 = makeNode({ id: 'ny', source_entry_id: entryId, speaker: 'prometheus' });
    const n3 = makeNode({ id: 'nz', source_entry_id: 'other', speaker: 'sentinel' });
    const edge = makeEdge('nx', 'nz', 'attacks');
    const entry = makeEntry({ id: entryId });

    const result = computeConvergenceSignals(
      entryId, 'prometheus', [entry], [n1, n2, n3], [edge], [],
    );
    expect(result.dialectical_engagement.targeted).toBe(1);
    expect(result.dialectical_engagement.standalone).toBe(1);
    expect(result.dialectical_engagement.ratio).toBe(0.5);
  });

  it('handles incoming edges (target is turn node, source is external)', () => {
    const entryId = 'eng5';
    const n1 = makeNode({ id: 'n-in', source_entry_id: entryId, speaker: 'prometheus' });
    const n2 = makeNode({ id: 'n-ext', source_entry_id: 'other', speaker: 'sentinel' });
    const edge = makeEdge('n-ext', 'n-in', 'attacks');
    const entry = makeEntry({ id: entryId });

    const result = computeConvergenceSignals(
      entryId, 'prometheus', [entry], [n1, n2], [edge], [],
    );
    expect(result.dialectical_engagement.targeted).toBe(1);
    expect(result.dialectical_engagement.standalone).toBe(0);
  });

  it('returns ratio 0 when turn has no nodes', () => {
    const entry = makeEntry({ id: 'eng6' });
    const result = computeConvergenceSignals(
      'eng6', 'prometheus', [entry], [], [], [],
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
      'rec1', 'prometheus', [entry], [], [], [],
    );
    expect(result.argument_redundancy.avg_self_overlap).toBe(0);
    expect(result.argument_redundancy.max_self_overlap).toBe(0);
  });

  it('computes high overlap when repeating same words', () => {
    const prior = makeEntry({
      id: 'r-prior',
      speaker: 'sentinel',
      content: 'regulation safety governance alignment policy',
    });
    const current = makeEntry({
      id: 'r-current',
      speaker: 'sentinel',
      content: 'regulation safety governance alignment policy',
    });
    const result = computeConvergenceSignals(
      'r-current', 'sentinel', [prior, current], [], [], [],
    );
    expect(result.argument_redundancy.avg_self_overlap).toBe(1);
    expect(result.argument_redundancy.max_self_overlap).toBe(1);
  });

  it('computes low overlap with different vocabulary', () => {
    const prior = makeEntry({
      id: 'r-low-prior',
      speaker: 'cassandra',
      content: 'regulation safety governance alignment policy',
    });
    const current = makeEntry({
      id: 'r-low-current',
      speaker: 'cassandra',
      content: 'innovation disruption acceleration technology progress',
    });
    const result = computeConvergenceSignals(
      'r-low-current', 'cassandra', [prior, current], [], [], [],
    );
    expect(result.argument_redundancy.avg_self_overlap).toBe(0);
    expect(result.argument_redundancy.max_self_overlap).toBe(0);
  });

  it('averages overlap across multiple prior turns by same speaker', () => {
    const prior1 = makeEntry({
      id: 'rm1',
      speaker: 'prometheus',
      content: 'innovation progress acceleration technology growth',
    });
    const prior2 = makeEntry({
      id: 'rm2',
      speaker: 'prometheus',
      content: 'completely different words about regulation safety alignment',
    });
    const current = makeEntry({
      id: 'rm3',
      speaker: 'prometheus',
      content: 'innovation progress acceleration technology growth',
    });
    const result = computeConvergenceSignals(
      'rm3', 'prometheus', [prior1, prior2, current], [], [], [],
    );
    // Perfect overlap with prior1 (1.0), zero with prior2 (0.0), avg = 0.5
    expect(result.argument_redundancy.max_self_overlap).toBe(1);
    expect(result.argument_redundancy.avg_self_overlap).toBeCloseTo(0.5, 1);
  });

  it('ignores prior entries by different speakers', () => {
    const other = makeEntry({
      id: 'ro-other',
      speaker: 'sentinel',
      content: 'innovation progress acceleration technology growth',
    });
    const current = makeEntry({
      id: 'ro-curr',
      speaker: 'prometheus',
      content: 'innovation progress acceleration technology growth',
    });
    const result = computeConvergenceSignals(
      'ro-curr', 'prometheus', [other, current], [], [], [],
    );
    expect(result.argument_redundancy.avg_self_overlap).toBe(0);
  });
});

// ── Semantic recycling ─────────────────────────────────────

describe('computeConvergenceSignals — semantic recycling', () => {
  it('returns undefined semantic fields when no embeddings provided', () => {
    const entry = makeEntry({ id: 'sem1' });
    const result = computeConvergenceSignals(
      'sem1', 'prometheus', [entry], [], [], [],
    );
    expect(result.argument_redundancy.semantic_max_similarity).toBeUndefined();
    expect(result.argument_redundancy.semantically_recycled).toBeUndefined();
  });

  it('returns undefined when current entry has no embedding', () => {
    const prior = makeEntry({ id: 'sem-prior', speaker: 'prometheus' });
    const entry = makeEntry({ id: 'sem2', speaker: 'prometheus' });
    const embeddings = new Map<string, number[]>();
    embeddings.set('sem-prior', makeEmbedding(1));
    // No embedding for 'sem2'

    const result = computeConvergenceSignals(
      'sem2', 'prometheus', [prior, entry], [], [], [], embeddings,
    );
    expect(result.argument_redundancy.semantic_max_similarity).toBeUndefined();
    expect(result.argument_redundancy.semantically_recycled).toBeUndefined();
  });

  it('detects high semantic similarity (above threshold)', () => {
    const prior = makeEntry({ id: 'sh-prior', speaker: 'prometheus' });
    const entry = makeEntry({ id: 'sh-curr', speaker: 'prometheus' });
    const embeddings = new Map<string, number[]>();
    const e = makeEmbedding(42);
    embeddings.set('sh-prior', e);
    embeddings.set('sh-curr', makeSimilarEmbedding(42)); // same direction, scaled

    const result = computeConvergenceSignals(
      'sh-curr', 'prometheus', [prior, entry], [], [], [], embeddings,
    );
    expect(result.argument_redundancy.semantic_max_similarity).toBeGreaterThan(SEMANTIC_RECYCLING_THRESHOLD);
    expect(result.argument_redundancy.semantically_recycled).toBe(true);
  });

  it('detects low semantic similarity (below threshold)', () => {
    const prior = makeEntry({ id: 'sl-prior', speaker: 'sentinel' });
    const entry = makeEntry({ id: 'sl-curr', speaker: 'sentinel' });
    const embeddings = new Map<string, number[]>();
    embeddings.set('sl-prior', makeEmbedding(1));
    embeddings.set('sl-curr', makeDissimilarEmbedding(1));

    const result = computeConvergenceSignals(
      'sl-curr', 'sentinel', [prior, entry], [], [], [], embeddings,
    );
    expect(result.argument_redundancy.semantic_max_similarity).toBeDefined();
    expect(result.argument_redundancy.semantically_recycled).toBe(false);
  });

  it('returns undefined when speaker has no prior turns with embeddings', () => {
    const entry = makeEntry({ id: 'sn-curr', speaker: 'prometheus' });
    const embeddings = new Map<string, number[]>();
    embeddings.set('sn-curr', makeEmbedding(5));

    const result = computeConvergenceSignals(
      'sn-curr', 'prometheus', [entry], [], [], [], embeddings,
    );
    // No prior same-speaker entries, so maxSim stays 0 and fields are undefined
    expect(result.argument_redundancy.semantic_max_similarity).toBeUndefined();
    expect(result.argument_redundancy.semantically_recycled).toBeUndefined();
  });

  it('picks the maximum similarity across multiple prior turns', () => {
    const p1 = makeEntry({ id: 'sm-p1', speaker: 'cassandra' });
    const p2 = makeEntry({ id: 'sm-p2', speaker: 'cassandra' });
    const curr = makeEntry({ id: 'sm-curr', speaker: 'cassandra' });
    const embeddings = new Map<string, number[]>();
    embeddings.set('sm-p1', makeDissimilarEmbedding(1));    // low sim
    embeddings.set('sm-p2', makeSimilarEmbedding(7));        // high sim
    embeddings.set('sm-curr', makeEmbedding(7));             // matches p2

    const result = computeConvergenceSignals(
      'sm-curr', 'cassandra', [p1, p2, curr], [], [], [], embeddings,
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
    const n1 = makeNode({ id: 'sn1', speaker: 'prometheus' });
    const result = computeConvergenceSignals(
      'op1', 'prometheus', [entry], [n1], [], [],
    );
    expect(result.dominant_counterargument).toBeNull();
  });

  it('identifies the strongest attack on speaker nodes using precomputedStrengths', () => {
    const entry = makeEntry({ id: 'op2' });
    const speakerNode = makeNode({ id: 'sp1', speaker: 'prometheus' });
    const attackerNode1 = makeNode({ id: 'at1', speaker: 'sentinel', bdi_category: 'belief' });
    const attackerNode2 = makeNode({ id: 'at2', speaker: 'cassandra', bdi_category: 'desire' });
    const edge1 = makeEdge('at1', 'sp1', 'attacks');
    const edge2 = makeEdge('at2', 'sp1', 'attacks');

    const strengths = new Map<string, number>();
    strengths.set('at1', 0.3);
    strengths.set('at2', 0.9);

    const result = computeConvergenceSignals(
      'op2', 'prometheus', [entry],
      [speakerNode, attackerNode1, attackerNode2],
      [edge1, edge2], [], undefined, strengths,
    );
    expect(result.dominant_counterargument).not.toBeNull();
    expect(result.dominant_counterargument!.node_id).toBe('at2');
    expect(result.dominant_counterargument!.strength).toBe(0.9);
    expect(result.dominant_counterargument!.attacker).toBe('cassandra');
    expect(result.dominant_counterargument!.bdi_category).toBe('desire');
  });

  it('defaults to 0.5 strength when node is not in precomputed strengths', () => {
    const entry = makeEntry({ id: 'op3' });
    const sp = makeNode({ id: 'sp3', speaker: 'prometheus' });
    const at = makeNode({ id: 'at3', speaker: 'sentinel' });
    const edge = makeEdge('at3', 'sp3', 'attacks');
    const strengths = new Map<string, number>(); // at3 not in map

    const result = computeConvergenceSignals(
      'op3', 'prometheus', [entry], [sp, at], [edge], [], undefined, strengths,
    );
    expect(result.dominant_counterargument).not.toBeNull();
    expect(result.dominant_counterargument!.strength).toBe(0.5);
  });

  it('ignores support edges for strongest opposing', () => {
    const entry = makeEntry({ id: 'op4' });
    const sp = makeNode({ id: 'sp4', speaker: 'prometheus' });
    const sup = makeNode({ id: 'sup4', speaker: 'sentinel' });
    const edge = makeEdge('sup4', 'sp4', 'supports');

    const strengths = new Map<string, number>();
    strengths.set('sup4', 0.99);

    const result = computeConvergenceSignals(
      'op4', 'prometheus', [entry], [sp, sup], [edge], [], undefined, strengths,
    );
    expect(result.dominant_counterargument).toBeNull();
  });

  it('uses QBAF computation when no precomputed strengths provided', () => {
    const entry = makeEntry({ id: 'op5' });
    const sp = makeNode({ id: 'sp5', speaker: 'prometheus', base_strength: 0.5 });
    const at = makeNode({ id: 'at5', speaker: 'sentinel', base_strength: 0.7 });
    const edge = makeEdge('at5', 'sp5', 'attacks');

    const result = computeConvergenceSignals(
      'op5', 'prometheus', [entry], [sp, at], [edge], [],
    );
    expect(result.dominant_counterargument).not.toBeNull();
    expect(result.dominant_counterargument!.node_id).toBe('at5');
    // QBAF should compute a strength close to the base_strength
    expect(result.dominant_counterargument!.strength).toBeGreaterThan(0);
  });

  it('sets attacker to "unknown" when attacker node is not found', () => {
    const entry = makeEntry({ id: 'op6' });
    const sp = makeNode({ id: 'sp6', speaker: 'prometheus' });
    // attacker node referenced in edge but not in nodes array
    const edge = makeEdge('phantom', 'sp6', 'attacks');

    const strengths = new Map<string, number>();
    strengths.set('phantom', 0.8);

    const result = computeConvergenceSignals(
      'op6', 'prometheus', [entry], [sp], [edge], [], undefined, strengths,
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
      'con1', 'prometheus', [entry], [], [], [],
    );
    expect(result.concession_opportunity.outcome).toBe('none');
    expect(result.concession_opportunity.strong_attacks_faced).toBe(0);
  });

  it('returns outcome "taken" when strong attacks faced and concession used', () => {
    const entry = makeEntry({
      id: 'con2',
      metadata: { move_types: ['CONCEDE-AND-PIVOT'] },
    });
    const sp = makeNode({ id: 'c-sp', speaker: 'prometheus' });
    const at = makeNode({ id: 'c-at', speaker: 'sentinel' });
    const edge = makeEdge('c-at', 'c-sp', 'attacks');
    const strengths = new Map<string, number>();
    strengths.set('c-at', 0.8); // >= 0.6 threshold

    const result = computeConvergenceSignals(
      'con2', 'prometheus', [entry], [sp, at], [edge], [], undefined, strengths,
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
    const sp = makeNode({ id: 'cm-sp', speaker: 'sentinel' });
    const at = makeNode({ id: 'cm-at', speaker: 'prometheus' });
    const edge = makeEdge('cm-at', 'cm-sp', 'attacks');
    const strengths = new Map<string, number>();
    strengths.set('cm-at', 0.7); // >= 0.6

    const result = computeConvergenceSignals(
      'con3', 'sentinel', [entry], [sp, at], [edge], [], undefined, strengths,
    );
    expect(result.concession_opportunity.outcome).toBe('missed');
    expect(result.concession_opportunity.concession_used).toBe(false);
  });

  it('does not count attacks below 0.6 as strong', () => {
    const entry = makeEntry({
      id: 'con4',
      metadata: { move_types: ['COUNTEREXAMPLE'] },
    });
    const sp = makeNode({ id: 'cw-sp', speaker: 'prometheus' });
    const at = makeNode({ id: 'cw-at', speaker: 'sentinel' });
    const edge = makeEdge('cw-at', 'cw-sp', 'attacks');
    const strengths = new Map<string, number>();
    strengths.set('cw-at', 0.5); // below 0.6

    const result = computeConvergenceSignals(
      'con4', 'prometheus', [entry], [sp, at], [edge], [], undefined, strengths,
    );
    expect(result.concession_opportunity.strong_attacks_faced).toBe(0);
    expect(result.concession_opportunity.outcome).toBe('none');
  });

  it('counts multiple strong attacks', () => {
    const entry = makeEntry({
      id: 'con5',
      metadata: { move_types: ['DISTINGUISH'] },
    });
    const sp = makeNode({ id: 'ms-sp', speaker: 'cassandra' });
    const at1 = makeNode({ id: 'ms-at1', speaker: 'prometheus' });
    const at2 = makeNode({ id: 'ms-at2', speaker: 'sentinel' });
    const e1 = makeEdge('ms-at1', 'ms-sp', 'attacks');
    const e2 = makeEdge('ms-at2', 'ms-sp', 'attacks');
    const strengths = new Map<string, number>();
    strengths.set('ms-at1', 0.9);
    strengths.set('ms-at2', 0.7);

    const result = computeConvergenceSignals(
      'con5', 'cassandra', [entry], [sp, at1, at2], [e1, e2], [], undefined, strengths,
    );
    expect(result.concession_opportunity.strong_attacks_faced).toBe(2);
  });
});

// ── Position delta ─────────────────────────────────────────

describe('computeConvergenceSignals — position delta', () => {
  it('computes overlap with opening statement', () => {
    const opening = makeEntry({
      id: 'pd-open',
      speaker: 'prometheus',
      type: 'opening',
      content: 'innovation progress acceleration technology growth',
    });
    const current = makeEntry({
      id: 'pd-curr',
      speaker: 'prometheus',
      content: 'innovation progress acceleration technology growth',
    });
    const result = computeConvergenceSignals(
      'pd-curr', 'prometheus', [opening, current], [], [], [],
    );
    expect(result.position_drift.overlap_with_opening).toBe(1);
  });

  it('returns 0 overlap when no opening statement exists', () => {
    const current = makeEntry({
      id: 'pd-noopen',
      speaker: 'prometheus',
      content: 'some content here',
    });
    const result = computeConvergenceSignals(
      'pd-noopen', 'prometheus', [current], [], [], [],
    );
    expect(result.position_drift.overlap_with_opening).toBe(0);
  });

  it('computes drift from prior signal overlap value', () => {
    const opening = makeEntry({
      id: 'pd-d-open',
      speaker: 'sentinel',
      type: 'opening',
      content: 'regulation safety governance alignment policy',
    });
    const current = makeEntry({
      id: 'pd-d-curr',
      speaker: 'sentinel',
      content: 'innovation disruption acceleration technology progress',
    });
    const priorSignals: ConvergenceSignals[] = [
      makeSignals({
        speaker: 'sentinel',
        position_drift: { overlap_with_opening: 0.8, drift: 0 },
      }),
    ];
    const result = computeConvergenceSignals(
      'pd-d-curr', 'sentinel', [opening, current], [], [], priorSignals,
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
      speaker: 'prometheus',
      type: 'opening',
      content: 'some opening content here',
    });
    const current = makeEntry({
      id: 'pd-nd-curr',
      speaker: 'prometheus',
      content: 'some opening content here',
    });
    const result = computeConvergenceSignals(
      'pd-nd-curr', 'prometheus', [opening, current], [], [], [],
    );
    expect(result.position_drift.drift).toBe(0);
  });

  it('uses the last prior signal for drift calculation', () => {
    const opening = makeEntry({
      id: 'pd-last-open',
      speaker: 'prometheus',
      type: 'opening',
      content: 'alpha bravo charlie delta echo foxtrot',
    });
    const current = makeEntry({
      id: 'pd-last-curr',
      speaker: 'prometheus',
      content: 'alpha bravo charlie delta echo foxtrot',
    });
    const priorSignals: ConvergenceSignals[] = [
      makeSignals({ speaker: 'prometheus', position_drift: { overlap_with_opening: 0.9, drift: 0 } }),
      makeSignals({ speaker: 'prometheus', position_drift: { overlap_with_opening: 0.3, drift: 0.6 } }),
    ];
    const result = computeConvergenceSignals(
      'pd-last-curr', 'prometheus', [opening, current], [], [], priorSignals,
    );
    // Should use last signal's overlap_with_opening (0.3)
    expect(result.position_drift.drift).toBeCloseTo(
      Math.abs(result.position_drift.overlap_with_opening - 0.3),
      5,
    );
  });
});

// ── Crux rate ──────────────────────────────────────────────

describe('computeConvergenceSignals — crux rate', () => {
  it('detects IDENTIFY-CRUX usage', () => {
    const entry = makeEntry({
      id: 'cr1',
      metadata: { move_types: ['IDENTIFY-CRUX'] },
    });
    const result = computeConvergenceSignals(
      'cr1', 'prometheus', [entry], [], [], [],
    );
    expect(result.crux_engagement_rate.used_this_turn).toBe(true);
    expect(result.crux_engagement_rate.cumulative_count).toBe(1);
  });

  it('detects IDENTIFY_CRUX variant', () => {
    const entry = makeEntry({
      id: 'cr2',
      metadata: { move_types: ['IDENTIFY_CRUX'] },
    });
    const result = computeConvergenceSignals(
      'cr2', 'prometheus', [entry], [], [], [],
    );
    expect(result.crux_engagement_rate.used_this_turn).toBe(true);
  });

  it('returns false when no crux move used', () => {
    const entry = makeEntry({
      id: 'cr3',
      metadata: { move_types: ['COUNTEREXAMPLE', 'CONCEDE'] },
    });
    const result = computeConvergenceSignals(
      'cr3', 'prometheus', [entry], [], [], [],
    );
    expect(result.crux_engagement_rate.used_this_turn).toBe(false);
    expect(result.crux_engagement_rate.cumulative_count).toBe(0);
  });

  it('accumulates crux count from prior signals', () => {
    const entry = makeEntry({
      id: 'cr4',
      metadata: { move_types: ['IDENTIFY-CRUX'] },
    });
    const priorSignals: ConvergenceSignals[] = [
      makeSignals({
        speaker: 'prometheus',
        crux_engagement_rate: { used_this_turn: true, cumulative_count: 2, cumulative_follow_through: 1 },
      }),
    ];
    const result = computeConvergenceSignals(
      'cr4', 'prometheus', [entry], [], [], priorSignals,
    );
    // Prior had 2 crux uses, this turn adds 1, but cumulative is recounted from signals
    expect(result.crux_engagement_rate.cumulative_count).toBe(2); // prior 1 (from signals) + this 1
  });

  it('tracks follow-through when crux used with collaborative move', () => {
    const entry = makeEntry({
      id: 'cr5',
      metadata: { move_types: ['IDENTIFY-CRUX', 'INTEGRATE'] },
    });
    const result = computeConvergenceSignals(
      'cr5', 'prometheus', [entry], [], [], [],
    );
    expect(result.crux_engagement_rate.used_this_turn).toBe(true);
    expect(result.crux_engagement_rate.cumulative_follow_through).toBe(1);
  });

  it('does not count follow-through when crux used without collaborative move', () => {
    const entry = makeEntry({
      id: 'cr6',
      metadata: { move_types: ['IDENTIFY-CRUX', 'COUNTEREXAMPLE'] },
    });
    const result = computeConvergenceSignals(
      'cr6', 'prometheus', [entry], [], [], [],
    );
    expect(result.crux_engagement_rate.used_this_turn).toBe(true);
    expect(result.crux_engagement_rate.cumulative_follow_through).toBe(0);
  });

  it('does not count follow-through when no crux used even with collaborative move', () => {
    const entry = makeEntry({
      id: 'cr7',
      metadata: { move_types: ['INTEGRATE', 'CONCEDE'] },
    });
    const result = computeConvergenceSignals(
      'cr7', 'prometheus', [entry], [], [], [],
    );
    expect(result.crux_engagement_rate.used_this_turn).toBe(false);
    expect(result.crux_engagement_rate.cumulative_follow_through).toBe(0);
  });

  it('accumulates follow-through from prior signals', () => {
    const entry = makeEntry({
      id: 'cr8',
      metadata: { move_types: ['IDENTIFY-CRUX', 'EXTEND'] },
    });
    const priorSignals: ConvergenceSignals[] = [
      makeSignals({
        speaker: 'prometheus',
        crux_engagement_rate: { used_this_turn: true, cumulative_count: 1, cumulative_follow_through: 1 },
      }),
    ];
    const result = computeConvergenceSignals(
      'cr8', 'prometheus', [entry], [], [], priorSignals,
    );
    expect(result.crux_engagement_rate.cumulative_follow_through).toBe(2);
  });
});

// ── Speaker filtering ──────────────────────────────────────

describe('computeConvergenceSignals — speaker isolation', () => {
  it('only uses prior signals from the same speaker for drift', () => {
    const opening = makeEntry({
      id: 'iso-open',
      speaker: 'prometheus',
      type: 'opening',
      content: 'innovation progress acceleration technology growth',
    });
    const current = makeEntry({
      id: 'iso-curr',
      speaker: 'prometheus',
      content: 'innovation progress acceleration technology growth',
    });
    const otherSpeakerSignal = makeSignals({
      speaker: 'sentinel',
      position_drift: { overlap_with_opening: 0.1, drift: 0.9 },
    });
    const result = computeConvergenceSignals(
      'iso-curr', 'prometheus', [opening, current], [], [], [otherSpeakerSignal],
    );
    // No prior prometheus signals, so drift should be 0
    expect(result.position_drift.drift).toBe(0);
  });

  it('only counts prior crux signals from the same speaker', () => {
    const entry = makeEntry({
      id: 'iso-crux',
      metadata: { move_types: ['IDENTIFY-CRUX'] },
    });
    const otherSpeakerSignal = makeSignals({
      speaker: 'sentinel',
      crux_engagement_rate: { used_this_turn: true, cumulative_count: 5, cumulative_follow_through: 3 },
    });
    const result = computeConvergenceSignals(
      'iso-crux', 'prometheus', [entry], [], [], [otherSpeakerSignal],
    );
    // Should not inherit sentinel's crux counts
    expect(result.crux_engagement_rate.cumulative_count).toBe(1);
  });
});

// ── Full integration scenario ──────────────────────────────

describe('computeConvergenceSignals — integration', () => {
  it('computes all fields correctly for a realistic multi-turn scenario', () => {
    const opening = makeEntry({
      id: 'int-open',
      speaker: 'prometheus',
      type: 'opening',
      content: 'We should accelerate innovation with minimal regulation because technology progress benefits humanity.',
    });
    const sentinelTurn = makeEntry({
      id: 'int-sent',
      speaker: 'sentinel',
      type: 'cross-respond',
      content: 'Regulation is essential for safety. Unchecked progress poses catastrophic alignment risks.',
    });
    const current = makeEntry({
      id: 'int-curr',
      speaker: 'prometheus',
      type: 'cross-respond',
      content: 'While safety matters, innovation with minimal regulation drives progress. Technology benefits outweigh alignment risks.',
      metadata: {
        move_types: ['COUNTEREXAMPLE', 'CONCEDE-AND-PIVOT', 'IDENTIFY-CRUX'],
      },
    });

    const pNode = makeNode({ id: 'pn1', speaker: 'prometheus', source_entry_id: 'int-curr', base_strength: 0.6 });
    const sNode = makeNode({ id: 'sn1', speaker: 'sentinel', source_entry_id: 'int-sent', base_strength: 0.7 });
    const edge = makeEdge('pn1', 'sn1', 'attacks');
    const atkEdge = makeEdge('sn1', 'pn1', 'attacks', { weight: 0.6 });

    const strengths = new Map<string, number>();
    strengths.set('pn1', 0.55);
    strengths.set('sn1', 0.75);

    const result = computeConvergenceSignals(
      'int-curr', 'prometheus',
      [opening, sentinelTurn, current],
      [pNode, sNode],
      [edge, atkEdge],
      [],
      undefined,
      strengths,
    );

    // Basic fields
    expect(result.entry_id).toBe('int-curr');
    expect(result.round).toBe(3);
    expect(result.speaker).toBe('prometheus');

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
    expect(result.dominant_counterargument!.attacker).toBe('sentinel');

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
      speaker: 'prometheus',
      type: 'opening',
      content: 'innovation progress acceleration technology growth future',
    });
    const turn2 = makeEntry({
      id: 'seq-t2',
      speaker: 'prometheus',
      content: 'innovation progress acceleration technology growth future',
      metadata: { move_types: ['IDENTIFY-CRUX', 'CONCEDE'] },
    });
    const turn3 = makeEntry({
      id: 'seq-t3',
      speaker: 'prometheus',
      content: 'completely different vocabulary about regulation safety alignment',
      metadata: { move_types: ['IDENTIFY-CRUX', 'COUNTEREXAMPLE'] },
    });

    // First call
    const sig1 = computeConvergenceSignals(
      'seq-t2', 'prometheus', [opening, turn2], [], [], [],
    );
    expect(sig1.crux_engagement_rate.cumulative_count).toBe(1);
    expect(sig1.crux_engagement_rate.cumulative_follow_through).toBe(1); // crux + CONCEDE (support)

    // Second call uses first signal
    const sig2 = computeConvergenceSignals(
      'seq-t3', 'prometheus', [opening, turn2, turn3], [], [], [sig1],
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
      'ec1', 'prometheus', [entry], [], [], [],
    );
    expect(result.move_polarity.ratio).toBe(0);
    expect(result.crux_engagement_rate.used_this_turn).toBe(false);
  });

  it('handles metadata without move_types key', () => {
    const entry = makeEntry({ id: 'ec2', metadata: { other_key: 'value' } });
    const result = computeConvergenceSignals(
      'ec2', 'prometheus', [entry], [], [], [],
    );
    expect(result.move_polarity.ratio).toBe(0);
  });

  it('handles entry with undefined metadata', () => {
    const entry = makeEntry({ id: 'ec3' });
    delete (entry as Record<string, unknown>).metadata;
    const result = computeConvergenceSignals(
      'ec3', 'prometheus', [entry], [], [], [],
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
      speaker: 'prometheus',
      content: 'a b c d e', // all words <= 3 chars
    });
    const current = makeEntry({
      id: 'ec5-curr',
      speaker: 'prometheus',
      content: 'a b c d e',
    });
    const result = computeConvergenceSignals(
      'ec5-curr', 'prometheus', [prior, current], [], [], [],
    );
    // wordOverlap filters words <= 3 chars, so overlap should be 0
    expect(result.argument_redundancy.avg_self_overlap).toBe(0);
  });

  it('correctly identifies opening of correct speaker type', () => {
    // Other speaker's opening should be ignored
    const sentinelOpening = makeEntry({
      id: 'ec6-sopen',
      speaker: 'sentinel',
      type: 'opening',
      content: 'regulation safety governance alignment',
    });
    const promOpening = makeEntry({
      id: 'ec6-popen',
      speaker: 'prometheus',
      type: 'opening',
      content: 'innovation acceleration progress technology',
    });
    const current = makeEntry({
      id: 'ec6-curr',
      speaker: 'prometheus',
      content: 'innovation acceleration progress technology',
    });
    const result = computeConvergenceSignals(
      'ec6-curr', 'prometheus', [sentinelOpening, promOpening, current], [], [], [],
    );
    expect(result.position_drift.overlap_with_opening).toBe(1);
  });

  it('handles nodes with undefined base_strength (defaults to 0.5 in QBAF)', () => {
    const entry = makeEntry({ id: 'ec7' });
    const sp = makeNode({ id: 'ec7-sp', speaker: 'prometheus', base_strength: undefined as unknown as number });
    const at = makeNode({ id: 'ec7-at', speaker: 'sentinel', base_strength: undefined as unknown as number });
    const edge = makeEdge('ec7-at', 'ec7-sp', 'attacks');

    // Should not throw; QBAF defaults base_strength to 0.5 via ?? operator
    const result = computeConvergenceSignals(
      'ec7', 'prometheus', [entry], [sp, at], [edge], [],
    );
    expect(result.dominant_counterargument).not.toBeNull();
  });

  it('handles edges with undefined weight (defaults to 0.5)', () => {
    const entry = makeEntry({ id: 'ec8' });
    const sp = makeNode({ id: 'ec8-sp', speaker: 'prometheus' });
    const at = makeNode({ id: 'ec8-at', speaker: 'sentinel' });
    const edge = makeEdge('ec8-at', 'ec8-sp', 'attacks', { weight: undefined });

    const result = computeConvergenceSignals(
      'ec8', 'prometheus', [entry], [sp, at], [edge], [],
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
      'arco-1', 'prometheus', [entry], [], [], [],
      embeddings, undefined, undefined,
    );
    expect(result.arco).toBeUndefined();
  });

  it('is absent when no turnEmbeddings provided', () => {
    const entry = makeEntry({ id: 'arco-2' });
    const topicEmbed = makeEmbedding(1);
    const result = computeConvergenceSignals(
      'arco-2', 'prometheus', [entry], [], [], [],
      undefined, undefined, topicEmbed,
    );
    expect(result.arco).toBeUndefined();
  });

  it('is absent when current entry has no embedding', () => {
    const entry = makeEntry({ id: 'arco-3' });
    const embeddings = new Map([['other-entry', makeEmbedding(1)]]);
    const topicEmbed = makeEmbedding(1);
    const result = computeConvergenceSignals(
      'arco-3', 'prometheus', [entry], [], [], [],
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
      'arco-4', 'prometheus', [entry], [], [], [],
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
      'arco-5', 'prometheus', [entry], [], [], [],
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
      'arco-6', 'prometheus', [entry], [], [], [],
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
      'arco-7a', 'prometheus', [e1, e2], [], [], [],
      embeddings, undefined, topicEmbed,
    );
    expect(sig1.arco).toBeDefined();
    const firstSim = sig1.arco!.turn_similarity;
    expect(firstSim).toBeGreaterThan(0.99);

    // Compute second signal with first as existing
    const sig2 = computeConvergenceSignals(
      'arco-7b', 'sentinel', [e1, e2], [], [], [sig1],
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
      'arco-8a', 'prometheus', [e1, e2], [], [], [],
      embeddings, undefined, topicEmbed,
    );

    const sig2 = computeConvergenceSignals(
      'arco-8b', 'prometheus', [e1, e2], [], [], [sig1],
      embeddings, undefined, topicEmbed,
    );
    // sig2 phase_mean should only reflect the current (argumentation) phase turn
    expect(sig2.arco).toBeDefined();
    expect(sig2.arco!.phase_mean).toBeCloseTo(sig2.arco!.turn_similarity, 5);
  });
});
