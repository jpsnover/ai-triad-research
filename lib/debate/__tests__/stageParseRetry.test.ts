// Regression tests for t/2228: stage parse-failure retry (brief + plan, runTurnPipeline + runOpeningPipeline).
// Covers: success-after-retry (guard fires, pipeline completes) and exhaustion (guard bounds, throws after MAX_STAGE_RETRIES+1).

import { describe, it, expect, vi } from 'vitest';
import { runTurnPipeline, runOpeningPipeline } from '../turnPipeline.js';
import type { TurnPipelineInput, StageGenerateFn } from '../turnPipeline.js';
import type { OpeningPipelineInput } from '../turnPipeline.js';
import { ActionableError } from '../errors.js';

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
  statement: 'Proportionate regulation frameworks produce better outcomes than blanket restrictions, as EU AI Act 2026 compliance data demonstrates.',
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

function makeOpeningInput(overrides?: Partial<OpeningPipelineInput>): OpeningPipelineInput {
  return {
    label: 'Accelerationist',
    pov: 'accelerationist',
    personality: 'Bold',
    topic: 'AI governance',
    taxonomyContext: '',
    priorStatements: '',
    isFirst: true,
    model: 'test-model',
    briefMaxRetries: 0, // disable timeout-retry path for these tests
    ...overrides,
  };
}

// Generate factory: returns broken JSON for a stage the first N times, then valid JSON.
function makeRetryingGenerate(
  stage: string,
  failCount: number,
  validResponse: string,
): { generate: StageGenerateFn; callCount: () => number } {
  let count = 0;
  const generate = vi.fn(async (_p: string, _m: string, _o: unknown, label: string) => {
    if (label.includes(stage)) {
      count++;
      if (count <= failCount) return '<<<broken json that cannot parse>>>';
      return validResponse;
    }
    if (label.includes('brief')) return JSON.stringify(VALID_BRIEF);
    if (label.includes('plan')) return JSON.stringify(VALID_PLAN);
    if (label.includes('draft')) return JSON.stringify(VALID_DRAFT);
    if (label.includes('cite')) return JSON.stringify(VALID_CITE);
    return '{}';
  }) as unknown as StageGenerateFn;
  return { generate, callCount: () => count };
}

// ── runTurnPipeline: PLAN stage retry ────────────────────

describe('runTurnPipeline plan-stage parse-failure retry (t/2228)', () => {
  it('retries plan parse failure and completes pipeline on second attempt', async () => {
    const { generate, callCount } = makeRetryingGenerate('plan', 1, JSON.stringify(VALID_PLAN));
    const result = await runTurnPipeline(makeBaseInput(), generate);
    expect(result.draft.statement).toBeTruthy();
    expect(callCount()).toBe(2);
  });

  it('retries plan parse failure 3 times and succeeds on 4th attempt', async () => {
    const { generate, callCount } = makeRetryingGenerate('plan', 3, JSON.stringify(VALID_PLAN));
    const result = await runTurnPipeline(makeBaseInput(), generate);
    expect(result.draft.statement).toBeTruthy();
    expect(callCount()).toBe(4);
  });

  it('degrades the turn after exhausting all plan parse retries (MAX_STAGE_RETRIES+1 = 4 attempts) (t/2229)', async () => {
    const { generate, callCount } = makeRetryingGenerate('plan', 999, '');
    const result = await runTurnPipeline(makeBaseInput(), generate);
    expect(result.degraded_turn).toBe(true);
    expect(callCount()).toBe(4);
  });
});

// ── runTurnPipeline: BRIEF stage retry ───────────────────

describe('runTurnPipeline brief-stage parse-failure retry (t/2228)', () => {
  it('retries brief parse failure and completes pipeline on second attempt', async () => {
    const { generate, callCount } = makeRetryingGenerate('brief', 1, JSON.stringify(VALID_BRIEF));
    const result = await runTurnPipeline(makeBaseInput(), generate);
    expect(result.draft.statement).toBeTruthy();
    expect(callCount()).toBe(2);
  });

  it('degrades the turn after exhausting all brief parse retries (t/2229)', async () => {
    const { generate, callCount } = makeRetryingGenerate('brief', 999, '');
    const result = await runTurnPipeline(makeBaseInput(), generate);
    expect(result.degraded_turn).toBe(true);
    expect(callCount()).toBe(4);
  });
});

// ── runOpeningPipeline: PLAN stage retry (new loop, t/2228) ─

const VALID_OPENING_DRAFT = {
  statement: 'AI governance requires proportionate frameworks that balance safety with innovation across deployment contexts.',
  claim_sketches: [],
};
const VALID_OPENING_CITE = { taxonomy_refs: [], policy_refs: [] };

function makeOpeningRetryGenerate(
  stage: string,
  failCount: number,
  validResponse: string,
): { generate: StageGenerateFn; callCount: () => number } {
  let count = 0;
  const generate = vi.fn(async (_p: string, _m: string, _o: unknown, label: string) => {
    if (label.includes(stage)) {
      count++;
      if (count <= failCount) return '<<<broken>>>';
      return validResponse;
    }
    if (label.includes('opening brief')) return JSON.stringify(VALID_BRIEF);
    if (label.includes('opening plan')) return JSON.stringify(VALID_PLAN);
    if (label.includes('opening draft')) return JSON.stringify(VALID_OPENING_DRAFT);
    if (label.includes('opening cite')) return JSON.stringify(VALID_OPENING_CITE);
    return '{}';
  }) as unknown as StageGenerateFn;
  return { generate, callCount: () => count };
}

describe('runOpeningPipeline plan-stage parse-failure retry (t/2228)', () => {
  it('retries opening plan parse failure and completes on second attempt', async () => {
    const { generate, callCount } = makeOpeningRetryGenerate('opening plan', 1, JSON.stringify(VALID_PLAN));
    const result = await runOpeningPipeline(makeOpeningInput(), generate);
    expect(result.brief).toBeTruthy();
    expect(result.plan).toBeTruthy();
    expect(callCount()).toBe(2);
  });

  it('throws ActionableError after exhausting all opening plan parse retries', async () => {
    const { generate, callCount } = makeOpeningRetryGenerate('opening plan', 999, '');
    try {
      await runOpeningPipeline(makeOpeningInput(), generate);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ActionableError);
      expect((err as ActionableError).problem).toMatch(/Plan stage failed to parse after 4 attempt\(s\)/);
    }
    expect(callCount()).toBe(4);
  });
});

describe('runOpeningPipeline brief-stage parse-failure retry (t/2228)', () => {
  it('retries opening brief parse failure and completes on second attempt', async () => {
    const { generate, callCount } = makeOpeningRetryGenerate('opening brief', 1, JSON.stringify(VALID_BRIEF));
    const result = await runOpeningPipeline(makeOpeningInput(), generate);
    expect(result.brief).toBeTruthy();
    expect(callCount()).toBe(2);
  });

  it('throws ActionableError after exhausting all opening brief parse retries', async () => {
    const { generate, callCount } = makeOpeningRetryGenerate('opening brief', 999, '');
    await expect(runOpeningPipeline(makeOpeningInput(), generate)).rejects.toBeInstanceOf(ActionableError);
    expect(callCount()).toBe(4);
  });
});
