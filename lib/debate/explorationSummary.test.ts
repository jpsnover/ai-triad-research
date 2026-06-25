// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { extractExplorationSummary } from './explorationSummary.js';
import type { ExplorationSummary } from './explorationSummary.js';
import type {
  DebateSession,
  TrackedCrux,
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  ConvergenceSignals,
  ProcessRewardEntry,
  AdaptiveStagingDiagnostics,
  TranscriptEntry,
  ExtractionSummary,
} from './types.js';

// ── Factories ────────────────────────────────────────────

function makeMinimalSession(overrides: Partial<DebateSession> = {}): DebateSession {
  return {
    id: 'test-debate-001',
    title: 'Test Debate',
    created_at: '2026-06-25T00:00:00Z',
    updated_at: '2026-06-25T01:00:00Z',
    phase: 'closed',
    topic: {
      original: 'Should AI be regulated?',
      refined: 'Should national governments regulate AI development?',
      final: 'Should national governments regulate frontier AI development?',
    },
    source_type: 'topic',
    source_ref: '',
    source_content: '',
    active_povers: ['accelerationist', 'safetyist', 'skeptic'],
    user_is_pover: false,
    transcript: [],
    context_summaries: [],
    ...overrides,
  } as DebateSession;
}

function makeCrux(overrides: Partial<TrackedCrux> = {}): TrackedCrux {
  return {
    id: 'crux-1',
    description: 'Does increased capability necessarily increase risk?',
    identified_turn: 2,
    state: 'engaged',
    history: [],
    disagreement_type: 'empirical',
    attacking_claim_ids: ['AN-1'],
    speakers_involved: ['accelerationist', 'safetyist'],
    last_computed_strength: 0.7,
    support_polarity: -0.3,
    ...overrides,
  };
}

function makeANNode(overrides: Partial<ArgumentNetworkNode> = {}): ArgumentNetworkNode {
  return {
    id: 'AN-1',
    text: 'Market competition drives safety',
    speaker: 'accelerationist',
    source_entry_id: 'te-1',
    taxonomy_refs: ['acc-beliefs-001'],
    turn_number: 1,
    computed_strength: 0.72,
    bdi_category: 'belief',
    ...overrides,
  } as ArgumentNetworkNode;
}

function makeANEdge(overrides: Partial<ArgumentNetworkEdge> = {}): ArgumentNetworkEdge {
  return {
    id: 'edge-1',
    source: 'AN-1',
    target: 'AN-2',
    type: 'attacks',
    attack_type: 'rebut',
    ...overrides,
  } as ArgumentNetworkEdge;
}

function makeConvergenceSignal(round: number, speaker: string, overrides: Partial<ConvergenceSignals> = {}): ConvergenceSignals {
  return {
    entry_id: `te-${round}-${speaker}`,
    round,
    speaker: speaker as ConvergenceSignals['speaker'],
    move_polarity: { confrontational: 0.5, collaborative: 0.5, ratio: 1 },
    dialectical_engagement: { targeted: 1, standalone: 0, ratio: 1 },
    argument_redundancy: { avg_self_overlap: 0.2, max_self_overlap: 0.3, semantically_recycled: false },
    dominant_counterargument: null,
    concession_opportunity: { strong_attacks_faced: 0, concession_used: false, outcome: 'none' },
    position_drift: { overlap_with_opening: 0.8, drift: 0.2 },
    crux_engagement_rate: { used_this_turn: false, cumulative_count: 0, cumulative_follow_through: 0 },
    ...overrides,
  };
}

function makeProcessReward(round: number, speaker: string, score: number): ProcessRewardEntry {
  return {
    entry_id: `te-${round}-${speaker}`,
    round,
    speaker: speaker as ProcessRewardEntry['speaker'],
    phase: 'argumentation',
    score,
    components: { engagement: score, novelty: score, consistency: score, grounding: score, move_quality: score, crux_relevance: score },
  };
}

function makeTranscriptEntry(overrides: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    id: `te-${Math.random().toString(36).slice(2)}`,
    timestamp: '2026-06-25T00:10:00Z',
    type: 'statement',
    speaker: 'accelerationist',
    content: 'Test content.',
    taxonomy_refs: [],
    ...overrides,
  };
}

