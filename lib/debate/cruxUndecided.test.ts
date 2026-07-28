// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Tests for the `undecided` crux terminal verdict (t/1676). Covers CL AC1 (undecided is a
// valid terminal state, set end-to-end), AC2 (sufficiency gate — a crux both sides engaged is
// NOT closed undecided), AC3 (crux_undecided_rate in the calibration log; crux_addressed_rate
// denominator excludes undecided), and TL guards 1 (idempotent sweep) / 3 (exhaustiveness).

import { describe, it, expect } from 'vitest';
import {
  finalizeUndecidedCruxes,
  isTerminalCruxState,
  wasCruxAdjudicated,
} from './cruxResolution.js';
import { extractExplorationSummary } from './explorationSummary.js';
import { extractCalibrationData } from './calibrationLogger.js';
import type {
  DebateSession,
  TrackedCrux,
  CruxResolutionState,
  ArgumentNetworkNode,
  TranscriptEntry,
} from './types.js';

// ── Factories ────────────────────────────────────────────

function makeCrux(overrides: Partial<TrackedCrux> = {}): TrackedCrux {
  return {
    id: 'crux-1',
    description: 'Does increased capability necessarily increase risk?',
    identified_turn: 2,
    state: 'engaged',
    history: [],
    disagreement_type: 'empirical',
    attacking_claim_ids: ['AN-1'],
    speakers_involved: ['accelerationist', 'safetyist'],
    last_computed_strength: 0.7,
    support_polarity: -0.3,
    ...overrides,
  };
}

function makeSession(overrides: Partial<DebateSession> = {}): DebateSession {
  return {
    id: 'test-debate',
    title: 'Test debate',
    created_at: '2026-07-27T00:00:00Z',
    updated_at: '2026-07-27T01:00:00Z',
    phase: 'closed',
    topic: { original: 'AI policy', refined: null, final: 'AI policy' },
    source_type: 'topic',
    source_ref: '',
    source_content: '',
    active_povers: ['accelerationist', 'safetyist', 'skeptic'],
    user_is_pover: false,
    transcript: [],
    context_summaries: [],
    debate_model: 'gemini-2.5-flash',
    ...overrides,
  } as unknown as DebateSession;
}

// AN node standing in for a crux proposition, anchored to `taxonomyRefs` (t/1818 signal A).
function makeCruxNode(id: string, taxonomyRefs: string[]): ArgumentNetworkNode {
  return {
    id,
    text: `crux proposition ${id}`,
    speaker: 'accelerationist',
    source_entry_id: 'e0',
    taxonomy_refs: taxonomyRefs,
    turn_number: 2,
  };
}

// Transcript turn by `speaker` referencing taxonomy nodes `refNodeIds` (TaxonomyRef.node_id).
function makeTurn(
  speaker: TranscriptEntry['speaker'],
  refNodeIds: string[],
  id = `turn-${speaker}`,
): TranscriptEntry {
  return {
    id,
    timestamp: '2026-07-27T00:00:00Z',
    type: 'statement',
    speaker,
    content: `content by ${speaker}`,
    taxonomy_refs: refNodeIds.map((node_id) => ({ node_id, relevance: 'primary' })),
  };
}

// ── AC1 + guard 1: the finalization sweep sets the literal terminal state ──

describe('finalizeUndecidedCruxes (t/1676)', () => {
  it('transitions a surfaced-but-never-cross-engaged (identified) crux to terminal undecided', () => {
    // No AN node / transcript ⇒ signal A has no engagement evidence ⇒ not adjudicated ⇒ undecided.
    const out = finalizeUndecidedCruxes([makeCrux({ id: 'c1', state: 'identified' })], 7, [], [], []);
    expect(out[0].state).toBe('undecided');
    // Literal state carries an audit transition so consumers read it, not re-derive it.
    const last = out[0].history[out[0].history.length - 1];
    expect(last).toMatchObject({ from: 'identified', to: 'undecided', turn: 7 });
  });

  it('AC2 sufficiency gate — a crux both sides engaged is NOT closed undecided', () => {
    // engaged / one_side_conceded / resolved / irreducible all imply the crux WAS adjudicated
    // (both sides engaged the proposition), so none may become undecided.
    const adjudicated: CruxResolutionState[] = ['engaged', 'one_side_conceded', 'resolved', 'irreducible'];
    for (const state of adjudicated) {
      const out = finalizeUndecidedCruxes([makeCrux({ id: `c-${state}`, state })], 9, [], [], []);
      expect(out[0].state).toBe(state);
    }
  });

  it('guard 1 — idempotent: re-finalizing an already-undecided tracker is a no-op', () => {
    const once = finalizeUndecidedCruxes([makeCrux({ id: 'c1', state: 'identified' })], 5, [], [], []);
    const twice = finalizeUndecidedCruxes(once, 6, [], [], []);
    expect(twice[0].state).toBe('undecided');
    // No second transition appended — the crux was no longer `identified` on the re-run.
    expect(twice[0].history).toHaveLength(once[0].history.length);
  });

  it('handles empty / undefined trackers', () => {
    expect(finalizeUndecidedCruxes(undefined, 1, [], [], [])).toEqual([]);
    expect(finalizeUndecidedCruxes([], 1, [], [], [])).toEqual([]);
  });
});

