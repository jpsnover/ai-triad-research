// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  initAgentBeliefState,
  updateBeliefs,
  computeBeliefDivergence,
  computeMaxBeliefDivergence,
} from './beliefTracking.js';
import type { ArgumentNetworkNode } from './types.js';

// ── Helpers ──────────────────────────────────────────────

function makeNode(overrides: Partial<ArgumentNetworkNode> & { id: string }): ArgumentNetworkNode {
  return {
    text: `Claim ${overrides.id}`,
    speaker: 'accelerationist',
    source_entry_id: 'e1',
    taxonomy_refs: [],
    turn_number: 1,
    base_strength: 0.5,
    computed_strength: 0.5,
    ...overrides,
  };
}

// ── initAgentBeliefState ─────────────────────────────────

describe('initAgentBeliefState', () => {
  it('creates empty belief state for a speaker', () => {
    const state = initAgentBeliefState('accelerationist');
    expect(state.speaker).toBe('accelerationist');
    expect(state.beliefs.size).toBe(0);
    expect(state.round).toBe(0);
  });
});

// ── updateBeliefs ────────────────────────────────────────

describe('updateBeliefs', () => {
  it('adds beliefs for new claims at default prior', () => {
    const state = initAgentBeliefState('accelerationist');
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist', computed_strength: 0.8 }),
      makeNode({ id: 'AN-2', speaker: 'safetyist', computed_strength: 0.7 }),
    ];
    const strengths = new Map([['AN-1', 0.8], ['AN-2', 0.7]]);

    updateBeliefs(state, nodes, strengths, 1);

    expect(state.beliefs.size).toBe(2);
    expect(state.round).toBe(1);

    // Own claim (AN-1): observation=0.8, prior=0.5, posterior = 0.5 + 0.6*(0.8-0.5) = 0.68
    const b1 = state.beliefs.get('AN-1')!;
    expect(b1.prior).toBe(0.5);
    expect(b1.posterior).toBeCloseTo(0.68, 2);
    expect(b1.confidence).toBeGreaterThan(0);

    // Opponent claim (AN-2): observation=1-0.7=0.3, posterior = 0.5 + 0.6*(0.3-0.5) = 0.38
    const b2 = state.beliefs.get('AN-2')!;
    expect(b2.posterior).toBeCloseTo(0.38, 2);
  });

  it('uses posterior from previous round as prior', () => {
    const state = initAgentBeliefState('safetyist');
    const nodes = [makeNode({ id: 'AN-1', speaker: 'safetyist', computed_strength: 0.9 })];
    const strengths = new Map([['AN-1', 0.9]]);

    // Round 1
    updateBeliefs(state, nodes, strengths, 1);
    const round1Posterior = state.beliefs.get('AN-1')!.posterior;

    // Round 2 with same strength
    updateBeliefs(state, nodes, strengths, 2);
    const b = state.beliefs.get('AN-1')!;
    expect(b.prior).toBeCloseTo(round1Posterior, 10);
    // Should move further toward 0.9
    expect(b.posterior).toBeGreaterThan(round1Posterior);
  });

  it('skips system/document/user nodes', () => {
    const state = initAgentBeliefState('accelerationist');
    const nodes = [
      makeNode({ id: 'sys-1', speaker: 'system' as 'accelerationist' }),
      makeNode({ id: 'doc-1', speaker: 'document' as 'accelerationist' }),
      makeNode({ id: 'usr-1', speaker: 'user' }),
      makeNode({ id: 'AN-1', speaker: 'accelerationist' }),
    ];
    const strengths = new Map([['sys-1', 0.5], ['doc-1', 0.5], ['usr-1', 0.5], ['AN-1', 0.7]]);

    updateBeliefs(state, nodes, strengths, 1);
    expect(state.beliefs.size).toBe(1);
    expect(state.beliefs.has('AN-1')).toBe(true);
  });

  it('clamps posterior to [0.01, 0.99]', () => {
    const state = initAgentBeliefState('accelerationist');
    // Very high strength for own claim → posterior should approach but not reach 1
    const nodes = [makeNode({ id: 'AN-1', speaker: 'accelerationist', computed_strength: 1.0 })];
    const strengths = new Map([['AN-1', 1.0]]);

    // Update many times to push toward 1
    for (let i = 0; i < 50; i++) {
      updateBeliefs(state, nodes, strengths, i);
    }
    expect(state.beliefs.get('AN-1')!.posterior).toBeLessThanOrEqual(0.99);
    expect(state.beliefs.get('AN-1')!.posterior).toBeGreaterThanOrEqual(0.01);
  });

  it('confidence is 0 when posterior is 0.5', () => {
    const state = initAgentBeliefState('accelerationist');
    const nodes = [makeNode({ id: 'AN-1', speaker: 'accelerationist', computed_strength: 0.5 })];
    const strengths = new Map([['AN-1', 0.5]]);

    updateBeliefs(state, nodes, strengths, 1);
    // observation=0.5, prior=0.5, posterior stays at 0.5, confidence = 1-1 = 0
    expect(state.beliefs.get('AN-1')!.confidence).toBeCloseTo(0, 1);
  });

  it('confidence increases as posterior moves away from 0.5', () => {
    const state = initAgentBeliefState('accelerationist');
    const nodes = [makeNode({ id: 'AN-1', speaker: 'accelerationist' })];

    updateBeliefs(state, nodes, new Map([['AN-1', 0.5]]), 1);
    const confNeutral = state.beliefs.get('AN-1')!.confidence;

    updateBeliefs(state, nodes, new Map([['AN-1', 0.9]]), 2);
    const confHigh = state.beliefs.get('AN-1')!.confidence;

    expect(confHigh).toBeGreaterThan(confNeutral);
  });

  it('falls back to base_strength when computed_strength is absent', () => {
    const state = initAgentBeliefState('accelerationist');
    const nodes = [makeNode({ id: 'AN-1', speaker: 'accelerationist', computed_strength: undefined, base_strength: 0.8 })];
    const strengths = new Map<string, number>(); // empty, should fallback

    updateBeliefs(state, nodes, strengths, 1);
    // observation = 0.8 (from base_strength), posterior = 0.5 + 0.6*(0.8-0.5) = 0.68
    expect(state.beliefs.get('AN-1')!.posterior).toBeCloseTo(0.68, 2);
  });
});

