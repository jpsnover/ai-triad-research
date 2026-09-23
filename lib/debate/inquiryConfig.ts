// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Fidelity → DebateConfig derivation for the inquiry pipeline (t/3575).
// Pure function: no I/O. The caller loads ai-models.json and passes the registry in.

import type { DebateConfig } from './debateEngine/internals.js';
import type { InquiryRequest, ResolvedDerivation, Fidelity } from '../inquiry/index.js';
import type { ModelRegistry } from '../ai-client/registry.js';
import { ActionableError } from './errors.js';

// Matches phaseTransitions.ts budget.hard_multiplier — the multiplier that converts
// maxTotalRounds into the API hard ceiling the engine enforces.
const HARD_MULTIPLIER = 15;

interface FidelityProfile {
  pacing: 'tight' | 'moderate' | 'thorough';
  maxTotalRounds: number;
  rounds: number;
  responseLength: 'brief' | 'medium' | 'detailed';
  tier: 'basic' | 'advanced';
  useAdaptiveStaging: boolean;
}

const FIDELITY_PROFILES: Record<Fidelity, FidelityProfile> = {
  quick:    { pacing: 'tight',    maxTotalRounds: 4,  rounds: 2, responseLength: 'brief',    tier: 'basic',    useAdaptiveStaging: false },
  standard: { pacing: 'moderate', maxTotalRounds: 10, rounds: 4, responseLength: 'medium',   tier: 'basic',    useAdaptiveStaging: true  },
  deep:     { pacing: 'thorough', maxTotalRounds: 8,  rounds: 6, responseLength: 'detailed', tier: 'advanced', useAdaptiveStaging: true  },
};

export interface DerivedDebateConfig {
  config: DebateConfig;
  derivation: ResolvedDerivation;
}

/**
 * Map an InquiryRequest to a DebateConfig + ResolvedDerivation stamp.
 *
 * Model resolution order:
 *   1. request.models.debaters / request.models.evaluator (if present)
 *   2. registry.debateTiers[tier][backend] for 'gemini' then 'claude' as preference order
 *
 * Throws ActionableError when a model override names an unregistered id.
 */
export function deriveDebateConfig(request: InquiryRequest, registry: ModelRegistry): DerivedDebateConfig {
  const profile = FIDELITY_PROFILES[request.fidelity];
  const tierMap: Record<string, string> = registry.debateTiers?.[profile.tier] ?? {};

  const tierDebaterModel = tierMap['gemini'] ?? tierMap['claude'] ?? Object.values(tierMap)[0] ?? '';
  const tierEvaluatorModel = tierMap['gemini'] ?? tierDebaterModel;

  const modelIdSet = new Set((registry.models ?? []).map(m => m.id));

  let debaterModel = tierDebaterModel;
  let evaluatorModel = tierEvaluatorModel;

  if (request.models?.debaters !== undefined) {
    if (!modelIdSet.has(request.models.debaters)) {
      throw new ActionableError({
        goal: 'Derive debate config from inquiry request',
        problem: `Model override '${request.models.debaters}' is not registered in ai-models.json`,
        location: 'deriveDebateConfig',
        nextSteps: ['Use a model id from the model picker', 'Remove models.debaters to use the fidelity tier default'],
      });
    }
    debaterModel = request.models.debaters;
  }

  if (request.models?.evaluator !== undefined) {
    if (!modelIdSet.has(request.models.evaluator)) {
      throw new ActionableError({
        goal: 'Derive debate config from inquiry request',
        problem: `Model override '${request.models.evaluator}' is not registered in ai-models.json`,
        location: 'deriveDebateConfig',
        nextSteps: ['Use a model id from the model picker', 'Remove models.evaluator to use the fidelity tier default'],
      });
    }
    evaluatorModel = request.models.evaluator;
  }

  const callBudget = profile.maxTotalRounds * HARD_MULTIPLIER;

  const config: DebateConfig = {
    topic: request.question,
    sourceType: 'topic',
    activePovers: ['accelerationist', 'safetyist', 'skeptic'],
    model: debaterModel,
    rounds: profile.rounds,
    responseLength: profile.responseLength,
    pacing: profile.pacing,
    useAdaptiveStaging: profile.useAdaptiveStaging,
    maxTotalRounds: profile.maxTotalRounds,
    turnValidation: { enabled: true },
    stageModels: { evaluator: evaluatorModel },
  };

  const derivation: ResolvedDerivation = {
    fidelity: request.fidelity,
    models: { debaters: debaterModel, evaluator: evaluatorModel },
    rounds: profile.rounds,
    callBudget,
  };

  return { config, derivation };
}
