// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { deriveDebateConfig } from './inquiryConfig.js';
import type { ModelRegistry } from '../ai-client/registry.js';
import type { InquiryRequest } from '../inquiry/index.js';
import { ActionableError } from './errors.js';

// ── Fixture helpers ──────────────────────────────────────────────────────────

function makeRegistry(overrides: Partial<ModelRegistry> = {}): ModelRegistry {
  return {
    backends: [{ id: 'gemini', label: 'Gemini' }, { id: 'claude', label: 'Claude' }],
    models: [
      { id: 'gemini-3.5-flash-lite', apiModelId: 'gemini-3.5-flash-lite', label: 'Gemini Flash Lite', backend: 'gemini' },
      { id: 'gemini-3.1-pro-preview', apiModelId: 'gemini-3.1-pro-preview', label: 'Gemini Pro', backend: 'gemini' },
      { id: 'claude-haiku-4-5', apiModelId: 'claude-haiku-4-5-20251001', label: 'Claude Haiku', backend: 'claude' },
      { id: 'claude-sonnet-4-6', apiModelId: 'claude-sonnet-4-6', label: 'Claude Sonnet', backend: 'claude' },
    ],
    debateTiers: {
      basic:    { gemini: 'gemini-3.5-flash-lite', claude: 'claude-haiku-4-5' },
      advanced: { gemini: 'gemini-3.1-pro-preview', claude: 'claude-sonnet-4-6' },
    },
    ...overrides,
  };
}

function makeRequest(overrides: Partial<InquiryRequest> = {}): InquiryRequest {
  return {
    question: 'What are the safety risks of autonomous AI systems?',
    fidelity: 'standard',
    ...overrides,
  };
}

// ── Fidelity profiles ────────────────────────────────────────────────────────

describe('deriveDebateConfig — fidelity profiles', () => {
  it('quick: tight pacing, maxTotalRounds=4, callBudget=60', () => {
    const { config, derivation } = deriveDebateConfig(makeRequest({ fidelity: 'quick' }), makeRegistry());
    expect(config.pacing).toBe('tight');
    expect(config.maxTotalRounds).toBe(4);
    expect(config.rounds).toBe(2);
    expect(config.responseLength).toBe('brief');
    expect(config.useAdaptiveStaging).toBe(false);
    expect(derivation.callBudget).toBe(60);   // 4 × 15
    expect(derivation.fidelity).toBe('quick');
  });

  it('standard: moderate pacing, maxTotalRounds=10, callBudget=150', () => {
    const { config, derivation } = deriveDebateConfig(makeRequest({ fidelity: 'standard' }), makeRegistry());
    expect(config.pacing).toBe('moderate');
    expect(config.maxTotalRounds).toBe(10);
    expect(config.rounds).toBe(4);
    expect(config.responseLength).toBe('medium');
    expect(config.useAdaptiveStaging).toBe(true);
    expect(derivation.callBudget).toBe(150);  // 10 × 15
    expect(derivation.fidelity).toBe('standard');
  });

  it('deep: thorough pacing, maxTotalRounds=8, callBudget=120', () => {
    const { config, derivation } = deriveDebateConfig(makeRequest({ fidelity: 'deep' }), makeRegistry());
    expect(config.pacing).toBe('thorough');
    expect(config.maxTotalRounds).toBe(8);
    expect(config.rounds).toBe(6);
    expect(config.responseLength).toBe('detailed');
    expect(config.useAdaptiveStaging).toBe(true);
    expect(derivation.callBudget).toBe(120);  // 8 × 15
    expect(derivation.fidelity).toBe('deep');
  });
});

// ── Model resolution ─────────────────────────────────────────────────────────

describe('deriveDebateConfig — model resolution', () => {
  it('uses gemini tier default when no override', () => {
    const { config, derivation } = deriveDebateConfig(makeRequest({ fidelity: 'standard' }), makeRegistry());
    expect(config.model).toBe('gemini-3.5-flash-lite');
    expect(config.stageModels?.evaluator).toBe('gemini-3.5-flash-lite');
    expect(derivation.models['debaters']).toBe('gemini-3.5-flash-lite');
    expect(derivation.models['evaluator']).toBe('gemini-3.5-flash-lite');
  });

  it('deep fidelity uses advanced tier model', () => {
    const { config } = deriveDebateConfig(makeRequest({ fidelity: 'deep' }), makeRegistry());
    expect(config.model).toBe('gemini-3.1-pro-preview');
  });

  it('honors debaters override and stamps it in derivation', () => {
    const req = makeRequest({ models: { debaters: 'claude-sonnet-4-6' } });
    const { config, derivation } = deriveDebateConfig(req, makeRegistry());
    expect(config.model).toBe('claude-sonnet-4-6');
    expect(derivation.models['debaters']).toBe('claude-sonnet-4-6');
  });

  it('honors evaluator override independently of debaters', () => {
    const req = makeRequest({ models: { debaters: 'gemini-3.5-flash-lite', evaluator: 'claude-sonnet-4-6' } });
    const { config, derivation } = deriveDebateConfig(req, makeRegistry());
    expect(config.model).toBe('gemini-3.5-flash-lite');
    expect(config.stageModels?.evaluator).toBe('claude-sonnet-4-6');
    expect(derivation.models['evaluator']).toBe('claude-sonnet-4-6');
  });

  it('throws ActionableError for unregistered debaters model', () => {
    const req = makeRequest({ models: { debaters: 'not-a-real-model-xyz' } });
    expect(() => deriveDebateConfig(req, makeRegistry())).toThrow(ActionableError);
  });

  it('throws ActionableError for unregistered evaluator model', () => {
    const req = makeRequest({ models: { evaluator: 'bogus-model' } });
    expect(() => deriveDebateConfig(req, makeRegistry())).toThrow(ActionableError);
  });
});

// ── Config shape ─────────────────────────────────────────────────────────────

describe('deriveDebateConfig — config shape', () => {
  it('always sets topic from question', () => {
    const question = 'Is AGI a realistic near-term possibility?';
    const { config } = deriveDebateConfig(makeRequest({ question }), makeRegistry());
    expect(config.topic).toBe(question);
  });

  it('always activates all three debaters', () => {
    const { config } = deriveDebateConfig(makeRequest(), makeRegistry());
    expect(config.activePovers).toEqual(['accelerationist', 'safetyist', 'skeptic']);
  });

  it('derivation.rounds matches config.rounds', () => {
    const { config, derivation } = deriveDebateConfig(makeRequest(), makeRegistry());
    expect(derivation.rounds).toBe(config.rounds);
  });

  it('callsUsed and costUsd are absent from fresh derivation', () => {
    const { derivation } = deriveDebateConfig(makeRequest(), makeRegistry());
    expect(derivation.callsUsed).toBeUndefined();
    expect(derivation.costUsd).toBeUndefined();
  });
});
