// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3513 — the deterministic intervention floor under the moderator LLM.

import { describe, it, expect, vi } from 'vitest';
import { deriveEngineTrigger, countResponsiveInterventions, ENGINE_TRIGGER, type EngineTriggerInput } from './moderatorEngineTriggers.js';
import { runModeratorSelection, type ModeratorSelectionInput, type ModeratorSelectionCallbacks } from './orchestration.js';
import { initModeratorState } from './moderator.js';
import type { ConvergenceSignals } from './types/convergence.js';
import type { UnansweredClaimEntry, ModeratorState } from './types/moderator.js';
import type { SpeakerId } from './types/phase.js';

const signal = (speaker: SpeakerId, round: number, outcome: 'none' | 'taken' | 'missed', attacks = 2): ConvergenceSignals => ({
  entry_id: `e-${speaker}-${round}`,
  round,
  speaker,
  move_polarity: { confrontational: 1, collaborative: 0, ratio: 1 },
  dialectical_engagement: { targeted: 1, standalone: 0, ratio: 1 },
  argument_redundancy: { avg_self_overlap: 0.1, max_self_overlap: 0.1 },
  concession_opportunity: { strong_attacks_faced: attacks, concession_used: outcome === 'taken', outcome },
} as unknown as ConvergenceSignals);

const claim = (id: string, speaker: string, first: number, addressed?: number): UnansweredClaimEntry => ({
  claim_id: id, claim_text: `text of ${id}`, speaker, first_unanswered_round: first, ...(addressed != null ? { addressed_round: addressed } : {}),
});

function input(over: Partial<EngineTriggerInput> = {}): EngineTriggerInput {
  return {
    phase: 'argumentation',
    responder: 'safetyist',
    convergenceSignals: [],
    unansweredLedger: [],
    modState: initModeratorState(10, ['accelerationist', 'safetyist', 'skeptic']),
    labelOf: id => id.charAt(0).toUpperCase() + id.slice(1),
    ...over,
  };
}

/** n later debater turns after round `after`. */
const laterTurns = (after: number, n: number): ConvergenceSignals[] =>
  Array.from({ length: n }, (_, i) => signal(['accelerationist', 'skeptic', 'safetyist'][i % 3] as SpeakerId, after + 1 + i, 'none'));

describe('deriveEngineTrigger', () => {
  it('returns null when nothing measured warrants an intervention', () => {
    expect(deriveEngineTrigger(input({ convergenceSignals: [signal('safetyist', 1, 'taken')] }))).toBeNull();
  });

  it('never fires outside confrontation/argumentation', () => {
    const cs = [signal('safetyist', 1, 'missed'), signal('safetyist', 2, 'missed')];
    expect(deriveEngineTrigger(input({ phase: 'concluding', convergenceSignals: cs }))).toBeNull();
    expect(deriveEngineTrigger(input({ phase: 'terminated', convergenceSignals: cs }))).toBeNull();
  });

  it('CHALLENGEs the next speaker after two consecutive missed concessions (entrenchment)', () => {
    const t = deriveEngineTrigger(input({ convergenceSignals: [signal('safetyist', 1, 'missed', 2), signal('skeptic', 2, 'taken'), signal('safetyist', 3, 'missed', 1)] }));
    expect(t).toMatchObject({ signal: 'entrenchment', move: 'CHALLENGE', target: 'safetyist' });
    expect(t!.reasoning).toContain('3 strong attack(s)');
  });

  it('does not treat one missed concession as entrenchment', () => {
    expect(deriveEngineTrigger(input({ convergenceSignals: [signal('safetyist', 1, 'taken'), signal('safetyist', 3, 'missed')] }))).toBeNull();
  });

  it('PINs the next speaker on the oldest opponent claim left unanswered long enough', () => {
    const t = deriveEngineTrigger(input({
      convergenceSignals: laterTurns(2, ENGINE_TRIGGER.UNANSWERED_MIN_AGE_TURNS),
      unansweredLedger: [claim('AN-9', 'skeptic', 2), claim('AN-4', 'accelerationist', 1)],
    }));
    expect(t).toMatchObject({ signal: 'unanswered_claim', move: 'PIN', target: 'safetyist' });
    expect(t!.evidence.source_claim).toBe('AN-4');
  });

  it('ignores claims that are too young, already answered, the responder\'s own, or already pinned', () => {
    const young = input({ convergenceSignals: laterTurns(2, ENGINE_TRIGGER.UNANSWERED_MIN_AGE_TURNS - 1), unansweredLedger: [claim('AN-1', 'skeptic', 2)] });
    expect(deriveEngineTrigger(young)).toBeNull();

    const old = laterTurns(2, ENGINE_TRIGGER.UNANSWERED_MIN_AGE_TURNS);
    expect(deriveEngineTrigger(input({ convergenceSignals: old, unansweredLedger: [claim('AN-1', 'skeptic', 2, 5)] }))).toBeNull();
    expect(deriveEngineTrigger(input({ convergenceSignals: old, unansweredLedger: [claim('AN-1', 'safetyist', 2)] }))).toBeNull();

    const state = { ...initModeratorState(10, ['accelerationist', 'safetyist', 'skeptic']), engine_pinned_claims: ['AN-1'] } as ModeratorState;
    expect(deriveEngineTrigger(input({ convergenceSignals: old, unansweredLedger: [claim('AN-1', 'skeptic', 2)], modState: state }))).toBeNull();
  });

  it('acts on a sustained SLI breach when no speaker-specific signal applies', () => {
    const state = { ...initModeratorState(10, ['accelerationist', 'safetyist', 'skeptic']), sli_consecutive_breaches: { novelty: 2 } } as ModeratorState;
    expect(deriveEngineTrigger(input({ modState: state }))).toMatchObject({ signal: 'sli_breach', move: 'CHALLENGE', target: 'safetyist' });
  });

  it('prefers entrenchment over an aged claim', () => {
    // Filler turns are opponents only, so safetyist's own last two turns are both 'missed'.
    const filler = laterTurns(1, ENGINE_TRIGGER.UNANSWERED_MIN_AGE_TURNS).filter(s => s.speaker !== 'safetyist');
    const cs = [signal('safetyist', 1, 'missed'), ...filler, ...laterTurns(10, 3).filter(s => s.speaker !== 'safetyist'), signal('safetyist', 20, 'missed')];
    expect(deriveEngineTrigger(input({ convergenceSignals: cs, unansweredLedger: [claim('AN-1', 'skeptic', 1)] }))?.signal).toBe('entrenchment');
  });
});

