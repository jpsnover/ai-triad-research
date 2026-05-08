// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Tests for debate engine validation gaps 11.4, 11.5, 11.6, 11.7.
 */

import { describe, it, expect } from 'vitest';
import {
  assemblePipelineResult,
  assembleOpeningPipelineResult,
  runTurnPipeline,
} from '../../../../lib/debate/turnPipeline';
import type { TurnPipelineResult, OpeningPipelineResult } from '../../../../lib/debate/types';
import { validateTurn } from '../../../../lib/debate/turnValidator';
import type { ValidateTurnParams } from '../../../../lib/debate/turnValidator';
import { resolveTurnValidationConfig } from '../../../../lib/debate/turnValidator';

// ── Helpers ───────────────────────────────────────────────

function basePipelineResult(): TurnPipelineResult {
  return {
    brief: {
      situation_assessment: 'test',
      key_claims_to_address: [],
      relevant_taxonomy_nodes: [],
      relevant_commitments: [],
      edge_tensions: [],
      phase_considerations: '',
    },
    plan: {
      strategic_goal: 'test',
      planned_moves: [],
      target_claims: [],
      argument_sketch: '',
      anticipated_responses: [],
      evidence_needed: [],
    },
    draft: {
      statement: 'AI safety requires careful empirical measurement of model capabilities before deployment to production environments.',
      turn_symbols: [],
      claim_sketches: [],
      key_assumptions: [],
      disagreement_type: 'EMPIRICAL',
    },
    cite: {
      taxonomy_refs: [],
      policy_refs: [],
      move_annotations: [{ move: 'DISTINGUISH', detail: 'test' }],
      grounding_confidence: 0.8,
    },
    stage_diagnostics: [],
    total_time_ms: 100,
  };
}

function baseValidateParams(overrides?: Partial<ValidateTurnParams>): ValidateTurnParams {
  return {
    statement: 'AI safety requires empirical measurement.\n\nWe need standardized benchmarks.\n\nDeployment should be gated on passing these benchmarks.',
    taxonomyRefs: [{ node_id: 'saf-beliefs-001', relevance: 'This node captures the empirical measurement framework that underpins responsible deployment gating mechanisms.' }],
    meta: {
      move_types: [{ move: 'DISTINGUISH', target: 'test', detail: 'distinguishing approaches' }],
      disagreement_type: 'EMPIRICAL',
      my_claims: [{ claim: 'Safety benchmarks should be mandatory', targets: ['acc-beliefs-001'] }],
    },
    phase: 'argumentation',
    speaker: 'sentinel',
    round: 3,
    priorTurns: [],
    recentTurns: [],
    knownNodeIds: new Set(['saf-beliefs-001', 'acc-beliefs-001']),
    policyIds: new Set(),
    config: resolveTurnValidationConfig({ deterministicOnly: true }),
    callJudge: async () => '{}',
    ...overrides,
  };
}

// ── Gap 11.4: my_claims validated against statement text ──

describe('assemblePipelineResult — my_claims grounding (gap 11.4)', () => {
  it('keeps claims with ≥40% word overlap to statement', () => {
    const result = basePipelineResult();
    result.draft.claim_sketches = [
      { claim: 'AI safety requires careful empirical measurement of capabilities', targets: ['saf-001'] },
    ];
    const { meta } = assemblePipelineResult(result);
    expect(meta.my_claims).toHaveLength(1);
  });

  it('filters out claims with <40% word overlap (fabricated)', () => {
    const result = basePipelineResult();
    result.draft.claim_sketches = [
      { claim: 'International trade tariffs reduce consumer purchasing power across all sectors', targets: ['econ-001'] },
    ];
    const { meta } = assemblePipelineResult(result);
    expect(meta.my_claims).toBeUndefined();
  });

  it('keeps grounded claims and filters fabricated from same batch', () => {
    const result = basePipelineResult();
    result.draft.claim_sketches = [
      { claim: 'empirical measurement of model capabilities before deployment', targets: ['saf-001'] },
      { claim: 'ocean acidification threatens coral reef ecosystems worldwide', targets: ['env-001'] },
    ];
    const { meta } = assemblePipelineResult(result);
    expect(meta.my_claims).toHaveLength(1);
    expect(meta.my_claims![0].claim).toContain('empirical measurement');
  });

  it('works in assembleOpeningPipelineResult too', () => {
    const result: OpeningPipelineResult = {
      brief: { situation_assessment: '', strongest_angles: [], relevant_taxonomy_nodes: [], key_tensions: [] },
      plan: { strategic_goal: '', core_thesis: '', argument_structure: [], framing_choices: '', anticipated_challenges: [] },
      draft: {
        statement: 'Scaling laws demonstrate consistent capability gains.',
        turn_symbols: [],
        claim_sketches: [
          { claim: 'Scaling laws demonstrate consistent capability gains', targets: ['acc-001'] },
          { claim: 'Unrelated marine biology claim about dolphins', targets: ['bio-001'] },
        ],
        key_assumptions: [],
        disagreement_type: 'EMPIRICAL',
      },
      cite: { taxonomy_refs: [], policy_refs: [], grounding_confidence: 0.8 },
      stage_diagnostics: [],
      total_time_ms: 50,
    };
    const { meta } = assembleOpeningPipelineResult(result);
    expect(meta.my_claims).toHaveLength(1);
  });
});

