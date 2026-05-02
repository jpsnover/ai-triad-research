// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Post-debate calibration data logger.
 *
 * After each debate, extracts calibration-relevant metrics from the session
 * and appends a data point to calibration-log.json. The optimizer reads
 * this log to auto-tune parameters in provisional-weights.json.
 *
 * Works in both local (Electron) and Azure (server) environments — the log
 * lives in the data directory alongside debate sessions.
 */

import type { DebateSession, ArgumentNetworkNode, ArgumentNetworkEdge } from './types';
import type { NeutralEvaluation } from './neutralEvaluator';

// ── Calibration data point schema ──────────────────────────

export interface CalibrationDataPoint {
  /** Schema version for forward compat */
  schema_version: 1;
  /** Unique debate ID */
  debate_id: string;
  /** When the data point was recorded */
  timestamp: string;
  /** Where the debate ran */
  origin: 'local' | 'azure';
  /** Model used */
  model: string;
  /** Total rounds completed */
  rounds: number;

  // ── Parameter 1: Exploration exit threshold ──
  /** Saturation score at the moment of exploration→synthesis transition (null if no transition) */
  saturation_at_transition: number | null;
  /** The exploration_exit threshold that was active */
  exploration_exit_threshold: number;
  /** Neutral evaluator: debate engaging real disagreement? */
  engaging_real_disagreement: boolean | null;
  /** Neutral evaluator: fraction of cruxes addressed */
  crux_addressed_ratio: number | null;

  // ── Parameter 2: Embedding relevance threshold ──
  /** Average utilization rate across all turns: referenced / injected */
  avg_utilization_rate: number | null;
  /** Average primary node utilization: referenced_primary / injected_primary */
  avg_primary_utilization: number | null;
  /** The relevance threshold that was active (from config or default) */
  relevance_threshold: number;

  // ── Parameter 3: QBAF attack weights ──
  /** How often QBAF computed_strength ordering agrees with synthesis preferences */
  qbaf_preference_concordance: number | null;
  /** Attack weights used: [rebut, undercut, undermine] */
  attack_weights: [number, number, number];

  // ── Parameter 4: Draft temperature ──
  /** Schema/structural error rate: schema_errors / total_turns */
  structural_error_rate: number;
  /** Repetition warning rate: repetition_warnings / total_turns */
  repetition_rate: number;
  /** The draft temperature used */
  draft_temperature: number;

  // ── Parameter 5: Saturation signal weights ──
  /** Raw saturation signal values at transition point */
  saturation_signals_at_transition: Record<string, number> | null;
  /** The signal weights that were active */
  saturation_weights: Record<string, number>;

  // ── Parameter 6: Context compression window ──
  /** Fraction of claims that fell out of context and were never addressed */
  claims_forgotten_rate: number | null;
  /** RECENT_WINDOW value used */
  recent_window: number;

  // ── Parameter 7: GC trigger ──
  /** Argument network node count at synthesis time */
  an_nodes_at_synthesis: number;
  /** Number of GC runs during the debate */
  gc_runs: number;
  /** GC trigger threshold used */
  gc_trigger: number;

  // ── Parameter 8: Crux resolution thresholds ──
  /** How often engine crux status agrees with neutral evaluator crux status */
  crux_resolution_divergence_rate: number | null;
  /** POLARITY_RESOLVED_THRESHOLD used */
  polarity_resolved_threshold: number;

  // ── Parameter 9: Node selection caps ──
  /** Variance of relevance scores across injected nodes (low = narrow topic) */
  relevance_score_variance: number | null;
  /** Total nodes injected vs referenced (for cap tuning) */
  max_nodes_cap: number;

  // ── Parameter 10: Semantic recycling threshold ──
  /** Agreement rate between recycling detector and turn validator novelty signal */
  recycling_novelty_agreement: number | null;
  /** SEMANTIC_RECYCLING_THRESHOLD used */
  semantic_recycling_threshold: number;

  // ── Parameter 11: Cluster MinSimilarity ──
  /** How many AN nodes map to taxonomy nodes vs are orphaned (proxy for cluster quality) */
  taxonomy_mapped_ratio: number | null;
  /** Cluster MinSimilarity used in hierarchy proposals */
  cluster_min_similarity: number;

  // ── Parameter 12: Duplicate claim similarity ──
  /** Number of near-miss claim pairs (similarity in [threshold-0.05, threshold]) */
  near_miss_duplicate_count: number | null;
  /** Duplicate similarity threshold used */
  duplicate_similarity_threshold: number;