function makeStagingDiagnostics(overrides: Partial<AdaptiveStagingDiagnostics> = {}): AdaptiveStagingDiagnostics {
  return {
    enabled: true,
    phases: [
      { phase: 'confrontation' as never, rounds: [1, 2], exit_reason: 'saturation' },
      { phase: 'argumentation' as never, rounds: [3, 4, 5, 6], exit_reason: 'convergence' },
      { phase: 'concluding' as never, rounds: [7, 8], exit_reason: 'complete' },
    ],
    regressions: [],
    total_predicate_evaluations: 24,
    confidence_deferrals: 1,
    vetoes_fired: 0,
    forces_fired: 0,
    human_overrides: [],
    network_size_peak: 30,
    gc_events: [],
    signal_telemetry: [],
    ...overrides,
  };
}

function makeExtractionSummary(overrides: Partial<ExtractionSummary> = {}): ExtractionSummary {
  return {
    total_turns: 8,
    total_proposed: 20,
    total_accepted: 15,
    total_rejected: 5,
    acceptance_rate: 0.75,
    an_growth_series: [],
    plateau_detected: false,
    rejection_reason_totals: {},
    ...overrides,
  };
}

function makeFullSession(): DebateSession {
  const nodes = Array.from({ length: 25 }, (_, i) =>
    makeANNode({
      id: `AN-${i + 1}`,
      text: `Claim ${i + 1}`,
      speaker: (['accelerationist', 'safetyist', 'skeptic'] as const)[i % 3],
      computed_strength: 0.9 - i * 0.03,
      bdi_category: (['belief', 'desire', 'intention'] as const)[i % 3],
      taxonomy_refs: [`ref-${i + 1}`],
    }),
  );

  const edges: ArgumentNetworkEdge[] = [
    makeANEdge({ id: 'e1', source: 'AN-1', target: 'AN-2', type: 'attacks', attack_type: 'rebut' }),
    makeANEdge({ id: 'e2', source: 'AN-3', target: 'AN-1', type: 'supports' }),
    makeANEdge({ id: 'e3', source: 'AN-5', target: 'AN-22', type: 'attacks' }),
    makeANEdge({ id: 'e-revoice', source: 'AN-1', target: 'AN-3', type: 'revoice_of' }),
  ];

  const statements = Array.from({ length: 24 }, (_, i) =>
    makeTranscriptEntry({
      id: `te-${i}`,
      type: 'statement',
      speaker: (['accelerationist', 'safetyist', 'skeptic'] as const)[i % 3],
    }),
  );

  const synthEntry = makeTranscriptEntry({
    id: 'te-synth',
    type: 'concluding',
    speaker: 'system',
    metadata: {
      synthesis: {
        areas_of_agreement: [
          { point: 'Some regulation is necessary', povers: ['accelerationist', 'safetyist'] },
        ],
        areas_of_disagreement: [
          { point: 'Scope of regulation', positions: [{ pover: 'accelerationist', stance: 'narrow' }] },
          { point: 'Timing of enforcement', positions: [{ pover: 'safetyist', stance: 'immediate' }] },
        ],
        unresolved_questions: ['How to enforce?', 'Who pays?'],
      },
    },
  });

  const signals = [
    makeConvergenceSignal(1, 'accelerationist'),
    makeConvergenceSignal(1, 'safetyist'),
    makeConvergenceSignal(1, 'skeptic'),
    makeConvergenceSignal(2, 'accelerationist', { argument_redundancy: { avg_self_overlap: 0.9, max_self_overlap: 0.95, semantically_recycled: true } }),
    makeConvergenceSignal(2, 'safetyist', { argument_redundancy: { avg_self_overlap: 0.9, max_self_overlap: 0.95, semantically_recycled: true } }),
    makeConvergenceSignal(2, 'skeptic', { argument_redundancy: { avg_self_overlap: 0.9, max_self_overlap: 0.95, semantically_recycled: true } }),
    makeConvergenceSignal(3, 'accelerationist', { position_drift: { overlap_with_opening: 0.6, drift: 0.4 } }),
    makeConvergenceSignal(3, 'safetyist', { position_drift: { overlap_with_opening: 0.7, drift: 0.3 } }),
    makeConvergenceSignal(3, 'skeptic', { position_drift: { overlap_with_opening: 0.65, drift: 0.35 } }),
  ];

  const rewards = [
    makeProcessReward(1, 'accelerationist', 0.8),
    makeProcessReward(1, 'safetyist', 0.7),
    makeProcessReward(1, 'skeptic', 0.6),
    makeProcessReward(2, 'accelerationist', 0.5),
    makeProcessReward(2, 'safetyist', 0.4),
    makeProcessReward(3, 'accelerationist', 0.9),
    makeProcessReward(3, 'safetyist', 0.85),
  ];

  return makeMinimalSession({
    debate_model: 'groq-openai-gpt-oss-120b',
    model_tier: 'basic',
    transcript: [...statements, synthEntry],
    argument_network: { nodes, edges },
    crux_tracker: [
      makeCrux({ id: 'crux-1', state: 'engaged', disagreement_type: 'empirical' }),
      makeCrux({ id: 'crux-2', state: 'irreducible', disagreement_type: 'values', description: 'Autonomy vs collective safety' }),
      makeCrux({ id: 'crux-3', state: 'identified', description: 'Unengaged crux' }),
    ],
    convergence_signals: signals,
    process_rewards: rewards,
    adaptive_staging_diagnostics: makeStagingDiagnostics(),
    extraction_summary: makeExtractionSummary({ plateau_detected: true, plateau_started_at_turn: 6 }),
    situation_debate_refs: {
      refs: {
        'sit-012': { debate_id: 'test-debate-001', turns: ['te-1', 'te-3', 'te-5', 'te-7'], match_type: 'both', relevance_score: 0.85 },
        'sit-007': { debate_id: 'test-debate-001', turns: ['te-2', 'te-4'], match_type: 'explicit_citation', relevance_score: 0.9 },
        'sit-099': { debate_id: 'test-debate-001', turns: [], match_type: 'semantic_match', relevance_score: 0.3 },
      },
      stats: { situations_checked: 10, situations_matched: 3, explicit_citations: 1, semantic_matches: 1, both: 1 },
    },
  });
}

