// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { pruneSessionData, pruneModeratorState } from './sessionPruning.js';
import type { DebateSession, ModeratorState, ConvergenceSignals, DebateHealthScore } from './types.js';

function makeMinimalSession(overrides: Partial<DebateSession> = {}): DebateSession {
  return {
    id: 'test-session',
    title: 'Test',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    phase: 'debate',
    topic: { original: 'test', refined: null, final: 'test' },
    source_type: 'topic',
    source_ref: '',
    source_content: '',
    povers: [],
    transcript: [],
    ...overrides,
  } as DebateSession;
}

function makeSignal(round: number): ConvergenceSignals {
  return {
    entry_id: `entry-${round}`,
    round,
    speaker: 'prometheus',
    move_disposition: { confrontational: 1, collaborative: 0, ratio: 1 },
    engagement_depth: { targeted: 1, standalone: 0, ratio: 1 },
    recycling_rate: { avg_self_overlap: 0.1, max_self_overlap: 0.2 },
    strongest_opposing: null,
    concession_opportunity: { strong_attacks_faced: 0, concession_used: false, outcome: 'none' },
    position_delta: { overlap_with_opening: 0.8, drift: 0.2 },
    crux_rate: { used_this_turn: false, cumulative_count: 0, cumulative_follow_through: 0 },
  };
}

function makeHealthScore(value: number): DebateHealthScore {
  return { value, trend: 0, consecutive_decline: 0, components: {} } as DebateHealthScore;
}

describe('pruneSessionData', () => {
  it('does nothing when fields are under limits', () => {
    const session = makeMinimalSession({
      convergence_signals: [makeSignal(1), makeSignal(2)],
      position_drift: [{ round: 1, speaker: 'prometheus', self_similarity: 0.9, opponent_similarities: {} }],
    });
    pruneSessionData(session);
    expect(session.convergence_signals).toHaveLength(2);
    expect(session.position_drift).toHaveLength(1);
  });

  it('does nothing when fields are undefined', () => {
    const session = makeMinimalSession();
    pruneSessionData(session);
    expect(session.convergence_signals).toBeUndefined();
    expect(session.position_drift).toBeUndefined();
    expect(session.turn_embeddings).toBeUndefined();
  });

  it('prunes convergence_signals to last 30', () => {
    const signals = Array.from({ length: 50 }, (_, i) => makeSignal(i));
    const session = makeMinimalSession({ convergence_signals: signals });
    pruneSessionData(session);
    expect(session.convergence_signals).toHaveLength(30);
    expect(session.convergence_signals![0].round).toBe(20);
    expect(session.convergence_signals![29].round).toBe(49);
  });

  it('prunes position_drift to last 30', () => {
    const drift = Array.from({ length: 40 }, (_, i) => ({
      round: i, speaker: 'prometheus' as const, self_similarity: 0.9, opponent_similarities: {},
    }));
    const session = makeMinimalSession({ position_drift: drift });
    pruneSessionData(session);
    expect(session.position_drift).toHaveLength(30);
    expect(session.position_drift![0].round).toBe(10);
  });

  it('prunes turn_embeddings to keep only recent transcript entries', () => {
    const transcript = Array.from({ length: 30 }, (_, i) => ({
      id: `entry-${i}`, type: 'statement' as const, speaker: 'prometheus' as const,
      content: `Turn ${i}`, taxonomy_refs: [], timestamp: '2026-01-01T00:00:00Z',
    }));
    const embeddings: Record<string, number[]> = {};
    for (let i = 0; i < 30; i++) embeddings[`entry-${i}`] = [0.1, 0.2, 0.3];

    const session = makeMinimalSession({ transcript, turn_embeddings: embeddings });
    pruneSessionData(session);

    const remaining = Object.keys(session.turn_embeddings!);
    expect(remaining.length).toBe(20);
    expect(remaining).toContain('entry-29');
    expect(remaining).toContain('entry-10');
    expect(remaining).not.toContain('entry-9');
  });

  it('prunes diagnostic entries to keep only recent transcript entries', () => {
    const transcript = Array.from({ length: 25 }, (_, i) => ({
      id: `entry-${i}`, type: 'statement' as const, speaker: 'prometheus' as const,
      content: `Turn ${i}`, taxonomy_refs: [], timestamp: '2026-01-01T00:00:00Z',
    }));
    const entries: Record<string, { prompt?: string }> = {};
    for (let i = 0; i < 25; i++) entries[`entry-${i}`] = { prompt: `prompt-${i}` };

    const session = makeMinimalSession({
      transcript,
      diagnostics: { enabled: true, entries, overview: {} as any },
    });
    pruneSessionData(session);

    const remaining = Object.keys(session.diagnostics!.entries);
    expect(remaining.length).toBe(15);
    expect(remaining).toContain('entry-24');
    expect(remaining).toContain('entry-10');
    expect(remaining).not.toContain('entry-9');
  });
});

describe('pruneModeratorState', () => {
  it('does nothing when health_history is under limit', () => {
    const state = { health_history: [makeHealthScore(0.8)] } as ModeratorState;
    pruneModeratorState(state);
    expect(state.health_history).toHaveLength(1);
  });

  it('prunes health_history to last 20', () => {
    const history = Array.from({ length: 30 }, (_, i) => makeHealthScore(0.5 + i * 0.01));
    const state = { health_history: history } as ModeratorState;
    pruneModeratorState(state);
    expect(state.health_history).toHaveLength(20);
    expect(state.health_history[0].value).toBeCloseTo(0.6);
    expect(state.health_history[19].value).toBeCloseTo(0.79);
  });
});