  // ── Parameter 13: FIRE confidence threshold ──
  /** Fraction of FIRE-accepted claims (confidence 0.7-0.75) that survived debate without being refuted */
  borderline_claim_survival_rate: number | null;
  /** FIRE confidence threshold used */
  fire_confidence_threshold: number;

  // ── Parameter 14: Hierarchy cohesion thresholds ──
  /** Average cohesion score of taxonomy branches referenced in the debate */
  avg_branch_cohesion: number | null;
  /** Cohesion "clear theme" threshold */
  cohesion_clear_theme: number;

  // ── Parameter 15: Extraction density quotas ──
  /** Claims per 1000 words across source documents in the debate */
  claims_per_1k_words: number | null;
  /** KP divisor (wordCount / divisor = key points) */
  kp_divisor: number;
}

// ── Extraction logic ────────────────────────────────────────

/**
 * Extract calibration data from a completed debate session.
 * Pure function — no side effects, no file I/O.
 */
export function extractCalibrationData(
  session: DebateSession,
  origin: 'local' | 'azure',
  config: {
    explorationExitThreshold?: number;
    relevanceThreshold?: number;
    draftTemperature?: number;
    attackWeights?: [number, number, number];
    saturationWeights?: Record<string, number>;
    recentWindow?: number;
    gcTrigger?: number;
    polarityResolvedThreshold?: number;
    maxNodesCap?: number;
    semanticRecyclingThreshold?: number;
    clusterMinSimilarity?: number;
    duplicateSimilarityThreshold?: number;
    fireConfidenceThreshold?: number;
    cohesionClearTheme?: number;
    kpDivisor?: number;
  } = {},
): CalibrationDataPoint {
  const now = new Date().toISOString();

  // ── Neutral evaluator metrics ──
  const finalEval = (session.neutral_evaluations ?? [])
    .find((e: NeutralEvaluation) => e.checkpoint === 'final');
  const engaging = finalEval?.overall_assessment.debate_is_engaging_real_disagreement ?? null;
  const cruxRatio = finalEval
    ? finalEval.cruxes.length > 0
      ? finalEval.cruxes.filter(c => c.status === 'addressed').length / finalEval.cruxes.length
      : null
    : null;

  // ── Utilization rates from context injection manifests ──
  let totalUtil = 0, totalPrimaryUtil = 0, utilCount = 0;
  for (const entry of session.transcript) {
    const manifest = (entry.metadata as Record<string, unknown>)?.injection_manifest as {
      injected_count?: number;
      referenced_count?: number;
      primary_injected?: number;
      primary_referenced?: number;
    } | undefined;
    if (manifest?.injected_count && manifest.injected_count > 0) {
      totalUtil += (manifest.referenced_count ?? 0) / manifest.injected_count;
      if (manifest.primary_injected && manifest.primary_injected > 0) {
        totalPrimaryUtil += (manifest.primary_referenced ?? 0) / manifest.primary_injected;
      }
      utilCount++;
    }
  }

  // ── Validation error/warning rates ──
  const validations = session.turn_validations ?? {};
  const validationEntries = Object.values(validations) as { final?: { issues?: string[] } }[];
  const totalTurns = session.transcript.filter(e =>
    e.type === 'opening' || e.type === 'statement',
  ).length;
  let structuralErrors = 0, repetitionWarnings = 0;
  for (const v of validationEntries) {
    const issues = (v as any)?.final?.issues ?? (v as any)?.attempts?.flatMap((a: any) => a.issues ?? []) ?? [];
    for (const issue of issues) {
      const text = typeof issue === 'string' ? issue : (issue as any)?.message ?? '';
      if (/unknown move|schema|missing|move_types/i.test(text)) structuralErrors++;
      if (/repeat|repetition|same moves/i.test(text)) repetitionWarnings++;
    }
  }

  // ── QBAF concordance with synthesis preferences ──
  let concordance: number | null = null;
  const synthEntry = session.transcript.find(e => e.type === 'synthesis');
  const synthMeta = (synthEntry?.metadata as Record<string, unknown>)?.synthesis as {
    preferences?: { prevails?: string; claim_ids?: string[] }[];
  } | undefined;
  const an = session.argument_network;
  if (synthMeta?.preferences && an && an.nodes.length > 0) {
    let matches = 0, total = 0;
    for (const pref of synthMeta.preferences) {
      if (!pref.claim_ids || pref.claim_ids.length < 2) continue;
      const strengths = pref.claim_ids
        .map(id => an.nodes.find((n: ArgumentNetworkNode) => n.id === id))
        .filter(Boolean)
        .map(n => n!.computed_strength ?? n!.base_strength ?? 0.5);
      if (strengths.length >= 2) {
        total++;
        // Check if the prevailing claim has the highest computed strength
        const maxStr = Math.max(...strengths);
        if (strengths[0] === maxStr) matches++;
      }
    }
    concordance = total > 0 ? matches / total : null;
  }

  // ── Saturation signals at transition ──
  // Look for phase transition metadata in convergence signals
  const convSignals = (session as any).convergence_signals as {
    round: number;
    saturation_score?: number;
    signal_values?: Record<string, number>;
  }[] | undefined;
  let saturationAtTransition: number | null = null;
  let signalsAtTransition: Record<string, number> | null = null;
  if (convSignals && convSignals.length > 0) {
    // Find the signal closest to exploration→synthesis transition
    const last = convSignals[convSignals.length - 1];
    saturationAtTransition = last.saturation_score ?? null;
    signalsAtTransition = last.signal_values ?? null;
  }

  // ── Round count ──
  const rounds = session.transcript.filter(e => e.type === 'statement').length;

  // ── Parameter 6: Compression window — claims forgotten rate ──
  const ledger = session.unanswered_claims_ledger ?? [];
  const totalClaims = an?.nodes.length ?? 0;
  const forgottenClaims = ledger.filter(c => !c.addressed_round).length;
  const claimsForgottenRate = totalClaims > 0 ? forgottenClaims / totalClaims : null;

  // ── Parameter 7: GC metrics ──
  const anNodesAtSynthesis = an?.nodes.length ?? 0;
  const gcRuns = ((session as any).gc_history as unknown[] | undefined)?.length ?? 0;

  // ── Parameter 8: Crux resolution divergence ──
  let cruxDivergenceRate: number | null = null;
  if (finalEval && (session as any).crux_tracker) {
    const engineCruxes = ((session as any).crux_tracker?.cruxes as { id: string; status: string }[] | undefined) ?? [];
    const evalCruxes = finalEval.cruxes;
    if (engineCruxes.length > 0 && evalCruxes.length > 0) {
      // Compare: how often does engine "addressed" disagree with evaluator "unaddressed" (or vice versa)?
      let divergences = 0;
      const minLen = Math.min(engineCruxes.length, evalCruxes.length);
      for (let i = 0; i < minLen; i++) {
        const engineResolved = engineCruxes[i].status === 'resolved';
        const evalAddressed = evalCruxes[i].status === 'addressed';
        if (engineResolved !== evalAddressed) divergences++;
      }
      cruxDivergenceRate = minLen > 0 ? divergences / minLen : null;
    }
  }

  // ── Parameter 9: Node cap — relevance score variance ──
  let relevanceVariance: number | null = null;
  const allRelevanceScores: number[] = [];
  for (const entry of session.transcript) {
    const manifest = (entry.metadata as Record<string, unknown>)?.injection_manifest as {
      node_scores?: number[];
    } | undefined;
    if (manifest?.node_scores) {
      allRelevanceScores.push(...manifest.node_scores);
    }
  }
  if (allRelevanceScores.length > 2) {
    const mean = allRelevanceScores.reduce((a, b) => a + b, 0) / allRelevanceScores.length;
    relevanceVariance = allRelevanceScores.reduce((s, v) => s + (v - mean) ** 2, 0) / allRelevanceScores.length;
  }

  // ── Parameter 10: Recycling/novelty agreement ──
  let recyclingAgreement: number | null = null;
  const recyclingFlags: boolean[] = [];
  const noveltyFlags: boolean[] = [];
  for (const entry of session.transcript) {
    if (entry.type !== 'statement') continue;
    const meta = entry.metadata as Record<string, unknown> | undefined;
    const recycled = meta?.recycling_detected === true;
    const noNewRefs = meta?.no_new_refs === true;
    recyclingFlags.push(recycled);
    noveltyFlags.push(noNewRefs);
  }
  if (recyclingFlags.length > 0) {
    let agreements = 0;
    for (let i = 0; i < recyclingFlags.length; i++) {
      if (recyclingFlags[i] === noveltyFlags[i]) agreements++;
    }
    recyclingAgreement = agreements / recyclingFlags.length;
  }

  // ── Parameter 11: Cluster quality — taxonomy mapping ratio ──
  // What fraction of AN nodes have taxonomy_refs (mapped to existing taxonomy nodes)?
  let taxonomyMappedRatio: number | null = null;
  if (an && an.nodes.length > 0) {
    const allRefIds = new Set<string>();
    for (const entry of session.transcript) {
      for (const ref of entry.taxonomy_refs ?? []) allRefIds.add(ref.node_id);
    }
    // Nodes whose speaker references match taxonomy = mapped
    const mapped = an.nodes.filter((n: ArgumentNetworkNode) => {
      const entryRefs = session.transcript
        .filter(e => e.id === n.source_entry_id)
        .flatMap(e => e.taxonomy_refs ?? []);
      return entryRefs.length > 0;
    }).length;
    taxonomyMappedRatio = mapped / an.nodes.length;
  }

  // ── Parameter 12: Near-miss duplicates ──
  // Count AN node pairs with high text similarity that weren't merged
  let nearMissDups: number | null = null;
  if (an && an.nodes.length >= 2 && an.nodes.length <= 100) {
    let count = 0;
    for (let i = 0; i < an.nodes.length; i++) {
      for (let j = i + 1; j < an.nodes.length; j++) {
        const a = an.nodes[i].text.toLowerCase().split(/\s+/);
        const b = an.nodes[j].text.toLowerCase().split(/\s+/);
        const shared = a.filter(w => b.includes(w)).length;
        const overlap = shared / Math.max(a.length, b.length);
        if (overlap >= 0.7 && overlap < 0.85) count++; // Near-miss range
      }
    }
    nearMissDups = count;
  }

  // ── Parameter 13: Borderline FIRE claim survival ──
  // Claims with base_strength near the acceptance threshold — did they survive debate?
  let borderlineSurvival: number | null = null;
  if (an && an.nodes.length > 0) {
    const borderline = an.nodes.filter((n: ArgumentNetworkNode) =>
      (n.base_strength ?? 0.5) >= 0.4 && (n.base_strength ?? 0.5) <= 0.55,
    );
    if (borderline.length >= 2) {
      const refuted = borderline.filter((n: ArgumentNetworkNode) =>
        (n.computed_strength ?? n.base_strength ?? 0.5) < 0.25,
      ).length;
      borderlineSurvival = 1 - refuted / borderline.length;
    }
  }

  // ── Parameter 14: Branch cohesion — avg base_strength of taxonomy-grounded nodes ──
  let avgBranchCohesion: number | null = null;
  if (an && an.nodes.length > 0) {
    const grounded = an.nodes.filter((n: ArgumentNetworkNode) => n.base_strength != null);
    if (grounded.length >= 3) {
      avgBranchCohesion = grounded.reduce((s, n) => s + (n.base_strength ?? 0.5), 0) / grounded.length;
    }
  }

  // ── Parameter 15: Extraction density — claims per source document length ──
  let claimsPer1k: number | null = null;
  const docAnalysis = (session as any).document_analysis as { word_count?: number } | undefined;
  if (docAnalysis?.word_count && an && an.nodes.length > 0) {
    claimsPer1k = (an.nodes.length / docAnalysis.word_count) * 1000;
  }

  return {
    schema_version: 1,
    debate_id: session.id,
    timestamp: now,
    origin,
    model: (session as any).config?.model ?? (session as any).model ?? 'unknown',
    rounds,

    saturation_at_transition: saturationAtTransition,
    exploration_exit_threshold: config.explorationExitThreshold ?? 0.65,
    engaging_real_disagreement: engaging,
    crux_addressed_ratio: cruxRatio,

    avg_utilization_rate: utilCount > 0 ? totalUtil / utilCount : null,
    avg_primary_utilization: utilCount > 0 ? totalPrimaryUtil / utilCount : null,
    relevance_threshold: config.relevanceThreshold ?? 0.45,

    qbaf_preference_concordance: concordance,
    attack_weights: config.attackWeights ?? [1.0, 1.1, 1.2],

    structural_error_rate: totalTurns > 0 ? structuralErrors / totalTurns : 0,
    repetition_rate: totalTurns > 0 ? repetitionWarnings / totalTurns : 0,
    draft_temperature: config.draftTemperature ?? 0.7,

    saturation_signals_at_transition: signalsAtTransition,
    saturation_weights: config.saturationWeights ?? {
      recycling_pressure: 0.30, crux_maturity: 0.25, concession_plateau: 0.15,
      engagement_fatigue: 0.15, pragmatic_convergence: 0.05, scheme_stagnation: 0.10,
    },

    claims_forgotten_rate: claimsForgottenRate,
    recent_window: config.recentWindow ?? 8,

    an_nodes_at_synthesis: anNodesAtSynthesis,
    gc_runs: gcRuns,
    gc_trigger: config.gcTrigger ?? 175,

    crux_resolution_divergence_rate: cruxDivergenceRate,
    polarity_resolved_threshold: config.polarityResolvedThreshold ?? 0.85,

    relevance_score_variance: relevanceVariance,
    max_nodes_cap: config.maxNodesCap ?? 50,

    recycling_novelty_agreement: recyclingAgreement,
    semantic_recycling_threshold: config.semanticRecyclingThreshold ?? 0.85,

    taxonomy_mapped_ratio: taxonomyMappedRatio,
    cluster_min_similarity: config.clusterMinSimilarity ?? 0.55,

    near_miss_duplicate_count: nearMissDups,
    duplicate_similarity_threshold: config.duplicateSimilarityThreshold ?? 0.85,

    borderline_claim_survival_rate: borderlineSurvival,
    fire_confidence_threshold: config.fireConfidenceThreshold ?? 0.7,

    avg_branch_cohesion: avgBranchCohesion,
    cohesion_clear_theme: config.cohesionClearTheme ?? 0.60,

    claims_per_1k_words: claimsPer1k,
    kp_divisor: config.kpDivisor ?? 500,
  };
}