// ── Tests ────────────────────────────────────────────────

describe('extractExplorationSummary', () => {
  describe('envelope fields', () => {
    it('sets version to 1', () => {
      const result = extractExplorationSummary(makeMinimalSession());
      expect(result.version).toBe(1);
    });

    it('copies source_debate_id from session.id', () => {
      const result = extractExplorationSummary(makeMinimalSession({ id: 'my-debate' }));
      expect(result.source_debate_id).toBe('my-debate');
    });

    it('uses debate_model for source_model, empty string when absent', () => {
      expect(extractExplorationSummary(makeMinimalSession({ debate_model: 'flash-lite' })).source_model).toBe('flash-lite');
      expect(extractExplorationSummary(makeMinimalSession()).source_model).toBe('');
    });

    it('defaults source_tier to basic when model_tier absent', () => {
      expect(extractExplorationSummary(makeMinimalSession()).source_tier).toBe('basic');
    });

    it('uses model_tier for source_tier', () => {
      expect(extractExplorationSummary(makeMinimalSession({ model_tier: 'advanced' })).source_tier).toBe('advanced');
    });

    it('copies topic fields, using original as fallback for refined', () => {
      const result = extractExplorationSummary(makeMinimalSession({
        topic: { original: 'orig', refined: null, final: 'final' },
      }));
      expect(result.topic).toEqual({ original: 'orig', refined: 'orig', final: 'final' });
    });

    it('produces a valid ISO timestamp', () => {
      const result = extractExplorationSummary(makeMinimalSession());
      expect(() => new Date(result.timestamp)).not.toThrow();
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('cruxes', () => {
    it('filters out identified-only cruxes', () => {
      const session = makeMinimalSession({
        crux_tracker: [
          makeCrux({ state: 'identified' }),
          makeCrux({ id: 'crux-2', state: 'engaged' }),
          makeCrux({ id: 'crux-3', state: 'irreducible' }),
        ],
      });
      const result = extractExplorationSummary(session);
      expect(result.cruxes).toHaveLength(2);
      expect(result.cruxes.map(c => c.state)).toEqual(['engaged', 'irreducible']);
    });

    it('returns empty array when crux_tracker absent', () => {
      const result = extractExplorationSummary(makeMinimalSession());
      expect(result.cruxes).toEqual([]);
    });

    it('defaults disagreement_type to empirical when absent', () => {
      const session = makeMinimalSession({
        crux_tracker: [makeCrux({ state: 'engaged', disagreement_type: undefined })],
      });
      const result = extractExplorationSummary(session);
      expect(result.cruxes[0].disagreement_type).toBe('empirical');
    });

    it('preserves speakers_involved', () => {
      const session = makeMinimalSession({
        crux_tracker: [makeCrux({ state: 'engaged', speakers_involved: ['safetyist', 'skeptic'] })],
      });
      const result = extractExplorationSummary(session);
      expect(result.cruxes[0].speakers_involved).toEqual(['safetyist', 'skeptic']);
    });
  });

  describe('argument_sketch', () => {
    it('takes top 20 nodes by computed_strength', () => {
      const nodes = Array.from({ length: 25 }, (_, i) =>
        makeANNode({ id: `AN-${i}`, computed_strength: 1 - i * 0.04 }),
      );
      const session = makeMinimalSession({ argument_network: { nodes, edges: [] } });
      const result = extractExplorationSummary(session);
      expect(result.argument_sketch.nodes).toHaveLength(20);
      expect(result.argument_sketch.nodes[0].id).toBe('AN-0');
      expect(result.argument_sketch.nodes[19].id).toBe('AN-19');
    });

    it('filters edges to only those between top nodes', () => {
      const nodes = Array.from({ length: 25 }, (_, i) =>
        makeANNode({ id: `AN-${i}`, computed_strength: 1 - i * 0.04 }),
      );
      const edges = [
        makeANEdge({ source: 'AN-0', target: 'AN-1', type: 'attacks' }),
        makeANEdge({ source: 'AN-0', target: 'AN-22', type: 'supports' }),
      ];
      const session = makeMinimalSession({ argument_network: { nodes, edges } });
      const result = extractExplorationSummary(session);
      expect(result.argument_sketch.edges).toHaveLength(1);
      expect(result.argument_sketch.edges[0].source).toBe('AN-0');
      expect(result.argument_sketch.edges[0].target).toBe('AN-1');
    });

    it('excludes revoice_of edges', () => {
      const nodes = [
        makeANNode({ id: 'AN-1', computed_strength: 0.9 }),
        makeANNode({ id: 'AN-2', computed_strength: 0.8 }),
      ];
      const edges = [
        makeANEdge({ source: 'AN-1', target: 'AN-2', type: 'revoice_of' }),
      ];
      const session = makeMinimalSession({ argument_network: { nodes, edges } });
      const result = extractExplorationSummary(session);
      expect(result.argument_sketch.edges).toHaveLength(0);
    });

    it('returns empty sketch when argument_network absent', () => {
      const result = extractExplorationSummary(makeMinimalSession());
      expect(result.argument_sketch.nodes).toEqual([]);
      expect(result.argument_sketch.edges).toEqual([]);
    });

    it('defaults bdi_category to belief when absent', () => {
      const session = makeMinimalSession({
        argument_network: { nodes: [makeANNode({ bdi_category: undefined })], edges: [] },
      });
      const result = extractExplorationSummary(session);
      expect(result.argument_sketch.nodes[0].bdi_category).toBe('belief');
    });

    it('includes attack_type only when present', () => {
      const nodes = [
        makeANNode({ id: 'AN-1', computed_strength: 0.9 }),
        makeANNode({ id: 'AN-2', computed_strength: 0.8 }),
      ];
      const edges = [
        makeANEdge({ source: 'AN-1', target: 'AN-2', type: 'attacks', attack_type: 'undercut' }),
        makeANEdge({ id: 'e2', source: 'AN-2', target: 'AN-1', type: 'supports', attack_type: undefined }),
      ];
      const session = makeMinimalSession({ argument_network: { nodes, edges } });
      const result = extractExplorationSummary(session);
      expect(result.argument_sketch.edges[0].attack_type).toBe('undercut');
      expect('attack_type' in result.argument_sketch.edges[1]).toBe(false);
    });
  });

  describe('situation effectiveness', () => {
    it('classifies situations by turns referenced', () => {
      const session = makeMinimalSession({
        situation_debate_refs: {
          refs: {
            'sit-1': { debate_id: 'd', turns: ['t1', 't2'], match_type: 'both', relevance_score: 0.8 },
            'sit-2': { debate_id: 'd', turns: [], match_type: 'semantic_match', relevance_score: 0.3 },
          },
          stats: { situations_checked: 2, situations_matched: 1, explicit_citations: 0, semantic_matches: 1, both: 1 },
        },
      });
      const result = extractExplorationSummary(session);
      expect(result.effective_situations).toHaveLength(1);
      expect(result.effective_situations[0]).toEqual({
        id: 'sit-1', label: '', referenced_turns: 2, match_type: 'both',
      });
      expect(result.ineffective_situations).toHaveLength(1);
      expect(result.ineffective_situations[0]).toEqual({ id: 'sit-2', label: '' });
    });

    it('returns empty arrays when situation_debate_refs absent', () => {
      const result = extractExplorationSummary(makeMinimalSession());
      expect(result.effective_situations).toEqual([]);
      expect(result.ineffective_situations).toEqual([]);
    });
  });

  describe('phase_dynamics', () => {
    it('extracts from adaptive_staging_diagnostics when present', () => {
      const session = makeMinimalSession({
        adaptive_staging_diagnostics: makeStagingDiagnostics({
          regressions: [{ from_round: 4, crux_id: 'crux-1', threshold_after: 0.6 }],
        }),
        extraction_summary: makeExtractionSummary({ plateau_started_at_turn: 5 }),
      });
      const result = extractExplorationSummary(session);
      expect(result.phase_dynamics.total_rounds).toBe(8);
      expect(result.phase_dynamics.saturation_round).toBe(5);
      expect(result.phase_dynamics.regression_count).toBe(1);
      expect(result.phase_dynamics.phase_durations).toHaveLength(3);
      expect(result.phase_dynamics.phase_durations[0]).toEqual({
        phase: 'confrontation', rounds: 2, exit_reason: 'saturation',
      });
    });

    it('falls back to transcript counting when diagnostics absent', () => {
      const statements = Array.from({ length: 9 }, (_, i) =>
        makeTranscriptEntry({ type: 'statement', speaker: (['accelerationist', 'safetyist', 'skeptic'] as const)[i % 3] }),
      );
      const session = makeMinimalSession({ transcript: statements });
      const result = extractExplorationSummary(session);
      expect(result.phase_dynamics.total_rounds).toBe(3);
      expect(result.phase_dynamics.phase_durations).toEqual([]);
    });

    it('sets saturation_round to null when no plateau', () => {
      const session = makeMinimalSession({
        adaptive_staging_diagnostics: makeStagingDiagnostics(),
      });
      const result = extractExplorationSummary(session);
      expect(result.phase_dynamics.saturation_round).toBeNull();
    });
  });

  describe('convergence_profile', () => {
    it('computes final_convergence_score from last signal drift', () => {
      const signals = [
        makeConvergenceSignal(1, 'acc', { position_drift: { overlap_with_opening: 0.8, drift: 0.2 } }),
        makeConvergenceSignal(2, 'acc', { position_drift: { overlap_with_opening: 0.6, drift: 0.4 } }),
      ];
      const session = makeMinimalSession({ convergence_signals: signals });
      const result = extractExplorationSummary(session);
      expect(result.convergence_profile.final_convergence_score).toBe(0.6);
    });

    it('returns null score when no signals', () => {
      const result = extractExplorationSummary(makeMinimalSession());
      expect(result.convergence_profile.final_convergence_score).toBeNull();
    });

    it('detects stall rounds where all speakers recycled', () => {
      const signals = [
        makeConvergenceSignal(1, 'accelerationist', { argument_redundancy: { avg_self_overlap: 0.9, max_self_overlap: 0.95, semantically_recycled: true } }),
        makeConvergenceSignal(1, 'safetyist', { argument_redundancy: { avg_self_overlap: 0.9, max_self_overlap: 0.95, semantically_recycled: true } }),
        makeConvergenceSignal(1, 'skeptic', { argument_redundancy: { avg_self_overlap: 0.9, max_self_overlap: 0.95, semantically_recycled: true } }),
        makeConvergenceSignal(2, 'accelerationist'),
        makeConvergenceSignal(2, 'safetyist'),
        makeConvergenceSignal(2, 'skeptic'),
      ];
      const session = makeMinimalSession({ convergence_signals: signals });
      const result = extractExplorationSummary(session);
      expect(result.convergence_profile.stall_rounds).toEqual([1]);
    });

    it('finds top 3 best engagement rounds by mean process reward', () => {
      const rewards = [
        makeProcessReward(1, 'acc', 0.9),
        makeProcessReward(1, 'saf', 0.8),
        makeProcessReward(2, 'acc', 0.3),
        makeProcessReward(3, 'acc', 0.7),
        makeProcessReward(3, 'saf', 0.75),
        makeProcessReward(4, 'acc', 0.6),
      ];
      const session = makeMinimalSession({ process_rewards: rewards });
      const result = extractExplorationSummary(session);
      expect(result.convergence_profile.best_engagement_rounds).toEqual([1, 3, 4]);
    });

    it('extracts agreement/disagreement areas from synthesis metadata', () => {
      const synthEntry = makeTranscriptEntry({
        type: 'concluding', speaker: 'system',
        metadata: {
          synthesis: {
            areas_of_agreement: [{ point: 'Agree on X' }],
            areas_of_disagreement: [{ point: 'Disagree on Y' }],
            unresolved_questions: ['Question Z'],
          },
        },
      });
      const session = makeMinimalSession({ transcript: [synthEntry] });
      const result = extractExplorationSummary(session);
      expect(result.convergence_profile.areas_of_agreement).toEqual(['Agree on X']);
      expect(result.convergence_profile.areas_of_disagreement).toEqual(['Disagree on Y']);
      expect(result.convergence_profile.unresolved_questions).toEqual(['Question Z']);
    });

    it('returns empty arrays when no synthesis entry', () => {
      const result = extractExplorationSummary(makeMinimalSession());
      expect(result.convergence_profile.areas_of_agreement).toEqual([]);
      expect(result.convergence_profile.areas_of_disagreement).toEqual([]);
      expect(result.convergence_profile.unresolved_questions).toEqual([]);
    });
  });

  describe('quality_summary', () => {
    it('computes mean process reward', () => {
      const session = makeMinimalSession({
        process_rewards: [
          makeProcessReward(1, 'acc', 0.8),
          makeProcessReward(1, 'saf', 0.6),
        ],
      });
      const result = extractExplorationSummary(session);
      expect(result.quality_summary.mean_process_reward).toBe(0.7);
    });

    it('returns 0 mean when no rewards', () => {
      const result = extractExplorationSummary(makeMinimalSession());
      expect(result.quality_summary.mean_process_reward).toBe(0);
    });

    it('computes repetition rate from semantically_recycled signals', () => {
      const signals = [
        makeConvergenceSignal(1, 'acc', { argument_redundancy: { avg_self_overlap: 0.9, max_self_overlap: 0.95, semantically_recycled: true } }),
        makeConvergenceSignal(1, 'saf'),
        makeConvergenceSignal(1, 'skp'),
        makeConvergenceSignal(2, 'acc', { argument_redundancy: { avg_self_overlap: 0.9, max_self_overlap: 0.95, semantically_recycled: true } }),
      ];
      const session = makeMinimalSession({ convergence_signals: signals });
      const result = extractExplorationSummary(session);
      expect(result.quality_summary.repetition_rate).toBe(0.5);
    });

    it('computes claims_forgotten_rate from extraction_summary', () => {
      const session = makeMinimalSession({
        extraction_summary: makeExtractionSummary({ total_proposed: 20, total_rejected: 4 }),
      });
      const result = extractExplorationSummary(session);
      expect(result.quality_summary.claims_forgotten_rate).toBe(0.2);
    });

    it('returns null crux_addressed_rate when no crux_tracker', () => {
      const result = extractExplorationSummary(makeMinimalSession());
      expect(result.quality_summary.crux_addressed_rate).toBeNull();
    });

    it('computes crux_addressed_rate correctly', () => {
      const session = makeMinimalSession({
        crux_tracker: [
          makeCrux({ state: 'engaged' }),
          makeCrux({ id: 'c2', state: 'resolved' }),
          makeCrux({ id: 'c3', state: 'identified' }),
          makeCrux({ id: 'c4', state: 'identified' }),
        ],
      });
      const result = extractExplorationSummary(session);
      expect(result.quality_summary.crux_addressed_rate).toBe(0.5);
    });
  });

  describe('recommended_config', () => {
    it('clamps max_rounds to 6-20 range', () => {
      const lowSession = makeMinimalSession({
        adaptive_staging_diagnostics: makeStagingDiagnostics({
          phases: [{ phase: 'argumentation' as never, rounds: [1, 2], exit_reason: 'complete' }],
        }),
      });
      expect(extractExplorationSummary(lowSession).recommended_config.max_rounds).toBe(6);

      const highSession = makeMinimalSession({
        adaptive_staging_diagnostics: makeStagingDiagnostics({
          phases: [{ phase: 'argumentation' as never, rounds: Array.from({ length: 20 }, (_, i) => i + 1), exit_reason: 'complete' }],
        }),
      });
      expect(extractExplorationSummary(highSession).recommended_config.max_rounds).toBe(20);
    });

    it('applies 1.5x multiplier to exploration rounds', () => {
      const session = makeMinimalSession({
        adaptive_staging_diagnostics: makeStagingDiagnostics({
          phases: [{ phase: 'argumentation' as never, rounds: [1, 2, 3, 4, 5, 6, 7, 8], exit_reason: 'complete' }],
        }),
      });
      expect(extractExplorationSummary(session).recommended_config.max_rounds).toBe(12);
    });

    it('lowers thresholds when exploration saturated early', () => {
      const session = makeMinimalSession({
        adaptive_staging_diagnostics: makeStagingDiagnostics(),
        extraction_summary: makeExtractionSummary({ plateau_started_at_turn: 3 }),
      });
      const result = extractExplorationSummary(session);
      expect(result.recommended_config.argumentation_exit_threshold).toBe(0.6);
      expect(result.recommended_config.concluding_exit_threshold).toBe(0.7);
    });

    it('uses standard thresholds when no early saturation', () => {
      const session = makeMinimalSession({
        adaptive_staging_diagnostics: makeStagingDiagnostics(),
      });
      const result = extractExplorationSummary(session);
      expect(result.recommended_config.argumentation_exit_threshold).toBe(0.7);
      expect(result.recommended_config.concluding_exit_threshold).toBe(0.8);
    });

    it('sets pacing based on exploration round count', () => {
      const make = (rounds: number[]) => makeMinimalSession({
        adaptive_staging_diagnostics: makeStagingDiagnostics({
          phases: [{ phase: 'argumentation' as never, rounds, exit_reason: 'complete' }],
        }),
      });
      expect(extractExplorationSummary(make([1, 2, 3, 4])).recommended_config.pacing).toBe('quick');
      expect(extractExplorationSummary(make([1, 2, 3, 4, 5, 6])).recommended_config.pacing).toBe('quick');
      expect(extractExplorationSummary(make([1, 2, 3, 4, 5, 6, 7])).recommended_config.pacing).toBe('moderate');
      expect(extractExplorationSummary(make([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).recommended_config.pacing).toBe('moderate');
      expect(extractExplorationSummary(make([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).recommended_config.pacing).toBe('thorough');
    });

    it('clamps situation_cap to 5-30 range', () => {
      const result = extractExplorationSummary(makeMinimalSession());
      expect(result.recommended_config.situation_cap).toBe(5);

      const manyRefs: Record<string, { debate_id: string; turns: string[]; match_type: 'both'; relevance_score: number }> = {};
      for (let i = 0; i < 30; i++) {
        manyRefs[`sit-${i}`] = { debate_id: 'd', turns: ['t1'], match_type: 'both', relevance_score: 0.8 };
      }
      const bigSession = makeMinimalSession({
        situation_debate_refs: {
          refs: manyRefs,
          stats: { situations_checked: 30, situations_matched: 30, explicit_citations: 0, semantic_matches: 0, both: 30 },
        },
      });
      expect(extractExplorationSummary(bigSession).recommended_config.situation_cap).toBe(30);
    });

    it('always sets skip_clarification to true', () => {
      const result = extractExplorationSummary(makeMinimalSession());
      expect(result.recommended_config.skip_clarification).toBe(true);
    });

    it('always sets temperature to 0.7', () => {
      const result = extractExplorationSummary(makeMinimalSession());
      expect(result.recommended_config.temperature).toBe(0.7);
    });
  });

  describe('full session integration', () => {
    it('produces a valid summary from a fully-populated session', () => {
      const session = makeFullSession();
      const result = extractExplorationSummary(session);

      expect(result.version).toBe(1);
      expect(result.source_debate_id).toBe('test-debate-001');
      expect(result.source_model).toBe('groq-openai-gpt-oss-120b');
      expect(result.source_tier).toBe('basic');

      expect(result.cruxes).toHaveLength(2);
      expect(result.cruxes.map(c => c.state)).toEqual(['engaged', 'irreducible']);

      expect(result.argument_sketch.nodes).toHaveLength(20);
      expect(result.argument_sketch.edges).toHaveLength(2);
      expect(result.argument_sketch.edges.every(e => e.type !== 'revoice_of')).toBe(true);

      expect(result.effective_situations).toHaveLength(2);
      expect(result.ineffective_situations).toHaveLength(1);

      expect(result.phase_dynamics.total_rounds).toBe(8);
      expect(result.phase_dynamics.saturation_round).toBe(6);
      expect(result.phase_dynamics.phase_durations).toHaveLength(3);

      expect(result.convergence_profile.stall_rounds).toEqual([2]);
      expect(result.convergence_profile.areas_of_agreement).toEqual(['Some regulation is necessary']);
      expect(result.convergence_profile.areas_of_disagreement).toHaveLength(2);
      expect(result.convergence_profile.unresolved_questions).toHaveLength(2);
      expect(result.convergence_profile.best_engagement_rounds.length).toBeLessThanOrEqual(3);

      expect(result.quality_summary.mean_process_reward).toBeGreaterThan(0);
      expect(result.quality_summary.crux_addressed_rate).toBeCloseTo(0.6667, 3);

      expect(result.recommended_config.max_rounds).toBe(12);
      expect(result.recommended_config.skip_clarification).toBe(true);
      expect(result.recommended_config.pacing).toBe('moderate');
    });

    it('produces a valid summary from a minimal session', () => {
      const result = extractExplorationSummary(makeMinimalSession());

      expect(result.version).toBe(1);
      expect(result.cruxes).toEqual([]);
      expect(result.argument_sketch.nodes).toEqual([]);
      expect(result.argument_sketch.edges).toEqual([]);
      expect(result.effective_situations).toEqual([]);
      expect(result.ineffective_situations).toEqual([]);
      expect(result.phase_dynamics.total_rounds).toBe(0);
      expect(result.phase_dynamics.saturation_round).toBeNull();
      expect(result.convergence_profile.final_convergence_score).toBeNull();
      expect(result.convergence_profile.stall_rounds).toEqual([]);
      expect(result.quality_summary.mean_process_reward).toBe(0);
      expect(result.quality_summary.crux_addressed_rate).toBeNull();
      expect(result.recommended_config.max_rounds).toBe(6);
    });
  });
});
