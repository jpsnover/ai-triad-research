// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DebateConfig } from './debateEngine.js';
import type { DebateSession } from './types.js';

const explorationSession: DebateSession = {
  id: 'explore-1',
  title: 'Test',
  topic: { original: 'AI regulation', refined: 'AI regulation', final: 'AI regulation' },
  transcript: [],
  activePovers: ['accelerationist', 'safetyist', 'skeptic'],
  debate_model: 'test-model',
  model_tier: 'basic',
  crux_tracker: [],
  argument_network: { nodes: [], edges: [] },
} as DebateSession;

const productionSession: DebateSession = {
  id: 'prod-1',
  title: 'Test Prod',
  topic: { original: 'AI regulation', refined: 'AI regulation', final: 'AI regulation' },
  transcript: [],
  activePovers: ['accelerationist', 'safetyist', 'skeptic'],
  debate_model: 'prod-model',
  model_tier: 'advanced',
  crux_tracker: [],
  argument_network: { nodes: [], edges: [] },
} as DebateSession;

let engineCallCount = 0;
const capturedConfigs: DebateConfig[] = [];

vi.mock('./debateEngine.js', () => ({
  DebateEngine: class {
    config: DebateConfig;
    constructor(config: DebateConfig) {
      this.config = config;
      capturedConfigs.push(config);
    }
    async run(onProgress?: (p: any) => void) {
      engineCallCount++;
      return engineCallCount === 1 ? explorationSession : productionSession;
    }
  },
}));

vi.mock('./explorationSummary.js', () => ({
  extractExplorationSummary: () => ({
    version: 1,
    source_debate_id: 'explore-1',
    source_model: 'test-model',
    source_tier: 'basic' as const,
    timestamp: '2026-01-01T00:00:00Z',
    topic: { original: 'AI regulation', refined: 'AI regulation', final: 'AI regulation' },
    cruxes: [{ description: 'test crux', disagreement_type: 'empirical', state: 'engaged', speakers_involved: ['acc'] }],
    argument_sketch: { nodes: [], edges: [] },
    effective_situations: [],
    ineffective_situations: [],
    phase_dynamics: { total_rounds: 4, saturation_round: null, regression_count: 0, phase_durations: [] },
    convergence_profile: { final_convergence_score: null, stall_rounds: [], best_engagement_rounds: [], areas_of_agreement: [], areas_of_disagreement: [], unresolved_questions: [] },
    quality_summary: { mean_process_reward: 0, repetition_rate: 0, claims_forgotten_rate: 0, crux_addressed_rate: null },
    recommended_config: { max_rounds: 10, argumentation_exit_threshold: 0.65, concluding_exit_threshold: 0.6, temperature: 0.7, situation_cap: 15, skip_clarification: true, pacing: 'moderate' as const },
  }),
}));

import { EXPLORATION_PRESET, runExploreFirstPipeline } from './explorationPreset.js';

function makeBaseConfig(): DebateConfig {
  return {
    topic: 'AI regulation',
    sourceType: 'topic',
    sourceRef: '',
    activePovers: ['accelerationist', 'safetyist', 'skeptic'],
    model: 'claude-sonnet-4-6',
    rounds: 5,
    responseLength: 'medium',
    protocolId: 'structured',
  } as DebateConfig;
}

const mockAdapter = { generate: vi.fn(), generateWithHistory: vi.fn() };
const mockTaxonomy = { accelerationist: { nodes: [] }, safetyist: { nodes: [] }, skeptic: { nodes: [] }, situations: { nodes: [] }, edges: [] };

describe('EXPLORATION_PRESET', () => {
  it('has expected field values', () => {
    expect(EXPLORATION_PRESET.responseLength).toBe('brief');
    expect(EXPLORATION_PRESET.maxTotalRounds).toBe(8);
    expect(EXPLORATION_PRESET.pacing).toBe('quick');
    expect(EXPLORATION_PRESET.enableClarification).toBe(false);
    expect(EXPLORATION_PRESET.enableWisdomEvaluation).toBe(false);
    expect(EXPLORATION_PRESET.wisdomAutoReframe).toBe(false);
    expect(EXPLORATION_PRESET.enableProbing).toBe(false);
    expect(EXPLORATION_PRESET.temperature).toBe(0.8);
    expect(EXPLORATION_PRESET.turnValidation).toEqual({ maxRetries: 1 });
    expect(EXPLORATION_PRESET.protocolId).toBe('exploration');
  });

  it('does not set topic or model', () => {
    expect(EXPLORATION_PRESET).not.toHaveProperty('topic');
    expect(EXPLORATION_PRESET).not.toHaveProperty('model');
  });

  it('does not set activePovers or sourceContent', () => {
    expect(EXPLORATION_PRESET).not.toHaveProperty('activePovers');
    expect(EXPLORATION_PRESET).not.toHaveProperty('sourceContent');
    expect(EXPLORATION_PRESET).not.toHaveProperty('sourceType');
    expect(EXPLORATION_PRESET).not.toHaveProperty('sourceRef');
  });
});

