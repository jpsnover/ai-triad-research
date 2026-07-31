// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  computeFrameSurvivalMetrics,
  FRAME_PRESENCE_THRESHOLD,
  FRAME_LINK_THRESHOLD,
} from './extract-metrics.js';
import type { DebateSession } from '../types.js';
import type { NeutralEvaluation } from '../neutralEvaluator.js';

type ArgNetwork = DebateSession['argument_network'];

// ── Fixture helpers ──────────────────────────────────────────────────────────

function unitVec(dim: number, hotIndex: number): number[] {
  const v = new Array<number>(dim).fill(0);
  v[hotIndex] = 1;
  return v;
}

function makeSession(overrides: Partial<DebateSession> = {}): DebateSession {
  return {
    id: 'test-debate',
    phase: 'synthesis',
    topic: { title: 'Test', scope: null },
    transcript: [],
    argument_network: { nodes: [], edges: [] },
    neutral_evaluations: [],
    ...overrides,
  } as unknown as DebateSession;
}

function emptyAn(): ArgNetwork {
  return { nodes: [], edges: [] } as unknown as ArgNetwork;
}

// ── Happy path: 2 speakers × 2 frames, 3 statement turns each ───────────────

describe('computeFrameSurvivalMetrics — happy path', () => {
  // acc: frame0, frame1; saf: frame0, frame1
  // Statement entries: e1,e2,e3 (acc) + e4,e5,e6 (saf)
  // Similarity values are set directly in frame_similarity_series (no embedding calls)
  const transcript = [
    { id: 'open-acc', type: 'opening', speaker: 'acc', content: '' },
    { id: 'open-saf', type: 'opening', speaker: 'saf', content: '' },
    { id: 'e1', type: 'statement', speaker: 'acc', content: '' },
    { id: 'e2', type: 'statement', speaker: 'acc', content: '' },
    { id: 'e3', type: 'statement', speaker: 'acc', content: '' },
    { id: 'e4', type: 'statement', speaker: 'saf', content: '' },
    { id: 'e5', type: 'statement', speaker: 'saf', content: '' },
    { id: 'e6', type: 'statement', speaker: 'saf', content: '' },
  ];

  const frame_embeddings = {
    acc: { model: 'all-MiniLM-L6-v2', dim: 384, frames: [
      { frame: 'acc-f0', embedding: unitVec(384, 0) },
      { frame: 'acc-f1', embedding: unitVec(384, 1) },
    ]},
    saf: { model: 'all-MiniLM-L6-v2', dim: 384, frames: [
      { frame: 'saf-f0', embedding: unitVec(384, 2) },
      { frame: 'saf-f1', embedding: unitVec(384, 3) },
    ]},
  };

  // acc frame0 (T_acc=e1,e2,e3): present in e1(0.6), e3(0.7) → 2/3
  // acc frame1 (T_acc=e1,e2,e3): present in e1(0.5), e2(0.6), e3(0.6) → 3/3 = 1.0
  // persistence_acc = (2/3 + 1.0) / 2 ≈ 0.833
  //
  // saf frame0 (T_saf=e4,e5,e6): present in e4(0.7), e5(0.8), e6(0.9) → 3/3 = 1.0
  // saf frame1 (T_saf=e4,e5,e6): none ≥ 0.5 → 0/3 = 0
  // persistence_saf = (1.0 + 0.0) / 2 = 0.5
  //
  // frame_survival = (0.833 + 0.5) / 2 ≈ 0.667
  //
  // acc engagement (T_¬acc=e4,e5,e6):
  //   frame0: e4(0.55), e6(0.8) present → 2/3; frame1: e6(0.9) → 1/3
  //   engagement_acc = (2/3 + 1/3) / 2 = 0.5
  //
  // saf engagement (T_¬saf=e1,e2,e3):
  //   frame0: all ≥ 0.5 → 3/3; frame1: none → 0/3
  //   engagement_saf = (1.0 + 0.0) / 2 = 0.5
  const frame_similarity_series = {
    acc: [
      { frame: 'acc-f0', sims: { e1: 0.6, e2: 0.3, e3: 0.7, e4: 0.55, e5: 0.2, e6: 0.8 } },
      { frame: 'acc-f1', sims: { e1: 0.5, e2: 0.6, e3: 0.6, e4: 0.1, e5: 0.0, e6: 0.9 } },
    ],
    saf: [
      { frame: 'saf-f0', sims: { e1: 0.7, e2: 0.8, e3: 0.6, e4: 0.7, e5: 0.8, e6: 0.9 } },
      { frame: 'saf-f1', sims: { e1: 0.3, e2: 0.2, e3: 0.4, e4: 0.3, e5: 0.4, e6: 0.2 } },
    ],
  };

  const session = makeSession({ transcript: transcript as any, frame_embeddings, frame_similarity_series });

  it('frames_declared_per_speaker counts frames', () => {
    const r = computeFrameSurvivalMetrics(session, undefined, emptyAn());
    expect(r.framesDeclaredPerSpeaker).toEqual({ acc: 2, saf: 2 });
  });

  it('frame_persistence_per_speaker computes per-speaker mean fraction', () => {
    const r = computeFrameSurvivalMetrics(session, undefined, emptyAn());
    // acc: (2/3 + 1) / 2
    expect(r.framePersistencePerSpeaker.acc).toBeCloseTo((2 / 3 + 1) / 2, 6);
    // saf: (1 + 0) / 2 = 0.5
    expect(r.framePersistencePerSpeaker.saf).toBeCloseTo(0.5, 6);
  });

  it('frame_engagement_per_speaker computes per-speaker mean fraction over opponents', () => {
    const r = computeFrameSurvivalMetrics(session, undefined, emptyAn());
    expect(r.frameEngagementPerSpeaker.acc).toBeCloseTo(0.5, 6);
    expect(r.frameEngagementPerSpeaker.saf).toBeCloseTo(0.5, 6);
  });

  it('frame_survival is unweighted mean of non-null persistence values', () => {
    const r = computeFrameSurvivalMetrics(session, undefined, emptyAn());
    const expected = ((2 / 3 + 1) / 2 + 0.5) / 2;
    expect(r.frameSurvival).toBeCloseTo(expected, 6);
  });

  it('frame_reframe_targeted_count is 0 when no REFRAME edges', () => {
    const r = computeFrameSurvivalMetrics(session, undefined, emptyAn());
    expect(r.frameReframeTargetedCount).toBe(0);
  });

  it('frame_crux_alignment is null when no finalEval', () => {
    const r = computeFrameSurvivalMetrics(session, undefined, emptyAn());
    expect(r.frameCruxAlignment).toBeNull();
  });
});

