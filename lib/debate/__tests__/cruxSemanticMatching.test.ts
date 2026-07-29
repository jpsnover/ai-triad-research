// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Semantic crux matching for the evaluator↔engine divergence diagnostic (t/1853).
 *
 * The metric formerly compared the two crux lists BY POSITION, so a mere ordering
 * permutation of identical cruxes read as divergence (t/1846 §E defect 2). These
 * tests pin the replacement: greedy 1:1 embedding-similarity matching, threshold-
 * gated, with unmatched cruxes reported separately and "no embeddings" reading as
 * instrument-absent (null), never as data.
 */

import { describe, it, expect } from 'vitest';
import { extractCalibrationData } from '../calibrationLogger.js';
import {
  computeCruxSemanticDivergence,
  CRUX_MATCH_SIMILARITY_THRESHOLD,
} from '../calibrationLogger/extract-metrics.js';
import type { DebateSession } from '../types.js';

// 4-dim toy vectors: A ≈ A2 (cos ≈ 0.994), B ≈ B2, A ⊥ B (cos ≈ 0.11 across pairs).
const A = [1, 0, 0, 0];
const A2 = [0.9, 0.1, 0, 0];
const B = [0, 1, 0, 0];
const B2 = [0.1, 0.9, 0, 0];

type RawEngineCrux = { id?: string; state?: string; status?: string; description?: string };

function anWith(nodes: { id: string; embedding?: number[] }[]): DebateSession['argument_network'] {
  return {
    nodes: nodes.map(n => ({
      id: n.id,
      text: `Claim ${n.id}`,
      speaker: 'accelerationist',
      source_entry_id: 'e1',
      taxonomy_refs: [],
      turn_number: 1,
      ...(n.embedding ? { embedding: n.embedding } : {}),
    })),
    edges: [],
  } as unknown as DebateSession['argument_network'];
}

function evalCrux(status: string, embedding?: number[]): { status: string; embedding?: number[] } {
  return embedding ? { status, embedding } : { status };
}

