// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { DebateEngine } from './debateEngine.js';
import type { DebateConfig } from './debateEngine.js';
import type { ExtendedAIAdapter, GenerateOptions } from './aiAdapter.js';
import type { LoadedTaxonomy } from './taxonomyLoader.js';
import type { ExplorationSummary } from './explorationSummary.js';

// ── Fixtures ─────────────────────────────────────────────

function createMockAdapter(): ExtendedAIAdapter {
  return {
    async generateText(_prompt: string, _model: string, _options?: GenerateOptions) {
      return '{"response": "mock"}';
    },
  };
}

function createMinimalTaxonomy(): LoadedTaxonomy {
  return {
    accelerationist: {
      nodes: [
        { id: 'acc-B-001', label: 'AI progress', description: 'test', category: 'beliefs' } as any,
      ],
    },
    safetyist: {
      nodes: [
        { id: 'saf-B-001', label: 'AI risk', description: 'test', category: 'beliefs' } as any,
      ],
    },
    skeptic: {
      nodes: [
        { id: 'skp-B-001', label: 'AI hype', description: 'test', category: 'beliefs' } as any,
      ],
    },
    situations: {
      nodes: [
        { id: 'sit-001', label: 'Regulation', description: 'test' } as any,
        { id: 'sit-002', label: 'Open source', description: 'test' } as any,
        { id: 'sit-003', label: 'Compute governance', description: 'test' } as any,
      ],
    },
    edges: null,
    embeddings: {},
    policyRegistry: [],
  };
}

function createDefaultConfig(overrides: Partial<DebateConfig> = {}): DebateConfig {
  return {
    topic: 'Should AI development be regulated?',
    sourceType: 'topic',
    activePovers: ['accelerationist', 'safetyist', 'skeptic'],
    model: 'gemini-2.0-flash',
    rounds: 5,
    responseLength: 'medium',
    ...overrides,
  };
}

function createExplorationSummary(overrides: Partial<ExplorationSummary> = {}): ExplorationSummary {
  return {
    version: 1,
    source_debate_id: 'test-debate-001',
    source_model: 'gemini-2.0-flash-lite',
    source_tier: 'basic',
    timestamp: '2026-06-25T00:00:00.000Z',
    topic: {
      original: 'Should AI development be regulated?',
      refined: 'Should AI development be regulated?',
      final: 'Should AI development be regulated?',
    },
    cruxes: [
      {
        description: 'Whether current AI capabilities pose near-term risks',
        disagreement_type: 'empirical',
        state: 'engaged',
        speakers_involved: ['accelerationist', 'safetyist'],
      },
      {
        description: 'Whether safety measures slow beneficial progress',
        disagreement_type: 'values',
        state: 'one_side_conceded',
        speakers_involved: ['accelerationist', 'skeptic'],
      },
      {
        description: 'Whether regulation is the right policy tool',
        disagreement_type: 'definitional',
        state: 'resolved',
        speakers_involved: ['safetyist', 'skeptic'],
      },
    ],
    argument_sketch: {
      nodes: Array.from({ length: 15 }, (_, i) => ({
        id: `AN-${i + 1}`,
        text: `Argument node ${i + 1}`,
        speaker: ['accelerationist', 'safetyist', 'skeptic'][i % 3],
        bdi_category: 'belief',
        computed_strength: 1.0 - i * 0.05,
        taxonomy_refs: [`ref-${i + 1}`],
      })),
      edges: [
        { source: 'AN-1', target: 'AN-2', type: 'attacks' as const, attack_type: 'undercut' },
        { source: 'AN-3', target: 'AN-1', type: 'supports' as const },
        { source: 'AN-11', target: 'AN-12', type: 'attacks' as const },
      ],
    },
    effective_situations: [
      { id: 'sit-001', label: 'Regulation', referenced_turns: 5, match_type: 'explicit_citation' },
    ],
    ineffective_situations: [
      { id: 'sit-002', label: 'Open source' },
    ],
    phase_dynamics: {
      total_rounds: 8,
      saturation_round: null,
      regression_count: 1,
      phase_durations: [
        { phase: 'exploration', rounds: 5, exit_reason: 'threshold' },
        { phase: 'argumentation', rounds: 3, exit_reason: 'completed' },
      ],
    },
    convergence_profile: {
      final_convergence_score: 0.65,
      stall_rounds: [6],
      best_engagement_rounds: [2, 4, 5],
      areas_of_agreement: [
        'AI systems need some form of oversight',
        'Voluntary standards are insufficient alone',
      ],
      areas_of_disagreement: [
        'Whether government regulation is the right mechanism',
        'Speed of implementation vs thoroughness',
      ],
      unresolved_questions: [
        'How to handle open-source models under regulation',
      ],
    },
    quality_summary: {
      mean_process_reward: 0.72,
      repetition_rate: 0.15,
      claims_forgotten_rate: 0.08,
      crux_addressed_rate: 0.67,
    },
    recommended_config: {
      max_rounds: 12,
      argumentation_exit_threshold: 0.65,
      concluding_exit_threshold: 0.75,
      temperature: 0.7,
      situation_cap: 10,
      skip_clarification: true,
      pacing: 'moderate',
    },
    ...overrides,
  };
}

