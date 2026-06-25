// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type {
  DebateSession,
  SpeakerId,
  CruxResolutionState,
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
} from './types.js';

// ── ExplorationSummary Interface ─────────────────────────

export interface ExplorationSummary {
  version: 1;
  source_debate_id: string;
  source_model: string;
  source_tier: 'basic' | 'advanced';
  timestamp: string;
  topic: { original: string; refined: string; final: string };

  cruxes: {
    description: string;
    disagreement_type: 'empirical' | 'values' | 'definitional';
    state: CruxResolutionState;
    speakers_involved: string[];
  }[];

  argument_sketch: {
    nodes: {
      id: string;
      text: string;
      speaker: string;
      bdi_category: string;
      computed_strength: number;
      taxonomy_refs: string[];
    }[];
    edges: {
      source: string;
      target: string;
      type: 'supports' | 'attacks';
      attack_type?: string;
    }[];
  };

  effective_situations: {
    id: string;
    label: string;
    referenced_turns: number;
    match_type: 'explicit_citation' | 'semantic_match' | 'both';
  }[];
  ineffective_situations: { id: string; label: string }[];

  phase_dynamics: {
    total_rounds: number;
    saturation_round: number | null;
    regression_count: number;
    phase_durations: { phase: string; rounds: number; exit_reason: string }[];
  };

  convergence_profile: {
    final_convergence_score: number | null;
    stall_rounds: number[];
    best_engagement_rounds: number[];
    areas_of_agreement: string[];
    areas_of_disagreement: string[];
    unresolved_questions: string[];
  };

  quality_summary: {
    mean_process_reward: number;
    repetition_rate: number;
    claims_forgotten_rate: number;
    crux_addressed_rate: number | null;
  };

  recommended_config: {
    max_rounds: number;
    argumentation_exit_threshold: number;
    concluding_exit_threshold: number;
    temperature: number;
    situation_cap: number;
    skip_clarification: boolean;
    pacing: 'quick' | 'moderate' | 'thorough';
  };
}

// ── Constants ────────────────────────────────────────────

const AN_NODE_LIMIT = 20;
const DEFAULT_TEMPERATURE = 0.7;
const MIN_ROUNDS = 6;
const MAX_ROUNDS = 20;
const MIN_SITUATION_CAP = 5;
const MAX_SITUATION_CAP = 30;
const BEST_ENGAGEMENT_COUNT = 3;

// ── Extractor ────────────────────────────────────────────

export function extractExplorationSummary(session: DebateSession): ExplorationSummary {
  const cruxes = extractCruxes(session);
  const argumentSketch = extractArgumentSketch(session);
  const { effective, ineffective } = extractSituationEffectiveness(session);
  const phaseDynamics = extractPhaseDynamics(session);
  const convergenceProfile = extractConvergenceProfile(session);
  const qualitySummary = extractQualitySummary(session, cruxes.length);
  const recommendedConfig = deriveRecommendedConfig(phaseDynamics, effective.length);

  return {
    version: 1,
    source_debate_id: session.id,
    source_model: session.debate_model ?? '',
    source_tier: session.model_tier ?? 'basic',
    timestamp: new Date().toISOString(),
    topic: {
      original: session.topic.original,
      refined: session.topic.refined ?? session.topic.original,
      final: session.topic.final,
    },
    cruxes,
    argument_sketch: argumentSketch,
    effective_situations: effective,
    ineffective_situations: ineffective,
    phase_dynamics: phaseDynamics,
    convergence_profile: convergenceProfile,
    quality_summary: qualitySummary,
    recommended_config: recommendedConfig,
  };
}

// ── Section extractors ───────────────────────────────────

function extractCruxes(session: DebateSession): ExplorationSummary['cruxes'] {
  return (session.crux_tracker ?? [])
    .filter(c => c.state !== 'identified')
    .map(c => ({
      description: c.description,
      disagreement_type: c.disagreement_type ?? 'empirical',
      state: c.state,
      speakers_involved: [...c.speakers_involved],
    }));
}