// ── File I/O ────────────────────────────────────────────────

/**
 * Append a calibration data point to the log file.
 * Creates the calibration directory and file if they don't exist.
 */
export function appendCalibrationLog(
  dataPoint: CalibrationDataPoint,
  dataRoot: string,
): void {
  // Dynamic import to keep this module usable in browser contexts
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');

  const calibDir = path.join(dataRoot, 'calibration');
  if (!fs.existsSync(calibDir)) {
    fs.mkdirSync(calibDir, { recursive: true });
  }

  const logPath = path.join(calibDir, 'calibration-log.json');

  let log: CalibrationDataPoint[] = [];
  if (fs.existsSync(logPath)) {
    try {
      log = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    } catch {
      // Corrupt log — start fresh
      log = [];
    }
  }

  // Deduplicate by debate_id
  log = log.filter(p => p.debate_id !== dataPoint.debate_id);
  log.push(dataPoint);

  fs.writeFileSync(logPath, JSON.stringify(log, null, 2) + '\n', 'utf-8');
}

/**
 * Read all calibration data points from the log.
 */
export function readCalibrationLog(dataRoot: string): CalibrationDataPoint[] {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');

  const logPath = path.join(dataRoot, 'calibration', 'calibration-log.json');
  if (!fs.existsSync(logPath)) return [];

  try {
    return JSON.parse(fs.readFileSync(logPath, 'utf-8'));
  } catch {
    return [];
  }
}