function buildEngine(configOverrides: Partial<DebateConfig> = {}, summary?: ExplorationSummary) {
  const config = createDefaultConfig({
    explorationSummary: summary,
    ...configOverrides,
  });
  const adapter = createMockAdapter();
  const taxonomy = createMinimalTaxonomy();
  return new DebateEngine(config, adapter, taxonomy);
}

// ── Config overrides (Step 4) ────────────────────────────

describe('Phase 0.9 — config overrides', () => {
  it('applies recommended_config when explicit config fields are absent', () => {
    const summary = createExplorationSummary();
    const engine = buildEngine({}, summary);
    const cfg = (engine as any).config as DebateConfig;

    expect(cfg.maxTotalRounds).toBe(12);
    expect(cfg.argumentationExitThreshold).toBe(0.65);
    expect(cfg.concludingExitThreshold).toBe(0.75);
    expect(cfg.temperature).toBe(0.7);
    expect(cfg.pacing).toBe('moderate');
    expect(cfg.enableClarification).toBe(false);
  });

  it('explicit config values take priority over recommended_config', () => {
    const summary = createExplorationSummary();
    const engine = buildEngine({
      maxTotalRounds: 8,
      argumentationExitThreshold: 0.5,
      concludingExitThreshold: 0.6,
      temperature: 0.9,
      pacing: 'thorough',
      enableClarification: true,
    }, summary);
    const cfg = (engine as any).config as DebateConfig;

    expect(cfg.maxTotalRounds).toBe(8);
    expect(cfg.argumentationExitThreshold).toBe(0.5);
    expect(cfg.concludingExitThreshold).toBe(0.6);
    expect(cfg.temperature).toBe(0.9);
    expect(cfg.pacing).toBe('thorough');
    expect(cfg.enableClarification).toBe(true);
  });

  it('clamps recommended values to bounds', () => {
    const summary = createExplorationSummary({
      recommended_config: {
        max_rounds: 100,
        argumentation_exit_threshold: 0.1,
        concluding_exit_threshold: 0.99,
        temperature: 0.1,
        situation_cap: 50,
        skip_clarification: true,
        pacing: 'quick',
      },
    });
    const engine = buildEngine({}, summary);
    const cfg = (engine as any).config as DebateConfig;

    expect(cfg.maxTotalRounds).toBe(20);
    expect(cfg.argumentationExitThreshold).toBe(0.4);
    expect(cfg.concludingExitThreshold).toBe(0.9);
    expect(cfg.temperature).toBe(0.3);
  });

  it('does not apply config overrides when topic mismatches', () => {
    const summary = createExplorationSummary({
      topic: {
        original: 'Completely different topic',
        refined: 'Completely different topic',
        final: 'Completely different topic',
      },
    });
    const engine = buildEngine({}, summary);
    const cfg = (engine as any).config as DebateConfig;

    expect(cfg.maxTotalRounds).toBeUndefined();
    expect(cfg.argumentationExitThreshold).toBeUndefined();
    expect(cfg.temperature).toBeUndefined();
  });
});

