// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3937 (child of t/3876): the renderer's adaptive loop must not stop before the engine does.
// It used to cap at pacingPreset.maxTotalRounds, one turn per iteration, so a TIGHT situation
// debate (phase bounds 1/1/1 × 3 speakers = 9 turns) stopped after 3 turns with
// `maxRounds_exhausted` and a forced synthesis. The loop now iterates to the engine's real
// terminate point, maxTurnCeiling(): effectiveRoundCap() plus the scaled minimum concluding.
//
// The cap functions run as the REAL engine implementations (vi.importActual) against the real
// calibration config, so these tests check the engine's arithmetic rather than a stub.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { recorded } = vi.hoisted(() => ({ recorded: [] as Array<Record<string, unknown>> }));
vi.mock('@lib/flight-recorder/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lib/flight-recorder/index')>();
  return { ...actual, getGlobalRecorder: () => ({ record: (e: Record<string, unknown>) => { recorded.push(e); }, setEventContext: () => {} }) };
});

// Harness FIRST so its hoisted vi.mock registrations run before the store imports.
import { makeSession } from './storeTestHarness';
import { useDebateStore } from '../../useDebateStore';
import { loadProvisionalWeights, effectiveRoundCap, maxTurnCeiling } from '@lib/debate/phaseTransitions';

type Store = ReturnType<typeof useDebateStore.getState>;
type PT = typeof import('@lib/debate/phaseTransitions');

beforeEach(async () => {
  recorded.length = 0;
  const actual = await vi.importActual<PT>('@lib/debate/phaseTransitions');
  // Real weights for the cap functions; the loop reads the pacing preset from the same config.
  vi.mocked(loadProvisionalWeights).mockImplementation(actual.loadProvisionalWeights);
  vi.mocked(effectiveRoundCap).mockImplementation(actual.effectiveRoundCap);
  vi.mocked(maxTurnCeiling).mockImplementation(actual.maxTurnCeiling);
});

function opening(id: string, speaker: string) {
  return { id, timestamp: '2026-05-01T00:00:00.000Z', type: 'opening', speaker, content: `${speaker} opening — a sufficiently long body of prose to clear the delivery guard.`, taxonomy_refs: [] as string[] };
}

function seed(pacing: 'tight' | 'moderate', phaseBoundsOverride?: { maxConfrontationRounds: number; maxArgumentationRounds: number; maxConcludingRounds: number }) {
  const session = makeSession({
    phase: 'opening',
    active_povers: ['accelerationist', 'safetyist', 'skeptic'],
    adaptive_staging: { enabled: true, pacing, ...(phaseBoundsOverride ? { phase_bounds_override: phaseBoundsOverride } : {}) },
    transcript: [opening('o1', 'accelerationist'), opening('o2', 'safetyist'), opening('o3', 'skeptic')],
  });
  useDebateStore.setState({ activeDebate: session as unknown as Store['activeDebate'], activeDebateId: session.id });
}

/** Each turn adds a statement; on turn `terminateAt` the engine marks the debate terminated. */
function turnsThatTerminateAt(terminateAt: number | null) {
  let turns = 0;
  return vi.spyOn(useDebateStore.getState(), '_crossRespondLeased').mockImplementation(async () => {
    turns++;
    const d = useDebateStore.getState().activeDebate!;
    const as = d.adaptive_staging!;
    const phase_state = { ...(as.phase_state ?? {}), current_phase: terminateAt !== null && turns >= terminateAt ? 'terminated' : 'argumentation' };
    useDebateStore.setState({ activeDebate: { ...d, adaptive_staging: { ...as, phase_state }, transcript: [...d.transcript, { ...opening(`s${turns}`, 'skeptic'), type: 'statement' }] } as unknown as Store['activeDebate'] });
  });
}

const started = () => recorded.find(e => e.message === 'Adaptive loop started')?.data as Record<string, number>;
const ended = () => recorded.find(e => typeof e.message === 'string' && (e.message as string).startsWith('Adaptive loop ended'))?.data as Record<string, unknown>;