// ── Parameter snapshots & history ────────────────────────────

/** A point-in-time snapshot of all 15 tracked parameter values. */
export interface ParameterSnapshot {
  // Debate parameters (1-10)
  exploration_exit: number;
  relevance_threshold: number;
  attack_weights: [number, number, number];
  draft_temperature: number;
  saturation_weights: Record<string, number>;
  recent_window: number;
  gc_trigger: number;
  polarity_resolved: number;
  max_nodes_cap: number;
  semantic_recycling_threshold: number;
  // Upstream pipeline parameters (11-15)
  cluster_min_similarity: number;
  duplicate_similarity_threshold: number;
  fire_confidence_threshold: number;
  cohesion_clear_theme: number;
  kp_divisor: number;
}

/** A history entry recording a parameter change event. */
export interface ParameterHistoryEntry {
  timestamp: string;
  source: 'initial' | 'optimizer' | 'manual';
  /** Number of calibration data points at time of change */
  data_points: number;
  before: ParameterSnapshot;
  after: ParameterSnapshot;
  /** Per-parameter change details (only parameters that actually changed) */
  changes: {
    parameter: string;
    from: number | number[] | Record<string, number>;
    to: number | number[] | Record<string, number>;
    confidence?: 'high' | 'medium' | 'low';
    rationale?: string;
  }[];
}

