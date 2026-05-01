// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadProvisionalWeights,
  resetWeightsCache,
  initPhaseState,
  validatePhaseState,
  validateAdaptiveConfig,
  buildSignalRegistry,
  computeSaturationScore,
  computeConvergenceScore,
  detectCruxNodes,
  evaluatePhaseTransition,
  applyTransition,
  advanceRound,
  buildPhaseContext,
  buildSignalTelemetry,
  initAdaptiveDiagnostics,
} from './phaseTransitions';
import type {
  PhaseState,
  PhaseTransitionConfig,
  SignalContext,
  Signal,
  PredicateResult,
  DebatePhase,
} from './types';

// ── Helpers ───────────────────────────────────────────────

function makeConfig(overrides: Partial<PhaseTransitionConfig> = {}): PhaseTransitionConfig {
  return {
    useAdaptiveStaging: true,
    maxTotalRounds: 12,
    pacing: 'moderate',
    dialecticalStyle: 'deliberative',
    explorationExitThreshold: 0.65,
    synthesisExitThreshold: 0.70,
    allowEarlyTermination: true,
    ...overrides,
  };
}

function makePhaseState(overrides: Partial<PhaseState> = {}): PhaseState {
  return {
    current_phase: 'exploration',
    rounds_in_phase: 3,
    total_rounds_elapsed: 5,
    regression_count: 0,
    exploration_exit_threshold: 0.65,
    synthesis_exit_threshold: 0.70,
    prior_crux_clusters: [],
    veto_history: [],
    gc_ran_this_phase: false,
    api_calls_used: 0,
    ...overrides,
  };
}

function makeSignalContext(overrides: Partial<SignalContext> = {}): SignalContext {
  const defaults: SignalContext = {
    network: {
      nodes: [],
      edges: [],
      nodeCount: 10,
    },
    transcript: {
      currentRound: 5,
      roundsInPhase: 3,
      activePovsCount: 3,
      lastNRounds: (_n: number) => [
        {
          round: 4, speaker: 'prometheus', text: 'We should accelerate.',
          extraction_status: 'ok', claims_accepted: 3, claims_rejected: 1,
          category_validity_ratio: 0.9,
        },
        {
          round: 5, speaker: 'sentinel', text: 'Safety must come first.',
          extraction_status: 'ok', claims_accepted: 2, claims_rejected: 0,
          category_validity_ratio: 1.0,
        },
      ],
    },
    priorSignals: {
      get: (_signalId: string, _roundsBack: number) => 0.5,
      // Return null to bypass stability confidence gating (returns 1.0 when null)
      movingAverage: (_signalId: string, _window: number) => null,
    },
    convergenceSignals: {
      recycling_rate: { avg_self_overlap: 0.2, semantic_max_similarity: 0.3 },
      engagement_depth: { ratio: 0.8 },
      position_delta: { drift: 0.2 },
      concession_opportunity: { outcome: 'none', strong_attacks_faced: 0 },
    },
    phase: {
      current: 'exploration',
      allPovsResponded: true,
      cruxNodes: [],
      cruxResolution: [],
      priorCruxClusters: [],
      regressionCount: 0,
      explorationExitThreshold: 0.65,
      synthesisExitThreshold: 0.70,
    },
    extraction: {
      lastRoundStatus: 'ok',
      lastRoundClaimsAccepted: 2,
      lastRoundCategoryValidityRatio: 1.0,
    },
  };

  // Deep merge for nested overrides
  const merged = { ...defaults };
  if (overrides.network) merged.network = { ...defaults.network, ...overrides.network };
  if (overrides.transcript) merged.transcript = { ...defaults.transcript, ...overrides.transcript };
  if (overrides.priorSignals) merged.priorSignals = { ...defaults.priorSignals, ...overrides.priorSignals };
  if (overrides.convergenceSignals) merged.convergenceSignals = { ...defaults.convergenceSignals, ...overrides.convergenceSignals };
  if (overrides.phase) merged.phase = { ...defaults.phase, ...overrides.phase };
  if (overrides.extraction) merged.extraction = { ...defaults.extraction, ...overrides.extraction };
  return merged;
}

function makeNode(id: string, speaker: string, turn: number, strength = 0.7, overrides: Record<string, unknown> = {}) {
  return {
    id,
    speaker,
    computed_strength: strength,
    taxonomy_refs: [] as { node_id: string; relevance: string }[],
    turn_number: turn,
    ...overrides,
  };
}

function makeEdge(id: string, source: string, target: string, type: 'supports' | 'attacks', weight = 0.5) {
  return { id, source, target, type, weight };
}

// ── loadProvisionalWeights / resetWeightsCache ─────────────

