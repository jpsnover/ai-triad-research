// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { DebateEngineInternals } from './internals.js';
import { type ArgumentNetworkEdge, type SignalContext } from '../types.js';
import { detectCruxNodes } from '../phaseTransitions.js';
import { type SituationNode } from '../taxonomyTypes.js';
import { reScoreSituationsForCruxesDetailed } from '../taxonomyRelevance.js';
import { computeTaxonomyGapAnalysis } from '../taxonomyGapAnalysis.js';

/** Re-score situations against emerging cruxes at phase transitions. */
export function _rescoreSituations(engine: DebateEngineInternals): void {
  if (!engine.session.crux_tracker?.length) return;

  const sitNodes = (engine.taxonomy as unknown as Record<string, { nodes?: SituationNode[] }>).situations?.nodes ?? [];
  const anForRescore = engine.session.argument_network;
  if (!sitNodes.length || !anForRescore) return;

  const injectedSitIds = new Set(
    engine._contextManifests.flatMap(m => m.injected_node_ids).filter(id => id.startsWith('sit-')),
  );
  const referencedSitIds = new Set(
    engine.session.transcript.flatMap(e => e.taxonomy_refs).map(r => r.node_id).filter(id => id.startsWith('sit-')),
  );

  const nodeCategoryLookup = new Map(
    [
      ...engine.taxonomy.accelerationist.nodes,
      ...engine.taxonomy.safetyist.nodes,
      ...engine.taxonomy.skeptic.nodes,
    ].map(n => [n.id, n.category]),
  );

  const rescoreResult = reScoreSituationsForCruxesDetailed({
    situationNodes: sitNodes,
    cruxes: engine.session.crux_tracker,
    anNodes: anForRescore.nodes,
    nodeEmbeddings: engine.taxonomy.embeddings,
    injectedSitIds,
    referencedSitIds,
    edges: engine.taxonomy.edges?.edges,
    nodeCategoryLookup,
  });
  engine._situationScoreAdjustments = rescoreResult.adjustments;
  // Persist components for calibration logging (last-write-wins per node across rounds).
  const prevMap = engine.session.situation_score_map ?? {};
  engine.session.situation_score_map = { ...prevMap, ...Object.fromEntries(rescoreResult.components) };
}

// ── Adaptive staging helpers ─────────────────────────────