describe('adaptive loop cap = the engine\'s terminate point (t/3937)', () => {
  it('TIGHT situation (bounds 1/1/1, 3 speakers) runs all 9 turns and ends phase_terminated, not at 3', async () => {
    seed('tight', { maxConfrontationRounds: 1, maxArgumentationRounds: 1, maxConcludingRounds: 1 });
    const turn = turnsThatTerminateAt(9);
    vi.spyOn(useDebateStore.getState(), 'requestSynthesis').mockResolvedValue(undefined);

    await useDebateStore.getState().runOpeningStatements('tight-situation');

    expect(started()).toMatchObject({ maxTotalRounds: 3, effectiveCap: 9, turnCeiling: 12, speakers: 3 });
    expect(turn).toHaveBeenCalledTimes(9);
    expect(ended()).toMatchObject({ exit_reason: 'phase_terminated' });
    expect(recorded.some(e => typeof e.message === 'string' && (e.message as string).startsWith('Forcing synthesis'))).toBe(false);
  });

  it('a debate forced into concluding at the cap can still finish: the loop runs past effectiveCap up to turnCeiling', async () => {
    seed('tight', { maxConfrontationRounds: 1, maxArgumentationRounds: 1, maxConcludingRounds: 1 });
    const turn = turnsThatTerminateAt(11); // the engine terminates 2 turns into the forced concluding phase
    vi.spyOn(useDebateStore.getState(), 'requestSynthesis').mockResolvedValue(undefined);

    await useDebateStore.getState().runOpeningStatements('forced-concluding');

    expect(turn).toHaveBeenCalledTimes(11);
    expect(ended()).toMatchObject({ exit_reason: 'phase_terminated' });
  });

  it('safety net: an engine that never terminates is stopped at turnCeiling (12), not before', async () => {
    seed('tight', { maxConfrontationRounds: 1, maxArgumentationRounds: 1, maxConcludingRounds: 1 });
    const turn = turnsThatTerminateAt(null);
    vi.spyOn(useDebateStore.getState(), 'requestSynthesis').mockResolvedValue(undefined);

    await useDebateStore.getState().runOpeningStatements('runaway');

    expect(turn).toHaveBeenCalledTimes(12);
    expect(ended()).toMatchObject({ exit_reason: 'maxRounds_exhausted' });
  });

  it('MODERATE situation (bounds 1/3/1): cap 15, ceiling 18', async () => {
    seed('moderate', { maxConfrontationRounds: 1, maxArgumentationRounds: 3, maxConcludingRounds: 1 });
    const turn = turnsThatTerminateAt(15);
    vi.spyOn(useDebateStore.getState(), 'requestSynthesis').mockResolvedValue(undefined);

    await useDebateStore.getState().runOpeningStatements('moderate-situation');

    expect(started()).toMatchObject({ maxTotalRounds: 10, effectiveCap: 15, turnCeiling: 18 });
    // `iterations` in the end event counts the iteration that detects termination (turns + 1).
    expect(turn).toHaveBeenCalledTimes(15);
    expect(ended()).toMatchObject({ exit_reason: 'phase_terminated' });
  });

  it('no override (a normal debate): effectiveCap stays the preset; the ceiling only adds the minimum concluding', async () => {
    seed('moderate');
    const turn = turnsThatTerminateAt(10);
    vi.spyOn(useDebateStore.getState(), 'requestSynthesis').mockResolvedValue(undefined);

    await useDebateStore.getState().runOpeningStatements('normal');

    expect(started()).toMatchObject({ maxTotalRounds: 10, effectiveCap: 10, turnCeiling: 13 });
    expect(turn).toHaveBeenCalledTimes(10);
    expect(ended()).toMatchObject({ exit_reason: 'phase_terminated' });
  });

  it('every preset\'s ceiling stays under DebateActionBar\'s 50-turn safety cap', async () => {
    const actual = await vi.importActual<PT>('@lib/debate/phaseTransitions');
    const w = actual.loadProvisionalWeights();
    const bounds = [undefined, { maxConfrontationRounds: 1, maxArgumentationRounds: 1, maxConcludingRounds: 1 }, { maxConfrontationRounds: 1, maxArgumentationRounds: 3, maxConcludingRounds: 1 }, { maxConfrontationRounds: 2, maxArgumentationRounds: 4, maxConcludingRounds: 2 }];
    for (const preset of Object.values(w.pacing_presets)) {
      for (const b of bounds) {
        const ceiling = actual.maxTurnCeiling({ maxTotalRounds: preset.maxTotalRounds, phaseBoundsOverride: b } as never, 3);
        expect(ceiling).toBeLessThan(50);
      }
    }
  });
});
