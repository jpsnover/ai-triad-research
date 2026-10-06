// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3850 invariant tests:
//   1. `total` is constant across every progress emission of a single run.
//   2. The final `step` equals `total` for a normally-completing run.
// Both invariants were violated by the original t/3845 implementation:
//   - Opening denominator jumped 4-of-4 → 5-of-5 on repair (hardcoded literal).
//   - Micro-fix ran silently, making the counter appear to hang.

import { describe, it, expect } from 'vitest';
import { runOpeningPipelineWithRepair, OPENING_TOTAL_STAGES } from './opening.js';
import type { OpeningPipelineInput } from './opening.js';
import { runTurnPipeline } from './runTurn.js';
import type { TurnPipelineInput } from './types.js';
import { POVER_INFO } from '../types.js';
import type { StageProgressFn } from './types.js';

// ── Opening stubs ────────────────────────────────────────────────────────────

const OPENING_STUB = JSON.stringify({
  statement: 'test', claim_sketches: [], key_assumptions: [],
  beliefs: [], values: [], reasoning: [],
  plan: [], topics: [], taxonomy_refs: [], policy_refs: [],
});

// Cite response with an unknown node_id — triggers validateCiteStage Rule 3
// (only fires when knownNodeIds.size > 0, so input must set availablePovNodeIds)
const CITE_REPAIR_TRIGGER = JSON.stringify({
  statement: 'test', claim_sketches: [], key_assumptions: [],
  beliefs: [], values: [], reasoning: [],
  plan: [], topics: [], policy_refs: [],
  taxonomy_refs: [{ node_id: 'unknown-node', relevance: 'This relevance text is long enough to pass the 40-char filler validation check used in Rule 5.' }],
});

function makeOpeningInput(overrides: Partial<OpeningPipelineInput> = {}): OpeningPipelineInput {
  return { label: 'TestAgent', pov: 'acc', soul: POVER_INFO['accelerationist'], personality: 'test', topic: 'test topic', taxonomyContext: '', priorStatements: '', isFirst: true, model: 'test-model', ...overrides };
}

// ── Turn stubs ───────────────────────────────────────────────────────────────

const TURN_STUB = JSON.stringify({
  // Brief
  situation_assessment: 'test', key_claims_to_address: [], relevant_commitments: [], edge_tensions: [], phase_considerations: 'test',
  // Plan
  strategic_goal: 'test', planned_moves: [], target_claims: [], argument_sketch: 'test', anticipated_responses: [],
  // Draft
  statement: 'Test statement for validation. Contains enough words.',
  turn_symbols: [], claim_sketches: [], key_assumptions: [], disagreement_type: 'EMPIRICAL',
  // Cite
  taxonomy_refs: [], policy_refs: [], move_annotations: [], grounding_confidence: 0.9,
});

function makeTurnInput(overrides: Partial<TurnPipelineInput> = {}): TurnPipelineInput {
  return {
    label: 'TestAgent', pov: 'acc', soul: POVER_INFO['accelerationist'], personality: 'test', topic: 'test topic',
    taxonomyContext: '', commitmentContext: '', establishedPoints: '', edgeContext: '',
    concessionHint: '', recentTranscript: '', focusPoint: '', addressing: '',
    phase: 'exploration', priorMoves: [], turnsSinceLastConcession: 0,
    priorRefs: [], availablePovNodeIds: [], model: 'test-model',
    skipPreCheck: true, // no draft_quality → totalStages = 6
    ...overrides,
  };
}

// ── Progress capture ─────────────────────────────────────────────────────────

function captureProgress(): { calls: { stage: string; meta?: { step: number; total: number } }[]; fn: StageProgressFn } {
  const calls: { stage: string; meta?: { step: number; total: number } }[] = [];
  const fn: StageProgressFn = (stage, _label, meta) => calls.push({ stage, meta });
  return { calls, fn };
}

function assertInvariants(calls: { stage: string; meta?: { step: number; total: number } }[]): void {
  const metas = calls.filter(c => c.meta).map(c => c.meta!);
  expect(metas.length, 'no progress meta emitted').toBeGreaterThan(0);

  // Invariant 1: total never changes mid-run
  const firstTotal = metas[0].total;
  for (const m of metas) {
    expect(m.total, `total changed at step ${m.step}: expected ${firstTotal}, got ${m.total}`).toBe(firstTotal);
  }

  // Invariant 2: final step equals total (the run arrived at the denominator)
  const lastMeta = metas[metas.length - 1];
  expect(lastMeta.step, `final step ${lastMeta.step} !== total ${lastMeta.total}`).toBe(lastMeta.total);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('stage progress invariants (t/3850)', () => {
  describe('opening pipeline', () => {
    it('normal path: total constant, final step === total', async () => {
      const { calls, fn } = captureProgress();
      await runOpeningPipelineWithRepair(makeOpeningInput(), async () => OPENING_STUB as any, fn);
      assertInvariants(calls);
    });

    it('repair path: total stays constant — denominator must not jump when repair fires', async () => {
      const { calls, fn } = captureProgress();
      let citeCallCount = 0;
      const generate = async (_p: string, _m: string, _o: unknown, label: string) => {
        if ((label as string).includes('cite')) {
          citeCallCount++;
          if (citeCallCount === 1) return CITE_REPAIR_TRIGGER;
        }
        return OPENING_STUB;
      };
      await runOpeningPipelineWithRepair(
        makeOpeningInput({ availablePovNodeIds: ['acc-bel-001'] }),
        generate as any,
        fn,
      );

      // Confirm repair fired
      const repairEmission = calls.find(c => c.stage === 'repair');
      expect(repairEmission, 'repair did not fire — check cite stub or availablePovNodeIds').toBeDefined();

      // Repair must use OPENING_TOTAL_STAGES, not OPENING_TOTAL_STAGES + 1
      expect(repairEmission!.meta!.total).toBe(OPENING_TOTAL_STAGES);

      assertInvariants(calls);
    });
  });

  describe('turn pipeline', () => {
    it('normal path (no draft_quality): total constant, final step === 6', async () => {
      const { calls, fn } = captureProgress();
      await runTurnPipeline(makeTurnInput(), async () => TURN_STUB as any, fn);
      assertInvariants(calls);
      const metas = calls.filter(c => c.meta).map(c => c.meta!);
      expect(metas[metas.length - 1].total).toBe(6);
    });
  });
});
