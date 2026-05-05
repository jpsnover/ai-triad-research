// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type {
  DebatePhase,
  PhaseState,
  PhaseContext,
  PhaseTransitionConfig,
  SignalContext,
  Signal,
  PredicateResult,
  PredicateAction,
  SignalTelemetryRecord,
  AdaptiveStagingDiagnostics,
  ConvergenceSignals,
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  TranscriptEntry,
} from './types.js';
import { computePragmaticConvergence, computeSynthesisPragmaticSignal } from './pragmaticSignals.js';
import { computeSchemeStagnationCombined, computeSchemeCoverageFactor } from './schemeStagnation.js';
import {
  computeExtractionConfidence,
  computeStabilityConfidence,
  computeGlobalConfidence,
  isConfidenceDeferred,
  evaluateConfidenceGate,
  updateConfidenceState,
  initConfidenceState,
  DEFAULT_CONFIDENCE_FLOOR,
  type ConfidenceState,
} from './signalConfidence.js';
import { needsGc, needsHardCap } from './networkGc.js';
// ── Weight Loading ──────────────────────────────────────────
// Node.js fs/path/url are only available in the main process. In the renderer
// (Vite browser bundle) we fall through to the hardcoded defaults below.

interface ProvisionalWeights {
  schema_version: number;
  saturation: Record<string, number>;
  convergence: Record<string, number>;
  thresholds: Record<string, number>;
  phase_bounds: Record<string, number>;
  pacing_presets: Record<string, { maxTotalRounds: number; explorationExit: number; synthesisExit: number }>;
  network: Record<string, number>;
  budget: Record<string, number>;
  crux_detection?: { min_base_strength: number; min_cross_pov_attackers: number; min_total_cross_pov_edges: number };
}

let _cachedWeights: ProvisionalWeights | null = null;

export function loadProvisionalWeights(debateDir?: string): ProvisionalWeights {
  if (_cachedWeights) return _cachedWeights;

  // Only attempt filesystem reads in Node.js (main process / server)
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      // Dynamic imports avoid Vite externalization errors in the renderer
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('fs') as typeof import('fs');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('path') as typeof import('path');

      const candidates = [
        debateDir ? path.join(debateDir, 'provisional-weights.json') : null,
        path.resolve(__dirname, 'provisional-weights.json'),
      ].filter(Boolean) as string[];

      for (const p of candidates) {
        try {
          const raw = fs.readFileSync(p, 'utf-8');
          const parsed = JSON.parse(raw) as ProvisionalWeights;
          if (parsed.schema_version === 1) {
            _cachedWeights = parsed;
            return parsed;
          }
        } catch { /* try next candidate */ }
      }
    } catch { /* not in Node.js environment — fall through to defaults */ }
  }

  // Hardcoded fallback — PROVISIONAL pending Phase 5 validation
  _cachedWeights = {
    schema_version: 1,
    saturation: {
      recycling_pressure: 0.30, crux_maturity: 0.25, concession_plateau: 0.15,
      engagement_fatigue: 0.15, pragmatic_convergence: 0.05, scheme_stagnation: 0.10,
    },
    convergence: {
      qbaf_agreement_density: 0.30, position_stability: 0.20,
      irreducible_disagreement_ratio: 0.20, synthesis_pragmatic_signal: 0.15,
      crux_resolution_ratio: 0.15,
    },
    thresholds: { exploration_exit: 0.65, synthesis_exit: 0.70, confidence_floor: 0.40, crux_semantic_novelty: 0.70 },
    phase_bounds: {
      min_thesis_rounds: 2, max_thesis_rounds: 4,
      min_exploration_rounds: 2, max_exploration_rounds: 8,
      min_synthesis_rounds: 2, max_synthesis_rounds: 3,
      max_total_rounds_default: 12, max_regressions: 2, regression_ratchet: 0.10,
    },
    pacing_presets: {
      tight: { maxTotalRounds: 8, explorationExit: 0.55, synthesisExit: 0.60 },
      moderate: { maxTotalRounds: 12, explorationExit: 0.65, synthesisExit: 0.70 },
      thorough: { maxTotalRounds: 15, explorationExit: 0.80, synthesisExit: 0.80 },
    },
    network: { gc_trigger: 175, gc_target: 150, hard_cap: 200 },
    budget: { soft_multiplier: 6, hard_multiplier: 10, max_soft_multiplier: 8 },
  };
  return _cachedWeights;
}

export function resetWeightsCache(): void {
  _cachedWeights = null;
}

// ── Phase State Management ──────────────────────────────────

export function initPhaseState(config: PhaseTransitionConfig): PhaseState {
  const w = loadProvisionalWeights();
  const pacing = w.pacing_presets[config.pacing] ?? w.pacing_presets.moderate;

  return {
    current_phase: 'thesis-antithesis',
    rounds_in_phase: 0,
    total_rounds_elapsed: 0,
    regression_count: 0,
    exploration_exit_threshold: config.explorationExitThreshold ?? pacing.explorationExit,
    synthesis_exit_threshold: config.synthesisExitThreshold ?? pacing.synthesisExit,
    prior_crux_clusters: [],
    veto_history: [],
    gc_ran_this_phase: false,
    api_calls_used: 0,
    confidence_state: initConfidenceState(),
  };
}

