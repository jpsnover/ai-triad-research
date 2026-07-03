// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import type { DebateSession, ConvergenceSignals, ClaimExtractionTrace } from './types.js';

// ── Standalone trigger logic (mirrors the private method for unit testing) ──

const REPETITION_THRESHOLD = 0.5;
const MIN_ROUND = 3;

function shouldTriggerDiversityRound(
  session: Pick<DebateSession, 'convergence_signals' | 'diagnostics' | 'diversity_round_fired'>,
  round: number,
  phase: string,
  enableDiversityRound: boolean,
): boolean {
  if (!enableDiversityRound) return false;
  if (phase !== 'argumentation') return false;
  if (session.diversity_round_fired != null) return false;
  if (round < MIN_ROUND) return false;

  const signals = session.convergence_signals ?? [];
  const recentSignals = signals.filter(s => s.round >= round - 1);
  if (recentSignals.length < 2) return false;
  const recycledCount = recentSignals.filter(
    s => s.argument_redundancy?.semantically_recycled === true,
  ).length;
  const repetitionRate = recycledCount / recentSignals.length;
  if (repetitionRate < REPETITION_THRESHOLD) return false;

  const diag = session.diagnostics;
  if (!diag) return false;
  const traces: { round: number; an_nodes_added_ids: string[] }[] = [];
  for (const entryDiag of Object.values(diag.entries)) {
    if (entryDiag.extraction_trace) {
      traces.push({
        round: entryDiag.extraction_trace.round,
        an_nodes_added_ids: entryDiag.extraction_trace.an_nodes_added_ids,
      });
    }
  }
  const recentTraces = traces
    .filter(t => t.round >= round - 1)
    .sort((a, b) => b.round - a.round);
  if (recentTraces.length < 2) return false;
  const noNewAN = recentTraces.slice(0, 2).every(t => t.an_nodes_added_ids.length === 0);
  if (!noNewAN) return false;

  return true;
}

// ── Helpers ──

function makeSignal(round: number, recycled: boolean): ConvergenceSignals {
  return {
    entry_id: `e-${round}`,
    round,
    speaker: 'accelerationist',
    move_polarity: { confrontational: 1, collaborative: 0, ratio: 1 },
    dialectical_engagement: { targeted: 1, standalone: 0, ratio: 1 },
    argument_redundancy: {
      avg_self_overlap: recycled ? 0.8 : 0.2,
      max_self_overlap: recycled ? 0.9 : 0.3,
      semantically_recycled: recycled,
    },
    dominant_counterargument: undefined,
    concession_opportunity: { strong_attacks_faced: 0, concession_used: false, outcome: 'no_opportunity' },
    position_drift: { overlap_with_opening: 0.8, drift: false },
    crux_engagement_rate: { used_this_turn: 0, cumulative_count: 0, cumulative_follow_through: 0 },
  } as ConvergenceSignals;
}

function makeTrace(round: number, nodesAdded: string[]): ClaimExtractionTrace {
  return {
    round,
    candidates_proposed: 3,
    candidates_accepted: nodesAdded.length,
    candidates_rejected: 3 - nodesAdded.length,
    rejection_reasons: {},
    an_node_count_before: 10,
    an_node_count_after: 10 + nodesAdded.length,
    an_nodes_added_ids: nodesAdded,
  } as ClaimExtractionTrace;
}

function makeSession(overrides: {
  signals?: ConvergenceSignals[];
  traces?: ClaimExtractionTrace[];
  diversityFired?: number;
}): Pick<DebateSession, 'convergence_signals' | 'diagnostics' | 'diversity_round_fired'> {
  const entries: Record<string, { extraction_trace?: ClaimExtractionTrace }> = {};
  for (const [i, trace] of (overrides.traces ?? []).entries()) {
    entries[`e-${i}`] = { extraction_trace: trace };
  }
  return {
    convergence_signals: overrides.signals ?? [],
    diagnostics: { entries, overview: {} } as unknown as DebateSession['diagnostics'],
    diversity_round_fired: overrides.diversityFired,
  };
}

