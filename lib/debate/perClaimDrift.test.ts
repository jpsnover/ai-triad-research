// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { cosineSimilarity } from './taxonomyRelevance.js';
import type { ClaimDriftEntry, PerClaimDriftSnapshot } from './types.js';
import { pruneSessionData } from './sessionPruning.js';
import type { DebateSession } from './types.js';

// ── Helpers ───────────────────────────────────────────────

/**
 * Mirrors the classification logic in debateEngine.trackPerClaimDrift:
 *   sim >= 0.7 → maintained
 *   0.3 <= sim < 0.7 → refined
 *   sim < 0.3 → abandoned
 */
function classifyClaim(similarity: number, concessionExempt: boolean): ClaimDriftEntry {
  let status: 'maintained' | 'refined' | 'abandoned';
  if (similarity >= 0.7) status = 'maintained';
  else if (similarity >= 0.3) status = 'refined';
  else status = 'abandoned';
  return { claim_id: '', similarity, status, concession_exempt: concessionExempt };
}

function computeSycophancyScore(entries: ClaimDriftEntry[]): number {
  const abandonedNoExcuse = entries.filter(e => e.status === 'abandoned' && !e.concession_exempt);
  return abandonedNoExcuse.length / entries.length;
}

/** Create a unit vector with a given angle (in radians) from [1, 0, 0, ...] */
function makeVector(angle: number, dims = 8): number[] {
  const v = new Array(dims).fill(0);
  v[0] = Math.cos(angle);
  v[1] = Math.sin(angle);
  return v;
}

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

// ── Per-claim drift classification ───────────────────────

describe('per-claim drift classification', () => {
  it('classifies high similarity as maintained', () => {
    const entry = classifyClaim(0.85, false);
    expect(entry.status).toBe('maintained');
  });

  it('classifies boundary 0.7 as maintained', () => {
    const entry = classifyClaim(0.7, false);
    expect(entry.status).toBe('maintained');
  });

  it('classifies mid similarity as refined', () => {
    const entry = classifyClaim(0.5, false);
    expect(entry.status).toBe('refined');
  });

  it('classifies boundary 0.3 as refined', () => {
    const entry = classifyClaim(0.3, false);
    expect(entry.status).toBe('refined');
  });

  it('classifies low similarity as abandoned', () => {
    const entry = classifyClaim(0.1, false);
    expect(entry.status).toBe('abandoned');
  });

  it('uses cosine similarity correctly with controlled vectors', () => {
    const base = makeVector(0);
    // Same direction → sim = 1.0
    expect(cosineSimilarity(base, makeVector(0))).toBeCloseTo(1.0, 2);
    // Small angle (~0.3 rad) → sim ~ 0.955 → maintained
    expect(cosineSimilarity(base, makeVector(0.3))).toBeGreaterThan(0.7);
    // Large angle (~1.2 rad) → sim ~ 0.362 → refined
    const sim12 = cosineSimilarity(base, makeVector(1.2));
    expect(sim12).toBeGreaterThanOrEqual(0.3);
    expect(sim12).toBeLessThan(0.7);
    // Near orthogonal (~1.4 rad) → sim ~ 0.17 → abandoned
    expect(cosineSimilarity(base, makeVector(1.4))).toBeLessThan(0.3);
  });
});

// ── Sycophancy scoring ──────────────────────────────────

