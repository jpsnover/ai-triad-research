/**
 * Regression tests for t/282, t/283, t/284 — saturation signal bugs
 * that caused a 19-round debate to never exit argumentation.
 */
import { describe, it, expect } from 'vitest';
import { computeConvergenceSignals } from './convergenceSignals.js';
import { computeProcessReward } from './processReward.js';
import { updateCruxTracker } from './cruxResolution.js';
import type {
  TranscriptEntry,
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  ConvergenceSignals,
  TurnValidation,
} from './types.js';

// ── Helpers ──────────────────────────────────────────────

function makeEntry(overrides: Partial<TranscriptEntry> & { id: string }): TranscriptEntry {
  return {
    timestamp: '2026-01-01T00:00:00Z',
    type: 'statement',
    speaker: 'accelerationist',
    content: `Statement ${overrides.id}`,
    taxonomy_refs: [],
    ...overrides,
  };
}

function makeNode(overrides: Partial<ArgumentNetworkNode> & { id: string }): ArgumentNetworkNode {
  return {
    text: `Claim ${overrides.id}`,
    speaker: 'accelerationist',
    source_entry_id: 'e1',
    taxonomy_refs: [],
    turn_number: 1,
    base_strength: 0.6,
    computed_strength: 0.6,
    ...overrides,
  };
}

function makeEdge(overrides: Partial<ArgumentNetworkEdge> & { source: string; target: string }): ArgumentNetworkEdge {
  return {
    id: `${overrides.source}->${overrides.target}`,
    type: 'attacks',
    ...overrides,
  };
}

function makeEmbedding(seed: number): number[] {
  const vec = new Array(8).fill(0);
  vec[seed % 8] = 1;
  return vec;
}

function makeValidation(): TurnValidation {
  return {
    outcome: 'pass',
    process_reward: 0.7,
    dimensions: {
      schema: { pass: true, issues: [] },
      grounding: { pass: true, issues: [] },
      advancement: { pass: true, signals: [] },
      clarifies: { pass: false, signals: [] },
    },
    repairHints: [],
    clarifies_taxonomy: [],
    judge_used: false,
  };
}

// ── t/282: Process rewards must be populated ─────────────

describe('t/282: process rewards populated for every turn', () => {
  it('computeProcessReward returns numeric score and components', () => {
    const sig = computeConvergenceSignals(
      'e1', 'accelerationist',
      [makeEntry({ id: 'e1', metadata: { move_types: ['DISTINGUISH'] } })],
      [makeNode({ id: 'AN-1', source_entry_id: 'e1' })],
      [], [], undefined, undefined, undefined,
    );

    const pr = computeProcessReward({
      convergenceSignals: sig,
      turnValidation: makeValidation(),
      phase: 'argumentation',
      moveCount: 1,
      taxonomyRefCount: 2,
    });

    expect(pr.score).toBeGreaterThanOrEqual(0);
    expect(pr.score).toBeLessThanOrEqual(1);
    expect(pr.components.engagement).toBeTypeOf('number');
    expect(pr.components.novelty).toBeTypeOf('number');
    expect(pr.components.consistency).toBeTypeOf('number');
    expect(pr.components.grounding).toBeTypeOf('number');
    expect(pr.components.move_quality).toBeTypeOf('number');
  });

  it('no component is undefined or NaN', () => {
    const sig = computeConvergenceSignals(
      'e1', 'safetyist',
      [makeEntry({ id: 'e1', speaker: 'safetyist' })],
      [], [], [],
    );

    const pr = computeProcessReward({
      convergenceSignals: sig,
      turnValidation: makeValidation(),
      phase: 'confrontation',
      moveCount: 0,
      taxonomyRefCount: 0,
    });

    for (const [key, val] of Object.entries(pr.components)) {
      expect(val, `component ${key}`).not.toBeNaN();
      expect(val, `component ${key}`).not.toBeUndefined();
    }
    expect(pr.score).not.toBeNaN();
  });
});

// ── t/283: ArCo computed when topic embedding is available ──