export function buildSignalContext(engine: DebateEngineInternals, round: number): SignalContext {
  const an = engine.session.argument_network!;
  const transcript = engine.session.transcript;
  const recentConvSignals = (engine.session.convergence_signals ?? []);
  const state = engine._phaseState!;
  const signalHistory = engine._signalHistory;

  const lastConvSignal = recentConvSignals.length > 0
    ? recentConvSignals[recentConvSignals.length - 1]
    : null;

  // Build transcript accessor
  const allStatements = transcript
    .filter(e => e.type === 'statement' || e.type === 'opening')
    .map(e => {
      const meta = e.metadata as Record<string, unknown> | undefined;
      const round = (meta?.round as number) ?? 0;
      const trace = engine.session.turn_validations?.[e.id];
      const lastAttempt = trace?.attempts?.[trace.attempts.length - 1];
      return {
        round,
        speaker: e.speaker,
        text: e.content,
        extraction_status: lastAttempt?.validation?.outcome ?? 'unknown',
        claims_accepted: (meta?.extracted_claims_accepted as number) ?? 0,
        claims_rejected: (meta?.extracted_claims_rejected as number) ?? 0,
        category_validity_ratio: 1.0,
      };
    });

  const lastRoundStatements = allStatements.filter(s => s.round === round);
  const lastStatus = lastRoundStatements.length > 0
    ? lastRoundStatements[lastRoundStatements.length - 1].extraction_status
    : 'ok';
  const lastClaimsAccepted = lastRoundStatements.reduce((sum, s) => sum + s.claims_accepted, 0);

  return {
    network: {
      nodes: an.nodes.map(n => ({
        id: n.id,
        speaker: n.speaker,
        computed_strength: n.computed_strength ?? 0.5,
        base_strength: n.base_strength,
        base_strength_category: n.bdi_category,
        argumentation_scheme: (an.edges.find(e => e.source === n.id) as ArgumentNetworkEdge | undefined)?.argumentation_scheme,
        taxonomy_refs: n.taxonomy_refs.map(id => ({
          node_id: typeof id === 'string' ? id : (id as unknown as { node_id: string }).node_id,
          relevance: 'medium',
        })),
        turn_number: n.turn_number,
      })),
      edges: an.edges.filter(e => e.type !== 'revoice_of').map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type as 'supports' | 'attacks',
        attack_type: e.attack_type,
        weight: e.weight ?? 0.5,
        scheme: e.scheme,
        argumentation_scheme: e.argumentation_scheme,
      })),
      nodeCount: an.nodes.length,
    },

    transcript: {
      currentRound: round,
      roundsInPhase: state.rounds_in_phase,
      activePovsCount: engine.config.activePovers.length,
      lastNRounds: (n: number) => {
        const maxRound = round;
        const minRound = Math.max(1, maxRound - n + 1);
        return allStatements.filter(s => s.round >= minRound && s.round <= maxRound);
      },
    },

    priorSignals: {
      get: (signalId: string, roundsBack: number): number | null => {
        const history = signalHistory.get(signalId);
        if (!history || history.length === 0) return null;
        const idx = history.length - 1 - roundsBack;
        return idx >= 0 ? history[idx].value : null;
      },
      movingAverage: (signalId: string, window: number): number | null => {
        const history = signalHistory.get(signalId);
        if (!history || history.length === 0) return null;
        const recent = history.slice(-window);
        return recent.reduce((sum, h) => sum + h.value, 0) / recent.length;
      },
    },

    convergenceSignals: {
      argument_redundancy: { avg_self_overlap: lastConvSignal?.argument_redundancy?.avg_self_overlap ?? 0, semantic_max_similarity: lastConvSignal?.argument_redundancy?.semantic_max_similarity },
      dialectical_engagement: { ratio: lastConvSignal?.dialectical_engagement?.ratio ?? 1 },
      position_drift: { drift: lastConvSignal?.position_drift?.drift ?? 0 },
      concession_opportunity: {
        outcome: lastConvSignal?.concession_opportunity?.outcome ?? 'none',
        strong_attacks_faced: lastConvSignal?.concession_opportunity?.strong_attacks_faced ?? 0,
      },
    },

    processRewards: (engine.session.process_rewards ?? []).slice(-12).map(pr => ({
      round: pr.round, score: pr.score,
    })),

    phase: {
      current: state.current_phase,
      allPovsResponded: allPovsRespondedThisRound(engine, round),
      cruxNodes: detectCruxNodes(
        an.nodes.map(n => ({
          id: n.id, speaker: n.speaker, computed_strength: n.computed_strength ?? 0.5,
          base_strength: n.base_strength, taxonomy_refs: [], turn_number: n.turn_number,
        })),
        an.edges.filter(e => e.type !== 'revoice_of').map(e => ({
          id: e.id, source: e.source, target: e.target,
          type: e.type as 'supports' | 'attacks', weight: e.weight ?? 0.5,
        })),
      ),
      cruxResolution: (engine.session.crux_tracker ?? []).map(c => ({
        id: c.id, state: c.state, support_polarity: c.support_polarity,
      })),
      priorCruxClusters: state.prior_crux_clusters,
      regressionCount: state.regression_count,
      argumentationExitThreshold: state.argumentation_exit_threshold,
      concludingExitThreshold: state.concluding_exit_threshold,
    },

    extraction: {
      lastRoundStatus: lastStatus,
      lastRoundClaimsAccepted: lastClaimsAccepted,
      lastRoundCategoryValidityRatio: 1.0,
    },
  };
}

export function allPovsRespondedThisRound(engine: DebateEngineInternals, round: number): boolean {
  const respondedThisRound = new Set(
    engine.session.transcript
      .filter(e => e.type === 'statement' && (e.metadata as Record<string, unknown>)?.round === round)
      .map(e => e.speaker),
  );
  return engine.config.activePovers.every(p => respondedThisRound.has(p));
}

export function recordSignalHistory(engine: DebateEngineInternals, signalId: string, round: number, value: number): void {
  if (!engine._signalHistory.has(signalId)) {
    engine._signalHistory.set(signalId, []);
  }
  engine._signalHistory.get(signalId)!.push({ round, value });
}

export function updatePeakTracker(engine: DebateEngineInternals, key: string, value: number): void {
  const current = engine._peakTrackers.get(key) ?? 0;
  if (value > current) {
    engine._peakTrackers.set(key, value);
  }
}

/**
 * Record a context manifest entry for taxonomy gap analysis.
 * Translates the last injection manifest (if any) into the format expected by
 * computeTaxonomyGapAnalysis, accumulating entries across the debate.
 */
export function accumulateContextManifest(engine: DebateEngineInternals, 
  round: number,
  speaker: string,
  pov: string,
  referencedNodeIds: string[],
): void {
  const manifest = engine._lastInjectionManifest;
  if (!manifest) return;
  engine._contextManifests.push({
    round,
    speaker,
    pov,
    injected_node_ids: [...manifest.povNodeIds, ...manifest.situationNodeIds],
    primary_node_ids: manifest.povPrimaryIds,
    referenced_node_ids: referencedNodeIds,
  });
}