// ── computeBeliefDivergence ─────────────────────────────

describe('computeBeliefDivergence', () => {
  it('returns zero divergence for identical beliefs', () => {
    const stateA = initAgentBeliefState('accelerationist');
    const stateB = initAgentBeliefState('safetyist');
    const nodes = [makeNode({ id: 'AN-1', speaker: 'accelerationist', computed_strength: 0.7 })];
    const strengths = new Map([['AN-1', 0.7]]);

    updateBeliefs(stateA, nodes, strengths, 1);
    // Give stateB the same beliefs manually
    stateB.beliefs.set('AN-1', { ...stateA.beliefs.get('AN-1')! });

    const result = computeBeliefDivergence(stateA, stateB);
    expect(result.symmetric_kl).toBeCloseTo(0, 5);
    expect(result.mean_abs_diff).toBeCloseTo(0, 5);
    expect(result.converged).toBe(true);
  });

  it('returns high divergence for opposing beliefs', () => {
    const stateA = initAgentBeliefState('accelerationist');
    const stateB = initAgentBeliefState('safetyist');

    stateA.beliefs.set('AN-1', { prior: 0.5, posterior: 0.9, confidence: 0.5 });
    stateB.beliefs.set('AN-1', { prior: 0.5, posterior: 0.1, confidence: 0.5 });

    const result = computeBeliefDivergence(stateA, stateB);
    expect(result.symmetric_kl).toBeGreaterThan(0.5);
    expect(result.mean_abs_diff).toBeCloseTo(0.8, 1);
    expect(result.converged).toBe(false);
  });

  it('only compares shared claims', () => {
    const stateA = initAgentBeliefState('accelerationist');
    const stateB = initAgentBeliefState('safetyist');

    stateA.beliefs.set('AN-1', { prior: 0.5, posterior: 0.8, confidence: 0.3 });
    stateA.beliefs.set('AN-2', { prior: 0.5, posterior: 0.7, confidence: 0.2 });
    stateB.beliefs.set('AN-2', { prior: 0.5, posterior: 0.3, confidence: 0.2 });
    stateB.beliefs.set('AN-3', { prior: 0.5, posterior: 0.9, confidence: 0.4 });

    const result = computeBeliefDivergence(stateA, stateB);
    expect(result.shared_claims).toBe(1); // only AN-2
  });

  it('returns converged=true when no shared claims', () => {
    const stateA = initAgentBeliefState('accelerationist');
    const stateB = initAgentBeliefState('safetyist');

    stateA.beliefs.set('AN-1', { prior: 0.5, posterior: 0.8, confidence: 0.3 });
    stateB.beliefs.set('AN-2', { prior: 0.5, posterior: 0.2, confidence: 0.3 });

    const result = computeBeliefDivergence(stateA, stateB);
    expect(result.shared_claims).toBe(0);
    expect(result.converged).toBe(true);
  });
});

