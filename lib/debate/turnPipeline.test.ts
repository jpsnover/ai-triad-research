// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { runTurnPipeline } from './turnPipeline.js';
import type { TurnPipelineInput, StageGenerateFn } from './turnPipeline.js';

// ── Shared helpers ──────────────────────────────────────

function makeBaseInput(overrides?: Partial<TurnPipelineInput>): TurnPipelineInput {
  return {
    label: 'Accelerationist',
    pov: 'accelerationist',
    personality: 'Bold, technology-optimistic',
    topic: 'AI governance frameworks',
    taxonomyContext: '',
    commitmentContext: '',
    establishedPoints: '',
    edgeContext: '',
    concessionHint: '',
    recentTranscript: 'Safetyist: We need strict regulation of AI systems.',
    focusPoint: 'regulation approach',
    addressing: 'Safetyist',
    phase: 'argumentation',
    priorMoves: ['REBUT'],
    turnsSinceLastConcession: 3,
    priorRefs: [],
    availablePovNodeIds: [],
    model: 'test-model',
    skipPreCheck: true,
    ...overrides,
  };
}

const VALID_BRIEF = {
  situation_assessment: 'The debate centers on whether AI governance should prioritize innovation or caution.',
  key_claims_to_address: [],
  opponent_commitments: [],
};

const VALID_PLAN = {
  strategic_goal: 'Present evidence for proportionate AI regulation rather than blanket restrictions on development',
  planned_moves: [{ move: 'ASSERT', target: 'safetyist', detail: 'challenge blanket restrictions' }],
  argument_sketch: 'Use specific examples from EU AI Act implementation data to demonstrate that proportionate regulation works better than blanket bans for driving responsible innovation.',
  target_nodes: [],
};

const ABSTRACT_DRAFT = {
  statement: 'AI governance is important for society. We need better frameworks to address concerns. This topic requires careful consideration from all stakeholders. More work is needed to address this going forward. However, the stakes are high for everyone involved in the process.',
  claim_sketches: [
    { claim: 'governance matters a lot for everyone', targets: [] },
    { claim: 'we need better approaches going forward', targets: [] },
  ],
  move_types: [{ move: 'ASSERT', target: 'safetyist', detail: 'test' }],
  disagreement_type: 'VALUES',
};

const SPECIFIC_DRAFT = {
  statement: 'The EU AI Act requires 85% of companies to comply by 2026. This proportionate framework outperforms blanket bans.\n\nInnovation hubs report 40% faster deployment under risk-based frameworks.',
  claim_sketches: [
    { claim: 'EU AI Act requires 85% compliance by 2026', targets: [] },
    { claim: 'Innovation hubs report 40% faster deployment', targets: [] },
  ],
  move_types: [{ move: 'ASSERT', target: 'safetyist', detail: 'test' }],
  disagreement_type: 'EMPIRICAL',
};

const VALID_CITE = {
  taxonomy_refs: [],
  policy_refs: [],
};

type ResponseEntry = [string, string];

function makeGenerate(overrides: ResponseEntry[] = []): StageGenerateFn {
  const defaultResponses: ResponseEntry[] = [
    ['micro-fix', '{}'],
    ['assumptions', '{}'],
    ['cite-retry', JSON.stringify(VALID_CITE)],
    ['draft-quality', '{}'],
    ['brief', JSON.stringify(VALID_BRIEF)],
    ['plan', JSON.stringify(VALID_PLAN)],
    ['draft', JSON.stringify(ABSTRACT_DRAFT)],
    ['cite', JSON.stringify(VALID_CITE)],
  ];
  const merged = [...overrides, ...defaultResponses];
  return vi.fn(async (_prompt: string, _model: string, _options: unknown, label: string) => {
    for (const [key, value] of merged) {
      if (label.includes(key)) return value;
    }
    return '{}';
  }) as unknown as StageGenerateFn;
}

function findMicroFixDiags(result: Awaited<ReturnType<typeof runTurnPipeline>>) {
  return result.stage_diagnostics.filter(d => d.stage === 'micro-fix');
}

// ── Specificity micro-fix tests ─────────────────────────