describe('loadProvisionalWeights', () => {
  beforeEach(() => resetWeightsCache());

  it('returns hardcoded fallback with schema_version 1', () => {
    const w = loadProvisionalWeights();
    expect(w.schema_version).toBe(1);
  });

  it('returns consistent weights across calls (caching)', () => {
    const w1 = loadProvisionalWeights();
    const w2 = loadProvisionalWeights();
    expect(w1).toBe(w2); // same object reference
  });

  it('saturation weights sum to 1.0', () => {
    const w = loadProvisionalWeights();
    const sum = Object.values(w.saturation).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('convergence weights sum to 1.0', () => {
    const w = loadProvisionalWeights();
    const sum = Object.values(w.convergence).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('has all three pacing presets', () => {
    const w = loadProvisionalWeights();
    expect(w.pacing_presets).toHaveProperty('tight');
    expect(w.pacing_presets).toHaveProperty('moderate');
    expect(w.pacing_presets).toHaveProperty('thorough');
  });
});

describe('resetWeightsCache', () => {
  it('forces a fresh load on next call', () => {
    const w1 = loadProvisionalWeights();
    resetWeightsCache();
    const w2 = loadProvisionalWeights();
    expect(w1).not.toBe(w2); // different object references
    expect(w1).toEqual(w2); // but same content
  });
});

// ── initPhaseState ──────────────────────────────────────────

describe('initPhaseState', () => {
  beforeEach(() => resetWeightsCache());

  it('starts in thesis-antithesis with zero counters', () => {
    const state = initPhaseState(makeConfig());
    expect(state.current_phase).toBe('thesis-antithesis');
    expect(state.rounds_in_phase).toBe(0);
    expect(state.total_rounds_elapsed).toBe(0);
    expect(state.regression_count).toBe(0);
    expect(state.api_calls_used).toBe(0);
  });

  it('uses config thresholds when provided', () => {
    const state = initPhaseState(makeConfig({ explorationExitThreshold: 0.80, synthesisExitThreshold: 0.90 }));
    expect(state.exploration_exit_threshold).toBe(0.80);
    expect(state.synthesis_exit_threshold).toBe(0.90);
  });

  it('falls back to pacing preset when thresholds are absent', () => {
    const state = initPhaseState(makeConfig({
      explorationExitThreshold: undefined as unknown as number,
      synthesisExitThreshold: undefined as unknown as number,
      pacing: 'tight',
    }));
    const w = loadProvisionalWeights();
    expect(state.exploration_exit_threshold).toBe(w.pacing_presets.tight.explorationExit);
    expect(state.synthesis_exit_threshold).toBe(w.pacing_presets.tight.synthesisExit);
  });

  it('falls back to moderate when pacing preset is unknown', () => {
    const state = initPhaseState(makeConfig({ pacing: 'unknown' as 'moderate' }));
    const w = loadProvisionalWeights();
    expect(state.exploration_exit_threshold).toBe(w.pacing_presets.moderate.explorationExit);
  });

  it('initializes empty veto_history and prior_crux_clusters', () => {
    const state = initPhaseState(makeConfig());
    expect(state.veto_history).toEqual([]);
    expect(state.prior_crux_clusters).toEqual([]);
  });
});

// ── validatePhaseState ──────────────────────────────────────

describe('validatePhaseState', () => {
  beforeEach(() => resetWeightsCache());

  it('accepts a valid state', () => {
    const result = validatePhaseState(makePhaseState());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects invalid phase name', () => {
    const result = validatePhaseState(makePhaseState({ current_phase: 'invalid' as DebatePhase }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Invalid phase'))).toBe(true);
  });

  it('rejects negative rounds_in_phase', () => {
    const result = validatePhaseState(makePhaseState({ rounds_in_phase: -1 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('rounds_in_phase'))).toBe(true);
  });

  it('rejects non-integer rounds_in_phase', () => {
    const result = validatePhaseState(makePhaseState({ rounds_in_phase: 2.5 }));
    expect(result.valid).toBe(false);
  });

  it('rejects regression count exceeding max', () => {
    const w = loadProvisionalWeights();
    const result = validatePhaseState(makePhaseState({ regression_count: w.phase_bounds.max_regressions + 1 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Regression count'))).toBe(true);
  });

  it('rejects exploration threshold below baseline', () => {
    const result = validatePhaseState(makePhaseState({ exploration_exit_threshold: 0.10 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Exploration threshold'))).toBe(true);
  });

  it('accumulates multiple errors', () => {
    const result = validatePhaseState(makePhaseState({
      current_phase: 'invalid' as DebatePhase,
      rounds_in_phase: -1,
    }));
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ── validateAdaptiveConfig ──────────────────────────────────

describe('validateAdaptiveConfig', () => {
  it('accepts valid config', () => {
    const result = validateAdaptiveConfig(makeConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects explorationExitThreshold > 0.95', () => {
    const result = validateAdaptiveConfig(makeConfig({ explorationExitThreshold: 0.96 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('explorationExitThreshold'))).toBe(true);
  });

  it('rejects synthesisExitThreshold < 0.30', () => {
    const result = validateAdaptiveConfig(makeConfig({ synthesisExitThreshold: 0.29 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('synthesisExitThreshold'))).toBe(true);
  });

  it('rejects maxTotalRounds < 6', () => {
    const result = validateAdaptiveConfig(makeConfig({ maxTotalRounds: 5 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('maxTotalRounds < 6'))).toBe(true);
  });

  it('warns for maxTotalRounds > 20', () => {
    const result = validateAdaptiveConfig(makeConfig({ maxTotalRounds: 25 }));
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('maxTotalRounds > 20'))).toBe(true);
  });

  it('warns for tight pacing with integrative style', () => {
    const result = validateAdaptiveConfig(makeConfig({ pacing: 'tight', dialecticalStyle: 'integrative' }));
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('tight pacing'))).toBe(true);
  });
});

// ── buildSignalRegistry ─────────────────────────────────────

describe('buildSignalRegistry', () => {
  beforeEach(() => resetWeightsCache());

  it('returns 6 signals', () => {
    const signals = buildSignalRegistry();
    expect(signals).toHaveLength(6);
  });

  it('all signals are enabled by default', () => {
    const signals = buildSignalRegistry();
    expect(signals.every(s => s.enabled)).toBe(true);
  });

  it('all signals have v1-ship maturity', () => {
    const signals = buildSignalRegistry();
    expect(signals.every(s => s.maturity === 'v1-ship')).toBe(true);
  });

  it('signal weights match saturation weights', () => {
    const signals = buildSignalRegistry();
    const w = loadProvisionalWeights();
    for (const sig of signals) {
      expect(sig.weight).toBe(w.saturation[sig.id]);
    }
  });

  it('signal IDs are unique', () => {
    const signals = buildSignalRegistry();
    const ids = signals.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── computeSaturationScore ──────────────────────────────────

describe('computeSaturationScore', () => {
  beforeEach(() => resetWeightsCache());

  it('returns 0.5 during cold start', () => {
    const signals = buildSignalRegistry();
    const ctx = makeSignalContext();
    expect(computeSaturationScore(signals, ctx, true)).toBe(0.5);
  });

  it('returns 0 when all signals return 0', () => {
    const signals: Signal[] = [
      { id: 'test', weight: 1.0, enabled: true, maturity: 'v1-ship', compute: () => 0 },
    ];
    const ctx = makeSignalContext();
    expect(computeSaturationScore(signals, ctx, false)).toBe(0);
  });

  it('returns weight when single signal returns 1', () => {
    const signals: Signal[] = [
      { id: 'test', weight: 0.4, enabled: true, maturity: 'v1-ship', compute: () => 1.0 },
    ];
    const ctx = makeSignalContext();
    expect(computeSaturationScore(signals, ctx, false)).toBeCloseTo(0.4);
  });

  it('clamps signal values to [0,1]', () => {
    const signals: Signal[] = [
      { id: 'test', weight: 1.0, enabled: true, maturity: 'v1-ship', compute: () => 2.0 },
    ];
    const ctx = makeSignalContext();
    expect(computeSaturationScore(signals, ctx, false)).toBeLessThanOrEqual(1);
  });

  it('clamps negative signal values to 0', () => {
    const signals: Signal[] = [
      { id: 'test', weight: 1.0, enabled: true, maturity: 'v1-ship', compute: () => -0.5 },
    ];
    const ctx = makeSignalContext();
    expect(computeSaturationScore(signals, ctx, false)).toBe(0);
  });

  it('skips disabled signals', () => {
    const signals: Signal[] = [
      { id: 'a', weight: 0.5, enabled: true, maturity: 'v1-ship', compute: () => 1.0 },
      { id: 'b', weight: 0.5, enabled: false, maturity: 'v1-ship', compute: () => 1.0 },
    ];
    const ctx = makeSignalContext();
    expect(computeSaturationScore(signals, ctx, false)).toBeCloseTo(0.5);
  });
});

// ── computeConvergenceScore ─────────────────────────────────

describe('computeConvergenceScore', () => {
  beforeEach(() => resetWeightsCache());

  it('returns 0.5 during cold start', () => {
    const ctx = makeSignalContext();
    expect(computeConvergenceScore(ctx, true)).toBe(0.5);
  });

  it('returns a value in [0,1] for normal context', () => {
    const ctx = makeSignalContext();
    const score = computeConvergenceScore(ctx, false);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('position stability contributes based on drift', () => {
    // Low drift = high stability = higher convergence
    const ctxLowDrift = makeSignalContext({
      convergenceSignals: {
        recycling_rate: { avg_self_overlap: 0, semantic_max_similarity: 0 },
        engagement_depth: { ratio: 1 },
        position_delta: { drift: 0.0 },
        concession_opportunity: { outcome: 'none', strong_attacks_faced: 0 },
      },
    });
    const ctxHighDrift = makeSignalContext({
      convergenceSignals: {
        recycling_rate: { avg_self_overlap: 0, semantic_max_similarity: 0 },
        engagement_depth: { ratio: 1 },
        position_delta: { drift: 0.9 },
        concession_opportunity: { outcome: 'none', strong_attacks_faced: 0 },
      },
    });
    const lowDriftScore = computeConvergenceScore(ctxLowDrift, false);
    const highDriftScore = computeConvergenceScore(ctxHighDrift, false);
    expect(lowDriftScore).toBeGreaterThan(highDriftScore);
  });
});

// ── detectCruxNodes ─────────────────────────────────────────

describe('detectCruxNodes', () => {
  it('returns empty for no nodes', () => {
    expect(detectCruxNodes([], [])).toEqual([]);
  });

  it('identifies node attacked by 2+ different speakers', () => {
    const nodes = [
      makeNode('A', 'prometheus', 1, 0.7),
      makeNode('B', 'sentinel', 2, 0.6),
      makeNode('C', 'cassandra', 2, 0.8),
    ];
    const edges = [
      makeEdge('e1', 'B', 'A', 'attacks'),
      makeEdge('e2', 'C', 'A', 'attacks'),
    ];
    const cruxes = detectCruxNodes(nodes, edges);
    expect(cruxes).toHaveLength(1);
    expect(cruxes[0].id).toBe('A');
    expect(cruxes[0].crossPovAttackCount).toBe(2);
  });

  it('does not flag a node attacked by only 1 speaker', () => {
    const nodes = [
      makeNode('A', 'prometheus', 1, 0.7),
      makeNode('B', 'sentinel', 2, 0.6),
    ];
    const edges = [
      makeEdge('e1', 'B', 'A', 'attacks'),
    ];
    expect(detectCruxNodes(nodes, edges)).toEqual([]);
  });

  it('does not flag a node with computed_strength <= 0.5', () => {
    const nodes = [
      makeNode('A', 'prometheus', 1, 0.4), // below 0.5 threshold
      makeNode('B', 'sentinel', 2, 0.6),
      makeNode('C', 'cassandra', 2, 0.8),
    ];
    const edges = [
      makeEdge('e1', 'B', 'A', 'attacks'),
      makeEdge('e2', 'C', 'A', 'attacks'),
    ];
    expect(detectCruxNodes(nodes, edges)).toEqual([]);
  });

  it('ignores support edges', () => {
    const nodes = [
      makeNode('A', 'prometheus', 1, 0.7),
      makeNode('B', 'sentinel', 2, 0.6),
      makeNode('C', 'cassandra', 2, 0.8),
    ];
    const edges = [
      makeEdge('e1', 'B', 'A', 'supports'),
      makeEdge('e2', 'C', 'A', 'supports'),
    ];
    expect(detectCruxNodes(nodes, edges)).toEqual([]);
  });

  it('counts distinct attacker speakers, not edges', () => {
    const nodes = [
      makeNode('A', 'prometheus', 1, 0.7),
      makeNode('B1', 'sentinel', 2, 0.6),
      makeNode('B2', 'sentinel', 3, 0.5), // same speaker
    ];
    const edges = [
      makeEdge('e1', 'B1', 'A', 'attacks'),
      makeEdge('e2', 'B2', 'A', 'attacks'),
    ];
    // Only 1 distinct attacker speaker, so not a crux
    expect(detectCruxNodes(nodes, edges)).toEqual([]);
  });
});

// ── evaluatePhaseTransition ─────────────────────────────────

describe('evaluatePhaseTransition', () => {
  beforeEach(() => resetWeightsCache());

  const signals = buildSignalRegistry();

  describe('global guards', () => {
    it('terminates on catastrophic health collapse (< 0.10)', () => {
      const state = makePhaseState();
      const ctx = makeSignalContext();
      const config = makeConfig();
      const health = { value: 0.05, consecutive_decline: 1 };
      const result = evaluatePhaseTransition(state, ctx, signals, config, health);
      expect(result.action).toBe('terminate');
      expect(result.reason).toContain('Catastrophic health');
      expect(result.force_active).toBe(true);
    });

    it('terminates on sustained health decline (< 0.20 for 3 rounds)', () => {
      const state = makePhaseState();
      const ctx = makeSignalContext();
      const config = makeConfig();
      const health = { value: 0.15, consecutive_decline: 3 };
      const result = evaluatePhaseTransition(state, ctx, signals, config, health);
      expect(result.action).toBe('terminate');
      expect(result.reason).toContain('Sustained health decline');
    });

    it('does not terminate on low health if allowEarlyTermination is false', () => {
      const state = makePhaseState();
      const ctx = makeSignalContext();
      const config = makeConfig({ allowEarlyTermination: false });
      const health = { value: 0.05, consecutive_decline: 5 };
      const result = evaluatePhaseTransition(state, ctx, signals, config, health);
      expect(result.action).not.toBe('terminate');
    });

    it('terminates on API hard ceiling', () => {
      const w = loadProvisionalWeights();
      const hardCeiling = 12 * w.budget.hard_multiplier;
      const state = makePhaseState({ api_calls_used: hardCeiling });
      const ctx = makeSignalContext();
      const config = makeConfig();
      const result = evaluatePhaseTransition(state, ctx, signals, config);
      expect(result.action).toBe('terminate');
      expect(result.reason).toContain('API hard ceiling');
    });

    it('force transitions to synthesis on network hard cap (non-synthesis)', () => {
      const w = loadProvisionalWeights();
      const state = makePhaseState({ current_phase: 'exploration' });
      const ctx = makeSignalContext({
        network: { nodes: [], edges: [], nodeCount: w.network.hard_cap },
      });
      const config = makeConfig();
      const result = evaluatePhaseTransition(state, ctx, signals, config);
      expect(result.action).toBe('force_transition');
      expect(result.new_phase).toBe('synthesis');
    });

    it('does not force-transition on network hard cap in synthesis', () => {
      const w = loadProvisionalWeights();
      const state = makePhaseState({ current_phase: 'synthesis', rounds_in_phase: 2 });
      const ctx = makeSignalContext({
        network: { nodes: [], edges: [], nodeCount: w.network.hard_cap },
        phase: {
          current: 'synthesis',
          allPovsResponded: true,
          cruxNodes: [],
          cruxResolution: [],
          priorCruxClusters: [],
          regressionCount: 0,
          explorationExitThreshold: 0.65,
          synthesisExitThreshold: 0.70,
        },
      });
      const config = makeConfig();
      const result = evaluatePhaseTransition(state, ctx, signals, config);
      expect(result.action).not.toBe('force_transition');
    });

    it('terminates on max total rounds', () => {
      const state = makePhaseState({ total_rounds_elapsed: 12 });
      const ctx = makeSignalContext();
      const config = makeConfig({ maxTotalRounds: 12 });
      const result = evaluatePhaseTransition(state, ctx, signals, config);
      expect(result.action).toBe('terminate');
      expect(result.reason).toContain('Max total rounds');
    });
  });

  describe('thesis-antithesis phase', () => {
    it('stays during cold start (below min rounds)', () => {
      const state = makePhaseState({ current_phase: 'thesis-antithesis', rounds_in_phase: 1 });
      const ctx = makeSignalContext({ phase: { current: 'thesis-antithesis', allPovsResponded: true, cruxNodes: [], cruxResolution: [], priorCruxClusters: [], regressionCount: 0, explorationExitThreshold: 0.65, synthesisExitThreshold: 0.70 } });
      const config = makeConfig();
      const result = evaluatePhaseTransition(state, ctx, signals, config);
      expect(result.action).toBe('stay');
      expect(result.reason).toContain('Cold start');
    });

    it('force-transitions on max thesis rounds', () => {
      const w = loadProvisionalWeights();
      const state = makePhaseState({
        current_phase: 'thesis-antithesis',
        rounds_in_phase: w.phase_bounds.max_thesis_rounds,
      });
      const ctx = makeSignalContext({ phase: { current: 'thesis-antithesis', allPovsResponded: true, cruxNodes: [], cruxResolution: [], priorCruxClusters: [], regressionCount: 0, explorationExitThreshold: 0.65, synthesisExitThreshold: 0.70 } });
      const config = makeConfig();
      const result = evaluatePhaseTransition(state, ctx, signals, config);
      expect(result.action).toBe('transition');
      expect(result.new_phase).toBe('exploration');
      expect(result.force_active).toBe(true);
    });

    it('stays when not all POVs have responded', () => {
      const w = loadProvisionalWeights();
      const state = makePhaseState({
        current_phase: 'thesis-antithesis',
        rounds_in_phase: w.phase_bounds.min_thesis_rounds,
      });
      const ctx = makeSignalContext({ phase: { current: 'thesis-antithesis', allPovsResponded: false, cruxNodes: [], cruxResolution: [], priorCruxClusters: [], regressionCount: 0, explorationExitThreshold: 0.65, synthesisExitThreshold: 0.70 } });
      const config = makeConfig();
      const result = evaluatePhaseTransition(state, ctx, signals, config);
      expect(result.action).toBe('stay');
      expect(result.reason).toContain('Not all POVs');
    });

    it('transitions when crux is found and all POVs responded', () => {
      const w = loadProvisionalWeights();
      const state = makePhaseState({
        current_phase: 'thesis-antithesis',
        rounds_in_phase: w.phase_bounds.min_thesis_rounds,
      });
      const ctx = makeSignalContext({
        phase: {
          current: 'thesis-antithesis',
          allPovsResponded: true,
          cruxNodes: [{ id: 'crux-1', crossPovAttackCount: 2, computedStrength: 0.8 }],
          cruxResolution: [],
          priorCruxClusters: [],
          regressionCount: 0,
          explorationExitThreshold: 0.65,
          synthesisExitThreshold: 0.70,
        },
      });
      const config = makeConfig();
      const result = evaluatePhaseTransition(state, ctx, signals, config);
      expect(result.action).toBe('transition');
      expect(result.new_phase).toBe('exploration');
      expect(result.reason).toContain('Crux identified');
    });
  });

  describe('exploration phase', () => {
    it('stays during cold start', () => {
      const state = makePhaseState({ current_phase: 'exploration', rounds_in_phase: 1 });
      const ctx = makeSignalContext();
      const config = makeConfig();
      const result = evaluatePhaseTransition(state, ctx, signals, config);
      expect(result.action).toBe('stay');
      expect(result.reason).toContain('Cold start');
    });

    it('force-transitions on max exploration rounds', () => {
      const w = loadProvisionalWeights();
      const state = makePhaseState({
        current_phase: 'exploration',
        rounds_in_phase: w.phase_bounds.max_exploration_rounds,
      });
      const ctx = makeSignalContext();
      const config = makeConfig();
      const result = evaluatePhaseTransition(state, ctx, signals, config);
      expect(result.action).toBe('transition');
      expect(result.new_phase).toBe('synthesis');
      expect(result.force_active).toBe(true);
    });

    it('force-transitions on soft API budget', () => {
      const w = loadProvisionalWeights();
      const softBudget = 12 * w.budget.soft_multiplier;
      const state = makePhaseState({
        current_phase: 'exploration',
        rounds_in_phase: 3,
        api_calls_used: softBudget,
      });
      const ctx = makeSignalContext();
      const config = makeConfig();
      const result = evaluatePhaseTransition(state, ctx, signals, config);
      expect(result.action).toBe('transition');
      expect(result.new_phase).toBe('synthesis');
      expect(result.reason).toContain('API soft budget');
    });

    it('force-transitions when debate is dead (recycling > 0.8 AND fatigue > 0.8)', () => {
      const state = makePhaseState({ current_phase: 'exploration', rounds_in_phase: 3 });
      const ctx = makeSignalContext({
        convergenceSignals: {
          recycling_rate: { avg_self_overlap: 0.85, semantic_max_similarity: 0.9 },
          engagement_depth: { ratio: 0.1 }, // very low current ratio
          position_delta: { drift: 0.2 },
          concession_opportunity: { outcome: 'none', strong_attacks_faced: 0 },
        },
        priorSignals: {
          get: (id: string) => id === '_peak_engagement_ratio' ? 0.9 : 0.5,
          movingAverage: () => 0.5,
        },
      });
      const config = makeConfig();
      const result = evaluatePhaseTransition(state, ctx, signals, config);
      expect(result.action).toBe('transition');
      expect(result.new_phase).toBe('synthesis');
      expect(result.reason).toContain('Debate is dead');
    });

    it('fires fresh-crux veto when saturation above threshold but crux just discovered', () => {
      const state = makePhaseState({
        current_phase: 'exploration',
        rounds_in_phase: 3,
        exploration_exit_threshold: 0.01, // very low so saturation exceeds it
      });
      // Need a crux node that was added at the current round
      const cruxNode = makeNode('crux-1', 'prometheus', 5, 0.8);
      const ctx = makeSignalContext({
        network: {
          nodes: [cruxNode],
          edges: [],
          nodeCount: 1,
        },
        phase: {
          current: 'exploration',
          allPovsResponded: true,
          cruxNodes: [{ id: 'crux-1', crossPovAttackCount: 2, computedStrength: 0.8 }],
          cruxResolution: [],
          priorCruxClusters: [],
          regressionCount: 0,
          explorationExitThreshold: 0.01,
          synthesisExitThreshold: 0.70,
        },
        transcript: {
          currentRound: 5,
          roundsInPhase: 3,
          activePovsCount: 3,
          lastNRounds: () => [
            { round: 4, speaker: 'prometheus', text: 'X', extraction_status: 'ok', claims_accepted: 3, claims_rejected: 1, category_validity_ratio: 0.9 },
            { round: 5, speaker: 'sentinel', text: 'Y', extraction_status: 'ok', claims_accepted: 2, claims_rejected: 0, category_validity_ratio: 1.0 },
          ],
        },
      });
      const config = makeConfig();
      const result = evaluatePhaseTransition(state, ctx, signals, config);
      expect(result.veto_active).toBe(true);
      expect(result.action).toBe('stay');
      expect(result.reason).toContain('Veto');
    });
  });

  describe('synthesis phase', () => {
    it('stays during cold start', () => {
      const state = makePhaseState({ current_phase: 'synthesis', rounds_in_phase: 1 });
      const ctx = makeSignalContext({
        phase: {
          current: 'synthesis',
          allPovsResponded: true,
          cruxNodes: [],
          cruxResolution: [],
          priorCruxClusters: [],
          regressionCount: 0,
          explorationExitThreshold: 0.65,
          synthesisExitThreshold: 0.70,
        },
      });
      const config = makeConfig();
      const result = evaluatePhaseTransition(state, ctx, signals, config);
      expect(result.action).toBe('stay');
      expect(result.reason).toContain('Cold start');
    });

    it('terminates on max synthesis rounds', () => {
      const w = loadProvisionalWeights();
      const state = makePhaseState({
        current_phase: 'synthesis',
        rounds_in_phase: w.phase_bounds.max_synthesis_rounds,
      });
      const ctx = makeSignalContext({
        phase: {
          current: 'synthesis',
          allPovsResponded: true,
          cruxNodes: [],
          cruxResolution: [],
          priorCruxClusters: [],
          regressionCount: 0,
          explorationExitThreshold: 0.65,
          synthesisExitThreshold: 0.70,
        },
      });
      const config = makeConfig();
      const result = evaluatePhaseTransition(state, ctx, signals, config);
      expect(result.action).toBe('terminate');
      expect(result.force_active).toBe(true);
    });

    it('regresses on novel crux discovered in synthesis', () => {
      const w = loadProvisionalWeights();
      const cruxNode = makeNode('novel-crux', 'prometheus', 5, 0.8);
      const state = makePhaseState({
        current_phase: 'synthesis',
        rounds_in_phase: 2,
        regression_count: 0,
      });
      const ctx = makeSignalContext({
        network: {
          nodes: [cruxNode],
          edges: [],
          nodeCount: 1,
        },
        phase: {
          current: 'synthesis',
          allPovsResponded: true,
          cruxNodes: [{ id: 'novel-crux', crossPovAttackCount: 2, computedStrength: 0.8 }],
          cruxResolution: [],
          priorCruxClusters: [], // not in prior clusters
          regressionCount: 0,
          explorationExitThreshold: 0.65,
          synthesisExitThreshold: 0.70,
        },
        transcript: {
          currentRound: 5,
          roundsInPhase: 2,
          activePovsCount: 3,
          lastNRounds: () => [
            { round: 4, speaker: 'prometheus', text: 'X', extraction_status: 'ok', claims_accepted: 3, claims_rejected: 0, category_validity_ratio: 1.0 },
            { round: 5, speaker: 'sentinel', text: 'Y', extraction_status: 'ok', claims_accepted: 2, claims_rejected: 0, category_validity_ratio: 1.0 },
          ],
        },
        // Make convergence look stable (no stall)
        priorSignals: {
          get: (id: string, _rb: number) => id === '_convergence_score' ? 0.50 : 0.5,
          movingAverage: () => 0.5,
        },
        convergenceSignals: {
          recycling_rate: { avg_self_overlap: 0.1, semantic_max_similarity: 0.1 },
          engagement_depth: { ratio: 0.8 },
          position_delta: { drift: 0.2 },
          concession_opportunity: { outcome: 'none', strong_attacks_faced: 0 },
        },
      });
      const config = makeConfig();
      const result = evaluatePhaseTransition(state, ctx, signals, config);
      expect(result.action).toBe('regress');
      expect(result.new_phase).toBe('exploration');
      expect(result.reason).toContain('Novel crux');
    });

    it('does not regress when max regressions exhausted', () => {
      const w = loadProvisionalWeights();
      const cruxNode = makeNode('novel-crux', 'prometheus', 5, 0.8);
      const state = makePhaseState({
        current_phase: 'synthesis',
        rounds_in_phase: 2,
        regression_count: w.phase_bounds.max_regressions, // already at max
      });
      const ctx = makeSignalContext({
        network: { nodes: [cruxNode], edges: [], nodeCount: 1 },
        phase: {
          current: 'synthesis',
          allPovsResponded: true,
          cruxNodes: [{ id: 'novel-crux', crossPovAttackCount: 2, computedStrength: 0.8 }],
          cruxResolution: [],
          priorCruxClusters: [],
          regressionCount: w.phase_bounds.max_regressions,
          explorationExitThreshold: 0.65,
          synthesisExitThreshold: 0.70,
        },
        transcript: {
          currentRound: 5,
          roundsInPhase: 2,
          activePovsCount: 3,
          lastNRounds: () => [
            { round: 4, speaker: 'a', text: 'x', extraction_status: 'ok', claims_accepted: 2, claims_rejected: 0, category_validity_ratio: 1.0 },
            { round: 5, speaker: 'b', text: 'y', extraction_status: 'ok', claims_accepted: 2, claims_rejected: 0, category_validity_ratio: 1.0 },
          ],
        },
        priorSignals: {
          get: () => 0.5,
          movingAverage: () => 0.5,
        },
        convergenceSignals: {
          recycling_rate: { avg_self_overlap: 0.1, semantic_max_similarity: 0.1 },
          engagement_depth: { ratio: 0.8 },
          position_delta: { drift: 0.2 },
          concession_opportunity: { outcome: 'none', strong_attacks_faced: 0 },
        },
      });
      const config = makeConfig();
      const result = evaluatePhaseTransition(state, ctx, signals, config);
      expect(result.action).not.toBe('regress');
    });
  });

  describe('confidence gating', () => {
    it('defers when extraction confidence is low', () => {
      const state = makePhaseState({ current_phase: 'exploration', rounds_in_phase: 3 });
      const ctx = makeSignalContext({
        extraction: {
          lastRoundStatus: 'parse_error',
          lastRoundClaimsAccepted: 0,
          lastRoundCategoryValidityRatio: 0.0,
        },
      });
      const config = makeConfig();
      const result = evaluatePhaseTransition(state, ctx, signals, config);
      expect(result.confidence_deferred).toBe(true);
      expect(result.action).toBe('stay');
    });
  });
});

// ── applyTransition ─────────────────────────────────────────

describe('applyTransition', () => {
  beforeEach(() => resetWeightsCache());

  it('stays with no changes', () => {
    const state = makePhaseState();
    const result: PredicateResult = {
      action: 'stay', reason: 'Test', veto_active: false, force_active: false,
      confidence_deferred: false, components: {},
    };
    const next = applyTransition(state, result);
    expect(next.current_phase).toBe(state.current_phase);
    expect(next.rounds_in_phase).toBe(state.rounds_in_phase);
  });

  it('transitions to specified phase and resets rounds', () => {
    const state = makePhaseState({ current_phase: 'exploration', rounds_in_phase: 5 });
    const result: PredicateResult = {
      action: 'transition', new_phase: 'synthesis', reason: 'Test',
      veto_active: false, force_active: false, confidence_deferred: false, components: {},
    };
    const next = applyTransition(state, result);
    expect(next.current_phase).toBe('synthesis');
    expect(next.rounds_in_phase).toBe(0);
    expect(next.gc_ran_this_phase).toBe(false);
  });

  it('defaults to synthesis when new_phase is absent', () => {
    const state = makePhaseState({ current_phase: 'exploration' });
    const result: PredicateResult = {
      action: 'transition', reason: 'Test',
      veto_active: false, force_active: false, confidence_deferred: false, components: {},
    };
    const next = applyTransition(state, result);
    expect(next.current_phase).toBe('synthesis');
  });

  it('records veto in history when veto_active', () => {
    const state = makePhaseState({ veto_history: [] });
    const result: PredicateResult = {
      action: 'transition', new_phase: 'synthesis', reason: 'Veto reason',
      veto_active: true, force_active: false, confidence_deferred: false, components: {},
    };
    const next = applyTransition(state, result);
    expect(next.veto_history).toHaveLength(1);
    expect(next.veto_history[0].veto_type).toBe('Veto reason');
  });

  it('regression increments regression_count and ratchets threshold', () => {
    const w = loadProvisionalWeights();
    const state = makePhaseState({ regression_count: 0, exploration_exit_threshold: 0.65 });
    const result: PredicateResult = {
      action: 'regress', new_phase: 'exploration', reason: 'Novel crux',
      veto_active: false, force_active: false, confidence_deferred: false, components: { novel_cruxes: 0 },
    };
    const next = applyTransition(state, result);
    expect(next.current_phase).toBe('exploration');
    expect(next.regression_count).toBe(1);
    expect(next.exploration_exit_threshold).toBeCloseTo(0.65 + w.phase_bounds.regression_ratchet);
    expect(next.rounds_in_phase).toBe(0);
  });

  it('terminate returns state unchanged', () => {
    const state = makePhaseState({ current_phase: 'synthesis', rounds_in_phase: 3 });
    const result: PredicateResult = {
      action: 'terminate', reason: 'Done', veto_active: false, force_active: true,
      confidence_deferred: false, components: {},
    };
    const next = applyTransition(state, result);
    expect(next.current_phase).toBe('synthesis');
    expect(next.rounds_in_phase).toBe(3);
  });

  it('force_transition works like transition', () => {
    const state = makePhaseState({ current_phase: 'exploration' });
    const result: PredicateResult = {
      action: 'force_transition', new_phase: 'synthesis', reason: 'Hard cap',
      veto_active: false, force_active: true, confidence_deferred: false, components: {},
    };
    const next = applyTransition(state, result);
    expect(next.current_phase).toBe('synthesis');
    expect(next.rounds_in_phase).toBe(0);
  });
});

// ── advanceRound ────────────────────────────────────────────

describe('advanceRound', () => {
  it('increments both round counters', () => {
    const state = makePhaseState({ rounds_in_phase: 2, total_rounds_elapsed: 5 });
    const next = advanceRound(state);
    expect(next.rounds_in_phase).toBe(3);
    expect(next.total_rounds_elapsed).toBe(6);
  });

  it('does not mutate original state', () => {
    const state = makePhaseState({ rounds_in_phase: 2, total_rounds_elapsed: 5 });
    advanceRound(state);
    expect(state.rounds_in_phase).toBe(2);
    expect(state.total_rounds_elapsed).toBe(5);
  });
});

// ── buildPhaseContext ───────────────────────────────────────

describe('buildPhaseContext', () => {
  beforeEach(() => resetWeightsCache());

  it('returns thesis-antithesis with establishing message', () => {
    const state = makePhaseState({ current_phase: 'thesis-antithesis', rounds_in_phase: 1 });
    const config = makeConfig();
    const pc = buildPhaseContext(state, config, 0, 0);
    expect(pc.phase).toBe('thesis-antithesis');
    expect(pc.rationale).toContain('establishing positions');
  });

  it('returns exploration with saturation percentage', () => {
    const state = makePhaseState({ current_phase: 'exploration', rounds_in_phase: 3 });
    const config = makeConfig();
    const pc = buildPhaseContext(state, config, 0.45, 0);
    expect(pc.phase).toBe('exploration');
    expect(pc.rationale).toContain('45%');
  });

  it('returns synthesis with convergence percentage', () => {
    const state = makePhaseState({ current_phase: 'synthesis', rounds_in_phase: 1 });
    const config = makeConfig();
    const pc = buildPhaseContext(state, config, 0, 0.60);
    expect(pc.phase).toBe('synthesis');
    expect(pc.rationale).toContain('60%');
  });

  it('progress is clamped to [0,1]', () => {
    const state = makePhaseState({ current_phase: 'exploration', rounds_in_phase: 100 });
    const config = makeConfig();
    const pc = buildPhaseContext(state, config, 2.0, 0);
    expect(pc.phase_progress).toBeGreaterThanOrEqual(0);
    expect(pc.phase_progress).toBeLessThanOrEqual(1);
  });

  it('approaching_transition fires at >= 85% progress', () => {
    const w = loadProvisionalWeights();
    const state = makePhaseState({
      current_phase: 'exploration',
      rounds_in_phase: w.phase_bounds.max_exploration_rounds - 1,
      exploration_exit_threshold: 0.65,
    });
    const config = makeConfig();
    const pc = buildPhaseContext(state, config, 0.60, 0);
    expect(pc.approaching_transition).toBe(true);
  });

  it('includes regression note when regressions > 0', () => {
    const state = makePhaseState({ current_phase: 'exploration', rounds_in_phase: 3, regression_count: 1 });
    const config = makeConfig();
    const pc = buildPhaseContext(state, config, 0.3, 0);
    expect(pc.rationale).toContain('1 regression');
  });
});

// ── initAdaptiveDiagnostics ─────────────────────────────────

describe('initAdaptiveDiagnostics', () => {
  it('starts with all counters at zero and enabled', () => {
    const diag = initAdaptiveDiagnostics();
    expect(diag.enabled).toBe(true);
    expect(diag.total_predicate_evaluations).toBe(0);
    expect(diag.confidence_deferrals).toBe(0);
    expect(diag.vetoes_fired).toBe(0);
    expect(diag.forces_fired).toBe(0);
    expect(diag.network_size_peak).toBe(0);
    expect(diag.phases).toEqual([]);
    expect(diag.regressions).toEqual([]);
    expect(diag.gc_events).toEqual([]);
    expect(diag.signal_telemetry).toEqual([]);
    expect(diag.human_overrides).toEqual([]);
  });
});

// ── buildSignalTelemetry ────────────────────────────────────

describe('buildSignalTelemetry', () => {
  beforeEach(() => resetWeightsCache());

  it('produces a telemetry record with all fields', () => {
    const state = makePhaseState({ current_phase: 'exploration', rounds_in_phase: 3, total_rounds_elapsed: 5 });
    const ctx = makeSignalContext();
    const signals = buildSignalRegistry();
    const result: PredicateResult = {
      action: 'stay', reason: 'Test', veto_active: false, force_active: false,
      confidence_deferred: false, components: {},
    };
    const record = buildSignalTelemetry(state, ctx, signals, result, 0.5, 100);
    expect(record.round).toBe(5);
    expect(record.phase).toBe('exploration');
    expect(record.phase_progress).toBe(0.5);
    expect(record.elapsed_ms).toBe(100);
    expect(record.predicate_result).toBe(result);
    expect(record.network_size).toBe(10);
  });

  it('fills saturation_score for non-synthesis phase', () => {
    const state = makePhaseState({ current_phase: 'exploration' });
    const ctx = makeSignalContext();
    const signals = buildSignalRegistry();
    const result: PredicateResult = {
      action: 'stay', reason: 'Test', veto_active: false, force_active: false,
      confidence_deferred: false, components: {},
    };
    const record = buildSignalTelemetry(state, ctx, signals, result, 0.5, 50);
    expect(record.composite.saturation_score).not.toBeNull();
    expect(record.composite.convergence_score).toBeNull();
  });

  it('fills convergence_score for synthesis phase', () => {
    const state = makePhaseState({ current_phase: 'synthesis' });
    const ctx = makeSignalContext({
      phase: {
        current: 'synthesis',
        allPovsResponded: true,
        cruxNodes: [],
        cruxResolution: [],
        priorCruxClusters: [],
        regressionCount: 0,
        explorationExitThreshold: 0.65,
        synthesisExitThreshold: 0.70,
      },
    });
    const signals = buildSignalRegistry();
    const result: PredicateResult = {
      action: 'stay', reason: 'Test', veto_active: false, force_active: false,
      confidence_deferred: false, components: {},
    };
    const record = buildSignalTelemetry(state, ctx, signals, result, 0.5, 50);
    expect(record.composite.convergence_score).not.toBeNull();
    expect(record.composite.saturation_score).toBeNull();
  });

  it('records signal values for each enabled signal', () => {
    const state = makePhaseState();
    const ctx = makeSignalContext();
    const signals = buildSignalRegistry();
    const result: PredicateResult = {
      action: 'stay', reason: 'Test', veto_active: false, force_active: false,
      confidence_deferred: false, components: {},
    };
    const record = buildSignalTelemetry(state, ctx, signals, result, 0.5, 50);
    for (const sig of signals) {
      expect(record.signals).toHaveProperty(sig.id);
    }
  });
});

// ── Integration: full lifecycle ─────────────────────────────

describe('lifecycle integration', () => {
  beforeEach(() => resetWeightsCache());

  it('thesis -> exploration -> synthesis via advanceRound + applyTransition', () => {
    const config = makeConfig();
    let state = initPhaseState(config);

    // Advance through thesis-antithesis
    expect(state.current_phase).toBe('thesis-antithesis');
    const w = loadProvisionalWeights();
    for (let i = 0; i < w.phase_bounds.max_thesis_rounds; i++) {
      state = advanceRound(state);
    }
    expect(state.rounds_in_phase).toBe(w.phase_bounds.max_thesis_rounds);

    // Apply thesis -> exploration transition
    const thesisResult: PredicateResult = {
      action: 'transition', new_phase: 'exploration', reason: 'Max rounds',
      veto_active: false, force_active: true, confidence_deferred: false, components: {},
    };
    state = applyTransition(state, thesisResult);
    expect(state.current_phase).toBe('exploration');
    expect(state.rounds_in_phase).toBe(0);
    expect(state.total_rounds_elapsed).toBe(w.phase_bounds.max_thesis_rounds);

    // Advance through exploration
    for (let i = 0; i < w.phase_bounds.max_exploration_rounds; i++) {
      state = advanceRound(state);
    }

    // Apply exploration -> synthesis transition
    const explorationResult: PredicateResult = {
      action: 'transition', new_phase: 'synthesis', reason: 'Saturation',
      veto_active: false, force_active: false, confidence_deferred: false, components: {},
    };
    state = applyTransition(state, explorationResult);
    expect(state.current_phase).toBe('synthesis');
    expect(state.rounds_in_phase).toBe(0);
  });

  it('regression from synthesis -> exploration ratchets threshold', () => {
    const config = makeConfig();
    const w = loadProvisionalWeights();
    let state = makePhaseState({
      current_phase: 'synthesis',
      rounds_in_phase: 2,
      regression_count: 0,
      exploration_exit_threshold: 0.65,
    });

    const regressResult: PredicateResult = {
      action: 'regress', new_phase: 'exploration', reason: 'Novel crux',
      veto_active: false, force_active: false, confidence_deferred: false,
      components: { novel_cruxes: 0 },
    };
    state = applyTransition(state, regressResult);
    expect(state.current_phase).toBe('exploration');
    expect(state.regression_count).toBe(1);
    expect(state.exploration_exit_threshold).toBeCloseTo(0.65 + w.phase_bounds.regression_ratchet);

    // Second regression ratchets further
    state = { ...state, current_phase: 'synthesis', rounds_in_phase: 2 };
    state = applyTransition(state, regressResult);
    expect(state.regression_count).toBe(2);
    expect(state.exploration_exit_threshold).toBeCloseTo(0.65 + 2 * w.phase_bounds.regression_ratchet);
  });
});