describe('countResponsiveInterventions', () => {
  it('excludes the scripted concluding COMMITs', () => {
    const state = initModeratorState(10, ['accelerationist', 'safetyist']);
    state.intervention_history.push(
      { round: 7, move: 'COMMIT', family: 'synthesis', target: 'accelerationist', burden: 0.8 },
      { round: 4, move: 'PIN', family: 'elicitation', target: 'safetyist', burden: 1 },
    );
    expect(countResponsiveInterventions(state)).toBe(1);
  });
});

// ── Integration: the floor inside runModeratorSelection ───────────────

function moderatorInput(over: Partial<ModeratorSelectionInput> = {}): ModeratorSelectionInput {
  const modState = initModeratorState(10, ['accelerationist', 'safetyist', 'skeptic']);
  modState.rounds_since_last_intervention = 3; // clear of the initial cooldown
  return {
    round: 5,
    phase: 'argumentation',
    activePovers: ['accelerationist', 'safetyist', 'skeptic'],
    totalRounds: 10,
    model: 'test-model',
    transcript: [{ id: 't1', timestamp: 't', type: 'statement', speaker: 'accelerationist', content: 'x', taxonomy_refs: [] }],
    poverInfo: { accelerationist: { label: 'Accelerationist', pov: 'acc' }, safetyist: { label: 'Safetyist', pov: 'saf' }, skeptic: { label: 'Skeptic', pov: 'skp' } },
    convergenceSignals: [signal('safetyist', 1, 'missed'), signal('safetyist', 3, 'missed')],
    existingModState: modState,
    ...over,
  };
}

function callbacks(): ModeratorSelectionCallbacks {
  const generate = vi.fn()
    // Stage 1: the LLM declines to intervene — the dormancy pattern.
    .mockResolvedValueOnce(JSON.stringify({ responder: 'safetyist', addressing: 'accelerationist', focus_point: 'f', agreement_detected: false, intervene: false }))
    // Stage 2: intervention text.
    .mockResolvedValueOnce(JSON.stringify({ text: 'Safetyist, answer the attacks you have left standing.' }));
  return { generate, addEntry: vi.fn().mockReturnValue('id'), progress: vi.fn(), warn: vi.fn(), formatEdgeContext: vi.fn().mockReturnValue({ text: '', edges_used: [] }) };
}

describe('runModeratorSelection — engine floor', () => {
  it('fires an engine-proposed intervention when the LLM declines but entrenchment is measured', async () => {
    const cb = callbacks();
    const result = await runModeratorSelection(moderatorInput(), cb);
    expect(result.selectionResult).toMatchObject({ intervene: true, trigger_source: 'engine', suggested_move: 'CHALLENGE', target_debater: 'safetyist' });
    expect(result.engineValidation?.proceed).toBe(true);
    expect(cb.generate).toHaveBeenCalledTimes(2); // selection + stage-2 intervention text
  });

  it('still respects validation — no engine intervention during cooldown', async () => {
    const inp = moderatorInput();
    inp.existingModState!.rounds_since_last_intervention = 0;
    const cb = callbacks();
    const result = await runModeratorSelection(inp, cb);
    expect(result.selectionResult.trigger_source).toBe('engine');
    expect(result.engineValidation?.proceed).toBe(false);
    expect(result.engineValidation?.suppressed_reason).toBe('cooldown_active');
    expect(cb.generate).toHaveBeenCalledTimes(1);
  });

  it('leaves socratic mode alone', async () => {
    const cb = callbacks();
    const result = await runModeratorSelection(moderatorInput({ moderatorMode: 'socratic' }), cb);
    expect(result.selectionResult.trigger_source).toBeUndefined();
  });

  it('does not intervene when nothing is measured', async () => {
    const cb = callbacks();
    const result = await runModeratorSelection(moderatorInput({ convergenceSignals: [signal('safetyist', 1, 'taken')] }), cb);
    expect(result.selectionResult.intervene).toBe(false);
    expect(cb.generate).toHaveBeenCalledTimes(1);
  });
});