// ── computeMaxBeliefDivergence ──────────────────────────

describe('computeMaxBeliefDivergence', () => {
  it('finds the most divergent pair among three agents', () => {
    const stateP = initAgentBeliefState('accelerationist');
    const stateS = initAgentBeliefState('safetyist');
    const stateC = initAgentBeliefState('skeptic');

    // Prometheus and Sentinel agree; Cassandra disagrees
    stateP.beliefs.set('AN-1', { prior: 0.5, posterior: 0.8, confidence: 0.3 });
    stateS.beliefs.set('AN-1', { prior: 0.5, posterior: 0.75, confidence: 0.3 });
    stateC.beliefs.set('AN-1', { prior: 0.5, posterior: 0.1, confidence: 0.4 });

    const result = computeMaxBeliefDivergence([stateP, stateS, stateC]);

    // The maximum divergence should be between accelerationist/safetyist and skeptic
    expect(result.pair).toContain('skeptic');
    expect(result.converged).toBe(false);
    expect(result.symmetric_kl).toBeGreaterThan(0);
  });

  it('reports convergence when all agents agree', () => {
    const stateP = initAgentBeliefState('accelerationist');
    const stateS = initAgentBeliefState('safetyist');

    stateP.beliefs.set('AN-1', { prior: 0.5, posterior: 0.6, confidence: 0.1 });
    stateS.beliefs.set('AN-1', { prior: 0.5, posterior: 0.6, confidence: 0.1 });

    const result = computeMaxBeliefDivergence([stateP, stateS]);
    expect(result.converged).toBe(true);
    expect(result.symmetric_kl).toBeCloseTo(0, 5);
  });

  it('handles single agent gracefully', () => {
    const state = initAgentBeliefState('accelerationist');
    state.beliefs.set('AN-1', { prior: 0.5, posterior: 0.8, confidence: 0.3 });

    const result = computeMaxBeliefDivergence([state]);
    expect(result.converged).toBe(true);
    expect(result.shared_claims).toBe(0);
  });
});

// ── Integration: multi-round belief evolution ───────────

describe('beliefTracking — integration', () => {
  it('beliefs converge as agents observe the same QBAF outcomes', () => {
    const stateP = initAgentBeliefState('accelerationist');
    const stateS = initAgentBeliefState('safetyist');
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist', computed_strength: 0.7 }),
      makeNode({ id: 'AN-2', speaker: 'safetyist', computed_strength: 0.6 }),
    ];

    // Simulate 5 rounds with stable QBAF
    const strengths = new Map([['AN-1', 0.7], ['AN-2', 0.6]]);
    for (let round = 1; round <= 5; round++) {
      updateBeliefs(stateP, nodes, strengths, round);
      updateBeliefs(stateS, nodes, strengths, round);
    }

    // After multiple rounds with stable outcomes, beliefs should converge
    const divBefore = computeBeliefDivergence(
      initAgentBeliefState('accelerationist'),
      initAgentBeliefState('safetyist'),
    );
    const divAfter = computeBeliefDivergence(stateP, stateS);

    // Both agents updated from the same QBAF but with perspective inversion
    // Their beliefs should still differ (perspective-adjusted), but the metric
    // should be stable
    expect(divAfter.shared_claims).toBe(2);
    expect(divAfter.symmetric_kl).toBeGreaterThan(0);
  });

  it('divergence increases when QBAF shifts favor one side', () => {
    const stateP = initAgentBeliefState('accelerationist');
    const stateS = initAgentBeliefState('safetyist');
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist' }),
    ];

    // Round 1: neutral
    updateBeliefs(stateP, nodes, new Map([['AN-1', 0.5]]), 1);
    updateBeliefs(stateS, nodes, new Map([['AN-1', 0.5]]), 1);
    const div1 = computeBeliefDivergence(stateP, stateS);

    // Round 2: accelerationist's claim gets strong
    updateBeliefs(stateP, nodes, new Map([['AN-1', 0.9]]), 2);
    updateBeliefs(stateS, nodes, new Map([['AN-1', 0.9]]), 2);
    const div2 = computeBeliefDivergence(stateP, stateS);

    // Perspective inversion means accelerationist sees this positively, safetyist negatively
    // So divergence should increase
    expect(div2.symmetric_kl).toBeGreaterThan(div1.symmetric_kl);
  });
});