/** Build the current snapshot from provisional-weights.json + hardcoded defaults. */
export function captureSnapshot(weightsPath?: string): ParameterSnapshot {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');

  let weights: any = {};
  const wPath = weightsPath ?? path.resolve(__dirname, '..', '..', 'lib', 'debate', 'provisional-weights.json');
  try {
    weights = JSON.parse(fs.readFileSync(wPath, 'utf-8'));
  } catch { /* use defaults */ }

  return {
    exploration_exit: weights?.thresholds?.exploration_exit ?? 0.65,
    relevance_threshold: 0.45,
    attack_weights: [1.0, 1.1, 1.2],
    draft_temperature: 0.7,
    saturation_weights: weights?.saturation ?? {
      recycling_pressure: 0.30, crux_maturity: 0.25, concession_plateau: 0.15,
      engagement_fatigue: 0.15, pragmatic_convergence: 0.05, scheme_stagnation: 0.10,
    },
    recent_window: 8,
    gc_trigger: weights?.network?.gc_trigger ?? 175,
    polarity_resolved: 0.85,
    max_nodes_cap: 50,
    semantic_recycling_threshold: 0.85,
    cluster_min_similarity: 0.55,
    duplicate_similarity_threshold: 0.85,
    fire_confidence_threshold: 0.7,
    cohesion_clear_theme: 0.60,
    kp_divisor: 500,
  };
}