describe('per-claim sycophancy scoring', () => {
  it('does not fire when one claim is refined but others maintained', () => {
    // 4 opening claims: 1 drops to sim=0.4 (refined), 3 stay above 0.7
    const entries: ClaimDriftEntry[] = [
      { claim_id: 'c1', similarity: 0.85, status: 'maintained', concession_exempt: false },
      { claim_id: 'c2', similarity: 0.75, status: 'maintained', concession_exempt: false },
      { claim_id: 'c3', similarity: 0.4, status: 'refined', concession_exempt: false },
      { claim_id: 'c4', similarity: 0.72, status: 'maintained', concession_exempt: false },
    ];
    const score = computeSycophancyScore(entries);
    expect(score).toBe(0); // 0 abandoned → score = 0
    expect(score).toBeLessThanOrEqual(0.5); // guard would not fire
  });

  it('fires when >50% claims abandoned without concession', () => {
    // 4 opening claims: 3 drop below 0.3, no concessions
    const entries: ClaimDriftEntry[] = [
      { claim_id: 'c1', similarity: 0.1, status: 'abandoned', concession_exempt: false },
      { claim_id: 'c2', similarity: 0.05, status: 'abandoned', concession_exempt: false },
      { claim_id: 'c3', similarity: 0.2, status: 'abandoned', concession_exempt: false },
      { claim_id: 'c4', similarity: 0.72, status: 'maintained', concession_exempt: false },
    ];
    const score = computeSycophancyScore(entries);
    expect(score).toBe(0.75); // 3/4 abandoned
    expect(score).toBeGreaterThan(0.5); // guard fires
  });

  it('exempts claims with explicit concessions from sycophancy scoring', () => {
    // 4 opening claims: 3 drop below 0.3, but 2 have concessions
    const entries: ClaimDriftEntry[] = [
      { claim_id: 'c1', similarity: 0.1, status: 'abandoned', concession_exempt: true },
      { claim_id: 'c2', similarity: 0.05, status: 'abandoned', concession_exempt: true },
      { claim_id: 'c3', similarity: 0.2, status: 'abandoned', concession_exempt: false },
      { claim_id: 'c4', similarity: 0.72, status: 'maintained', concession_exempt: false },
    ];
    const score = computeSycophancyScore(entries);
    expect(score).toBe(0.25); // only 1/4 abandoned without concession
    expect(score).toBeLessThanOrEqual(0.5); // guard does NOT fire
  });

  it('scores 0 when all claims are maintained', () => {
    const entries: ClaimDriftEntry[] = [
      { claim_id: 'c1', similarity: 0.9, status: 'maintained', concession_exempt: false },
      { claim_id: 'c2', similarity: 0.8, status: 'maintained', concession_exempt: false },
    ];
    expect(computeSycophancyScore(entries)).toBe(0);
  });

  it('scores 1.0 when all claims abandoned without concession', () => {
    const entries: ClaimDriftEntry[] = [
      { claim_id: 'c1', similarity: 0.1, status: 'abandoned', concession_exempt: false },
      { claim_id: 'c2', similarity: 0.05, status: 'abandoned', concession_exempt: false },
    ];
    expect(computeSycophancyScore(entries)).toBe(1.0);
  });
});

// ── Session pruning for per_claim_drift ─────────────────

describe('pruneSessionData — per_claim_drift', () => {
  function makeSnapshot(round: number): PerClaimDriftSnapshot {
    return {
      round,
      speaker: 'prometheus',
      claims: [{ claim_id: `c-${round}`, similarity: 0.8, status: 'maintained', concession_exempt: false }],
      sycophancy_score: 0,
    };
  }

  it('does not prune when under limit', () => {
    const session = makeMinimalSession({
      per_claim_drift: [makeSnapshot(1), makeSnapshot(2)],
    });
    pruneSessionData(session);
    expect(session.per_claim_drift).toHaveLength(2);
  });

  it('prunes per_claim_drift to last 30', () => {
    const snapshots = Array.from({ length: 40 }, (_, i) => makeSnapshot(i));
    const session = makeMinimalSession({ per_claim_drift: snapshots });
    pruneSessionData(session);
    expect(session.per_claim_drift).toHaveLength(30);
    expect(session.per_claim_drift![0].round).toBe(10);
    expect(session.per_claim_drift![29].round).toBe(39);
  });

  it('does nothing when per_claim_drift is undefined', () => {
    const session = makeMinimalSession();
    pruneSessionData(session);
    expect(session.per_claim_drift).toBeUndefined();
  });
});
