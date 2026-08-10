// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Prevention test for t/2423: adaptive_staging_diagnostics must be written
// to the session on every GUI crossRespond round when adaptive staging is
// enabled. The engine batch path (runAdaptiveCrossRespond) always writes it;
// this test guards the GUI per-round path (evaluateAdaptiveStaging) which
// previously accumulated signal telemetry into module-level state only and
// never wrote it back to the session — leaving termination_reason = 'unknown'
// on 1167/1168 real post-cutoff debates (t/2422 audit).
import { describe, it, expect, vi } from 'vitest';
import { mockApi, makeSession } from './storeTestHarness';
import { useDebateStore } from '../../useDebateStore';
import { runModeratorSelection, executeTurnWithRetry } from '@lib/debate/orchestration';
import { loadProvisionalWeights } from '@lib/debate/phaseTransitions';

const makeTurnResult = (speaker: string) => ({
  statement: `${speaker} response`,
  taxonomyRefs: [],
  meta: { move_types: ['CHALLENGE'], policy_refs: [] },
  validation: { outcome: 'accept', score: 0.9, repairHints: [], clarifies_taxonomy: [] },
  attempts: [{ statement: `${speaker} response`, score: 0.9 }],
  pipelineResult: {
    draft: {},
    total_time_ms: 100,
    stage_diagnostics: [{ stage: 'draft', prompt: 'p', raw_response: 'r' }],
    topicAlignmentResult: null,
  },
  aborted: false,
});

const makeModResult = (speaker: string) => ({
  responder: speaker,
  focusPoint: 'test focus',
  addressing: 'all',
  agreementDetected: false,
  selectionResult: {},
  intervention: null,
  interventionBriefInjection: '',
  modState: {
    budget_remaining: 10, budget_total: 10, health_history: [],
    consecutive_decline: 0, round: 1, phase: 'debate', required_gap: 2,
    rounds_since_last_intervention: 5, burden_per_debater: {},
  },
  healthScore: { value: 0.8, trend: 0, components: {} },
  earlyReturn: false,
  diagnostics: { selectionPrompt: '', selectionResponse: '' },
});