function extractArgumentSketch(session: DebateSession): ExplorationSummary['argument_sketch'] {
  const allNodes = session.argument_network?.nodes ?? [];
  const allEdges = session.argument_network?.edges ?? [];

  const topNodes = [...allNodes]
    .sort((a, b) => (b.computed_strength ?? 0) - (a.computed_strength ?? 0))
    .slice(0, AN_NODE_LIMIT);

  const topNodeIds = new Set(topNodes.map(n => n.id));

  const relevantEdges = allEdges.filter(
    e => topNodeIds.has(e.source) && topNodeIds.has(e.target) && e.type !== 'revoice_of',
  );

  return {
    nodes: topNodes.map(n => ({
      id: n.id,
      text: n.text,
      speaker: n.speaker,
      bdi_category: n.bdi_category ?? 'belief',
      computed_strength: n.computed_strength ?? 0,
      taxonomy_refs: [...n.taxonomy_refs],
    })),
    edges: relevantEdges.map(e => ({
      source: e.source,
      target: e.target,
      type: e.type as 'supports' | 'attacks',
      ...(e.attack_type ? { attack_type: e.attack_type } : {}),
    })),
  };
}

function extractSituationEffectiveness(session: DebateSession): {
  effective: ExplorationSummary['effective_situations'];
  ineffective: ExplorationSummary['ineffective_situations'];
} {
  const refs = session.situation_debate_refs?.refs ?? {};

  const effective: ExplorationSummary['effective_situations'] = [];
  const ineffective: ExplorationSummary['ineffective_situations'] = [];

  for (const [id, ref] of Object.entries(refs)) {
    if (ref.turns.length > 0) {
      effective.push({
        id,
        label: '',
        referenced_turns: ref.turns.length,
        match_type: ref.match_type,
      });
    } else {
      ineffective.push({ id, label: '' });
    }
  }

  return { effective, ineffective };
}

function extractPhaseDynamics(session: DebateSession): ExplorationSummary['phase_dynamics'] {
  const diag = session.adaptive_staging_diagnostics;

  if (diag) {
    const totalRounds = diag.phases.reduce((sum, p) => sum + p.rounds.length, 0);
    return {
      total_rounds: totalRounds,
      saturation_round: session.extraction_summary?.plateau_started_at_turn ?? null,
      regression_count: diag.regressions.length,
      phase_durations: diag.phases.map(p => ({
        phase: p.phase,
        rounds: p.rounds.length,
        exit_reason: p.exit_reason,
      })),
    };
  }

  const statementCount = session.transcript.filter(
    e => e.type === 'statement' || e.type === 'opening',
  ).length;
  const poversCount = Math.max(session.active_povers.length, 1);

  return {
    total_rounds: Math.ceil(statementCount / poversCount),
    saturation_round: session.extraction_summary?.plateau_started_at_turn ?? null,
    regression_count: 0,
    phase_durations: [],
  };
}

function extractConvergenceProfile(session: DebateSession): ExplorationSummary['convergence_profile'] {
  const signals = session.convergence_signals ?? [];
  const rewards = session.process_rewards ?? [];

  const lastSignal = signals.length > 0 ? signals[signals.length - 1] : null;
  const finalScore = lastSignal
    ? Math.round((1 - lastSignal.position_drift.drift) * 10000) / 10000
    : null;

  const stallRounds = findStallRounds(signals, session.active_povers);

  const bestEngagement = findBestEngagementRounds(rewards);

  const { agreements, disagreements, unresolved } = extractSynthesisAreas(session);

  return {
    final_convergence_score: finalScore,
    stall_rounds: stallRounds,
    best_engagement_rounds: bestEngagement,
    areas_of_agreement: agreements,
    areas_of_disagreement: disagreements,
    unresolved_questions: unresolved,
  };
}

function findStallRounds(
  signals: DebateSession['convergence_signals'] & {},
  activePovers: SpeakerId[],
): number[] {
  const roundMap = new Map<number, { recycled: number; total: number }>();
  for (const s of signals) {
    const entry = roundMap.get(s.round) ?? { recycled: 0, total: 0 };
    entry.total++;
    if (s.argument_redundancy.semantically_recycled) entry.recycled++;
    roundMap.set(s.round, entry);
  }
  const poversCount = Math.max(activePovers.length, 1);
  const stall: number[] = [];
  for (const [round, { recycled, total }] of roundMap) {
    if (total >= poversCount && recycled === total) stall.push(round);
  }
  return stall.sort((a, b) => a - b);
}

