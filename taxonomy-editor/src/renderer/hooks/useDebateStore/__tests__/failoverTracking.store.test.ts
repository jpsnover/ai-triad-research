// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/4044 (SO e/281#2): per-turn failover tracking through the REAL store path. A real createDebate session,
// real makeStageGenerate calls reporting servedModel into the real store, real load paths, and the result
// read by the real extractCalibrationData and replicationSet. Only the bridge is mocked (storeTestHarness).
import { describe, it, expect, beforeEach } from 'vitest';
import { mockApi, makeSession } from './storeTestHarness';
import { useDebateStore } from '../../useDebateStore';
import { setLiveModelRegistry } from '../shared/sessionFingerprint';
import { makeStageGenerate } from '../shared/generation';
import { servedTurnRecorder } from '../shared/failoverTracking';
import type { ModelRegistry } from '@lib/ai-client/registry';
import { extractCalibrationData } from '@lib/debate/calibrationLogger/extract';
import { replicationSet, fixedConfigKey } from '@lib/debate/calibrationLogger/replicationGate';
import type { CalibrationDataPoint } from '@lib/debate/calibrationLogger/schema';
import { DebateSessionSchema } from '@lib/debate/schemas';
import type { DebateSession } from '@lib/debate/types';
import aiModels from '../../../../../../ai-models.json';

const registry = aiModels as unknown as ModelRegistry;
const MODEL = registry.debateTiers!.basic.gemini;
const SEATS = ['accelerationist', 'safetyist', 'skeptic'] as const;

const store = () => useDebateStore.getState();
const active = () => store().activeDebate as DebateSession;

async function create(): Promise<void> {
  await store().createDebate('Should frontier labs pause?', [...SEATS], false, 'topic', '', '', MODEL);
}

/** One speaker turn: a real stage-generate call whose backend reports `served` (undefined = not reported). */
async function speakerTurn(speaker: string, served: string | undefined, requested = MODEL): Promise<void> {
  mockApi.generateText.mockResolvedValueOnce({ text: 'ok', servedModel: served });
  const gen = makeStageGenerate(() => {}, requested, servedTurnRecorder(store, useDebateStore.setState as never, speaker));
  await gen('prompt', requested, {}, `${speaker} turn`);
}

/** The logger stamps working_tree_state after extraction; a clean tree leaves failover tracking as the only gate. */
function cleanRow(session: DebateSession): CalibrationDataPoint {
  return { ...extractCalibrationData(session, 'test'), working_tree_state: 'clean' };
}
const counted = (s: DebateSession) => { const row = cleanRow(s); return replicationSet([row], fixedConfigKey(row)).length === 1; };

/** Save and reload: the persisted JSON re-parsed through the real DebateSessionSchema, then loaded. */
function saveAndReload(): void {
  const persisted = DebateSessionSchema.parse(JSON.parse(JSON.stringify(active())));
  store().loadDebateFromData(persisted);
}

beforeEach(() => setLiveModelRegistry(registry));

describe('renderer per-turn failover tracking through the store (t/4044, SO e/281#2)', () => {
  it('every speaker turn carries servedModel: tracked, and the fingerprinted row is counted', async () => {
    await create();
    expect(active().model_api_id).toBeTruthy(); // fingerprinted, so the gate reads failover_tracking
    for (const s of SEATS) await speakerTurn(s, MODEL);
    expect(active().failover_tracking).toBe('tracked');
    expect(active().failover_untracked).toBeUndefined();
    expect(counted(active())).toBe(true);
  });

  it('one turn without servedModel: unavailable, sticky across later turns AND a save and reload', async () => {
    await create();
    await speakerTurn('accelerationist', MODEL);
    await speakerTurn('safetyist', undefined);
    expect(active()).toMatchObject({ failover_tracking: 'unavailable', failover_untracked: true });
    saveAndReload();
    expect(active().failover_untracked).toBe(true); // the latch survived the real schema parse
    await speakerTurn('skeptic', MODEL);
    await speakerTurn('accelerationist', MODEL);
    expect(active().failover_tracking).toBe('unavailable');
    expect(counted(active())).toBe(false);
  });

  it('served differs from requested: the failover is recorded for that speaker and replicationSet excludes the row', async () => {
    await create();
    await speakerTurn('skeptic', 'claude-substitute', MODEL);
    expect(active().speaker_model_failovers).toEqual({ skeptic: 'claude-substitute' });
    expect(counted(active())).toBe(false);
  });

  it('zero speaker turns: the creation stamp, unavailable, stands and the row is not counted', async () => {
    await create();
    expect(active().failover_tracking).toBe('unavailable');
    expect(counted(active())).toBe(false);
  });

  it('condition 1: a stored pre-change session with speaker turns is latched on load and never promoted', async () => {
    const legacy = makeSession({
      id: 'legacy-1', phase: 'debate', failover_tracking: 'unavailable',
      transcript: [
        { id: 't1', timestamp: '2026-05-01T00:00:01.000Z', type: 'opening', speaker: 'accelerationist', content: 'a', taxonomy_refs: [] },
        { id: 't2', timestamp: '2026-05-01T00:00:02.000Z', type: 'opening', speaker: 'skeptic', content: 'b', taxonomy_refs: [] },
      ],
    });
    mockApi.loadDebateSession.mockResolvedValueOnce(structuredClone(legacy));
    await store().loadDebate('legacy-1');
    expect(active()).toMatchObject({ id: 'legacy-1', failover_untracked: true, failover_tracking: 'unavailable' });
    await speakerTurn('safetyist', MODEL);
    await speakerTurn('skeptic', MODEL);
    expect(active().failover_tracking).toBe('unavailable');
  });
});