describe('t/283: ArCo computed with topic embedding', () => {
  it('arco is populated when both topic and turn embeddings exist', () => {
    const topicEmbed = makeEmbedding(0);
    const turnEmbed = makeEmbedding(0); // same direction = high similarity
    const embeddings = new Map([['e1', turnEmbed]]);

    const sig = computeConvergenceSignals(
      'e1', 'accelerationist',
      [makeEntry({ id: 'e1' })],
      [], [], [],
      embeddings, undefined, topicEmbed,
    );

    expect(sig.arco).toBeDefined();
    expect(sig.arco!.turn_similarity).toBeTypeOf('number');
    expect(sig.arco!.turn_similarity).toBeGreaterThan(0);
    expect(sig.arco!.phase_mean).toBeTypeOf('number');
    expect(sig.arco!.drift_warning).toBeTypeOf('boolean');
  });

  it('arco is absent when topic embedding is missing', () => {
    const turnEmbed = makeEmbedding(0);
    const embeddings = new Map([['e1', turnEmbed]]);

    const sig = computeConvergenceSignals(
      'e1', 'accelerationist',
      [makeEntry({ id: 'e1' })],
      [], [], [],
      embeddings, undefined, undefined,
    );

    expect(sig.arco).toBeUndefined();
  });
});

// ── t/284: Crux state machine advances past 'identified' ──

describe('t/284: crux state machine advances', () => {
  it('crux with same-turn cross-POV edges advances beyond identified', () => {
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist', turn_number: 3 }),
      makeNode({ id: 'AN-2', speaker: 'safetyist', turn_number: 3 }),
      makeNode({ id: 'AN-3', speaker: 'skeptic', turn_number: 3 }),
    ];
    const edges = [
      makeEdge({ source: 'AN-2', target: 'AN-1', type: 'attacks' }),
      makeEdge({ source: 'AN-3', target: 'AN-1', type: 'attacks' }),
    ];

    const result = updateCruxTracker(undefined, nodes, edges, {}, 3);
    expect(result).toHaveLength(1);
    expect(result[0].state).not.toBe('identified');
    // Should have advanced through at least 'engaged'
    expect(result[0].history.length).toBeGreaterThan(0);
  });

  it('crux with mixed polarity advances to engaged but not resolved', () => {
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist', turn_number: 3, computed_strength: 0.7 }),
      makeNode({ id: 'AN-2', speaker: 'safetyist', turn_number: 3 }),
      makeNode({ id: 'AN-3', speaker: 'skeptic', turn_number: 3 }),
    ];
    const edges = [
      makeEdge({ source: 'AN-2', target: 'AN-1', type: 'attacks' }),
      makeEdge({ source: 'AN-3', target: 'AN-1', type: 'supports' }),
    ];
    // polarity = 1/2 = 0.5, not past resolution threshold

    const result = updateCruxTracker(undefined, nodes, edges, {}, 3);
    expect(result).toHaveLength(1);
    expect(result[0].state).toBe('engaged');
  });

  it('after 3+ rounds with direct engagement, crux advances to at least engaged', () => {
    // Round 2: crux detected
    const nodes2 = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist', turn_number: 2, computed_strength: 0.7 }),
      makeNode({ id: 'AN-2', speaker: 'safetyist', turn_number: 2 }),
    ];
    const edges2 = [
      makeEdge({ source: 'AN-2', target: 'AN-1', type: 'attacks' }),
    ];
    const after2 = updateCruxTracker(undefined, nodes2, edges2, {}, 2);

    // Round 3: new support edge
    const nodes3 = [
      ...nodes2,
      makeNode({ id: 'AN-3', speaker: 'skeptic', turn_number: 3 }),
    ];
    const edges3 = [
      ...edges2,
      makeEdge({ source: 'AN-3', target: 'AN-1', type: 'supports' }),
    ];
    const after3 = updateCruxTracker(after2, nodes3, edges3, {}, 3);

    // Round 4: another edge
    const nodes4 = [
      ...nodes3,
      makeNode({ id: 'AN-4', speaker: 'safetyist', turn_number: 4 }),
    ];
    const edges4 = [
      ...edges3,
      makeEdge({ source: 'AN-4', target: 'AN-1', type: 'attacks' }),
    ];
    const after4 = updateCruxTracker(after3, nodes4, edges4, {}, 4);

    expect(after4).toHaveLength(1);
    const crux = after4[0];
    expect(crux.state).not.toBe('identified');
    expect(['engaged', 'one_side_conceded', 'resolved', 'irreducible']).toContain(crux.state);
  });
});