// ── t/1818: engagement gate replaces the bare `identified` proxy ──

describe('finalizeUndecidedCruxes engagement gate (t/1818, Option 1 / signal A)', () => {
  const cruxId = 'crux-adj';
  const nodes = [makeCruxNode(cruxId, ['tax-1'])];
  const bothCamps = ['accelerationist', 'safetyist'];

  it('leaves an adjudicated identified crux as identified (≥2 involved camps engaged the proposition)', () => {
    const transcript = [makeTurn('accelerationist', ['tax-1']), makeTurn('safetyist', ['tax-1'])];
    const crux = makeCrux({ id: cruxId, state: 'identified', speakers_involved: bothCamps });
    const out = finalizeUndecidedCruxes([crux], 12, nodes, [], transcript);
    expect(out[0].state).toBe('identified');
    expect(out[0].history).toHaveLength(0); // no transition appended — status-quo-ante
  });

  it('marks undecided when only one involved camp engaged the proposition', () => {
    // safetyist's turn shares no taxonomy_ref with the crux node → only acc engaged.
    const transcript = [makeTurn('accelerationist', ['tax-1']), makeTurn('safetyist', ['tax-other'])];
    const crux = makeCrux({ id: cruxId, state: 'identified', speakers_involved: bothCamps });
    const out = finalizeUndecidedCruxes([crux], 12, nodes, [], transcript);
    expect(out[0].state).toBe('undecided');
  });

  it('marks undecided when the crux node has no taxonomy anchor (signal A has no basis)', () => {
    const bareNodes = [makeCruxNode(cruxId, [])];
    const transcript = [makeTurn('accelerationist', ['tax-1']), makeTurn('safetyist', ['tax-1'])];
    const crux = makeCrux({ id: cruxId, state: 'identified', speakers_involved: bothCamps });
    const out = finalizeUndecidedCruxes([crux], 12, bareNodes, [], transcript);
    expect(out[0].state).toBe('undecided');
  });

  it('counts only the crux own camps — a topically-adjacent third party does not adjudicate it', () => {
    // acc (involved) + skeptic (NOT involved) both cite the ref; safetyist (involved) is silent.
    const transcript = [makeTurn('accelerationist', ['tax-1']), makeTurn('skeptic', ['tax-1'])];
    const crux = makeCrux({ id: cruxId, state: 'identified', speakers_involved: bothCamps });
    const out = finalizeUndecidedCruxes([crux], 12, nodes, [], transcript);
    expect(out[0].state).toBe('undecided'); // only 1 of the 2 involved camps engaged
  });

  it('honors the minTurnsPerCamp calibration knob', () => {
    const transcript = [makeTurn('accelerationist', ['tax-1'], 'a1'), makeTurn('safetyist', ['tax-1'], 's1')];
    const crux = makeCrux({ id: cruxId, state: 'identified', speakers_involved: bothCamps });
    // Default (≥1 turn/camp): one turn each ⇒ adjudicated ⇒ stays identified.
    expect(finalizeUndecidedCruxes([crux], 12, nodes, [], transcript)[0].state).toBe('identified');
    // Knob raised to ≥2 turns/camp: a single turn each is insufficient ⇒ undecided.
    expect(
      finalizeUndecidedCruxes([crux], 12, nodes, [], transcript, { minTurnsPerCamp: 2 })[0].state,
    ).toBe('undecided');
  });

  it('idempotent on an adjudicated (left-identified) crux — re-running is a no-op', () => {
    const transcript = [makeTurn('accelerationist', ['tax-1']), makeTurn('safetyist', ['tax-1'])];
    const crux = makeCrux({ id: cruxId, state: 'identified', speakers_involved: bothCamps });
    const once = finalizeUndecidedCruxes([crux], 12, nodes, [], transcript);
    const twice = finalizeUndecidedCruxes(once, 13, nodes, [], transcript);
    expect(twice[0].state).toBe('identified');
    expect(twice[0].history).toHaveLength(once[0].history.length);
  });
});

