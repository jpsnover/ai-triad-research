// Regression tests for t/2229: graceful degradation when brief/plan parse retries are exhausted.
// Covers: pipeline completes (no throw) on brief exhaustion, plan exhaustion; flag reaches result + stage_diagnostics.
// Opening pipeline is NOT tested here — it still throws on exhaustion (by design).

import { describe, it, expect, vi } from 'vitest';
import { runTurnPipeline } from '../turnPipeline.js';
import type { TurnPipelineInput, StageGenerateFn } from '../turnPipeline.js';

// ── Shared fixtures ──────────────────────────────────────

const VALID_BRIEF = {
  situation_assessment: 'Debate centers on AI governance.',
  key_claims_to_address: [],
  relevant_commitments: [],
  edge_tensions: [],
  phase_considerations: 'argumentation',
};

const VALID_PLAN = {
  strategic_goal: 'Rebut the overreach argument by citing proportionate-regulation evidence from the EU AI Act.',
  planned_moves: [{ move: 'REBUT', target: 'safetyist', detail: 'Cite EU AI Act data showing risk-based frameworks outperform blanket bans.' }],
  target_claims: ['strict regulation is counterproductive'],
  argument_sketch: 'Use EU AI Act 2026 compliance data to show risk-based frameworks outperform blanket restrictions while preserving safety outcomes.',
  anticipated_responses: ['Safetyist may cite recent safety incidents'],
};

const VALID_DRAFT = {
  statement: 'Proportionate regulation frameworks produce better outcomes.',
  turn_symbols: [],
  claim_sketches: [{ claim: 'Proportionate regulation works', targets: [] }],
  key_assumptions: [],
  disagreement_type: 'EMPIRICAL',
};

const VALID_CITE = { taxonomy_refs: [], policy_refs: [], move_annotations: [], grounding_confidence: 0.8 };

function makeBaseInput(overrides?: Partial<TurnPipelineInput>): TurnPipelineInput {
  return {
    label: 'Accelerationist',
    pov: 'accelerationist',
    personality: 'Bold',
    topic: 'AI governance',
    taxonomyContext: '',
    commitmentContext: '',
    establishedPoints: '',
    edgeContext: '',
    concessionHint: '',
    recentTranscript: 'Safetyist: Strict regulation needed.',
    focusPoint: 'regulation',
    addressing: 'Safetyist',
    phase: 'argumentation',
    priorMoves: ['REBUT'],
    turnsSinceLastConcession: 2,
    priorRefs: [],
    availablePovNodeIds: [],
    model: 'test-model',
    skipPreCheck: true,
    ...overrides,
  };
}

// Returns broken JSON for `stage` on every call; other stages return valid JSON.
function makeAlwaysFailGenerate(stage: string): StageGenerateFn {
  return vi.fn(async (_p: string, _m: string, _o: unknown, label: string) => {
    if (label.includes(stage)) return '<<<broken json that cannot parse>>>';
    if (label.includes('brief')) return JSON.stringify(VALID_BRIEF);
    if (label.includes('plan')) return JSON.stringify(VALID_PLAN);
    if (label.includes('draft')) return JSON.stringify(VALID_DRAFT);
    if (label.includes('cite')) return JSON.stringify(VALID_CITE);
    return '{}';
  }) as unknown as StageGenerateFn;
}

// ── Brief exhaustion → degrade ───────────────────────────

describe('runTurnPipeline brief exhaustion → graceful degradation (t/2229)', () => {
  it('does not throw and returns degraded_turn: true when brief always fails', async () => {
    const generate = makeAlwaysFailGenerate('brief');
    const result = await runTurnPipeline(makeBaseInput(), generate);
    expect(result.degraded_turn).toBe(true);
  });

  it('marks the last brief stage_diagnostic with degraded: true', async () => {
    const generate = makeAlwaysFailGenerate('brief');
    const result = await runTurnPipeline(makeBaseInput(), generate);
    const briefDiags = result.stage_diagnostics.filter(d => d.stage === 'brief');
    expect(briefDiags.length).toBeGreaterThan(0);
    const lastBriefDiag = briefDiags[briefDiags.length - 1];
    expect((lastBriefDiag as Record<string, unknown>).degraded).toBe(true);
  });

  it('still produces a draft statement when brief is degraded', async () => {
    const generate = makeAlwaysFailGenerate('brief');
    const result = await runTurnPipeline(makeBaseInput(), generate);
    expect(result.draft.statement).toBeTruthy();
  });
});

// ── Plan exhaustion → degrade ────────────────────────────

describe('runTurnPipeline plan exhaustion → graceful degradation (t/2229)', () => {
  it('does not throw and returns degraded_turn: true when plan always fails', async () => {
    const generate = makeAlwaysFailGenerate('plan');
    const result = await runTurnPipeline(makeBaseInput(), generate);
    expect(result.degraded_turn).toBe(true);
  });

  it('marks the last plan stage_diagnostic with degraded: true', async () => {
    const generate = makeAlwaysFailGenerate('plan');
    const result = await runTurnPipeline(makeBaseInput(), generate);
    const planDiags = result.stage_diagnostics.filter(d => d.stage === 'plan');
    expect(planDiags.length).toBeGreaterThan(0);
    const lastPlanDiag = planDiags[planDiags.length - 1];
    expect((lastPlanDiag as Record<string, unknown>).degraded).toBe(true);
  });

  it('still produces a draft statement when plan is degraded', async () => {
    const generate = makeAlwaysFailGenerate('plan');
    const result = await runTurnPipeline(makeBaseInput(), generate);
    expect(result.draft.statement).toBeTruthy();
  });
});

// ── Normal success → no degraded flag ───────────────────

describe('runTurnPipeline normal success — no degraded_turn flag', () => {
  it('does not set degraded_turn when brief and plan parse successfully', async () => {
    const generate = vi.fn(async (_p: string, _m: string, _o: unknown, label: string) => {
      if (label.includes('brief')) return JSON.stringify(VALID_BRIEF);
      if (label.includes('plan')) return JSON.stringify(VALID_PLAN);
      if (label.includes('draft')) return JSON.stringify(VALID_DRAFT);
      if (label.includes('cite')) return JSON.stringify(VALID_CITE);
      return '{}';
    }) as unknown as StageGenerateFn;

    const result = await runTurnPipeline(makeBaseInput(), generate);
    expect(result.degraded_turn).toBeUndefined();
  });
});