describe('computeCruxSemanticDivergence (t/1853)', () => {
  it('is permutation-invariant: reordered identical cruxes read as 0 divergence, not 1.0', () => {
    // Engine: crux-a resolved, crux-b identified (not resolved).
    // Evaluator lists them in the OPPOSITE order with AGREEING statuses.
    // The old positional walk scored this 1.0 (pure order noise); matching scores 0.
    const an = anWith([{ id: 'crux-a', embedding: A }, { id: 'crux-b', embedding: B }]);
    const engine: RawEngineCrux[] = [
      { id: 'crux-a', state: 'resolved' },
      { id: 'crux-b', state: 'identified' },
    ];
    const evalCruxes = [
      evalCrux('unaddressed', B2), // ↔ crux-b (identified → agree)
      evalCrux('addressed', A2),   // ↔ crux-a (resolved → agree)
    ];

    const { cruxDivergenceRate, cruxMatchStats } = computeCruxSemanticDivergence(engine, evalCruxes, an);

    expect(cruxDivergenceRate).toBe(0);
    expect(cruxMatchStats).toMatchObject({
      matched: 2,
      engine_unmatched: 0,
      evaluator_unmatched: 0,
      match_threshold: CRUX_MATCH_SIMILARITY_THRESHOLD,
    });
    expect(cruxMatchStats!.mean_match_similarity).toBeGreaterThan(0.9);
  });

  it('counts a status disagreement on a matched pair', () => {
    const an = anWith([{ id: 'crux-a', embedding: A }]);
    const engine: RawEngineCrux[] = [{ id: 'crux-a', state: 'resolved' }];
    const evalCruxes = [evalCrux('unaddressed', A2)];

    const { cruxDivergenceRate, cruxMatchStats } = computeCruxSemanticDivergence(engine, evalCruxes, an);

    expect(cruxDivergenceRate).toBe(1);
    expect(cruxMatchStats!.matched).toBe(1);
  });

  it('treats partially_addressed as not-addressed (unchanged status semantics)', () => {
    const an = anWith([{ id: 'crux-a', embedding: A }]);
    const engine: RawEngineCrux[] = [{ id: 'crux-a', state: 'resolved' }];
    const { cruxDivergenceRate } = computeCruxSemanticDivergence(
      engine, [evalCrux('partially_addressed', A2)], an);
    expect(cruxDivergenceRate).toBe(1);
  });

  it('accepts the legacy `status` field on engine cruxes (state absent)', () => {
    const an = anWith([{ id: 'crux-a', embedding: A }]);
    const engine: RawEngineCrux[] = [{ id: 'crux-a', status: 'resolved' }];
    const { cruxDivergenceRate } = computeCruxSemanticDivergence(engine, [evalCrux('addressed', A2)], an);
    expect(cruxDivergenceRate).toBe(0);
  });

  it('matches greedily 1:1 — one evaluator crux cannot absorb two engine cruxes', () => {
    const an = anWith([{ id: 'crux-a', embedding: A }, { id: 'crux-a2', embedding: A2 }]);
    const engine: RawEngineCrux[] = [
      { id: 'crux-a', state: 'resolved' },
      { id: 'crux-a2', state: 'resolved' },
    ];
    const evalCruxes = [evalCrux('addressed', A)]; // sim 1.0 with crux-a, ~0.994 with crux-a2

    const { cruxDivergenceRate, cruxMatchStats } = computeCruxSemanticDivergence(engine, evalCruxes, an);

    expect(cruxMatchStats).toMatchObject({ matched: 1, engine_unmatched: 1, evaluator_unmatched: 0 });
    expect(cruxDivergenceRate).toBe(0);
  });

  it('reports below-threshold cruxes as unmatched coverage asymmetry, rate null', () => {
    // Orthogonal descriptions: the two instruments surfaced DIFFERENT cruxes.
    const an = anWith([{ id: 'crux-a', embedding: A }]);
    const engine: RawEngineCrux[] = [{ id: 'crux-a', state: 'resolved' }];
    const evalCruxes = [evalCrux('addressed', B)];

    const { cruxDivergenceRate, cruxMatchStats } = computeCruxSemanticDivergence(engine, evalCruxes, an);

    expect(cruxDivergenceRate).toBeNull();
    expect(cruxMatchStats).toMatchObject({
      matched: 0,
      engine_unmatched: 1,
      evaluator_unmatched: 1,
      mean_match_similarity: null,
    });
  });

  it('reads null/null when embeddings are absent — instrument-absent is not data', () => {
    // Engine cruxes with no AN embeddings, evaluator cruxes never embedded (legacy session).
    const an = anWith([{ id: 'crux-a' }]);
    const engine: RawEngineCrux[] = [{ id: 'crux-a', state: 'resolved' }];
    const evalCruxes = [evalCrux('addressed')];

    const { cruxDivergenceRate, cruxMatchStats } = computeCruxSemanticDivergence(engine, evalCruxes, an);

    expect(cruxDivergenceRate).toBeNull();
    expect(cruxMatchStats).toBeNull();
  });

  it('never compares across embedding spaces (dim mismatch → no candidates)', () => {
    const an = anWith([{ id: 'crux-a', embedding: A }]); // 4-dim
    const engine: RawEngineCrux[] = [{ id: 'crux-a', state: 'resolved' }];
    const evalCruxes = [evalCrux('addressed', [1, 0, 0])]; // 3-dim

    const { cruxDivergenceRate, cruxMatchStats } = computeCruxSemanticDivergence(engine, evalCruxes, an);

    expect(cruxDivergenceRate).toBeNull();
    expect(cruxMatchStats!.matched).toBe(0);
  });
});

// ── Integration: extraction wires the matched-pair diagnostic ──

function sessionFor(engineCruxes: RawEngineCrux[], evalCruxes: { status: string; embedding?: number[] }[],
  nodes: { id: string; embedding?: number[] }[]): DebateSession {
  return {
    id: 'debate-crux-match-test',
    topic: { original: 'test topic', final: 'test topic' },
    transcript: [],
    argument_network: anWith(nodes),
    crux_tracker: engineCruxes.map(c => ({
      description: `engine ${c.id}`,
      identified_turn: 1,
      history: [],
      attacking_claim_ids: [],
      speakers_involved: [],
      last_computed_strength: 0.5,
      support_polarity: 0,
      ...c,
    })),
    neutral_evaluations: [
      {
        checkpoint: 'final',
        timestamp: '2026-07-29T00:00:00.000Z',
        cruxes: evalCruxes.map((c, i) => ({
          id: `crux-${i}`,
          description: `crux ${i}`,
          disagreement_type: 'empirical',
          speakers_involved: ['A', 'B'],
          confidence: 'high',
          ...c,
        })),
        claims: [],
        overall_assessment: {
          strongest_unaddressed_claim_id: null,
          debate_is_engaging_real_disagreement: true,
          notes: '',
        },
      },
    ],
  } as unknown as DebateSession;
}