describe('adaptive_staging_diagnostics — GUI per-round path (t/2423 prevention)', () => {
  it('populates adaptive_staging_diagnostics.signal_telemetry after each crossRespond round', async () => {
    // Supply a proper pacing config so evaluateAdaptiveStaging can build PhaseTransitionConfig.
    vi.mocked(loadProvisionalWeights).mockReturnValue({
      pacing_presets: { moderate: { maxTotalRounds: 10 } },
      phase_bounds: { min_confrontation_rounds: 2, min_argumentation_rounds: 2, min_concluding_rounds: 2 },
      network: { gc_trigger: 200, gc_target: 150 },
    } as any);

    vi.mocked(runModeratorSelection).mockResolvedValue(makeModResult('accelerationist') as any);
    vi.mocked(executeTurnWithRetry).mockResolvedValue(makeTurnResult('accelerationist') as any);

    useDebateStore.setState({
      activeDebate: makeSession({
        phase: 'debate',
        active_povers: ['accelerationist', 'safetyist', 'skeptic'],
        transcript: [
          { id: 'o1', timestamp: 't', type: 'opening', speaker: 'accelerationist', content: 'Opening A', taxonomy_refs: [] },
          { id: 'o2', timestamp: 't', type: 'opening', speaker: 'safetyist', content: 'Opening S', taxonomy_refs: [] },
          { id: 'o3', timestamp: 't', type: 'opening', speaker: 'skeptic', content: 'Opening K', taxonomy_refs: [] },
        ],
        adaptive_staging: {
          enabled: true,
          pacing: 'moderate',
          phase_state: {
            current_phase: 'confrontation',
            rounds_in_phase: 0,
            total_rounds_elapsed: 0,
            argumentation_exit_threshold: 0.6,
            concluding_exit_threshold: 0.7,
            regression_count: 0,
            gc_ran_this_phase: false,
          },
        },
        argument_network: { nodes: [], edges: [] },
        diagnostics: {
          enabled: true,
          entries: {},
          overview: {
            total_ai_calls: 0, total_response_time_ms: 0,
            claims_accepted: 0, claims_rejected: 0,
            move_type_counts: {}, disagreement_type_counts: {},
          },
        },
      }) as any,
      initialCrossRespondRounds: 3,
    });

    await useDebateStore.getState().crossRespond();

    const debate = useDebateStore.getState().activeDebate!;
    expect(debate.adaptive_staging_diagnostics).toBeDefined();
    expect(debate.adaptive_staging_diagnostics!.signal_telemetry.length).toBeGreaterThanOrEqual(1);
    expect(debate.adaptive_staging_diagnostics!.total_predicate_evaluations).toBeGreaterThanOrEqual(1);
    expect(mockApi.saveDebateSession).toHaveBeenCalled();
  });

  it('accumulates signal_telemetry across multiple rounds', async () => {
    vi.mocked(loadProvisionalWeights).mockReturnValue({
      pacing_presets: { moderate: { maxTotalRounds: 10 } },
      phase_bounds: { min_confrontation_rounds: 2, min_argumentation_rounds: 2, min_concluding_rounds: 2 },
      network: { gc_trigger: 200, gc_target: 150 },
    } as any);

    const baseSession = makeSession({
      phase: 'debate',
      active_povers: ['accelerationist', 'safetyist'],
      transcript: [
        { id: 'o1', timestamp: 't', type: 'opening', speaker: 'accelerationist', content: 'Opening A', taxonomy_refs: [] },
        { id: 'o2', timestamp: 't', type: 'opening', speaker: 'safetyist', content: 'Opening S', taxonomy_refs: [] },
      ],
      adaptive_staging: {
        enabled: true,
        pacing: 'moderate',
        phase_state: {
          current_phase: 'confrontation',
          rounds_in_phase: 0,
          total_rounds_elapsed: 0,
          argumentation_exit_threshold: 0.6,
          concluding_exit_threshold: 0.7,
          regression_count: 0,
          gc_ran_this_phase: false,
        },
      },
      argument_network: { nodes: [], edges: [] },
      diagnostics: {
        enabled: true,
        entries: {},
        overview: {
          total_ai_calls: 0, total_response_time_ms: 0,
          claims_accepted: 0, claims_rejected: 0,
          move_type_counts: {}, disagreement_type_counts: {},
        },
      },
    });

    useDebateStore.setState({ activeDebate: baseSession as any, initialCrossRespondRounds: 3 });

    for (const speaker of ['accelerationist', 'safetyist']) {
      vi.mocked(runModeratorSelection).mockResolvedValueOnce(makeModResult(speaker) as any);
      vi.mocked(executeTurnWithRetry).mockResolvedValueOnce(makeTurnResult(speaker) as any);
      await useDebateStore.getState().crossRespond();
    }

    const debate = useDebateStore.getState().activeDebate!;
    expect(debate.adaptive_staging_diagnostics!.signal_telemetry.length).toBeGreaterThanOrEqual(2);
    expect(debate.adaptive_staging_diagnostics!.total_predicate_evaluations).toBeGreaterThanOrEqual(2);
  });

  it('records a phases entry when evaluatePhaseTransition returns transition', async () => {
    const { evaluatePhaseTransition } = await import('@lib/debate/phaseTransitions');
    vi.mocked(evaluatePhaseTransition).mockReturnValueOnce({
      action: 'transition', reason: 'saturation threshold reached',
      confidence_deferred: false, veto_active: false, force_active: false,
      components: {},
    } as any);
    vi.mocked(loadProvisionalWeights).mockReturnValue({
      pacing_presets: { moderate: { maxTotalRounds: 10 } },
      phase_bounds: { min_confrontation_rounds: 2, min_argumentation_rounds: 2, min_concluding_rounds: 2 },
      network: { gc_trigger: 200, gc_target: 150 },
    } as any);

    vi.mocked(runModeratorSelection).mockResolvedValue(makeModResult('accelerationist') as any);
    vi.mocked(executeTurnWithRetry).mockResolvedValue(makeTurnResult('accelerationist') as any);

    useDebateStore.setState({
      activeDebate: makeSession({
        phase: 'debate',
        active_povers: ['accelerationist', 'safetyist', 'skeptic'],
        transcript: [
          { id: 'o1', timestamp: 't', type: 'opening', speaker: 'accelerationist', content: 'Opening A', taxonomy_refs: [] },
          { id: 'o2', timestamp: 't', type: 'opening', speaker: 'safetyist', content: 'Opening S', taxonomy_refs: [] },
          { id: 'o3', timestamp: 't', type: 'opening', speaker: 'skeptic', content: 'Opening K', taxonomy_refs: [] },
        ],
        adaptive_staging: {
          enabled: true,
          pacing: 'moderate',
          phase_state: {
            current_phase: 'confrontation',
            rounds_in_phase: 2,
            total_rounds_elapsed: 2,
            argumentation_exit_threshold: 0.6,
            concluding_exit_threshold: 0.7,
            regression_count: 0,
            gc_ran_this_phase: false,
          },
        },
        argument_network: { nodes: [], edges: [] },
        diagnostics: {
          enabled: true,
          entries: {},
          overview: {
            total_ai_calls: 0, total_response_time_ms: 0,
            claims_accepted: 0, claims_rejected: 0,
            move_type_counts: {}, disagreement_type_counts: {},
          },
        },
      }) as any,
      initialCrossRespondRounds: 3,
    });

    await useDebateStore.getState().crossRespond();

    const debate = useDebateStore.getState().activeDebate!;
    expect(debate.adaptive_staging_diagnostics!.phases.length).toBeGreaterThanOrEqual(1);
    expect(debate.adaptive_staging_diagnostics!.phases[0].exit_reason).toBe('saturation threshold reached');
  });
});