// ── Gap 11.5: Judge fallback conservative defaults ──

describe('validateTurn — judge fallback (gap 11.5)', () => {
  it('returns accept_with_flag when judge returns unparseable response', async () => {
    const params = baseValidateParams({
      config: resolveTurnValidationConfig({ deterministicOnly: false }),
      callJudge: async () => 'THIS IS NOT JSON AT ALL {{{',
    });
    const result = await validateTurn(params);
    // parseJudgeVerdict fallback now returns advances: false, recommend: 'accept_with_flag'
    expect(result.outcome).toBe('accept_with_flag');
  });

  it('returns accept_with_flag when both judge calls throw', async () => {
    const params = baseValidateParams({
      config: resolveTurnValidationConfig({ deterministicOnly: false }),
      callJudge: async () => { throw new Error('API down'); },
      callJudgeFallback: async () => { throw new Error('Fallback also down'); },
    });
    const result = await validateTurn(params);
    // judge attempted but fully failed — advancement defaults to false
    expect(result.dimensions.advancement.pass).toBe(false);
  });
});

// ── Gap 11.6: Pipeline aborts on Brief/Plan parse failure ──

describe('runTurnPipeline — early abort (gap 11.6)', () => {
  it('throws when brief stage returns unparseable response', async () => {
    const generate = async () => 'NOT JSON';
    await expect(
      runTurnPipeline(
        {
          label: 'test', pov: 'safetyist', personality: 'test', topic: 'test',
          taxonomyContext: '', commitmentContext: '', establishedPoints: '',
          edgeContext: '', concessionHint: '', recentTranscript: '',
          focusPoint: '', addressing: 'all', phase: 'argumentation',
          priorMoves: [], priorRefs: [], availablePovNodeIds: [],
          model: 'test-model',
        },
        generate,
      ),
    ).rejects.toThrow('Brief stage failed to parse');
  });

  it('throws when plan stage returns unparseable response', async () => {
    let callCount = 0;
    const generate = async () => {
      callCount++;
      if (callCount === 1) {
        // Brief succeeds
        return JSON.stringify({
          situation_assessment: 'ok',
          key_claims_to_address: [],
          relevant_taxonomy_nodes: [],
          relevant_commitments: [],
          edge_tensions: [],
          phase_considerations: '',
        });
      }
      // Plan fails
      return '<<TRUNCATED';
    };
    await expect(
      runTurnPipeline(
        {
          label: 'test', pov: 'safetyist', personality: 'test', topic: 'test',
          taxonomyContext: '', commitmentContext: '', establishedPoints: '',
          edgeContext: '', concessionHint: '', recentTranscript: '',
          focusPoint: '', addressing: 'all', phase: 'argumentation',
          priorMoves: [], priorRefs: [], availablePovNodeIds: [],
          model: 'test-model',
        },
        generate,
      ),
    ).rejects.toThrow('Plan stage failed to parse');
  });
});

// ── Gap 11.7: Strengthened filler detection ──

describe('validateTurn — filler relevance detection (gap 11.7)', () => {
  it('rejects relevance that is mostly stop-words', async () => {
    const params = baseValidateParams({
      taxonomyRefs: [{
        node_id: 'saf-beliefs-001',
        relevance: 'This is very important and supports my position regarding this debate point overall clearly.',
      }],
    });
    const result = await validateTurn(params);
    expect(result.dimensions.grounding.pass).toBe(false);
  });

  it('rejects relevance with no domain-specific terms', async () => {
    const params = baseValidateParams({
      taxonomyRefs: [{
        node_id: 'saf-beliefs-001',
        relevance: 'This view is just about what would come from that point being more there.',
      }],
    });
    const result = await validateTurn(params);
    expect(result.dimensions.grounding.pass).toBe(false);
  });

  it('accepts relevance with domain-specific content', async () => {
    const params = baseValidateParams({
      taxonomyRefs: [{
        node_id: 'saf-beliefs-001',
        relevance: 'This node captures the empirical measurement framework that underpins responsible deployment gating mechanisms.',
      }],
    });
    const result = await validateTurn(params);
    expect(result.dimensions.grounding.pass).toBe(true);
  });
});