// ── Crux seeding (Step 1) ────────────────────────────────

describe('Phase 0.9 — crux seeding', () => {
  it('appends unresolved cruxes to prior crux context', () => {
    const summary = createExplorationSummary();
    const engine = buildEngine({}, summary);
    // Trigger seedExplorationSummary by calling private method
    (engine as any).initSession();
    (engine as any).seedExplorationSummary(summary);

    const ctx: string = (engine as any)._priorCruxContext;
    expect(ctx).toContain('=== EXPLORATION CRUXES ===');
    expect(ctx).toContain('[empirical] "Whether current AI capabilities pose near-term risks" (engaged)');
    expect(ctx).toContain('[values] "Whether safety measures slow beneficial progress" (one_side_conceded)');
  });

  it('filters out resolved cruxes', () => {
    const summary = createExplorationSummary();
    const engine = buildEngine({}, summary);
    (engine as any).initSession();
    (engine as any).seedExplorationSummary(summary);

    const ctx: string = (engine as any)._priorCruxContext;
    expect(ctx).not.toContain('Whether regulation is the right policy tool');
  });

  it('includes disagreement type in formatted output', () => {
    const summary = createExplorationSummary();
    const engine = buildEngine({}, summary);
    (engine as any).initSession();
    (engine as any).seedExplorationSummary(summary);

    const ctx: string = (engine as any)._priorCruxContext;
    expect(ctx).toContain('[empirical]');
    expect(ctx).toContain('[values]');
    expect(ctx).not.toContain('[definitional]');
  });

  it('appends after existing registry crux context', () => {
    const summary = createExplorationSummary();
    const engine = buildEngine({}, summary);
    (engine as any).initSession();
    (engine as any)._priorCruxContext = '=== PRIOR UNRESOLVED CRUXES ===\n- [empirical] "Registry crux" (identified)';
    (engine as any).seedExplorationSummary(summary);

    const ctx: string = (engine as any)._priorCruxContext;
    expect(ctx).toContain('=== PRIOR UNRESOLVED CRUXES ===');
    expect(ctx).toContain('=== EXPLORATION CRUXES ===');
    expect(ctx.indexOf('PRIOR UNRESOLVED')).toBeLessThan(ctx.indexOf('EXPLORATION CRUXES'));
  });
});

// ── Situation pre-filtering (Step 2) ─────────────────────

describe('Phase 0.9 — situation pre-filtering', () => {
  it('stores +0.15 boost for effective situations', () => {
    const summary = createExplorationSummary();
    const engine = buildEngine({}, summary);
    (engine as any).initSession();
    (engine as any).seedExplorationSummary(summary);

    const boosts: Map<string, number> = (engine as any)._explorationBoosts;
    expect(boosts.get('sit-001')).toBe(0.15);
  });

  it('stores -0.10 penalty for ineffective situations', () => {
    const summary = createExplorationSummary();
    const engine = buildEngine({}, summary);
    (engine as any).initSession();
    (engine as any).seedExplorationSummary(summary);

    const boosts: Map<string, number> = (engine as any)._explorationBoosts;
    expect(boosts.get('sit-002')).toBe(-0.10);
  });

  it('does not store boosts for unlisted situations', () => {
    const summary = createExplorationSummary();
    const engine = buildEngine({}, summary);
    (engine as any).initSession();
    (engine as any).seedExplorationSummary(summary);

    const boosts: Map<string, number> = (engine as any)._explorationBoosts;
    expect(boosts.has('sit-003')).toBe(false);
  });

  it('has empty boosts when explorationSummary is absent', () => {
    const engine = buildEngine({});
    const boosts: Map<string, number> = (engine as any)._explorationBoosts;
    expect(boosts.size).toBe(0);
  });
});

// ── AN priming (Step 3) ─────────────────────────────────