// ── Tests ──

describe('shouldTriggerDiversityRound', () => {
  it('returns false when flag is disabled', () => {
    const session = makeSession({
      signals: [makeSignal(3, true), makeSignal(4, true)],
      traces: [makeTrace(3, []), makeTrace(4, [])],
    });
    expect(shouldTriggerDiversityRound(session, 4, 'argumentation', false)).toBe(false);
  });

  it('returns false outside argumentation phase', () => {
    const session = makeSession({
      signals: [makeSignal(3, true), makeSignal(4, true)],
      traces: [makeTrace(3, []), makeTrace(4, [])],
    });
    expect(shouldTriggerDiversityRound(session, 4, 'confrontation', true)).toBe(false);
    expect(shouldTriggerDiversityRound(session, 4, 'concluding', true)).toBe(false);
  });

  it('returns false if already fired', () => {
    const session = makeSession({
      signals: [makeSignal(3, true), makeSignal(4, true)],
      traces: [makeTrace(3, []), makeTrace(4, [])],
      diversityFired: 3,
    });
    expect(shouldTriggerDiversityRound(session, 4, 'argumentation', true)).toBe(false);
  });

  it('returns false before round 3', () => {
    const session = makeSession({
      signals: [makeSignal(1, true), makeSignal(2, true)],
      traces: [makeTrace(1, []), makeTrace(2, [])],
    });
    expect(shouldTriggerDiversityRound(session, 2, 'argumentation', true)).toBe(false);
  });

  it('returns false when repetition rate is below threshold', () => {
    const session = makeSession({
      signals: [makeSignal(3, false), makeSignal(4, true)],
      traces: [makeTrace(3, []), makeTrace(4, [])],
    });
    // 1/2 recycled = 0.5 — exactly at threshold, but need to check ≥ 0.5
    expect(shouldTriggerDiversityRound(session, 4, 'argumentation', true)).toBe(true);

    const sessionLow = makeSession({
      signals: [makeSignal(3, false), makeSignal(4, false), makeSignal(4, true)],
      traces: [makeTrace(3, []), makeTrace(4, [])],
    });
    // 1/3 recycled = 0.33 — below threshold
    expect(shouldTriggerDiversityRound(sessionLow, 4, 'argumentation', true)).toBe(false);
  });

  it('returns false when AN is still growing', () => {
    const session = makeSession({
      signals: [makeSignal(3, true), makeSignal(4, true)],
      traces: [makeTrace(3, ['AN-11']), makeTrace(4, [])],
    });
    expect(shouldTriggerDiversityRound(session, 4, 'argumentation', true)).toBe(false);
  });

  it('triggers when both conditions met: high repetition + AN plateau', () => {
    const session = makeSession({
      signals: [makeSignal(3, true), makeSignal(4, true)],
      traces: [makeTrace(3, []), makeTrace(4, [])],
    });
    expect(shouldTriggerDiversityRound(session, 4, 'argumentation', true)).toBe(true);
  });

  it('requires at least 2 recent signals', () => {
    const session = makeSession({
      signals: [makeSignal(4, true)],
      traces: [makeTrace(3, []), makeTrace(4, [])],
    });
    expect(shouldTriggerDiversityRound(session, 4, 'argumentation', true)).toBe(false);
  });

  it('requires at least 2 recent extraction traces', () => {
    const session = makeSession({
      signals: [makeSignal(3, true), makeSignal(4, true)],
      traces: [makeTrace(4, [])],
    });
    expect(shouldTriggerDiversityRound(session, 4, 'argumentation', true)).toBe(false);
  });
});

describe('DebateSession.diversity_round_fired', () => {
  it('field is optional (undefined when not fired)', () => {
    const session: Pick<DebateSession, 'diversity_round_fired'> = {};
    expect(session.diversity_round_fired).toBeUndefined();
  });

  it('stores the round number when fired', () => {
    const session: Pick<DebateSession, 'diversity_round_fired'> = { diversity_round_fired: 5 };
    expect(session.diversity_round_fired).toBe(5);
  });
});