describe('wasCruxAdjudicated (t/1818, pure predicate)', () => {
  function deepFreeze<T>(obj: T): T {
    if (obj && typeof obj === 'object') {
      for (const v of Object.values(obj)) deepFreeze(v);
      Object.freeze(obj);
    }
    return obj;
  }

  it('is true when ≥2 involved camps each share a taxonomy_ref with the crux node', () => {
    const crux = makeCrux({ id: 'cx', state: 'identified', speakers_involved: ['accelerationist', 'safetyist'] });
    const nodes = [makeCruxNode('cx', ['tax-1'])];
    const transcript = [makeTurn('accelerationist', ['tax-1']), makeTurn('safetyist', ['tax-1', 'tax-2'])];
    expect(wasCruxAdjudicated(crux, nodes, [], transcript)).toBe(true);
  });

  it('is false when the crux node is absent from nodes', () => {
    const crux = makeCrux({ id: 'missing', state: 'identified' });
    expect(wasCruxAdjudicated(crux, [], [], [])).toBe(false);
  });

  it('does not mutate its inputs (deep-frozen crux / nodes / transcript)', () => {
    const crux = deepFreeze(
      makeCrux({ id: 'cx', state: 'identified', speakers_involved: ['accelerationist', 'safetyist'] }),
    );
    const nodes = deepFreeze([makeCruxNode('cx', ['tax-1'])]);
    const transcript = deepFreeze([makeTurn('accelerationist', ['tax-1']), makeTurn('safetyist', ['tax-1'])]);
    expect(() => wasCruxAdjudicated(crux, nodes, [], transcript)).not.toThrow();
    expect(wasCruxAdjudicated(crux, nodes, [], transcript)).toBe(true);
  });
});

// ── guard 3: exhaustiveness-guarded terminal classifier ──

describe('isTerminalCruxState (t/1676, TL guard 3)', () => {
  it('classifies undecided as terminal alongside resolved/irreducible', () => {
    expect(isTerminalCruxState('undecided')).toBe(true);
    expect(isTerminalCruxState('resolved')).toBe(true);
    expect(isTerminalCruxState('irreducible')).toBe(true);
  });

  it('classifies live states as non-terminal', () => {
    expect(isTerminalCruxState('identified')).toBe(false);
    expect(isTerminalCruxState('engaged')).toBe(false);
    expect(isTerminalCruxState('one_side_conceded')).toBe(false);
  });
});

// ── AC3: calibration + exploration metrics ──

describe('crux_undecided_rate in the calibration log (t/1676, AC3)', () => {
  it('records the share of tracked cruxes that terminated undecided', () => {
    const session = makeSession({
      crux_tracker: [
        makeCrux({ id: 'c1', state: 'undecided' }),
        makeCrux({ id: 'c2', state: 'undecided' }),
        makeCrux({ id: 'c3', state: 'resolved' }),
        makeCrux({ id: 'c4', state: 'engaged' }),
      ],
    } as Partial<DebateSession>);
    const dp = extractCalibrationData(session, 'local');
    expect(dp.crux_undecided_rate).toBe(0.5);
  });

  it('is null when there are no tracked cruxes', () => {
    const dp = extractCalibrationData(makeSession(), 'local');
    expect(dp.crux_undecided_rate).toBeNull();
  });
});

describe('crux_addressed_rate excludes undecided (t/1676, AC3)', () => {
  it('drops undecided from both numerator and denominator', () => {
    const session = makeSession({
      crux_tracker: [
        makeCrux({ id: 'c1', state: 'engaged' }),      // addressed
        makeCrux({ id: 'c2', state: 'resolved' }),     // addressed
        makeCrux({ id: 'c3', state: 'undecided' }),    // excluded from num AND denom
        makeCrux({ id: 'c4', state: 'identified' }),   // addressable, not addressed
      ],
    } as Partial<DebateSession>);
    // addressed = 2 (engaged, resolved); addressable = 4 - 1 undecided = 3 → 2/3.
    const result = extractExplorationSummary(session);
    expect(result.quality_summary.crux_addressed_rate).toBe(0.6667);
  });

  it('is null when every crux terminated undecided (nothing was addressable)', () => {
    const session = makeSession({
      crux_tracker: [
        makeCrux({ id: 'c1', state: 'undecided' }),
        makeCrux({ id: 'c2', state: 'undecided' }),
      ],
    } as Partial<DebateSession>);
    const result = extractExplorationSummary(session);
    expect(result.quality_summary.crux_addressed_rate).toBeNull();
  });
});