export function validatePhaseState(state: PhaseState): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const w = loadProvisionalWeights();

  const validPhases: DebatePhase[] = ['thesis-antithesis', 'exploration', 'synthesis', 'terminated'];
  if (!validPhases.includes(state.current_phase)) {
    errors.push(`Invalid phase: ${state.current_phase}`);
  }
  if (state.rounds_in_phase < 0 || !Number.isInteger(state.rounds_in_phase)) {
    errors.push(`Invalid rounds_in_phase: ${state.rounds_in_phase}`);
  }
  if (state.regression_count > w.phase_bounds.max_regressions) {
    errors.push(`Regression count ${state.regression_count} exceeds budget ${w.phase_bounds.max_regressions}`);
  }
  if (state.exploration_exit_threshold < (w.thresholds.exploration_exit - 0.01)) {
    errors.push(`Exploration threshold ${state.exploration_exit_threshold} below baseline`);
  }

  return { valid: errors.length === 0, errors };
}

// ── Config Validation ───────────────────────────────────────

export function validateAdaptiveConfig(config: PhaseTransitionConfig): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (config.explorationExitThreshold > 0.95) {
    errors.push('explorationExitThreshold > 0.95: exploration will almost never exit organically');
  }
  if (config.synthesisExitThreshold < 0.30) {
    errors.push('synthesisExitThreshold < 0.30: synthesis will exit before meaningful convergence');
  }
  if (config.maxTotalRounds < 6) {
    errors.push('maxTotalRounds < 6: below the minimum sum of per-phase minimums');
  }
  if (config.maxTotalRounds > 20) {
    warnings.push('maxTotalRounds > 20: unusually long debate');
  }
  if (config.pacing === 'tight' && config.dialecticalStyle === 'integrative') {
    warnings.push('tight pacing conflicts with integrative style\'s higher exploration threshold');
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── Signal Registry ─────────────────────────────────────────

export function buildSignalRegistry(): Signal[] {
  const w = loadProvisionalWeights();

  return [
    // Saturation signals (exploration exit)
    {
      id: 'recycling_pressure',
      weight: w.saturation.recycling_pressure,
      enabled: true,
      maturity: 'v1-ship' as const,
      compute: (ctx: SignalContext) => {
        const lexical = ctx.convergenceSignals.recycling_rate.avg_self_overlap;
        const semantic = ctx.convergenceSignals.recycling_rate.semantic_max_similarity;
        if (semantic != null) return Math.max(lexical, semantic);
        return lexical;
      },
    },
    {
      id: 'crux_maturity',
      weight: w.saturation.crux_maturity,
      enabled: true,
      maturity: 'v1-ship' as const,
      compute: (ctx: SignalContext) => {
        const expectedCruxes = Math.max(1, ctx.transcript.activePovsCount - 1);
        const cruxCount = ctx.phase.cruxNodes.length;
        const cruxRatio = Math.min(1, cruxCount / expectedCruxes);

        // Follow-through: cruxes that received cross-POV edges within 2 rounds
        let followThroughCount = 0;
        for (const crux of ctx.phase.cruxNodes) {
          const cruxNodeEdges = ctx.network.edges.filter(
            e => (e.source === crux.id || e.target === crux.id),
          );
          if (cruxNodeEdges.length >= 2) followThroughCount++;
        }
        const followThroughRatio = cruxCount > 0 ? followThroughCount / cruxCount : 0;

        // Scheme coverage
        const allSchemes = ctx.network.nodes
          .map(n => n.argumentation_scheme)
          .filter((s): s is string => !!s);
        const schemeCoverage = computeSchemeCoverageFactor(allSchemes);

        // Resolution progress from crux tracker
        const cruxResolution = ctx.phase.cruxResolution;
        const resolvedCount = cruxResolution.filter(c =>
          c.state === 'resolved' || c.state === 'irreducible'
        ).length;
        const trackedCount = cruxResolution.length;
        const resolutionRatio = trackedCount > 0 ? resolvedCount / trackedCount : 0;

        const baseMaturity = cruxRatio * followThroughRatio * schemeCoverage;
        return trackedCount > 0
          ? 0.6 * baseMaturity + 0.4 * resolutionRatio
          : baseMaturity;
      },
    },
    {
      id: 'concession_plateau',
      weight: w.saturation.concession_plateau,
      enabled: true,
      maturity: 'v1-ship' as const,
      compute: (ctx: SignalContext) => {
        const { outcome, strong_attacks_faced } = ctx.convergenceSignals.concession_opportunity;
        return (outcome === 'missed' && strong_attacks_faced > 0) ? 1.0 : 0.0;
      },
    },
    {
      id: 'engagement_fatigue',
      weight: w.saturation.engagement_fatigue,
      enabled: true,
      maturity: 'v1-ship' as const,
      compute: (ctx: SignalContext) => {
        const currentRatio = ctx.convergenceSignals.engagement_depth.ratio;
        const peakRatio = ctx.priorSignals.get('_peak_engagement_ratio', 0) ?? currentRatio;
        if (peakRatio <= 0) return 0;
        return 1 - (currentRatio / peakRatio);
      },
    },
    {
      id: 'pragmatic_convergence',
      weight: w.saturation.pragmatic_convergence,
      enabled: true,
      maturity: 'v1-ship' as const,
      compute: (ctx: SignalContext) => {
        const recentRounds = ctx.transcript.lastNRounds(2);
        const allRounds = ctx.transcript.lastNRounds(999);
        const recentTexts = recentRounds.map(r => r.text);
        const allTexts = allRounds.map(r => r.text);
        const peakConcessive = ctx.priorSignals.get('_peak_concessive_rate', 0) ?? 0;
        return computePragmaticConvergence(recentTexts, allTexts, peakConcessive);
      },
    },
    {
      id: 'scheme_stagnation',
      weight: w.saturation.scheme_stagnation,
      enabled: true,
      maturity: 'v1-ship' as const,
      compute: (ctx: SignalContext) => {
        const recentRounds = ctx.transcript.lastNRounds(2);
        const allRounds = ctx.transcript.lastNRounds(999);
        const recentTurnNumbers = new Set(recentRounds.map(r => r.round));
        const recentSchemes = ctx.network.nodes
          .filter(n => recentTurnNumbers.has(n.turn_number) && n.argumentation_scheme)
          .map(n => n.argumentation_scheme!);
        const allSchemes = ctx.network.nodes
          .filter(n => n.argumentation_scheme)
          .map(n => n.argumentation_scheme!);
        // Group recent schemes by turn for bigram diversity
        const byTurn = new Map<number, string[]>();
        for (const n of ctx.network.nodes) {
          if (recentTurnNumbers.has(n.turn_number) && n.argumentation_scheme) {
            const list = byTurn.get(n.turn_number) ?? [];
            list.push(n.argumentation_scheme);
            byTurn.set(n.turn_number, list);
          }
        }
        return computeSchemeStagnationCombined(recentSchemes, allSchemes, [...byTurn.values()]);
      },
    },
  ];
}

// ── Composite Scores ────────────────────────────────────────

export function computeSaturationScore(signals: Signal[], ctx: SignalContext, coldStart: boolean): number {
  if (coldStart) return 0.5;

  let score = 0;
  for (const signal of signals) {
    if (!signal.enabled) continue;
    const value = Math.max(0, Math.min(1, signal.compute(ctx)));
    score += signal.weight * value;
  }
  return Math.max(0, Math.min(1, score));
}

export function computeConvergenceScore(ctx: SignalContext, coldStart: boolean): number {
  if (coldStart) return 0.5;
  const w = loadProvisionalWeights();

  // QBAF agreement density: cross-POV support edges in last 2 rounds
  const recentRounds = ctx.transcript.lastNRounds(2);
  const recentTurnNumbers = new Set(recentRounds.map(r => r.round));
  const recentSupportEdges = ctx.network.edges.filter(e => {
    const sourceNode = ctx.network.nodes.find(n => n.id === e.source);
    const targetNode = ctx.network.nodes.find(n => n.id === e.target);
    if (!sourceNode || !targetNode) return false;
    return e.type === 'supports'
      && sourceNode.speaker !== targetNode.speaker
      && (recentTurnNumbers.has(sourceNode.turn_number) || recentTurnNumbers.has(targetNode.turn_number));
  });

  let qbafAgreementDensity = 0;
  for (const edge of recentSupportEdges) {
    const sourceNode = ctx.network.nodes.find(n => n.id === edge.source);
    const targetNode = ctx.network.nodes.find(n => n.id === edge.target);
    const sourceGrounding = sourceNode?.taxonomy_refs.some(r => r.relevance === 'high') ? 1.0 : 0.5;
    const targetGrounding = targetNode?.taxonomy_refs.some(r => r.relevance === 'high') ? 1.0 : 0.5;
    qbafAgreementDensity += (sourceGrounding + targetGrounding) / 2;
  }
  qbafAgreementDensity = Math.min(1, qbafAgreementDensity / Math.max(1, ctx.transcript.activePovsCount));

  // Position stability
  const positionStability = 1 - ctx.convergenceSignals.position_delta.drift;

  // Irreducible disagreement ratio
  const recentCrossPovEdges = ctx.network.edges.filter(e => {
    const sn = ctx.network.nodes.find(n => n.id === e.source);
    const tn = ctx.network.nodes.find(n => n.id === e.target);
    return sn && tn && sn.speaker !== tn.speaker
      && (recentTurnNumbers.has(sn.turn_number) || recentTurnNumbers.has(tn.turn_number));
  });
  const strongAttackEdges = recentCrossPovEdges.filter(e => {
    if (e.type !== 'attacks') return false;
    const sn = ctx.network.nodes.find(n => n.id === e.source);
    const tn = ctx.network.nodes.find(n => n.id === e.target);
    return sn && tn && (sn.computed_strength ?? 0) > 0.6 && (tn.computed_strength ?? 0) > 0.6;
  });
  const irreducibleRatio = recentCrossPovEdges.length > 0
    ? strongAttackEdges.length / recentCrossPovEdges.length
    : 0;

  // Synthesis pragmatic signal
  const recentTexts = recentRounds.map(r => r.text);
  const allTexts = ctx.transcript.lastNRounds(999).map(r => r.text);
  const synthPragmatic = computeSynthesisPragmaticSignal(recentTexts, allTexts);

  // Crux resolution ratio: proportion of tracked cruxes that reached terminal state
  const cruxResolution = ctx.phase.cruxResolution;
  const cruxResolutionRatio = cruxResolution.length > 0
    ? cruxResolution.filter(c => c.state === 'resolved' || c.state === 'irreducible').length / cruxResolution.length
    : 0.5;

  return Math.max(0, Math.min(1,
    w.convergence.qbaf_agreement_density * qbafAgreementDensity
    + w.convergence.position_stability * Math.max(0, positionStability)
    + w.convergence.irreducible_disagreement_ratio * irreducibleRatio
    + w.convergence.synthesis_pragmatic_signal * synthPragmatic
    + (w.convergence.crux_resolution_ratio ?? 0) * cruxResolutionRatio
  ));
}

// ── Crux Detection ──────────────────────────────────────────

export function detectCruxNodes(
  nodes: ReadonlyArray<SignalContext['network']['nodes'][0]>,
  edges: ReadonlyArray<SignalContext['network']['edges'][0]>,
): { id: string; crossPovAttackCount: number; computedStrength: number }[] {
  const w = loadProvisionalWeights();
  const cd = w.crux_detection ?? { min_base_strength: 0.3, min_cross_pov_attackers: 1, min_total_cross_pov_edges: 1 };

  // P5: O(N+E) via pre-built indexes instead of O(N*E) nested scans
  const nodeById = new Map<string, SignalContext['network']['nodes'][0]>();
  for (const n of nodes) nodeById.set(n.id, n);

  const attacksByTarget = new Map<string, string[]>();
  for (const e of edges) {
    if (e.type === 'attacks') {
      let arr = attacksByTarget.get(e.target);
      if (!arr) { arr = []; attacksByTarget.set(e.target, arr); }
      arr.push(e.source);
    }
  }

  const cruxes: { id: string; crossPovAttackCount: number; computedStrength: number }[] = [];
  for (const node of nodes) {
    // Filter by base_strength (not computed_strength — QBAF reduces strength under attack,
    // which would exclude the most contested nodes, the exact opposite of what we want)
    const baseStr = node.base_strength ?? node.computed_strength ?? 0.5;
    if (baseStr < cd.min_base_strength) continue;

    const sources = attacksByTarget.get(node.id);
    if (!sources) continue;

    // Count cross-POV attackers (different speaker than node owner)
    const crossPovSources: string[] = [];
    const attackerSpeakers = new Set<string>();
    for (const srcId of sources) {
      const src = nodeById.get(srcId);
      if (src?.speaker && src.speaker !== node.speaker) {
        crossPovSources.push(srcId);
        attackerSpeakers.add(src.speaker);
      }
    }

    if (attackerSpeakers.size >= cd.min_cross_pov_attackers && crossPovSources.length >= cd.min_total_cross_pov_edges) {
      cruxes.push({ id: node.id, crossPovAttackCount: attackerSpeakers.size, computedStrength: node.computed_strength ?? baseStr });
    }
  }

  return cruxes;
}

// ── Predicate Evaluation ────────────────────────────────────

export function evaluatePhaseTransition(
  state: PhaseState,
  ctx: SignalContext,
  signals: Signal[],
  config: PhaseTransitionConfig,
  healthScore?: { value: number; consecutive_decline: number },
): PredicateResult {
  const w = loadProvisionalWeights();
  const pb = w.phase_bounds;
  const coldStart = state.rounds_in_phase < (
    state.current_phase === 'thesis-antithesis' ? pb.min_thesis_rounds
    : state.current_phase === 'exploration' ? pb.min_exploration_rounds
    : pb.min_synthesis_rounds
  );

  // Global: early termination
  if (config.allowEarlyTermination && healthScore) {
    if (healthScore.value < 0.10) {
      return { action: 'terminate', reason: 'Catastrophic health collapse (< 0.10)', veto_active: false, force_active: true, confidence_deferred: false, components: { health: healthScore.value } };
    }
    if (healthScore.value < 0.20 && healthScore.consecutive_decline >= 3) {
      return { action: 'terminate', reason: 'Sustained health decline (< 0.20 for 3 rounds)', veto_active: false, force_active: true, confidence_deferred: false, components: { health: healthScore.value, consecutive_decline: healthScore.consecutive_decline } };
    }
  }

  // Global: hard API budget
  const hardCeiling = config.maxTotalRounds * w.budget.hard_multiplier;
  if (state.api_calls_used >= hardCeiling) {
    return { action: 'terminate', reason: `API hard ceiling hit (${state.api_calls_used} >= ${hardCeiling})`, veto_active: false, force_active: true, confidence_deferred: false, components: { api_calls: state.api_calls_used, ceiling: hardCeiling } };
  }

  // Global: network hard cap
  if (needsHardCap(ctx.network.nodeCount, w.network.hard_cap) && state.current_phase !== 'synthesis') {
    return { action: 'force_transition', new_phase: 'synthesis', reason: `Network hard cap (${ctx.network.nodeCount} >= ${w.network.hard_cap})`, veto_active: false, force_active: true, confidence_deferred: false, components: { network_size: ctx.network.nodeCount } };
  }

  // Global: max total rounds — budget-aware
  // Reserve enough rounds for downstream phases' minimums so all three phases complete.
  const downstreamMinimums =
    state.current_phase === 'thesis-antithesis' ? pb.min_exploration_rounds + pb.min_synthesis_rounds
    : state.current_phase === 'exploration' ? pb.min_synthesis_rounds
    : 0;
  const budgetDeadline = config.maxTotalRounds - downstreamMinimums;

  if (state.total_rounds_elapsed >= config.maxTotalRounds) {
    // Absolute ceiling — terminate if in synthesis, otherwise force-advance
    if (state.current_phase === 'synthesis') {
      return { action: 'terminate', reason: `Max total rounds (${config.maxTotalRounds})`, veto_active: false, force_active: true, confidence_deferred: false, components: { total_rounds: state.total_rounds_elapsed } };
    }
    const nextPhase: DebatePhase = state.current_phase === 'thesis-antithesis' ? 'exploration' : 'synthesis';
    return { action: 'force_transition', new_phase: nextPhase, reason: `Budget exhausted at round ${state.total_rounds_elapsed}/${config.maxTotalRounds}, forcing advance to ${nextPhase}`, veto_active: false, force_active: true, confidence_deferred: false, components: { total_rounds: state.total_rounds_elapsed, downstream_reserved: downstreamMinimums } };
  }

  // Approaching deadline — force-transition to ensure downstream phases get their minimums.
  // Respect cold start: don't cut a phase short before its minimum rounds, unless at absolute ceiling (above).
  if (state.current_phase !== 'synthesis' && !coldStart && state.total_rounds_elapsed >= budgetDeadline) {
    const nextPhase: DebatePhase = state.current_phase === 'thesis-antithesis' ? 'exploration' : 'synthesis';
    return { action: 'force_transition', new_phase: nextPhase, reason: `Budget ceiling approaching (${state.total_rounds_elapsed}/${config.maxTotalRounds}), reserving ${downstreamMinimums} rounds for remaining phases`, veto_active: false, force_active: true, confidence_deferred: false, components: { total_rounds: state.total_rounds_elapsed, budget_deadline: budgetDeadline, downstream_reserved: downstreamMinimums } };
  }

  // Confidence gating (with escalation)
  const extractionConf = computeExtractionConfidence(
    ctx.extraction.lastRoundStatus,
    ctx.extraction.lastRoundClaimsAccepted,
    ctx.extraction.lastRoundCategoryValidityRatio,
  );
  const satScore = computeSaturationScore(signals, ctx, coldStart);
  const convScore = computeConvergenceScore(ctx, coldStart);
  const activeScore = state.current_phase === 'synthesis' ? convScore : satScore;
  const stabilityConf = computeStabilityConfidence(
    activeScore,
    ctx.priorSignals.movingAverage(state.current_phase === 'synthesis' ? '_convergence_score' : '_saturation_score', 3),
    state.rounds_in_phase,
  );

  const confState = state.confidence_state ?? initConfidenceState();
  const { shouldDefer, diagnostics: confDiag } = evaluateConfidenceGate(extractionConf, stabilityConf, confState);

  if (shouldDefer && !coldStart) {
    if (confDiag.escalated) {
      console.warn(`[confidence-escalation] Floor lowered from ${DEFAULT_CONFIDENCE_FLOOR} to ${confDiag.effective_floor} after ${confDiag.consecutive_deferrals} consecutive deferrals`);
    }
    return {
      action: 'stay', reason: `Confidence deferred (${confDiag.global_conf.toFixed(2)} < ${confDiag.effective_floor.toFixed(2)})`,
      veto_active: false, force_active: false, confidence_deferred: true,
      components: { extraction_conf: extractionConf, stability_conf: stabilityConf, global_conf: confDiag.global_conf, effective_floor: confDiag.effective_floor, consecutive_deferrals: confDiag.consecutive_deferrals },
    };
  }

  // Phase-specific predicates
  switch (state.current_phase) {
    case 'thesis-antithesis':
      return evaluateThesisExit(state, ctx, signals, pb, coldStart, satScore);
    case 'exploration':
      return evaluateExplorationExit(state, ctx, signals, config, w, coldStart, satScore);
    case 'synthesis':
      return evaluateSynthesisExit(state, ctx, config, w, coldStart, convScore);
  }
}

function evaluateThesisExit(
  state: PhaseState, ctx: SignalContext, _signals: Signal[],
  pb: Record<string, number>, coldStart: boolean, _satScore: number,
): PredicateResult {
  const components: Record<string, number> = { rounds_in_phase: state.rounds_in_phase };

  if (coldStart) {
    return { action: 'stay', reason: `Cold start (round ${state.rounds_in_phase} < min ${pb.min_thesis_rounds})`, veto_active: false, force_active: false, confidence_deferred: false, components };
  }

  // Hard cap
  if (state.rounds_in_phase >= pb.max_thesis_rounds) {
    return { action: 'transition', new_phase: 'exploration', reason: `Max thesis rounds (${pb.max_thesis_rounds})`, veto_active: false, force_active: true, confidence_deferred: false, components };
  }

  // Must have all POVs responded
  if (!ctx.phase.allPovsResponded) {
    components.all_povs_responded = 0;
    return { action: 'stay', reason: 'Not all POVs have responded', veto_active: false, force_active: false, confidence_deferred: false, components };
  }
  components.all_povs_responded = 1;

  // Claim rate declining OR crux identified
  const cruxFound = ctx.phase.cruxNodes.length > 0;
  components.crux_found = cruxFound ? 1 : 0;

  // Claim rate: compare last round's new nodes vs peak
  const recentRounds = ctx.transcript.lastNRounds(2);
  const claimsThisRound = recentRounds.length > 0 ? recentRounds[recentRounds.length - 1].claims_accepted : 0;
  const peakClaims = ctx.priorSignals.get('_peak_claims_per_round', 0) ?? claimsThisRound;
  const claimRateRatio = peakClaims > 0 ? claimsThisRound / peakClaims : 1;
  const claimRateDeclining = claimRateRatio <= 0.3 && peakClaims > 2;
  components.claim_rate_ratio = claimRateRatio;

  if (claimRateDeclining || cruxFound) {
    return {
      action: 'transition', new_phase: 'exploration',
      reason: cruxFound ? 'Crux identified' : `Claim rate declining (${claimRateRatio.toFixed(2)} of peak)`,
      veto_active: false, force_active: false, confidence_deferred: false, components,
    };
  }

  return { action: 'stay', reason: 'Thesis-antithesis continues', veto_active: false, force_active: false, confidence_deferred: false, components };
}

function evaluateExplorationExit(
  state: PhaseState, ctx: SignalContext, _signals: Signal[],
  config: PhaseTransitionConfig, w: ProvisionalWeights, coldStart: boolean, satScore: number,
): PredicateResult {
  const pb = w.phase_bounds;
  const components: Record<string, number> = {
    rounds_in_phase: state.rounds_in_phase,
    saturation_score: satScore,
    threshold: state.exploration_exit_threshold,
  };

  if (coldStart) {
    return { action: 'stay', reason: `Cold start (round ${state.rounds_in_phase} < min ${pb.min_exploration_rounds})`, veto_active: false, force_active: false, confidence_deferred: false, components };
  }

  // Force exits
  if (state.rounds_in_phase >= pb.max_exploration_rounds) {
    return { action: 'transition', new_phase: 'synthesis', reason: `Max exploration rounds (${pb.max_exploration_rounds})`, veto_active: false, force_active: true, confidence_deferred: false, components };
  }

  const softBudget = config.maxTotalRounds * w.budget.soft_multiplier;
  if (state.api_calls_used >= softBudget) {
    components.api_soft_budget = softBudget;
    return { action: 'transition', new_phase: 'synthesis', reason: `API soft budget hit (${state.api_calls_used} >= ${softBudget})`, veto_active: false, force_active: true, confidence_deferred: false, components };
  }

  // "Debate is dead" force — use semantic similarity when available, fallback to lexical
  const lexicalRecycling = ctx.convergenceSignals.recycling_rate.avg_self_overlap;
  const semanticRecycling = ctx.convergenceSignals.recycling_rate.semantic_max_similarity;
  const recyclingPressure = semanticRecycling != null ? Math.max(lexicalRecycling, semanticRecycling) : lexicalRecycling;
  const engagementFatigue = 1 - (ctx.convergenceSignals.engagement_depth.ratio / Math.max(0.01, ctx.priorSignals.get('_peak_engagement_ratio', 0) ?? ctx.convergenceSignals.engagement_depth.ratio));
  components.recycling_pressure = recyclingPressure;
  components.engagement_fatigue = Math.max(0, engagementFatigue);
  if (recyclingPressure > 0.8 && engagementFatigue > 0.8) {
    return { action: 'transition', new_phase: 'synthesis', reason: 'Debate is dead (recycling > 0.8 AND fatigue > 0.8)', veto_active: false, force_active: true, confidence_deferred: false, components };
  }

  // Composite score check
  if (satScore >= state.exploration_exit_threshold) {
    // Check vetoes
    const freshCrux = ctx.phase.cruxNodes.some(c => {
      const cruxNode = ctx.network.nodes.find(n => n.id === c.id);
      return cruxNode && cruxNode.turn_number === ctx.transcript.currentRound;
    });
    const freshConcession = ctx.convergenceSignals.concession_opportunity.outcome === 'taken';

    const lastVeto = state.veto_history.length > 0 ? state.veto_history[state.veto_history.length - 1] : null;
    const sameVetoLastRound = lastVeto && lastVeto.round === ctx.transcript.currentRound - 1;

    if (freshCrux && !sameVetoLastRound) {
      components.veto_crux = 1;
      return { action: 'stay', reason: 'Veto: fresh crux discovered this round', veto_active: true, force_active: false, confidence_deferred: false, components };
    }
    if (freshConcession && !sameVetoLastRound) {
      components.veto_concession = 1;
      return { action: 'stay', reason: 'Veto: concession made this round', veto_active: true, force_active: false, confidence_deferred: false, components };
    }

    return { action: 'transition', new_phase: 'synthesis', reason: `Saturation score ${satScore.toFixed(2)} >= threshold ${state.exploration_exit_threshold.toFixed(2)}`, veto_active: false, force_active: false, confidence_deferred: false, components };
  }

  return { action: 'stay', reason: `Saturation ${satScore.toFixed(2)} < threshold ${state.exploration_exit_threshold.toFixed(2)}`, veto_active: false, force_active: false, confidence_deferred: false, components };
}

function evaluateSynthesisExit(
  state: PhaseState, ctx: SignalContext, config: PhaseTransitionConfig,
  w: ProvisionalWeights, coldStart: boolean, convScore: number,
): PredicateResult {
  const pb = w.phase_bounds;
  const components: Record<string, number> = {
    rounds_in_phase: state.rounds_in_phase,
    convergence_score: convScore,
    threshold: state.synthesis_exit_threshold,
    regression_count: state.regression_count,
  };

  if (coldStart) {
    return { action: 'stay', reason: `Cold start (round ${state.rounds_in_phase} < min ${pb.min_synthesis_rounds})`, veto_active: false, force_active: false, confidence_deferred: false, components };
  }

  // Force exits
  if (state.rounds_in_phase >= pb.max_synthesis_rounds) {
    return { action: 'terminate', reason: `Max synthesis rounds (${pb.max_synthesis_rounds})`, veto_active: false, force_active: true, confidence_deferred: false, components };
  }

  // Synthesis stall
  const priorConv = ctx.priorSignals.get('_convergence_score', 1);
  const convDelta = priorConv !== null ? Math.abs(convScore - priorConv) : 1;
  components.convergence_delta = convDelta;
  const synthRecycling = Math.max(
    ctx.convergenceSignals.recycling_rate.avg_self_overlap,
    ctx.convergenceSignals.recycling_rate.semantic_max_similarity ?? 0,
  );
  if (convDelta < 0.05 && synthRecycling > 0.5) {
    const priorPriorConv = ctx.priorSignals.get('_convergence_score', 2);
    if (priorPriorConv !== null && Math.abs(convScore - priorPriorConv) < 0.05) {
      return { action: 'terminate', reason: 'Synthesis stall (2 rounds, delta < 0.05, recycling > 0.5)', veto_active: false, force_active: true, confidence_deferred: false, components };
    }
  }

  // Regression check (must be round >= 2 in synthesis)
  if (state.rounds_in_phase >= 2 && state.regression_count < w.phase_bounds.max_regressions) {
    // Convergence drop
    const convDrop2 = priorConv !== null ? (priorConv - convScore) : 0;
    components.convergence_drop_2r = convDrop2;

    // Novel crux
    const novelCruxes = ctx.phase.cruxNodes.filter(c => {
      const cruxNode = ctx.network.nodes.find(n => n.id === c.id);
      if (!cruxNode || cruxNode.turn_number !== ctx.transcript.currentRound) return false;
      // Check structural novelty against prior clusters
      for (const cluster of ctx.phase.priorCruxClusters) {
        if (cluster.includes(c.id)) return false;
      }
      return true;
    });
    components.novel_cruxes = novelCruxes.length;

    if (convDrop2 > 0.10 || novelCruxes.length > 0) {
      return {
        action: 'regress', new_phase: 'exploration',
        reason: novelCruxes.length > 0
          ? `Novel crux discovered in synthesis (${novelCruxes.map(c => c.id).join(', ')})`
          : `Convergence drop ${convDrop2.toFixed(2)} > 0.10 over 2 rounds`,
        veto_active: false, force_active: false, confidence_deferred: false, components,
      };
    }
  }

  // Normal exit
  if (convScore >= state.synthesis_exit_threshold) {
    return { action: 'transition', reason: `Convergence ${convScore.toFixed(2)} >= threshold ${state.synthesis_exit_threshold.toFixed(2)}`, veto_active: false, force_active: false, confidence_deferred: false, components };
  }

  // Soft budget: lower threshold
  const softBudget = config.maxTotalRounds * w.budget.soft_multiplier;
  if (state.api_calls_used >= softBudget) {
    const loweredThreshold = state.synthesis_exit_threshold - 0.10;
    if (convScore >= loweredThreshold) {
      components.lowered_threshold = loweredThreshold;
      return { action: 'transition', reason: `Convergence ${convScore.toFixed(2)} >= lowered threshold ${loweredThreshold.toFixed(2)} (soft budget)`, veto_active: false, force_active: false, confidence_deferred: false, components };
    }
  }

  return { action: 'stay', reason: `Convergence ${convScore.toFixed(2)} < threshold ${state.synthesis_exit_threshold.toFixed(2)}`, veto_active: false, force_active: false, confidence_deferred: false, components };
}

// ── Phase Transition Application ────────────────────────────

export function applyTransition(state: PhaseState, result: PredicateResult): PhaseState {
  const w = loadProvisionalWeights();
  const next = { ...state };

  switch (result.action) {
    case 'stay':
      return next;
    case 'transition':
    case 'force_transition':
      next.current_phase = result.new_phase ?? 'synthesis';
      next.rounds_in_phase = 0;
      next.gc_ran_this_phase = false;
      if (result.veto_active) {
        next.veto_history = [...state.veto_history, { round: state.total_rounds_elapsed, veto_type: result.reason }];
      }
      return next;
    case 'regress':
      next.current_phase = 'exploration';
      next.rounds_in_phase = 0;
      next.regression_count = state.regression_count + 1;
      next.exploration_exit_threshold = state.exploration_exit_threshold + w.phase_bounds.regression_ratchet;
      next.gc_ran_this_phase = false;
      // Record crux cluster
      const cruxIds = (result.components.novel_cruxes ?? 0) > 0
        ? Object.keys(result.components).filter(k => k.startsWith('crux_'))
        : [];
      if (cruxIds.length > 0) {
        next.prior_crux_clusters = [...state.prior_crux_clusters, cruxIds];
      }
      return next;
    case 'terminate':
      return next;
  }
}

export function advanceRound(state: PhaseState): PhaseState {
  return {
    ...state,
    rounds_in_phase: state.rounds_in_phase + 1,
    total_rounds_elapsed: state.total_rounds_elapsed + 1,
  };
}

// ── Phase Context Generation ────────────────────────────────

export function buildPhaseContext(state: PhaseState, config: PhaseTransitionConfig, satScore: number, convScore: number): PhaseContext {
  const w = loadProvisionalWeights();
  const pb = w.phase_bounds;

  let timeProgress: number;
  let scoreProgress: number;

  switch (state.current_phase) {
    case 'thesis-antithesis':
      timeProgress = pb.max_thesis_rounds > 1 ? (state.rounds_in_phase - 1) / (pb.max_thesis_rounds - 1) : 0;
      scoreProgress = 0;
      break;
    case 'exploration':
      timeProgress = pb.max_exploration_rounds > 1 ? (state.rounds_in_phase - 1) / (pb.max_exploration_rounds - 1) : 0;
      scoreProgress = state.exploration_exit_threshold > 0 ? satScore / state.exploration_exit_threshold : 0;
      break;
    case 'synthesis':
      timeProgress = pb.max_synthesis_rounds > 1 ? (state.rounds_in_phase - 1) / (pb.max_synthesis_rounds - 1) : 0;
      scoreProgress = state.synthesis_exit_threshold > 0 ? convScore / state.synthesis_exit_threshold : 0;
      break;
  }

  const progress = Math.max(0, Math.min(1, Math.max(timeProgress, scoreProgress)));
  const approaching = progress >= 0.85;

  const rationale = buildPhaseRationale(state, satScore, convScore);

  return {
    phase: state.current_phase,
    rationale,
    rounds_in_phase: state.rounds_in_phase,
    phase_progress: progress,
    approaching_transition: approaching,
  };
}

function buildPhaseRationale(state: PhaseState, satScore: number, convScore: number): string {
  switch (state.current_phase) {
    case 'thesis-antithesis':
      return `Thesis-antithesis phase, round ${state.rounds_in_phase}. Debaters are establishing positions.`;
    case 'exploration': {
      const pct = (satScore * 100).toFixed(0);
      const threshPct = (state.exploration_exit_threshold * 100).toFixed(0);
      const regrNote = state.regression_count > 0 ? ` (${state.regression_count} regression${state.regression_count > 1 ? 's' : ''})` : '';
      return `Exploration phase, round ${state.rounds_in_phase}. Saturation at ${pct}% of ${threshPct}% threshold${regrNote}.`;
    }
    case 'synthesis': {
      const pct = (convScore * 100).toFixed(0);
      const threshPct = (state.synthesis_exit_threshold * 100).toFixed(0);
      return `Synthesis phase, round ${state.rounds_in_phase}. Convergence at ${pct}% of ${threshPct}% threshold.`;
    }
  }
}

// ── Telemetry ───────────────────────────────────────────────

export function buildSignalTelemetry(
  state: PhaseState, ctx: SignalContext, signals: Signal[],
  result: PredicateResult, phaseProgress: number, elapsedMs: number,
): SignalTelemetryRecord {
  const signalValues: Record<string, number> = {};
  for (const signal of signals) {
    if (!signal.enabled) continue;
    try {
      signalValues[signal.id] = Math.max(0, Math.min(1, signal.compute(ctx)));
    } catch {
      signalValues[signal.id] = -1;
    }
  }

  const extractionConf = computeExtractionConfidence(
    ctx.extraction.lastRoundStatus, ctx.extraction.lastRoundClaimsAccepted, ctx.extraction.lastRoundCategoryValidityRatio,
  );
  const satScore = computeSaturationScore(signals, ctx, false);
  const convScore = computeConvergenceScore(ctx, false);
  const stabilityConf = computeStabilityConfidence(satScore, null, state.rounds_in_phase);
  const globalConf = computeGlobalConfidence(extractionConf, stabilityConf);

  return {
    round: state.total_rounds_elapsed,
    phase: state.current_phase,
    signals: signalValues,
    composite: {
      saturation_score: state.current_phase !== 'synthesis' ? satScore : null,
      convergence_score: state.current_phase === 'synthesis' ? convScore : null,
    },
    confidence: { extraction: extractionConf, stability: stabilityConf, global: globalConf },
    predicate_result: result,
    phase_progress: phaseProgress,
    regression_pressure: state.regression_count / (loadProvisionalWeights().phase_bounds.max_regressions || 2),
    human_override: null,
    network_size: ctx.network.nodeCount,
    elapsed_ms: elapsedMs,
  };
}

// ── Diagnostics ─────────────────────────────────────────────

export function initAdaptiveDiagnostics(): AdaptiveStagingDiagnostics {
  return {
    enabled: true,
    phases: [],
    regressions: [],
    total_predicate_evaluations: 0,
    confidence_deferrals: 0,
    vetoes_fired: 0,
    forces_fired: 0,
    human_overrides: [],
    network_size_peak: 0,
    gc_events: [],
    signal_telemetry: [],
  };
}