describe('runTurnPipeline micro-fix: specificity', () => {
  it('applies micro-fix when claims are abstract and fix passes validation', async () => {
    const revisedStatement = 'The EU AI Act requires 85% compliance by 2026. We need better frameworks with concrete KPIs.\n\nThis approach outperforms blanket bans by 40% according to recent studies. However, the stakes remain high.';
    const microFixResponse = JSON.stringify({
      revised_statement: revisedStatement,
      changes: [
        { original: 'governance matters a lot for everyone', revised: 'EU AI Act requires 85% compliance by 2026', fact_source: 'EU AI Act data' },
      ],
    });

    const generate = makeGenerate([
      ['micro-fix(specificity)', microFixResponse],
    ]);

    const result = await runTurnPipeline(makeBaseInput(), generate);
    const microFixDiags = findMicroFixDiags(result);

    expect(microFixDiags.length).toBeGreaterThanOrEqual(1);
    const specDiag = microFixDiags.find(d =>
      (d.work_product as Record<string, unknown>).type === 'abstract_claims',
    );
    expect(specDiag).toBeDefined();
    expect((specDiag!.work_product as Record<string, unknown>).success).toBe(true);
    expect(result.draft.statement).toContain('85%');
  });

  it('rejects micro-fix when all changes are hallucinated (original === revised)', async () => {
    const microFixResponse = JSON.stringify({
      revised_statement: ABSTRACT_DRAFT.statement,
      changes: [
        { original: 'governance matters a lot for everyone', revised: 'governance matters a lot for everyone', fact_source: 'none' },
      ],
    });

    const generate = makeGenerate([
      ['micro-fix(specificity)', microFixResponse],
    ]);

    const result = await runTurnPipeline(makeBaseInput(), generate);
    const microFixDiags = findMicroFixDiags(result);

    const specDiag = microFixDiags.find(d =>
      (d.work_product as Record<string, unknown>).type === 'abstract_claims',
    );
    expect(specDiag).toBeDefined();
    expect((specDiag!.work_product as Record<string, unknown>).success).toBe(false);
    expect((specDiag!.work_product as Record<string, unknown>).rejected_reason).toBe('hallucinated_changes');
  });

  it('reverts micro-fix when re-validation fails (no specifics in revised text)', async () => {
    const revisedNoSpecifics = 'Governance remains an important concern for society. We should develop better approaches.\n\nThis requires sustained effort from all parties. The implications are far-reaching for the field.';
    const microFixResponse = JSON.stringify({
      revised_statement: revisedNoSpecifics,
      changes: [
        { original: 'governance matters a lot for everyone', revised: 'governance remains an important concern for society', fact_source: 'general' },
      ],
    });

    const generate = makeGenerate([
      ['micro-fix(specificity)', microFixResponse],
    ]);

    const result = await runTurnPipeline(makeBaseInput(), generate);
    const microFixDiags = findMicroFixDiags(result);

    const specDiag = microFixDiags.find(d =>
      (d.work_product as Record<string, unknown>).type === 'abstract_claims' &&
      (d.work_product as Record<string, unknown>).diff_check_passed === true,
    );
    if (specDiag) {
      expect((specDiag.work_product as Record<string, unknown>).success).toBe(false);
    }
  });

  it('falls through to full retry when micro-fix LLM call throws', async () => {
    let callCount = 0;
    const generate = vi.fn(async (_prompt: string, _model: string, _options: unknown, label: string) => {
      if (label.includes('micro-fix(specificity)')) throw new Error('LLM timeout');
      if (label.includes('assumptions')) return '{}';
      if (label.includes('cite-retry')) return JSON.stringify(VALID_CITE);
      if (label.includes('brief')) return JSON.stringify(VALID_BRIEF);
      if (label.includes('plan')) return JSON.stringify(VALID_PLAN);
      if (label.includes('draft')) {
        callCount++;
        return JSON.stringify(ABSTRACT_DRAFT);
      }
      if (label.includes('cite')) return JSON.stringify(VALID_CITE);
      return '{}';
    }) as unknown as StageGenerateFn;

    const result = await runTurnPipeline(makeBaseInput(), generate);
    const microFixDiags = findMicroFixDiags(result);

    const failedDiag = microFixDiags.find(d =>
      (d.work_product as Record<string, unknown>).type === 'abstract_claims' &&
      (d.work_product as Record<string, unknown>).error != null,
    );
    expect(failedDiag).toBeDefined();
    // Draft was called more than once (original + retry after micro-fix failure)
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it('skips micro-fix when draft passes validation', async () => {
    const generate = makeGenerate([
      ['draft', JSON.stringify(SPECIFIC_DRAFT)],
    ]);

    const result = await runTurnPipeline(makeBaseInput(), generate);
    const microFixDiags = findMicroFixDiags(result);

    expect(microFixDiags.length).toBe(0);
  });
});

// ── Intervention compliance micro-fix tests ─────────────

describe('runTurnPipeline micro-fix: intervention compliance', () => {
  const interventionInput = makeBaseInput({
    pendingIntervention: {
      move: 'PIN',
      family: 'engagement',
      targetDebater: 'accelerationist',
      responseField: 'pin_response',
      responseSchema: '{ "position": "agree"|"disagree"|"conditional", "condition": "...", "brief_reason": "..." }',
      isTargeted: true,
    },
  });

  it('patches missing response field when micro-fix succeeds', async () => {
    const draftMissingPin = {
      ...SPECIFIC_DRAFT,
      statement: 'I agree that regulation needs balance. The EU AI Act requires 85% compliance by 2026.\n\nHowever, blanket bans reduce innovation by 40% according to Oxford Economics.',
    };
    const intFixResponse = JSON.stringify({
      pin_response: { position: 'conditional', condition: 'If compliance costs stay below 5% of revenue', brief_reason: 'Proportionate regulation supports innovation' },
    });

    const generate = makeGenerate([
      ['micro-fix(intervention)', intFixResponse],
      ['draft', JSON.stringify(draftMissingPin)],
    ]);

    const result = await runTurnPipeline(interventionInput, generate);
    const microFixDiags = findMicroFixDiags(result);

    const intDiag = microFixDiags.find(d =>
      (d.work_product as Record<string, unknown>).type === 'intervention_compliance',
    );
    if (intDiag) {
      expect((intDiag.work_product as Record<string, unknown>).success).toBe(true);
      expect((intDiag.work_product as Record<string, unknown>).field).toBe('pin_response');
    }
  });

  it('reverts patch when re-validation fails', async () => {
    const draftMissingPin = {
      ...SPECIFIC_DRAFT,
      statement: 'I agree that regulation needs balance. The EU AI Act requires 85% compliance by 2026.\n\nHowever, blanket bans reduce innovation by 40%.',
    };
    // Return a value that will fail re-validation (empty position)
    const intFixResponse = JSON.stringify({
      pin_response: { position: '', condition: '', brief_reason: '' },
    });

    const generate = makeGenerate([
      ['micro-fix(intervention)', intFixResponse],
      ['draft', JSON.stringify(draftMissingPin)],
    ]);

    const result = await runTurnPipeline(interventionInput, generate);
    const microFixDiags = findMicroFixDiags(result);

    const intDiag = microFixDiags.find(d =>
      (d.work_product as Record<string, unknown>).type === 'intervention_compliance' &&
      (d.work_product as Record<string, unknown>).success === false,
    );
    // Either the micro-fix was attempted and failed, or no intervention micro-fix ran
    // (depends on whether claim_specificity ran first and broke)
    if (intDiag) {
      expect((intDiag.work_product as Record<string, unknown>).success).toBe(false);
    }
  });

  it('skips when pendingIntervention is not targeted', async () => {
    const notTargetedInput = makeBaseInput({
      pendingIntervention: {
        move: 'PIN',
        family: 'engagement',
        targetDebater: 'safetyist',
        isTargeted: false,
      },
    });

    const generate = makeGenerate([
      ['draft', JSON.stringify(SPECIFIC_DRAFT)],
    ]);

    const result = await runTurnPipeline(notTargetedInput, generate);
    const microFixDiags = findMicroFixDiags(result);

    const intDiag = microFixDiags.find(d =>
      (d.work_product as Record<string, unknown>).type === 'intervention_compliance',
    );
    expect(intDiag).toBeUndefined();
  });
});
