// Pipeline-level fault injection tests — Phase 3 (t/1086).
// Validates turn pipeline behavior under faults at each stage.

import { describe, it, expect, vi } from 'vitest';
import { runTurnPipeline } from '../turnPipeline.js';
import type { TurnPipelineInput, StageGenerateFn } from '../turnPipeline.js';

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
  situation_assessment: 'The debate centers on AI governance approaches.',
  key_claims_to_address: [],
  relevant_commitments: [],
  edge_tensions: [],
  phase_considerations: 'Mid-debate argumentation phase',
};

const VALID_PLAN = {
  strategic_goal: 'Present evidence for proportionate regulation',
  planned_moves: [{ move: 'ASSERT', target: 'safetyist', detail: 'challenge blanket restrictions' }],
  target_claims: ['strict regulation is counterproductive'],
  argument_sketch: 'Use EU AI Act data to show proportionate regulation works.',
  anticipated_responses: ['Safetyist may cite safety incidents'],
};

const VALID_DRAFT = {
  statement: 'The EU AI Act requires 85% of companies to comply by 2026. This proportionate framework outperforms blanket bans, with innovation hubs reporting 40% faster deployment under risk-based frameworks.',
  turn_symbols: [],
  claim_sketches: [
    { claim: 'EU AI Act requires 85% compliance by 2026', targets: [] },
  ],
  key_assumptions: [],
  disagreement_type: 'EMPIRICAL',
};

const VALID_CITE = {
  taxonomy_refs: [],
  policy_refs: [],
  move_annotations: [],
  grounding_confidence: 0.8,
};

type ResponseEntry = [string, string];