describe('Phase 0.9 — AN priming', () => {
  it('includes top 10 nodes by computed_strength', () => {
    const summary = createExplorationSummary();
    const engine = buildEngine({}, summary);
    (engine as any).initSession();
    (engine as any).seedExplorationSummary(summary);

    const priming: string = (engine as any)._explorationPriming;
    expect(priming).toContain('=== PRIOR ANALYSIS ===');
    expect(priming).toContain('Argument node 1');
    expect(priming).toContain('Argument node 10');
    expect(priming).not.toContain('Argument node 11');
  });

  it('includes edges between top 10 nodes only', () => {
    const summary = createExplorationSummary();
    const engine = buildEngine({}, summary);
    (engine as any).initSession();
    (engine as any).seedExplorationSummary(summary);

    const priming: string = (engine as any)._explorationPriming;
    expect(priming).toContain('AN-1');
    expect(priming).toContain('attacks');
    expect(priming).toContain('supports');
    // AN-11 → AN-12 edge should be excluded (both outside top 10)
    expect(priming).not.toContain('AN-11 →');
  });

  it('includes taxonomy refs in formatted nodes', () => {
    const summary = createExplorationSummary();
    const engine = buildEngine({}, summary);
    (engine as any).initSession();
    (engine as any).seedExplorationSummary(summary);

    const priming: string = (engine as any)._explorationPriming;
    expect(priming).toContain('refs: ref-1');
  });

  it('includes computed_strength in formatted nodes', () => {
    const summary = createExplorationSummary();
    const engine = buildEngine({}, summary);
    (engine as any).initSession();
    (engine as any).seedExplorationSummary(summary);

    const priming: string = (engine as any)._explorationPriming;
    expect(priming).toContain('strength: 1.00');
    expect(priming).toContain('strength: 0.95');
  });

  it('produces empty priming when argument_sketch has no nodes', () => {
    const summary = createExplorationSummary({
      argument_sketch: { nodes: [], edges: [] },
      convergence_profile: {
        final_convergence_score: null,
        stall_rounds: [],
        best_engagement_rounds: [],
        areas_of_agreement: [],
        areas_of_disagreement: [],
        unresolved_questions: [],
      },
    });
    const engine = buildEngine({}, summary);
    (engine as any).initSession();
    (engine as any).seedExplorationSummary(summary);

    const priming: string = (engine as any)._explorationPriming;
    expect(priming).toBe('');
  });
});

// ── Convergence priming (Step 5) ─────────────────────────

describe('Phase 0.9 — convergence priming', () => {
  it('includes areas of agreement', () => {
    const summary = createExplorationSummary();
    const engine = buildEngine({}, summary);
    (engine as any).initSession();
    (engine as any).seedExplorationSummary(summary);

    const priming: string = (engine as any)._explorationPriming;
    expect(priming).toContain('=== ESTABLISHED CONTEXT ===');
    expect(priming).toContain('AI systems need some form of oversight');
    expect(priming).toContain('Voluntary standards are insufficient alone');
  });

  it('includes areas of disagreement', () => {
    const summary = createExplorationSummary();
    const engine = buildEngine({}, summary);
    (engine as any).initSession();
    (engine as any).seedExplorationSummary(summary);

    const priming: string = (engine as any)._explorationPriming;
    expect(priming).toContain('Whether government regulation is the right mechanism');
  });

  it('includes unresolved questions', () => {
    const summary = createExplorationSummary();
    const engine = buildEngine({}, summary);
    (engine as any).initSession();
    (engine as any).seedExplorationSummary(summary);

    const priming: string = (engine as any)._explorationPriming;
    expect(priming).toContain('How to handle open-source models under regulation');
  });

  it('includes "Do not re-derive" instruction', () => {
    const summary = createExplorationSummary();
    const engine = buildEngine({}, summary);
    (engine as any).initSession();
    (engine as any).seedExplorationSummary(summary);

    const priming: string = (engine as any)._explorationPriming;
    expect(priming).toContain('Do not re-derive these');
  });
});

// ── Stale summary guard ──────────────────────────────────