describe('runExploreFirstPipeline', () => {
  beforeEach(() => {
    engineCallCount = 0;
    capturedConfigs.length = 0;
  });

  it('runs two engines in sequence and returns both sessions', async () => {
    const logs: string[] = [];
    const result = await runExploreFirstPipeline(
      makeBaseConfig(), mockAdapter as any, mockTaxonomy as any,
      'groq-openai-gpt-oss-120b', (msg) => logs.push(msg),
    );

    expect(result.exploration).not.toBeNull();
    expect(result.exploration?.id).toBe('explore-1');
    expect(result.production.id).toBe('prod-1');
    expect(engineCallCount).toBe(2);
  });

  it('sets exploration model to the provided exploreModel', async () => {
    await runExploreFirstPipeline(
      makeBaseConfig(), mockAdapter as any, mockTaxonomy as any,
      'gemini-3.1-flash-lite', () => {},
    );

    expect(capturedConfigs[0].model).toBe('gemini-3.1-flash-lite');
  });

  it('applies EXPLORATION_PRESET fields to exploration config', async () => {
    await runExploreFirstPipeline(
      makeBaseConfig(), mockAdapter as any, mockTaxonomy as any,
      'test-model', () => {},
    );

    const explorationConfig = capturedConfigs[0];
    expect(explorationConfig.responseLength).toBe('brief');
    expect(explorationConfig.maxTotalRounds).toBe(8);
    expect(explorationConfig.pacing).toBe('quick');
    expect(explorationConfig.enableClarification).toBe(false);
    expect(explorationConfig.protocolId).toBe('exploration');
    expect(explorationConfig.temperature).toBe(0.8);
  });

  it('preserves base config model for production run', async () => {
    await runExploreFirstPipeline(
      makeBaseConfig(), mockAdapter as any, mockTaxonomy as any,
      'groq-openai-gpt-oss-120b', () => {},
    );

    expect(capturedConfigs[1].model).toBe('claude-sonnet-4-6');
  });

  it('passes explorationSummary to production config', async () => {
    await runExploreFirstPipeline(
      makeBaseConfig(), mockAdapter as any, mockTaxonomy as any,
      'test-model', () => {},
    );

    const productionConfig = capturedConfigs[1];
    expect(productionConfig.explorationSummary).toBeDefined();
    expect(productionConfig.explorationSummary?.source_debate_id).toBe('explore-1');
    expect(productionConfig.explorationSummary?.cruxes).toHaveLength(1);
  });

  it('logs exploration summary stats', async () => {
    const logs: string[] = [];
    await runExploreFirstPipeline(
      makeBaseConfig(), mockAdapter as any, mockTaxonomy as any,
      'test-model', (msg) => logs.push(msg),
    );

    expect(logs.some(l => l.includes('Exploration complete'))).toBe(true);
    expect(logs.some(l => l.includes('1 cruxes'))).toBe(true);
  });

  it('clears onSnapshot for exploration run', async () => {
    const baseConfig = makeBaseConfig();
    baseConfig.onSnapshot = () => {};

    await runExploreFirstPipeline(
      baseConfig, mockAdapter as any, mockTaxonomy as any,
      'test-model', () => {},
    );

    expect(capturedConfigs[0].onSnapshot).toBeUndefined();
  });
});

describe('runExploreFirstPipeline fallback', () => {
  it('falls back to blind production run on exploration failure', async () => {
    let fallbackCallCount = 0;

    vi.doMock('./debateEngine.js', () => ({
      DebateEngine: class {
        config: DebateConfig;
        constructor(config: DebateConfig) { this.config = config; }
        async run() {
          fallbackCallCount++;
          if (fallbackCallCount === 1) throw new Error('Exploration API failure');
          return productionSession;
        }
      },
    }));

    vi.resetModules();
    const { runExploreFirstPipeline: runFallback } = await import('./explorationPreset.js');

    const logs: string[] = [];
    const result = await runFallback(
      makeBaseConfig(), mockAdapter as any, mockTaxonomy as any,
      'bad-model', (msg) => logs.push(msg),
    );

    expect(result.exploration).toBeNull();
    expect(result.production.id).toBe('prod-1');
    expect(logs.some(l => l.includes('falling back to blind production run'))).toBe(true);

    vi.doUnmock('./debateEngine.js');
  });
});