function makeGenerate(overrides: ResponseEntry[] = []): StageGenerateFn {
  const defaultResponses: ResponseEntry[] = [
    ['micro-fix', '{}'],
    ['assumptions', '{}'],
    ['cite-retry', JSON.stringify(VALID_CITE)],
    ['draft-quality', '{}'],
    ['scope-drift', '{}'],
    ['brief', JSON.stringify(VALID_BRIEF)],
    ['plan', JSON.stringify(VALID_PLAN)],
    ['draft', JSON.stringify(VALID_DRAFT)],
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

function makeThrowingGenerate(
  targetStage: string,
  baseOverrides: ResponseEntry[] = [],
): StageGenerateFn {
  return vi.fn(async (_prompt: string, _model: string, _options: unknown, label: string) => {
    if (label.includes(targetStage)) {
      throw new Error(`Simulated ${targetStage} failure`);
    }
    const defaults: ResponseEntry[] = [
      ['micro-fix', '{}'],
      ['assumptions', '{}'],
      ['cite-retry', JSON.stringify(VALID_CITE)],
      ['draft-quality', '{}'],
      ['scope-drift', '{}'],
      ['brief', JSON.stringify(VALID_BRIEF)],
      ['plan', JSON.stringify(VALID_PLAN)],
      ['draft', JSON.stringify(VALID_DRAFT)],
      ['cite', JSON.stringify(VALID_CITE)],
    ];
    const merged = [...baseOverrides, ...defaults];
    for (const [key, value] of merged) {
      if (label.includes(key)) return value;
    }
    return '{}';
  }) as unknown as StageGenerateFn;
}

// ── Test 1: BRIEF stage AI failure ──────────────────────

describe('pipeline fault: BRIEF stage AI failure', () => {
  it('degrades the turn (not throw) when brief parse exhausts after retries (t/2229)', async () => {
    const generate = makeGenerate([
      ['brief', '{broken json with no structure'],
    ]);

    const result = await runTurnPipeline(makeBaseInput(), generate);
    expect(result.degraded_turn).toBe(true);
    const briefDiags = result.stage_diagnostics.filter(d => d.stage === 'brief');
    expect((briefDiags[briefDiags.length - 1] as Record<string, unknown>).degraded).toBe(true);
  });

  it('still runs downstream stages after brief exhaustion (degrade path) (t/2229)', async () => {
    const generate = makeGenerate([
      ['brief', '{broken'],
    ]);

    const result = await runTurnPipeline(makeBaseInput(), generate);
    expect(result.degraded_turn).toBe(true);

    const calls = (generate as ReturnType<typeof vi.fn>).mock.calls;
    const labels = calls.map((c: unknown[]) => c[3] as string);
    // After brief exhaustion, pipeline continues: plan, draft, and cite should run
    expect(labels.some((l: string) => l.includes('draft'))).toBe(true);
    expect(labels.some((l: string) => l.includes('cite'))).toBe(true);
  });
});

// ── Test 2: PLAN stage parse failure ────────────────────

describe('pipeline fault: PLAN stage parse failure', () => {
  it('degrades the turn (not throw) when plan parse exhausts after retries (t/2229)', async () => {
    const generate = makeGenerate([
      ['plan', 'not valid json at all {{{'],
    ]);

    const result = await runTurnPipeline(makeBaseInput(), generate);
    expect(result.degraded_turn).toBe(true);
  });

  it('marks the last plan stage_diagnostic with degraded: true on exhaustion (t/2229)', async () => {
    const generate = makeGenerate([
      ['plan', '<<<corrupt>>>'],
    ]);

    const result = await runTurnPipeline(makeBaseInput(), generate);
    expect(result.degraded_turn).toBe(true);
    const planDiags = result.stage_diagnostics.filter(d => d.stage === 'plan');
    expect((planDiags[planDiags.length - 1] as Record<string, unknown>).degraded).toBe(true);
  });
});

// ── Test 3: DRAFT stage salvage path ────────────────────

describe('pipeline fault: DRAFT salvage path', () => {
  it('salvages prose when JSON parse fails but raw text is substantial', async () => {
    const proseText = 'The evidence strongly suggests that proportionate regulation frameworks produce better outcomes than blanket restrictions. The European AI Act implementation data from 2024 through 2026 demonstrates that risk-based approaches lead to faster responsible deployment while maintaining essential safety guardrails for high-risk applications.';

    const generate = makeGenerate([
      ['draft', proseText],
    ]);

    const result = await runTurnPipeline(makeBaseInput(), generate);

    expect(result.draft.statement).toBeTruthy();
    expect(result.draft.statement.length).toBeGreaterThan(100);
    expect(result.draft.statement).toContain('proportionate regulation');
  });

  it('does not salvage short text', async () => {
    const generate = makeGenerate([
      ['draft', 'Too short to salvage.'],
    ]);

    const result = await runTurnPipeline(makeBaseInput(), generate);
    expect(result.draft.statement || '').toBe('');
  });

  it('does not salvage text starting with { (looks like broken JSON)', async () => {
    const brokenJson = '{"statement": "This is a long enough string that would normally be salvaged but it starts with a curly brace so the pipeline should not treat it as prose. The salvage path only kicks in for text that looks like natural language.';

    const generate = makeGenerate([
      ['draft', brokenJson],
    ]);

    const result = await runTurnPipeline(makeBaseInput(), generate);
    expect(result.draft.statement || '').toBe('');
  });
});

// ── Test 4: DRAFT micro-fix exhaustion ──────────────────

describe('pipeline fault: DRAFT micro-fix exhaustion', () => {
  it('falls through to full retry when micro-fixes cannot resolve validation errors', async () => {
    const abstractDraft = {
      statement: 'AI governance is important for society. We need better frameworks to address the many concerns. This topic requires careful consideration from all stakeholders in the industry.',
      claim_sketches: [
        { claim: 'governance matters a lot for everyone', targets: [] },
        { claim: 'we need better approaches going forward', targets: [] },
      ],
      move_types: [{ move: 'ASSERT', target: 'safetyist', detail: 'test' }],
      disagreement_type: 'VALUES',
    };

    const generate = makeGenerate([
      ['draft', JSON.stringify(abstractDraft)],
      ['micro-fix', '{}'],
    ]);

    const result = await runTurnPipeline(makeBaseInput(), generate);

    const calls = (generate as ReturnType<typeof vi.fn>).mock.calls;
    const draftCalls = calls.filter((c: unknown[]) => (c[3] as string).includes('draft') && !(c[3] as string).includes('quality'));
    expect(draftCalls.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Test 5: CITE stage failure ──────────────────────────

describe('pipeline fault: CITE stage failure', () => {
  it('completes pipeline with draft when cite returns corrupt JSON', async () => {
    const generate = makeGenerate([
      ['cite', '{this is not valid cite json at all}}}'],
    ]);

    const result = await runTurnPipeline(makeBaseInput(), generate);

    expect(result.draft.statement).toBeTruthy();
    expect(result.brief.situation_assessment).toBeTruthy();
    expect(result.plan.strategic_goal).toBeTruthy();
  });

  it('returns empty taxonomy_refs when cite fails — not an error', async () => {
    const generate = makeGenerate([
      ['cite', '<<<totally broken>>>'],
      ['cite-retry', '<<<also broken>>>'],
    ]);

    const result = await runTurnPipeline(makeBaseInput(), generate);

    expect(result.cite.taxonomy_refs ?? []).toEqual([]);
    expect(result.draft.statement).toBeTruthy();
  });
});

// ── Test 6: Evidence retrieval failure ──────────────────

describe('pipeline fault: evidence retrieval failure', () => {
  it('proceeds without evidence when sourceEvidenceIndex throws', async () => {
    const badIndex = new Proxy({} as Record<string, unknown>, {
      get() { throw new Error('Simulated evidence retrieval timeout'); },
    });

    const generate = makeGenerate();

    const result = await runTurnPipeline(
      makeBaseInput({
        sourceEvidenceIndex: badIndex as unknown as TurnPipelineInput['sourceEvidenceIndex'],
      }),
      generate,
    );

    expect(result.draft.statement).toBeTruthy();
    expect(result.evidenceBlock ?? '').toBe('');
  });
});

// ── Test 7: Draft quality pre-check failure ─────────────

describe('pipeline fault: draft quality pre-check failure', () => {
  it('proceeds to CITE when quality pre-check generate throws', async () => {
    const generate = makeGenerate();

    const preCheckGenerate = vi.fn(async () => {
      throw new Error('Simulated quality check model failure');
    }) as unknown as StageGenerateFn;

    const result = await runTurnPipeline(
      makeBaseInput({ skipPreCheck: false, preCheckModel: 'quality-model' }),
      generate,
      undefined,
      undefined,
      preCheckGenerate,
    );

    expect(result.draft.statement).toBeTruthy();
    expect(result.cite).toBeDefined();
  });

  it('proceeds to CITE when quality pre-check returns unparseable response', async () => {
    const generate = makeGenerate();

    const preCheckGenerate = vi.fn(async () => {
      return 'not json at all {{{broken';
    }) as unknown as StageGenerateFn;

    const result = await runTurnPipeline(
      makeBaseInput({ skipPreCheck: false, preCheckModel: 'quality-model' }),
      generate,
      undefined,
      undefined,
      preCheckGenerate,
    );

    expect(result.draft.statement).toBeTruthy();
    expect(result.cite).toBeDefined();
  });
});

// ── Test 8: Orchestration-level retry (repairHints) ─────

describe('pipeline fault: orchestration-level retry with repairHints', () => {
  it('reduces MAX_STAGE_RETRIES to 0 when repairHints are provided — degrades after 1 attempt (t/2229)', async () => {
    const generate = makeGenerate([
      ['brief', '{broken json'],
    ]);

    const result = await runTurnPipeline(
      makeBaseInput({ repairHints: ['Fix the draft statement to be more specific'] }),
      generate,
    );
    expect(result.degraded_turn).toBe(true);

    const calls = (generate as ReturnType<typeof vi.fn>).mock.calls;
    const briefCalls = calls.filter((c: unknown[]) => (c[3] as string).includes('brief'));
    // With repairHints (outer retry), MAX_STAGE_RETRIES = 0, so only 1 brief attempt before degrading
    expect(briefCalls.length).toBe(1);
  });

  it('passes repairHints through to draft prompt', async () => {
    const repairHint = 'Fix claim_sketches to include specific numbers and dates';
    const generate = makeGenerate();

    const result = await runTurnPipeline(
      makeBaseInput({
        repairHints: [repairHint],
        frozenBrief: VALID_BRIEF as TurnPipelineInput['frozenBrief'],
        frozenPlan: VALID_PLAN as TurnPipelineInput['frozenPlan'],
      }),
      generate,
    );

    const calls = (generate as ReturnType<typeof vi.fn>).mock.calls;
    const draftCall = calls.find((c: unknown[]) => (c[3] as string).includes('draft') && !(c[3] as string).includes('quality'));
    expect(draftCall).toBeDefined();
    // The repair hint should appear in the draft prompt
    expect(draftCall![0]).toContain(repairHint);
  });
});