function findBestEngagementRounds(
  rewards: DebateSession['process_rewards'] & {},
): number[] {
  if (rewards.length === 0) return [];
  const roundScores = new Map<number, { sum: number; count: number }>();
  for (const r of rewards) {
    const entry = roundScores.get(r.round) ?? { sum: 0, count: 0 };
    entry.sum += r.score;
    entry.count++;
    roundScores.set(r.round, entry);
  }
  return [...roundScores.entries()]
    .map(([round, { sum, count }]) => ({ round, mean: sum / count }))
    .sort((a, b) => b.mean - a.mean)
    .slice(0, BEST_ENGAGEMENT_COUNT)
    .map(e => e.round)
    .sort((a, b) => a - b);
}

function extractSynthesisAreas(session: DebateSession): {
  agreements: string[];
  disagreements: string[];
  unresolved: string[];
} {
  const synthEntry = [...session.transcript].reverse().find(
    e => e.type === 'concluding' && e.speaker === 'system' && e.metadata?.synthesis,
  );
  const synthData = synthEntry?.metadata?.synthesis as Record<string, unknown> | undefined;
  if (!synthData) return { agreements: [], disagreements: [], unresolved: [] };

  const agreements = ((synthData.areas_of_agreement ?? []) as { point: string }[])
    .map(a => a.point)
    .filter(Boolean);

  const disagreements = ((synthData.areas_of_disagreement ?? []) as { point: string }[])
    .map(d => d.point)
    .filter(Boolean);

  const raw = synthData.unresolved_questions;
  const unresolved = Array.isArray(raw)
    ? raw.map(q => typeof q === 'string' ? q : (q as { question?: string }).question ?? '').filter(Boolean)
    : [];

  return { agreements, disagreements, unresolved };
}

function extractQualitySummary(
  session: DebateSession,
  engagedCruxCount: number,
): ExplorationSummary['quality_summary'] {
  const rewards = session.process_rewards ?? [];
  const meanReward = rewards.length > 0
    ? Math.round((rewards.reduce((s, r) => s + r.score, 0) / rewards.length) * 10000) / 10000
    : 0;

  const signals = session.convergence_signals ?? [];
  const recycledCount = signals.filter(s => s.argument_redundancy.semantically_recycled).length;
  const repetitionRate = signals.length > 0
    ? Math.round((recycledCount / signals.length) * 10000) / 10000
    : 0;

  const es = session.extraction_summary;
  const claimsForgottenRate = es && es.total_proposed > 0
    ? Math.round((es.total_rejected / es.total_proposed) * 10000) / 10000
    : 0;

  const totalCruxes = (session.crux_tracker ?? []).length;
  const cruxAddressedRate = totalCruxes > 0
    ? Math.round((engagedCruxCount / totalCruxes) * 10000) / 10000
    : null;

  return { mean_process_reward: meanReward, repetition_rate: repetitionRate, claims_forgotten_rate: claimsForgottenRate, crux_addressed_rate: cruxAddressedRate };
}

function deriveRecommendedConfig(
  phaseDynamics: ExplorationSummary['phase_dynamics'],
  effectiveSituationCount: number,
): ExplorationSummary['recommended_config'] {
  const explorationRounds = phaseDynamics.total_rounds;
  const maxRounds = Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, Math.ceil(explorationRounds * 1.5)));

  const saturatedEarly = phaseDynamics.saturation_round != null
    && phaseDynamics.saturation_round <= Math.ceil(explorationRounds * 0.5);

  const argThreshold = saturatedEarly ? 0.6 : 0.7;
  const conclThreshold = saturatedEarly ? 0.7 : 0.8;

  const situationCap = Math.min(
    MAX_SITUATION_CAP,
    Math.max(MIN_SITUATION_CAP, effectiveSituationCount + 5),
  );

  let pacing: 'quick' | 'moderate' | 'thorough';
  if (explorationRounds <= 6) pacing = 'quick';
  else if (explorationRounds <= 10) pacing = 'moderate';
  else pacing = 'thorough';

  return {
    max_rounds: maxRounds,
    argumentation_exit_threshold: argThreshold,
    concluding_exit_threshold: conclThreshold,
    temperature: DEFAULT_TEMPERATURE,
    situation_cap: situationCap,
    skip_clarification: true,
    pacing,
  };
}