describe('Phase 0.9 — stale summary guard', () => {
  it('skips seeding when topic mismatches on both final and original', () => {
    const summary = createExplorationSummary({
      topic: {
        original: 'Different topic entirely',
        refined: 'Different topic entirely',
        final: 'Different topic entirely',
      },
    });
    const engine = buildEngine({}, summary);
    (engine as any).initSession();
    (engine as any).seedExplorationSummary(summary);

    const ctx: string = (engine as any)._priorCruxContext;
    const boosts: Map<string, number> = (engine as any)._explorationBoosts;
    const priming: string = (engine as any)._explorationPriming;

    expect(ctx).toBe('');
    expect(boosts.size).toBe(0);
    expect(priming).toBe('');
  });

  it('proceeds when topic.final matches', () => {
    const summary = createExplorationSummary({
      topic: {
        original: 'Something else originally',
        refined: 'Something else refined',
        final: 'Should AI development be regulated?',
      },
    });
    const engine = buildEngine({}, summary);
    (engine as any).initSession();
    (engine as any).seedExplorationSummary(summary);

    const ctx: string = (engine as any)._priorCruxContext;
    expect(ctx).toContain('=== EXPLORATION CRUXES ===');
  });

  it('proceeds when topic.original matches config topic', () => {
    const summary = createExplorationSummary({
      topic: {
        original: 'Should AI development be regulated?',
        refined: 'Reframed version',
        final: 'Reframed version',
      },
    });
    const engine = buildEngine({}, summary);
    (engine as any).initSession();
    (engine as any).seedExplorationSummary(summary);

    const ctx: string = (engine as any)._priorCruxContext;
    expect(ctx).toContain('=== EXPLORATION CRUXES ===');
  });
});

// ── No-op when absent ────────────────────────────────────

describe('Phase 0.9 — no-op when absent', () => {
  it('leaves all exploration fields at defaults when no summary', () => {
    const engine = buildEngine({});

    const ctx: string = (engine as any)._priorCruxContext;
    const boosts: Map<string, number> = (engine as any)._explorationBoosts;
    const priming: string = (engine as any)._explorationPriming;

    expect(ctx).toBe('');
    expect(boosts.size).toBe(0);
    expect(priming).toBe('');
  });
});

// ── Integration: seeded vs blind comparison (AC #7) ──────

describe('Phase 0.9 — integration: seeded vs blind', () => {
  it('produces different crux context, situation scores, and priming when summary is present', () => {
    const summary = createExplorationSummary();

    const seededEngine = buildEngine({}, summary);
    (seededEngine as any).initSession();
    (seededEngine as any).seedExplorationSummary(summary);

    const blindEngine = buildEngine({});
    (blindEngine as any).initSession();

    // Crux context: seeded has exploration cruxes, blind has none
    const seededCrux: string = (seededEngine as any)._priorCruxContext;
    const blindCrux: string = (blindEngine as any)._priorCruxContext;
    expect(seededCrux.length).toBeGreaterThan(blindCrux.length);
    expect(seededCrux).toContain('EXPLORATION CRUXES');
    expect(blindCrux).not.toContain('EXPLORATION CRUXES');

    // Situation boosts: seeded has adjustments, blind has none
    const seededBoosts: Map<string, number> = (seededEngine as any)._explorationBoosts;
    const blindBoosts: Map<string, number> = (blindEngine as any)._explorationBoosts;
    expect(seededBoosts.size).toBeGreaterThan(0);
    expect(blindBoosts.size).toBe(0);

    // Priming: seeded has AN sketch + convergence, blind has none
    const seededPriming: string = (seededEngine as any)._explorationPriming;
    const blindPriming: string = (blindEngine as any)._explorationPriming;
    expect(seededPriming.length).toBeGreaterThan(0);
    expect(blindPriming).toBe('');
    expect(seededPriming).toContain('PRIOR ANALYSIS');
    expect(seededPriming).toContain('ESTABLISHED CONTEXT');

    // Config: seeded has overrides applied, blind has defaults
    const seededCfg = (seededEngine as any).config as DebateConfig;
    const blindCfg = (blindEngine as any).config as DebateConfig;
    expect(seededCfg.maxTotalRounds).toBe(12);
    expect(blindCfg.maxTotalRounds).toBeUndefined();
  });
});