// ── Null paths ───────────────────────────────────────────────────────────────

describe('computeFrameSurvivalMetrics — null paths', () => {
  it('returns empty dicts and nulls when no frame_embeddings', () => {
    const session = makeSession({ transcript: [] as any });
    const r = computeFrameSurvivalMetrics(session, undefined, emptyAn());
    expect(r.framesDeclaredPerSpeaker).toEqual({});
    expect(r.framePersistencePerSpeaker).toEqual({});
    expect(r.frameEngagementPerSpeaker).toEqual({});
    expect(r.frameCruxAlignment).toBeNull();
    expect(r.frameReframeTargetedCount).toBeUndefined();
    expect(r.frameSurvival).toBeNull();
  });

  it('persistence is null when speaker has fewer than 2 post-opening statement turns', () => {
    // acc has only 1 statement turn → persistence = null
    const transcript = [
      { id: 'open-acc', type: 'opening', speaker: 'acc', content: '' },
      { id: 'e1', type: 'statement', speaker: 'acc', content: '' }, // only 1
      { id: 'e2', type: 'statement', speaker: 'saf', content: '' },
      { id: 'e3', type: 'statement', speaker: 'saf', content: '' },
    ];
    const frame_similarity_series = {
      acc: [{ frame: 'f0', sims: { e1: 0.9, e2: 0.9, e3: 0.9 } }],
      saf: [{ frame: 'g0', sims: { e1: 0.9, e2: 0.9, e3: 0.9 } }],
    };
    const frame_embeddings = {
      acc: { model: 'all-MiniLM-L6-v2', dim: 384, frames: [{ frame: 'f0', embedding: unitVec(384, 0) }] },
      saf: { model: 'all-MiniLM-L6-v2', dim: 384, frames: [{ frame: 'g0', embedding: unitVec(384, 1) }] },
    };
    const session = makeSession({ transcript: transcript as any, frame_embeddings, frame_similarity_series });
    const r = computeFrameSurvivalMetrics(session, undefined, emptyAn());
    expect(r.framePersistencePerSpeaker.acc).toBeNull();
    expect(r.framePersistencePerSpeaker.saf).not.toBeNull(); // saf has 2 turns
  });

  it('persistence is null when frame_similarity_series missing for speaker', () => {
    const transcript = [
      { id: 'e1', type: 'statement', speaker: 'acc', content: '' },
      { id: 'e2', type: 'statement', speaker: 'acc', content: '' },
      { id: 'e3', type: 'statement', speaker: 'acc', content: '' },
    ];
    const frame_embeddings = {
      acc: { model: 'all-MiniLM-L6-v2', dim: 384, frames: [{ frame: 'f0', embedding: unitVec(384, 0) }] },
    };
    // No frame_similarity_series set at all
    const session = makeSession({ transcript: transcript as any, frame_embeddings });
    const r = computeFrameSurvivalMetrics(session, undefined, emptyAn());
    expect(r.framePersistencePerSpeaker.acc).toBeNull();
    expect(r.frameSurvival).toBeNull();
  });

  it('dimension mismatch: sims stored as 0 when embedding dims differ (cosineSim returns null)', () => {
    // This tests the null-safe path: if sims were computed with 0 (dim-mismatch fallback),
    // they're below FRAME_PRESENCE_THRESHOLD and frames read as not present.
    const transcript = [
      { id: 'e1', type: 'statement', speaker: 'acc', content: '' },
      { id: 'e2', type: 'statement', speaker: 'acc', content: '' },
      { id: 'e3', type: 'statement', speaker: 'acc', content: '' },
    ];
    const frame_embeddings = {
      acc: { model: 'all-MiniLM-L6-v2', dim: 384, frames: [{ frame: 'f0', embedding: unitVec(384, 0) }] },
    };
    // All sims = 0 (as if dim-mismatch skipped every paragraph)
    const frame_similarity_series = {
      acc: [{ frame: 'f0', sims: { e1: 0, e2: 0, e3: 0 } }],
    };
    const session = makeSession({ transcript: transcript as any, frame_embeddings, frame_similarity_series });
    const r = computeFrameSurvivalMetrics(session, undefined, emptyAn());
    expect(r.framePersistencePerSpeaker.acc).toBe(0); // 0/3 = 0.0 (NOT null — data present, frame just absent)
    expect(r.frameSurvival).toBe(0);
  });

  it('excludes unmeasured turns from persistence denominator (partial embed failure)', () => {
    // e2 has no sims entry (embedding failed) — must not count in denominator
    const transcript = [
      { id: 'e1', type: 'statement', speaker: 'acc', content: '' },
      { id: 'e2', type: 'statement', speaker: 'acc', content: '' }, // unmeasured
      { id: 'e3', type: 'statement', speaker: 'acc', content: '' },
    ];
    const frame_embeddings = {
      acc: { model: 'all-MiniLM-L6-v2', dim: 384, frames: [{ frame: 'f0', embedding: unitVec(384, 0) }] },
    };
    // e2 absent from sims (failed); e1, e3 both above threshold
    const frame_similarity_series = {
      acc: [{ frame: 'f0', sims: { e1: 0.8, e3: 0.7 } }],
    };
    const session = makeSession({ transcript: transcript as any, frame_embeddings, frame_similarity_series });
    const r = computeFrameSurvivalMetrics(session, undefined, emptyAn());
    // measured turns: e1, e3 → 2 present / 2 measured = 1.0 (not 2/3 = 0.667)
    expect(r.framePersistencePerSpeaker.acc).toBeCloseTo(1.0, 6);
  });
});