/** Compute the diff between two snapshots — returns only changed parameters. */
export function diffSnapshots(
  before: ParameterSnapshot,
  after: ParameterSnapshot,
): ParameterHistoryEntry['changes'] {
  const changes: ParameterHistoryEntry['changes'] = [];

  const simpleKeys: (keyof ParameterSnapshot)[] = [
    'exploration_exit', 'relevance_threshold', 'draft_temperature',
    'recent_window', 'gc_trigger', 'polarity_resolved', 'max_nodes_cap',
    'semantic_recycling_threshold', 'cluster_min_similarity',
    'duplicate_similarity_threshold', 'fire_confidence_threshold',
    'cohesion_clear_theme', 'kp_divisor',
  ];
  for (const key of simpleKeys) {
    if (before[key] !== after[key]) {
      changes.push({ parameter: key, from: before[key] as number, to: after[key] as number });
    }
  }

  // Attack weights
  const baw = before.attack_weights, aaw = after.attack_weights;
  if (baw[0] !== aaw[0] || baw[1] !== aaw[1] || baw[2] !== aaw[2]) {
    changes.push({ parameter: 'attack_weights', from: [...baw], to: [...aaw] });
  }

  // Saturation weights
  const bsw = before.saturation_weights, asw = after.saturation_weights;
  const swChanged = Object.keys({ ...bsw, ...asw }).some(k => (bsw[k] ?? 0) !== (asw[k] ?? 0));
  if (swChanged) {
    changes.push({ parameter: 'saturation_weights', from: { ...bsw }, to: { ...asw } });
  }

  return changes;
}

/** Read the parameter history log. */
export function readParameterHistory(dataRoot: string): ParameterHistoryEntry[] {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');

  const histPath = path.join(dataRoot, 'calibration', 'parameter-history.json');
  if (!fs.existsSync(histPath)) return [];

  try {
    return JSON.parse(fs.readFileSync(histPath, 'utf-8'));
  } catch {
    return [];
  }
}

/** Append a history entry to the parameter history log. */
export function appendParameterHistory(
  entry: ParameterHistoryEntry,
  dataRoot: string,
): void {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');

  const calibDir = path.join(dataRoot, 'calibration');
  if (!fs.existsSync(calibDir)) {
    fs.mkdirSync(calibDir, { recursive: true });
  }

  const histPath = path.join(calibDir, 'parameter-history.json');
  let history: ParameterHistoryEntry[] = [];
  if (fs.existsSync(histPath)) {
    try { history = JSON.parse(fs.readFileSync(histPath, 'utf-8')); } catch { /* fresh */ }
  }

  history.push(entry);
  fs.writeFileSync(histPath, JSON.stringify(history, null, 2) + '\n', 'utf-8');
}

/**
 * Seed initial snapshot if no history exists yet.
 * Call once during setup or on first debate.
 */
export function seedInitialSnapshot(dataRoot: string, weightsPath?: string): void {
  const history = readParameterHistory(dataRoot);
  if (history.length > 0) return; // Already seeded

  const snapshot = captureSnapshot(weightsPath);
  appendParameterHistory({
    timestamp: new Date().toISOString(),
    source: 'initial',
    data_points: 0,
    before: snapshot,
    after: snapshot,
    changes: [],
  }, dataRoot);
}
