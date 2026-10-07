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
import bundledModelRegistry from '../../../../../../ai-models.json';

let liveRegistry: ModelRegistry | null = null;

/** initAIModels hands over the LIVE ai-models.json (api.loadAIModels), the same file the backend resolves
 *  apiModelId from. The bundled copy is only a pre-load snapshot and can lag a model refresh. */
export function setLiveModelRegistry(registry: ModelRegistry | null): void {
  liveRegistry = registry;
}

function fingerprintRegistry(): ModelRegistry {
  if (liveRegistry) return liveRegistry;
  getGlobalRecorder()?.record({
    type: 'system.info', component: 'debate-store', level: 'warn',
    message: 'model-fingerprint: live model registry not loaded yet; fingerprinting from the bundled ai-models.json snapshot',
  });
  return bundledModelRegistry as unknown as ModelRegistry;
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
 */
export function sessionModelFingerprint(
  model: string,
  options: { speakerModels?: Record<string, string>; modelTier?: string; eligibleBackends?: string[] } | undefined,
): FingerprintFields {
  const multiProvider = Boolean(options?.speakerModels);
  return {
    ...computeModelFingerprint(
      fingerprintRegistry(),
      multiProvider ? options?.modelTier : undefined,
      multiProvider ? options?.eligibleBackends : undefined,
      model,
    ),
    initial_speaker_models: options?.speakerModels ? { ...options.speakerModels } : undefined,
    failover_tracking: 'unavailable',
  };
}