// ── REFRAME targeting ────────────────────────────────────────────────────────

describe('computeFrameSurvivalMetrics — REFRAME link', () => {
  const transcript = [
    { id: 'open-acc', type: 'opening', speaker: 'acc', content: '' },
    { id: 'e1', type: 'statement', speaker: 'saf', content: '' },
  ];
  const frame_embeddings = {
    acc: { model: 'all-MiniLM-L6-v2', dim: 384, frames: [
      { frame: 'f0', embedding: unitVec(384, 0) }, // cosine 1.0 with hotIndex=0 node
    ]},
  };
  const frame_similarity_series = {
    acc: [{ frame: 'f0', sims: { e1: 0.6 } }],
  };

  function makeAn(nodeEmbedding: number[], edgeScheme: string): ArgNetwork {
    return {
      nodes: [{
        id: 'acc-b-001',
        text: 'claim',
        speaker: 'acc',
        source_entry_id: 'open-acc', // originates from opening
        taxonomy_refs: [],
        turn_number: 0,
        embedding: nodeEmbedding,
      }],
      edges: [{
        id: 'edge-1',
        source: 'saf-b-001',
        target: 'acc-b-001',
        type: 'attacks',
        scheme: edgeScheme,
      }],
    } as unknown as ArgNetwork;
  }

  it('counts REFRAME edge targeting frame-linked opening node (cosine >= FRAME_LINK_THRESHOLD)', () => {
    // Frame vec and node vec are both unitVec(384, 0) → cosine = 1.0 ≥ 0.60
    const an = makeAn(unitVec(384, 0), 'REFRAME');
    const session = makeSession({ transcript: transcript as any, frame_embeddings, frame_similarity_series });
    const r = computeFrameSurvivalMetrics(session, undefined, an);
    expect(r.frameReframeTargetedCount).toBe(1);
  });

  it('does not count REFRAME edge when cosine < FRAME_LINK_THRESHOLD', () => {
    // Node embedding orthogonal to frame → cosine = 0 < 0.60
    const an = makeAn(unitVec(384, 5), 'REFRAME');
    const session = makeSession({ transcript: transcript as any, frame_embeddings, frame_similarity_series });
    const r = computeFrameSurvivalMetrics(session, undefined, an);
    expect(r.frameReframeTargetedCount).toBe(0);
  });

  it('does not count non-REFRAME edge even if frame-linked', () => {
    const an = makeAn(unitVec(384, 0), 'REBUT'); // same cosine but wrong scheme
    const session = makeSession({ transcript: transcript as any, frame_embeddings, frame_similarity_series });
    const r = computeFrameSurvivalMetrics(session, undefined, an);
    expect(r.frameReframeTargetedCount).toBe(0);
  });

  it('does not count REFRAME targeting a non-opening node', () => {
    // source_entry_id points to a statement entry, not an opening
    const anWithStatementNode: ArgNetwork = {
      nodes: [{
        id: 'acc-b-001',
        text: 'claim',
        speaker: 'acc',
        source_entry_id: 'e1', // statement, not opening
        taxonomy_refs: [],
        turn_number: 1,
        embedding: unitVec(384, 0),
      }],
      edges: [{
        id: 'edge-1',
        source: 'saf-b-001',
        target: 'acc-b-001',
        type: 'attacks',
        scheme: 'REFRAME',
      }],
    } as unknown as ArgNetwork;
    const session = makeSession({ transcript: transcript as any, frame_embeddings, frame_similarity_series });
    const r = computeFrameSurvivalMetrics(session, undefined, anWithStatementNode);
    expect(r.frameReframeTargetedCount).toBe(0);
  });
});

