// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/4044 (t/4040 SO conditions, e/268): the calibration model fingerprint for a debate the renderer
// creates. Editor and web debates build their session in sessionSlice.createDebate and never run
// DebateEngine.initSession, so without this their calibration rows carry no fingerprint.
//
// Stamped ONCE, at creation: sessions are re-saved, and a later registry repoint must not rewrite the key.

import { computeModelFingerprint } from '@lib/debate/debateEngine/modelFingerprint';
import type { ModelRegistry } from '@lib/ai-client/registry';
import type { DebateSession } from '@lib/debate/types';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

let liveRegistry: ModelRegistry | null = null;

/** initAIModels hands over the LIVE ai-models.json (api.loadAIModels), the same file the backend resolves
 *  apiModelId from. The bundled copy is only a pre-load snapshot and can lag a model refresh, so it is never
 *  used for a fingerprint (CL e/268#17). */
export function setLiveModelRegistry(registry: ModelRegistry | null): void {
  liveRegistry = registry;
}

type FingerprintFields = Pick<DebateSession, 'model_pool' | 'model_api_id' | 'initial_speaker_models' | 'failover_tracking'>;

/**
 * The fingerprint fields for a new renderer session. Mirrors DebateEngine._computeModelFingerprint: a run
 * is multi-provider iff it has speakerModels, and then tier + eligible backends key the pool.
 *
 * failover_tracking is 'unavailable': per-turn fallback happens server-side (getFallbackChain), below the
 * bridge, so the renderer cannot see a speaker's model change and cannot write speaker_model_failovers.
 * replicationSet excludes the row rather than count a run whose models it cannot vouch for (SO e/268#6,
 * #12). This flips to 'tracked' when the servedModel ticket lands.
 *
 * Live registry not loaded yet: NO model_pool / model_api_id (CL e/268#17). A key from the bundled snapshot can
 * name a model the backend no longer serves, and it is frozen on the row forever; once renderer rows become
 * 'tracked' it would be counted in the wrong group. Absent fields put the run in the un-fingerprinted bucket,
 * which never pools with fingerprinted rows: one run lost, not a contaminated group.
 */
export function sessionModelFingerprint(
  model: string,
  options: { speakerModels?: Record<string, string>; modelTier?: string; eligibleBackends?: string[] } | undefined,
): FingerprintFields {
  const multiProvider = Boolean(options?.speakerModels);
  const unfingerprinted: FingerprintFields = {
    initial_speaker_models: options?.speakerModels ? { ...options.speakerModels } : undefined,
    failover_tracking: 'unavailable',
  };
  if (!liveRegistry) {
    getGlobalRecorder()?.record({
      type: 'system.info', component: 'debate-store', level: 'warn',
      message: 'model-fingerprint: live model registry not loaded yet; session left un-fingerprinted (excluded from fingerprinted replication groups)',
    });
    return unfingerprinted;
  }
  return {
    ...computeModelFingerprint(
      liveRegistry,
      multiProvider ? options?.modelTier : undefined,
      multiProvider ? options?.eligibleBackends : undefined,
      model,
    ),
    ...unfingerprinted,
  };
}