describe('extractCalibrationData semantic crux divergence (t/1853)', () => {
  it('emits matched-pair rate and crux_match_stats', () => {
    const session = sessionFor(
      [{ id: 'crux-a', state: 'resolved' }, { id: 'crux-b', state: 'engaged' }],
      [evalCrux('unaddressed', B2), evalCrux('addressed', A2)],
      [{ id: 'crux-a', embedding: A }, { id: 'crux-b', embedding: B }],
    );
    const dp = extractCalibrationData(session, 'test');
    expect(dp.crux_resolution_divergence_rate).toBe(0);
    expect(dp.crux_match_stats).toMatchObject({
      engine_total: 2,
      evaluator_total: 2,
      matched: 2,
      match_threshold: CRUX_MATCH_SIMILARITY_THRESHOLD,
    });
  });

  it('stays null (no stats) on legacy sessions without embeddings', () => {
    const session = sessionFor(
      [{ id: 'crux-a', state: 'resolved' }],
      [evalCrux('addressed')],
      [{ id: 'crux-a' }],
    );
    const dp = extractCalibrationData(session, 'test');
    expect(dp.crux_resolution_divergence_rate).toBeNull();
    expect(dp.crux_match_stats).toBeNull();
  });
});

// ── Evaluation-time crux embedding (the async half of t/1853) ──

describe('runNeutralEvaluation crux embeddings (t/1853)', async () => {
  const { runNeutralEvaluation } = await import('../neutralEvaluator.js');
  type AIAdapter = import('../aiAdapter.js').AIAdapter;

  const responseWithCruxes = JSON.stringify({
    checkpoint: 'final',
    timestamp: '2026-07-29T00:00:00.000Z',
    cruxes: [
      { id: 'crux-1', description: 'Does scaling continue?', disagreement_type: 'empirical', speakers_involved: ['A', 'B'], status: 'addressed', confidence: 'high' },
      { id: 'crux-2', description: 'Is openness safer?', disagreement_type: 'values', speakers_involved: ['A', 'B'], status: 'unaddressed', confidence: 'medium' },
    ],
    claims: [],
    overall_assessment: {
      strongest_unaddressed_claim_id: null,
      debate_is_engaging_real_disagreement: true,
      notes: 'test',
    },
  });

  const baseConfig = (adapter: AIAdapter) => ({
    adapter,
    topic: 'test',
    transcript: [],
    activePovers: ['accelerationist', 'safetyist'] as import('../types.js').SpeakerId[],
    model: 'test-model',
  });

  it('embeds each crux description when the adapter supports embeddings', async () => {
    const embedded: string[] = [];
    const adapter = {
      generateText: async () => responseWithCruxes,
      computeQueryEmbedding: async (text: string) => {
        embedded.push(text);
        return { vector: [0.1, 0.2, 0.3] };
      },
    } as unknown as AIAdapter;

    const evaluation = await runNeutralEvaluation('final', baseConfig(adapter));

    expect(embedded).toEqual(['Does scaling continue?', 'Is openness safer?']);
    expect(evaluation.cruxes.map(c => c.embedding)).toEqual([[0.1, 0.2, 0.3], [0.1, 0.2, 0.3]]);
  });

  it('leaves cruxes unembedded when the adapter has no embedding capability', async () => {
    const adapter = { generateText: async () => responseWithCruxes } as unknown as AIAdapter;
    const evaluation = await runNeutralEvaluation('final', baseConfig(adapter));
    expect(evaluation.cruxes.every(c => c.embedding === undefined)).toBe(true);
  });

  it('stops embedding on backend failure without failing the evaluation', async () => {
    let calls = 0;
    const adapter = {
      generateText: async () => responseWithCruxes,
      computeQueryEmbedding: async () => {
        calls++;
        throw new Error('backend down');
      },
    } as unknown as AIAdapter;

    const evaluation = await runNeutralEvaluation('final', baseConfig(adapter));

    expect(calls).toBe(1); // gave up after the first failure, no hammering
    expect(evaluation.evaluation_invalid).toBeUndefined();
    expect(evaluation.cruxes.every(c => c.embedding === undefined)).toBe(true);
  });
});