// ── frame_crux_alignment ─────────────────────────────────────────────────────

describe('computeFrameSurvivalMetrics — frame_crux_alignment', () => {
  const transcript = [
    { id: 'e1', type: 'statement', speaker: 'acc', content: '' },
    { id: 'e2', type: 'statement', speaker: 'acc', content: '' },
    { id: 'e3', type: 'statement', speaker: 'acc', content: '' },
  ];
  const frame_embeddings = {
    acc: { model: 'all-MiniLM-L6-v2', dim: 384, frames: [
      { frame: 'f0', embedding: unitVec(384, 0) },
    ]},
  };
  const frame_similarity_series = {
    acc: [{ frame: 'f0', sims: { e1: 0.7, e2: 0.6, e3: 0.8 } }],
  };

  function makeEval(cruxes: Array<{ embedding?: number[] }>): NeutralEvaluation {
    return {
      checkpoint: 'final',
      timestamp: '',
      cruxes: cruxes.map((c, i) => ({
        id: `c${i}`,
        description: 'test crux',
        disagreement_type: 'empirical',
        speakers_involved: ['acc', 'saf'],
        status: 'unaddressed',
        confidence: 'high',
        ...c,
      })),
      claims: [],
      overall_assessment: { strongest_unaddressed_claim_id: null, debate_is_engaging_real_disagreement: true, notes: '' },
    } as NeutralEvaluation;
  }

  it('computes fraction of cruxes aligned with any declared frame', () => {
    // crux0: cosine 1.0 with acc-f0 → aligned; crux1: orthogonal → not aligned
    const finalEval = makeEval([
      { embedding: unitVec(384, 0) }, // cosine 1.0 ≥ 0.50
      { embedding: unitVec(384, 5) }, // cosine 0.0 < 0.50
    ]);
    const session = makeSession({ transcript: transcript as any, frame_embeddings, frame_similarity_series });
    const r = computeFrameSurvivalMetrics(session, finalEval, emptyAn());
    expect(r.frameCruxAlignment).toBeCloseTo(0.5, 6); // 1 of 2 aligned
  });

  it('returns null when finalEval is undefined', () => {
    const session = makeSession({ transcript: transcript as any, frame_embeddings, frame_similarity_series });
    const r = computeFrameSurvivalMetrics(session, undefined, emptyAn());
    expect(r.frameCruxAlignment).toBeNull();
  });

  it('returns null when no crux has embeddings', () => {
    const finalEval = makeEval([{}, {}]); // no embedding field
    const session = makeSession({ transcript: transcript as any, frame_embeddings, frame_similarity_series });
    const r = computeFrameSurvivalMetrics(session, finalEval, emptyAn());
    expect(r.frameCruxAlignment).toBeNull();
  });

  it('returns null when evaluation_invalid is true', () => {
    const finalEval = { ...makeEval([{ embedding: unitVec(384, 0) }]), evaluation_invalid: true };
    const session = makeSession({ transcript: transcript as any, frame_embeddings, frame_similarity_series });
    const r = computeFrameSurvivalMetrics(session, finalEval as NeutralEvaluation, emptyAn());
    expect(r.frameCruxAlignment).toBeNull();
  });
});

// ── Threshold sentinel: constants match the spec ─────────────────────────────

describe('threshold constants', () => {
  it('FRAME_PRESENCE_THRESHOLD is 0.50', () => {
    expect(FRAME_PRESENCE_THRESHOLD).toBe(0.50);
  });
  it('FRAME_LINK_THRESHOLD is 0.60', () => {
    expect(FRAME_LINK_THRESHOLD).toBe(0.60);
  });
});
