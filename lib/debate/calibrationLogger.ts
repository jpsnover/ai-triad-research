// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Post-debate calibration data logger.
 *
 * After each debate, extracts calibration-relevant metrics from the session
 * and appends a data point to calibration-log.json. The optimizer reads
 * this log to auto-tune parameters in calibration-config.json.
 *
 * Works in both local (Electron) and Azure (server) environments — the log
 * lives in the data directory alongside debate sessions.
 */

import { getDebatePhase } from './types.js';
import type { DebateSession, ArgumentNetworkNode, ArgumentNetworkEdge, SpeakerId, TrackedCrux, EntryDiagnostics, EntailmentRepairEvent } from './types.js';
import type { NeutralEvaluation } from './neutralEvaluator.js';
import { classifyClaimOutcomes, summarizeOutcomes } from './claimOutcomes.js';
import { meanSentenceLength, lexicalDiversity, jargonDensity } from './clarityMetrics.js';
import { computeAffectIntensity, computeAffectProfile, computeAffectAppropriateness } from './affectSignals.js';
import { computeSourceAuthority } from './sourceAuthority.js';
import { computeCampInsularityRate } from './schemeStagnation.js';
import type { DocMetaMap } from './evidenceFromSummaries.js';
import { elementDecompositionPrompt, coverageCheckPrompt } from './prompts.js';
import { parseJsonRobust } from './helpers.js';
import { DEFAULT_TEMPERATURE } from '../ai-client/defaults.js';

// Re-export from browser-safe module for backward compatibility
export { computeAgentUtility, PERSONA_UTILITY_WEIGHTS } from './agentUtility.js';
export type { AgentUtility } from './agentUtility.js';
import { computeAgentUtility } from './agentUtility.js';
import type { AgentUtility } from './agentUtility.js';


import fs from 'node:fs';
import path from 'node:path';

// ── Calibration data point schema ──────────────────────────

export interface CalibrationDataPoint {
  /** Schema version for forward compat */
  schema_version: 1;
  /** Unique debate ID */
  debate_id: string;
  /** When the data point was recorded */
  timestamp: string;
  /** Where the debate ran — 'local' for Electron, userId or 'azure' for web */
  origin: string;
  /** Model used */
  model: string;
  /** Total rounds completed */
  rounds: number;

  // ── Parameter 1: Exploration exit threshold ──
  /** Saturation score at the moment of exploration→synthesis transition (null if no transition) */
  argumentative_saturation_at_transition: number | null;
  /** The argumentation_exit threshold that was active */
  argumentation_exit_threshold: number;
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
  argumentative_saturation_signals_at_transition: Record<string, number> | null;
  /** The signal weights that were active */
  argumentative_saturation_weights: Record<string, number>;

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
  /** Distribution of counterfactual types across tracked cruxes (RATIO 2024). */
  counterfactual_type_distribution: { interventional: number; backtracking: number; normative: number; none: number } | null;
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

  // ── Parameter 16: API budget hard multiplier ──
  /** Whether the debate was terminated by the API hard ceiling */
  hit_api_ceiling: boolean;
  /** Total API calls used */
  total_api_calls: number;
  /** Hard multiplier used (rounds × multiplier = ceiling) */
  budget_hard_multiplier: number;

  // ── Situation effectiveness ──
  /** Number of situation nodes injected into debater context */
  situation_nodes_injected: number;
  /** Number of situation nodes actually referenced in taxonomy_refs */
  situation_nodes_referenced: number;
  /** Fraction of neutral evaluator cruxes that align with injected situation nodes (by word overlap) */
  situation_crux_alignment: number | null;
  /** Max situation nodes cap used */
  situation_max_nodes: number;

  // ── Per-claim drift / sycophancy ──
  /** Whether the per-claim sycophancy guard fired during this debate */
  sycophancy_guard_fired: boolean;
  /** Highest per-claim sycophancy score across all speakers */
  max_sycophancy_score: number;
  /** Fraction of all opening claims that ended as 'abandoned' */
  claims_abandoned_rate: number;

  // ── QBAF oscillation ──
  /** Whether any QBAF run in this debate required progressive damping. */
  qbaf_oscillation_detected: boolean;
  /** QBAF iterations in the final computation */
  qbaf_iterations: number;
  /** Peak progressive damping level across all rounds (0 = none, 3 = max schedule) */
  qbaf_damping_level: number;
  /** Fraction of QBAF runs that triggered damping (oscillated_runs / total_runs). */
  qbaf_oscillation_rate: number;

  // ── Claim outcomes (t/278 Phase 1) ──
  /** Aggregate claim outcome stats: thrived/survived/died */
  claim_outcome_summary: { total: number; thrived: number; survived: number; died: number; thrived_rate: number; died_rate: number } | null;

  // ── Confidence escalation ──
  /** Total confidence deferrals during this debate */
  confidence_deferrals: number;
  /** Times the confidence floor was lowered (escalations) */
  confidence_escalations: number;
  /** Predominant bottleneck: extraction, stability, or none */
  confidence_bottleneck: 'extraction' | 'stability' | 'none';

  // ── Agent utility (game theory Layer 4) ──
  /** Per-agent utility scores computed from argument network state. */
  agent_utilities: Record<string, AgentUtility> | null;
  /** Number of claims rejected by the marginal value filter (anti-filibustering). */
  low_value_claims_rejected: number;
  /** Per-speaker mean embedding similarity to crux centroid (1.0 = perfectly on-topic). */
  topic_coherence_per_speaker: Record<string, number> | null;
  /** Per-agent concession asymmetry (attack target strength - conceded strength). */
  concession_asymmetry_per_speaker: Record<string, number> | null;
  /** Premature concession cascades: sequential concessions by different agents within 2 turns. */
  concession_cascades: number;

  // ── Topic wisdom evaluation ──
  /** Composite topic wisdom score (0-20). Null if evaluation was skipped. */
  topic_wisdom_total: number | null;
  /** Whether topic reframing was applied. */
  topic_reframed: boolean;
  /** Dimensions that scored 0 (weakest areas). */
  topic_weakest: string[];
  /** Dominant intellectual traditions from lineage distribution (top 3 at 15%+). Null if unavailable. */
  lineage_frame: { cluster_id: string; label: string; percentage: number }[] | null;
  /** Lineage boost effectiveness: how often boosted/promoted nodes are actually referenced. */
  lineage_effectiveness: {
    boosted_node_count: number;
    promoted_node_count: number;
    promoted_referenced_count: number;
    promoted_reference_rate: number;
    baseline_reference_rate: number;
  } | null;

  // ── Topic alignment (t/336, t/341) ──
  /** Whether TopicScope was extracted for this debate. */
  topic_scope_extracted: boolean;
  /** constraint_confidence from TopicScope. Null if scope not extracted. */
  topic_scope_confidence: 'explicit' | 'inferred' | null;
  /** Number of relevant_disciplines in the extracted scope. Null if no scope. */
  topic_scope_disciplines: number | null;
  /** Number of off_scope_topics identified. Null if no scope. */
  topic_scope_off_topics: number | null;
  /** Number of drift_signatures identified. Null if no scope. */
  topic_scope_drift_sigs: number | null;
  /** Fraction of turns where topic_aligned was true in draft quality gate. Null if no scope or no quality gate data. */
  topic_alignment_rate: number | null;
  /** Fraction of TopicScope fields that are non-empty/non-default. Null if scope not extracted. */
  scope_extraction_populated: number | null;
  /** Fraction of entries where topic alignment required repair retry. Null if no quality gate data. */
  draft_repair_rate: number | null;
  /** Fraction of injected taxonomy nodes demoted by scope filter. Null if no scope filter data. */
  taxonomy_demotion_rate: number | null;
  /** Fraction of demoted nodes that debaters referenced anyway. Null if no demoted nodes. */
  demoted_node_reference_rate: number | null;
  /** Fraction of moderator turns where a drift pattern was triggered. Null if no moderator data. */
  moderator_drift_intervention_rate: number | null;

  // ── Process reward (PRM-adjacent signal) ──
  /** Per-turn process reward scores for correlation with convergence signals */
  process_reward_series: { round: number; speaker: string; score: number; components: Record<string, number> }[] | null;
  /** Mean process reward across all turns */
  process_reward_mean: number | null;
  /** Standard deviation of process rewards */
  process_reward_stddev: number | null;
  /** Minimum process reward (identifies weakest turns) */
  process_reward_min: number | null;

  // ── Prompt size tracking (t/219) ──
  /** Maximum prompt chars across all pipeline stages in this debate */
  max_prompt_chars: number | null;
  /** Mean prompt chars across all pipeline stages in this debate */
  mean_prompt_chars: number | null;

  // ── Grounding confidence (t/281) ──
  /** Average grounding_confidence across all Cite stages in this debate. Null if no Cite data. */
  avg_grounding_confidence: number | null;
  /** Minimum grounding_confidence across all Cite stages in this debate. Null if no Cite data. */
  min_grounding_confidence: number | null;

  // ── Per-component prompt breakdown (t/221) ──
  /** Maximum per-component char counts across all stages (null if no data). */
  max_component_chars: {
    taxonomy_chars: number;
    transcript_chars: number;
    hints_chars: number;
    edge_chars: number;
    commitment_chars: number;
    an_summary_chars: number;
  } | null;

  // ── Extraction coverage (t/391) ──
  /** Mean coverage_rate across sampled turns (covered_verifiable / verifiable_elements). */
  extraction_coverage_rate: number | null;
  /** Number of turns sampled for extraction coverage measurement. */
  extraction_coverage_samples: number;

  // ── Extraction quality (t/379, t/380) ──
  /** Mean extraction_confidence across all AN nodes. */
  mean_extraction_confidence: number | null;
  /** Fraction of AN nodes with extraction_confidence < 0.6. */
  low_confidence_claims_rate: number | null;
  /** Fraction of entailment checks with verdict 'entailed'. */
  entailment_pass_rate: number | null;
  /** Fraction of entailment checks that resulted in text repair (partial or not_entailed with repaired_text). */
  entailment_repair_rate: number | null;
  /** Fraction of AN nodes that were sampled for entailment checking. */
  entailment_sampling_coverage: number | null;

  // ── Clarity metrics (Wachsmuth: Clarity, t/1120) ──
  /** Per-debate mean words-per-sentence across speaker turns. */
  clarity_mean_sentence_length: number | null;
  /** Per-debate mean type-token ratio across speaker turns. */
  clarity_lexical_diversity: number | null;
  /** Per-debate mean domain-jargon ratio across speaker turns. */
  clarity_jargon_density: number | null;

  // ── Affect signals (Wachsmuth: Emotional Appeal, t/1121) ──
  /** Mean affect intensity across speaker turns [0,1]. */
  affect_intensity_mean: number | null;
  /** Population variance of per-turn affect intensity. */
  affect_intensity_variance: number | null;
  /** Mean affect appropriateness score (deviation from phase baseline). */
  affect_appropriateness: number | null;

  // ── Source authority (Wachsmuth: Credibility, t/1122) ──
  /** Mean venue tier score of cited sources [0,1]. */
  source_authority_mean: number | null;
  /** Mean recency score of cited sources (exponential decay, half-life 5yr). Computed relative to the calendar year at scoring time; not stable across re-scoring runs in later years. */
  source_recency_mean: number | null;
  /** Mean distinct source documents per AN node. */
  evidence_breadth_per_claim: number | null;

  // ── Camp insularity (BEA: Reflective User Engagement, t/1117) ──
  /** Mean same-camp citation rate across speakers [0,1]. Higher = more insular. */
  camp_insularity_rate: number | null;
  /** Max same-camp citation rate across speakers — faithful trigger for per-speaker intervention. */
  camp_insularity_max: number | null;
  /** Cross-camp node injections triggered by camp insularity (BEA RUE, t/1130). */
  insularity_interventions: { speaker: string; round: number; injected_node_id: string; target_camp: string; engaged: boolean }[] | null;

  // ── Exploration seeding (t/990) ──
  /** Debate ID of the exploration run that seeded this debate. */
  exploration_source_id?: string;
  /** Model used for the exploration run. */
  exploration_source_model?: string;
  /** Number of cruxes seeded from exploration. */
  seeded_crux_count?: number;
  /** Number of effective situations identified in exploration. */
  seeded_effective_situation_count?: number;
  /** Number of ineffective situations identified in exploration. */
  seeded_ineffective_situation_count?: number;
  /** Number of AN nodes primed from exploration. */
  seeded_an_node_count?: number;
}

// ── Extraction logic ────────────────────────────────────────

/**
 * Extract calibration data from a completed debate session.
 * Pure function — no side effects, no file I/O.
 */
export function extractCalibrationData(
  session: DebateSession,
  origin: string,
  config: {
    argumentationExitThreshold?: number;
    relevanceThreshold?: number;
    draftTemperature?: number;
    attackWeights?: [number, number, number];
    argumentativeSaturationWeights?: Record<string, number>;
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
    budgetHardMultiplier?: number;
    situationMaxNodes?: number;
    explorationSummary?: import('./explorationSummary.js').ExplorationSummary;
    docMeta?: DocMetaMap;
    insularityInterventions?: { speaker: string; round: number; injected_node_id: string; target_camp: string }[];
  } = {},
): CalibrationDataPoint {
  const now = new Date().toISOString();

  // ── Neutral evaluator metrics ──
  const finalEval = (session.neutral_evaluations ?? [])
    .find((e: NeutralEvaluation) => e.checkpoint === 'final');
  const engaging = finalEval?.overall_assessment.debate_is_engaging_real_disagreement ?? null;
  const cruxRatio = finalEval
    ? finalEval.cruxes.length > 0
      ? finalEval.cruxes.filter((c: { status: string }) => c.status === 'addressed').length / finalEval.cruxes.length
      : null
    : null;

  // ── Utilization rates from context injection manifests ──
  // Manifest stores povNodeIds (injected) and povPrimaryIds (primary).
  // Cross-reference with entry's taxonomy_refs to compute what was actually referenced.
  let totalUtil = 0, totalPrimaryUtil = 0, utilCount = 0;
  for (const entry of session.transcript) {
    if (entry.type !== 'opening' && entry.type !== 'statement') continue;
    const manifest = (entry.metadata as Record<string, unknown>)?.injection_manifest as {
      // New format (actual session structure)
      povNodeIds?: string[];
      povPrimaryIds?: string[];
      // Legacy format (pre-existing code)
      injected_count?: number;
      referenced_count?: number;
      primary_injected?: number;
      primary_referenced?: number;
    } | undefined;
    if (!manifest) continue;

    const referencedIds = new Set((entry.taxonomy_refs ?? []).map((r: { node_id: string }) => r.node_id));

    if (manifest.povNodeIds && manifest.povNodeIds.length > 0) {
      // New format: count array intersection
      const injected = manifest.povNodeIds.length;
      const referenced = manifest.povNodeIds.filter((id: string) => referencedIds.has(id)).length;
      totalUtil += referenced / injected;

      if (manifest.povPrimaryIds && manifest.povPrimaryIds.length > 0) {
        const primaryInjected = manifest.povPrimaryIds.length;
        const primaryReferenced = manifest.povPrimaryIds.filter((id: string) => referencedIds.has(id)).length;
        totalPrimaryUtil += primaryReferenced / primaryInjected;
      }
      utilCount++;
    } else if (manifest.injected_count && manifest.injected_count > 0) {
      // Legacy format
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
  const totalTurns = session.transcript.filter((e: { type: string }) =>
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
  // Synthesis preferences use internal claim IDs (C1, C2...) not AN IDs (AN-1, AN-2...).
  // The argument_map maps C-IDs to claim text. We match claim text to AN nodes by word overlap.
  let concordance: number | null = null;
  const synthEntry = session.transcript.find((e: { type: string }) => e.type === 'concluding');
  const synthMeta = (synthEntry?.metadata as Record<string, unknown>)?.synthesis as {
    preferences?: { prevails?: string; claim_ids?: string[]; conflict?: string }[];
    argument_map?: { claim_id?: string; claim?: string; claimant?: string }[];
  } | undefined;
  const an = session.argument_network;
  if (synthMeta?.preferences && synthMeta.argument_map && an && an.nodes.length > 0) {
    // Build C-ID → claim text lookup from argument_map (which is an array)
    const argMapEntries = Array.isArray(synthMeta.argument_map) ? synthMeta.argument_map : [];
    const claimTextById = new Map<string, string>();
    for (const entry of argMapEntries) {
      if (entry.claim_id && entry.claim) claimTextById.set(entry.claim_id, entry.claim);
    }

    // For each preference with 2+ claim_ids, find the best AN node match for each claim
    let matches = 0, total = 0;
    for (const pref of synthMeta.preferences) {
      if (!pref.claim_ids || pref.claim_ids.length < 2 || pref.prevails === 'undecidable') continue;
      // Find AN nodes matching each claim by text word overlap
      const claimStrengths: number[] = [];
      for (const cid of pref.claim_ids) {
        const claimText = claimTextById.get(cid);
        if (!claimText) continue;
        const claimWords = new Set(claimText.toLowerCase().split(/\s+/).filter(w => w.length > 3));
        let bestScore = 0, bestStrength = 0.5;
        for (const node of an.nodes) {
          const nodeWords = node.text.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
          const overlap = nodeWords.filter((w: string) => claimWords.has(w)).length / Math.max(claimWords.size, 1);
          if (overlap > bestScore) {
            bestScore = overlap;
            bestStrength = node.computed_strength ?? node.base_strength ?? 0.5;
          }
        }
        if (bestScore > 0.2) claimStrengths.push(bestStrength); // Only count if reasonable text match
      }
      if (claimStrengths.length >= 2) {
        total++;
        // Does the QBAF strength ordering match the preference verdict?
        const maxStr = Math.max(...claimStrengths);
        const prevailsIdx = pref.prevails ? pref.claim_ids.indexOf(pref.prevails) : -1;
        if (prevailsIdx >= 0 && prevailsIdx < claimStrengths.length && claimStrengths[prevailsIdx] === maxStr) matches++;
      }
    }
    concordance = total > 0 ? matches / total : null;
  }

  // ── Saturation signals at transition ──
  // Read from adaptive_staging_diagnostics.signal_telemetry (the actual session structure)
  const asd = (session as any).adaptive_staging_diagnostics as {
    signal_telemetry?: {
      round: number;
      phase: string;
      composite?: { argumentative_saturation_score?: number; convergence_score?: number };
      signals?: Record<string, number>;
    }[];
  } | undefined;
  let argumentativeSaturationAtTransition: number | null = null;
  let signalsAtTransition: Record<string, number> | null = null;
  if (asd?.signal_telemetry && asd.signal_telemetry.length > 0) {
    const telemetry = asd.signal_telemetry;
    // Find the last entry before phase changed (closest to transition)
    const last = telemetry[telemetry.length - 1];
    argumentativeSaturationAtTransition = last.composite?.argumentative_saturation_score ?? null;
    signalsAtTransition = last.signals ?? null;
  }

  // ── Round count ──
  const rounds = session.transcript.filter((e: { type: string }) => e.type === 'statement').length;

  // ── Parameter 6: Compression window — claims forgotten rate ──
  const ledger = session.unanswered_claims_ledger ?? [];
  const totalClaims = an?.nodes.length ?? 0;
  const forgottenClaims = ledger.filter((c: { addressed_round?: number }) => !c.addressed_round).length;
  const claimsForgottenRate = totalClaims > 0 ? forgottenClaims / totalClaims : null;

  // ── Parameter 7: GC metrics ──
  const anNodesAtSynthesis = an?.nodes.length ?? 0;
  const gcEvents = (session as any).adaptive_staging_diagnostics?.gc_events;
  const gcRuns = typeof gcEvents === 'number' ? gcEvents : (Array.isArray(gcEvents) ? gcEvents.length : 0);

  // ── Parameter 8: Crux resolution divergence ──
  // crux_tracker on the session is an array of crux entries (not an object with .cruxes)
  let cruxDivergenceRate: number | null = null;
  const rawCruxTracker = (session as any).crux_tracker;
  const engineCruxes = Array.isArray(rawCruxTracker) ? rawCruxTracker as { id?: string; status?: string; description?: string }[] : [];
  if (finalEval && engineCruxes.length > 0 && finalEval.cruxes.length > 0) {
    // Compare: how often does engine crux status disagree with evaluator crux status?
    // Since cruxes aren't ID-matched across the two, compare by position (both ordered by importance)
    let divergences = 0;
    const minLen = Math.min(engineCruxes.length, finalEval.cruxes.length);
    for (let i = 0; i < minLen; i++) {
      const engineResolved = engineCruxes[i].status === 'resolved' || engineCruxes[i].status === 'addressed';
      const evalAddressed = finalEval.cruxes[i].status === 'addressed';
      if (engineResolved !== evalAddressed) divergences++;
    }
    cruxDivergenceRate = minLen > 0 ? divergences / minLen : null;
  }

  // ── Counterfactual type distribution (RATIO 2024, t/1115) ──
  const cfTypeDist: { interventional: number; backtracking: number; normative: number; none: number } | null =
    engineCruxes.length > 0
      ? engineCruxes.reduce(
          (acc, c) => {
            const ct = (c as Record<string, unknown>).counterfactual_type;
            if (ct === 'interventional') acc.interventional++;
            else if (ct === 'backtracking') acc.backtracking++;
            else if (ct === 'normative') acc.normative++;
            else if (ct === 'none') acc.none++;
            return acc;
          },
          { interventional: 0, backtracking: 0, normative: 0, none: 0 },
        )
      : null;

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
        .filter((e: { id: string }) => e.id === n.source_entry_id)
        .flatMap((e: { taxonomy_refs?: { node_id: string }[] }) => e.taxonomy_refs ?? []);
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
        const shared = a.filter((w: string) => b.includes(w)).length;
        const overlap = shared / Math.max(a.length, b.length);
        if (overlap >= 0.7 && overlap < 0.85) count++; // Near-miss range
      }
    }
    nearMissDups = count;
  }

  // ── Parameter 13: Borderline FIRE claim survival ──
  // Claims with extraction_confidence near the acceptance threshold — did they survive debate?
  let borderlineSurvival: number | null = null;
  if (an && an.nodes.length > 0) {
    const borderline = an.nodes.filter((n: ArgumentNetworkNode) =>
      n.extraction_confidence != null &&
      n.extraction_confidence >= 0.5 && n.extraction_confidence <= 0.7,
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
      avgBranchCohesion = grounded.reduce((s: number, n: ArgumentNetworkNode) => s + (n.base_strength ?? 0.5), 0) / grounded.length;
    }
  }

  // ── Parameter 15: Extraction density — claims per source document or transcript length ──
  let claimsPer1k: number | null = null;
  const docAnalysis = (session as any).document_analysis as { word_count?: number } | undefined;
  if (docAnalysis?.word_count && an && an.nodes.length > 0) {
    // Document-sourced: claims per 1k source words
    claimsPer1k = (an.nodes.length / docAnalysis.word_count) * 1000;
  } else if (an && an.nodes.length > 0) {
    // Topic-sourced: claims per 1k transcript words (measures extraction density from debate text)
    const transcriptWords = session.transcript
      .filter((e: { type: string }) => e.type === 'opening' || e.type === 'statement')
      .reduce((sum: number, e: { content: string }) => sum + (e.content?.split(/\s+/).length ?? 0), 0);
    if (transcriptWords > 0) {
      claimsPer1k = (an.nodes.length / transcriptWords) * 1000;
    }
  }

  // ── Situation effectiveness — crux alignment ──
  // How many injected situation nodes align with the debate's actual cruxes?
  let sitNodesInjected = 0;
  let sitNodesReferenced = 0;
  const injectedSitIds = new Set<string>();
  for (const entry of session.transcript) {
    const manifest = (entry.metadata as Record<string, unknown>)?.injection_manifest as {
      situationNodeIds?: string[];
    } | undefined;
    if (manifest?.situationNodeIds) {
      for (const id of manifest.situationNodeIds) injectedSitIds.add(id);
    }
    for (const ref of entry.taxonomy_refs ?? []) {
      if (typeof ref.node_id === 'string' && ref.node_id.startsWith('sit-')) {
        sitNodesReferenced++;
      }
    }
  }
  sitNodesInjected = injectedSitIds.size;

  // Situation-crux alignment: do the neutral evaluator's cruxes match injected situation nodes?
  // Uses word overlap between crux descriptions and situation node labels/descriptions.
  let sitCruxAlignment: number | null = null;
  if (finalEval && finalEval.cruxes.length > 0 && injectedSitIds.size > 0) {
    // We don't have situation node text here, but we can check if crux descriptions
    // mention situation-related terms by matching against taxonomy_refs that are sit- IDs.
    // Better approach: check if sit- refs appear in entries that address each crux's topic.
    // Simplest viable: for each crux, check if any sit- ID was referenced in the same
    // round(s) where that crux's speakers are active.
    const cruxSpeakers = finalEval.cruxes.map((c: { speakers_involved: string[] }) =>
      new Set(c.speakers_involved.map((s: string) => s.toLowerCase())),
    );

    // Map speaker labels (A/B/C) back to POV names via neutral_speaker_mapping
    const reverseMap = (session as any).neutral_speaker_mapping?.reverse as Record<string, string> | undefined;

    let alignedCruxes = 0;
    for (const crux of finalEval.cruxes) {
      // Get the POV names for speakers involved in this crux
      const cruxPovs = new Set<string>();
      for (const s of crux.speakers_involved) {
        const label = `Speaker ${s}`;
        const poverId = reverseMap?.[label];
        if (poverId) cruxPovs.add(poverId);
      }

      // Check if any entry by these speakers referenced a sit- node
      let hasSitRef = false;
      for (const entry of session.transcript) {
        if (entry.type !== 'statement' && entry.type !== 'opening') continue;
        if (!cruxPovs.has(entry.speaker)) continue;
        const sitRef = (entry.taxonomy_refs ?? []).some(
          (r: { node_id: string }) => r.node_id.startsWith('sit-') && injectedSitIds.has(r.node_id),
        );
        if (sitRef) { hasSitRef = true; break; }
      }
      if (hasSitRef) alignedCruxes++;
    }
    sitCruxAlignment = alignedCruxes / finalEval.cruxes.length;
  }

  // ── Anti-exploit metrics ──
  // Low-value claims rejected is tracked in argument_network diagnostics
  const lowValueRejected = ((session as any).argument_network_diagnostics?.rejectionReasons?.low_marginal_value as number) ?? 0;

  // Topic coherence per speaker: mean embedding similarity of each speaker's claims to crux centroid
  let topicCoherencePerSpeaker: Record<string, number> | null = null;
  if (an && an.nodes.length > 0) {
    const cruxes = (session as any).crux_tracker as TrackedCrux[] | undefined;
    if (cruxes && cruxes.length > 0) {
      const cruxEmbeddings = cruxes
        .map(c => an.nodes.find((n: ArgumentNetworkNode) => n.id === c.id)?.embedding)
        .filter((e): e is number[] => !!e);
      if (cruxEmbeddings.length > 0) {
        const dim = cruxEmbeddings[0].length;
        const centroid = new Array(dim).fill(0) as number[];
        for (const emb of cruxEmbeddings) {
          for (let i = 0; i < dim; i++) centroid[i] += emb[i];
        }
        for (let i = 0; i < dim; i++) centroid[i] /= cruxEmbeddings.length;

        topicCoherencePerSpeaker = {};
        const speakers = [...new Set(an.nodes.map((n: ArgumentNetworkNode) => n.speaker).filter(s => s !== 'system' && s !== 'document'))];
        for (const sp of speakers) {
          const spNodes = an.nodes.filter((n: ArgumentNetworkNode) => n.speaker === sp && n.embedding);
          if (spNodes.length === 0) continue;
          let simSum = 0;
          for (const n of spNodes) {
            let dot = 0, normA = 0, normB = 0;
            for (let i = 0; i < dim; i++) {
              dot += n.embedding![i] * centroid[i];
              normA += n.embedding![i] * n.embedding![i];
              normB += centroid[i] * centroid[i];
            }
            const denom = Math.sqrt(normA) * Math.sqrt(normB);
            simSum += denom > 0 ? dot / denom : 0;
          }
          topicCoherencePerSpeaker[sp] = simSum / spNodes.length;
        }
      }
    }
  }

  // ── Agent utilities ──
  let agentUtilities: Record<string, AgentUtility> | null = null;
  if (an && an.nodes.length > 0) {
    const speakers = [...new Set(an.nodes.map((n: ArgumentNetworkNode) => n.speaker).filter((s): s is SpeakerId => s !== 'system' && s !== 'document'))];
    const cruxes = (session as any).crux_tracker as TrackedCrux[] | undefined;
    if (speakers.length > 0) {
      agentUtilities = {};
      for (const sp of speakers) {
        agentUtilities[sp] = computeAgentUtility(sp, an.nodes, an.edges, cruxes ?? []);
      }
    }
  }

  // ── Premature concession cascading ──
  // Detect sequential concessions by different agents within a 2-turn window.
  const signals = session.convergence_signals ?? [];
  let concessionCascades = 0;
  if (signals.length > 0) {
    // Find turns where concession was used
    const concessionTurns: { speaker: string; index: number }[] = [];
    for (let i = 0; i < signals.length; i++) {
      if (signals[i].concession_opportunity?.concession_used) {
        concessionTurns.push({ speaker: signals[i].speaker, index: i });
      }
    }
    // Check for cascades: different speaker concedes within 2 entries of a prior concession
    for (let i = 1; i < concessionTurns.length; i++) {
      const prev = concessionTurns[i - 1];
      const curr = concessionTurns[i];
      if (curr.speaker !== prev.speaker && (curr.index - prev.index) <= 2) {
        concessionCascades++;
      }
    }
  }

  // ── Prompt size tracking (t/219) ──
  let maxPromptChars: number | null = null;
  let meanPromptChars: number | null = null;
  const promptCharSamples: number[] = [];
  const diagEntries = session.diagnostics?.entries ?? {};
  for (const entryDiag of Object.values(diagEntries)) {
    const stages = (entryDiag as { stage_diagnostics?: { prompt?: string }[] }).stage_diagnostics;
    if (stages) {
      for (const sd of stages) {
        if (sd.prompt) promptCharSamples.push(sd.prompt.length);
      }
    }
    const et = (entryDiag as { extraction_trace?: { prompt_chars?: number } }).extraction_trace;
    if (et?.prompt_chars) promptCharSamples.push(et.prompt_chars);
  }
  if (promptCharSamples.length > 0) {
    maxPromptChars = Math.max(...promptCharSamples);
    meanPromptChars = Math.round(promptCharSamples.reduce((a, b) => a + b, 0) / promptCharSamples.length);
  }

  // ── Grounding confidence (t/281) ──
  const groundingConfidences: number[] = [];
  for (const entryDiag3 of Object.values(diagEntries)) {
    const stages3 = (entryDiag3 as { stage_diagnostics?: { stage: string; work_product: Record<string, unknown> }[] }).stage_diagnostics;
    if (!stages3) continue;
    for (const sd of stages3) {
      if (sd.stage === 'cite' && typeof sd.work_product?.grounding_confidence === 'number') {
        groundingConfidences.push(sd.work_product.grounding_confidence);
      }
    }
  }

  // ── Per-component prompt breakdown (t/221) ──
  let maxComponentChars: CalibrationDataPoint['max_component_chars'] = null;
  for (const entryDiag2 of Object.values(diagEntries)) {
    const stages2 = (entryDiag2 as { stage_diagnostics?: { prompt_component_chars?: { taxonomy_chars: number; transcript_chars: number; hints_chars: number; edge_chars: number; commitment_chars: number; an_summary_chars: number } }[] }).stage_diagnostics;
    if (!stages2) continue;
    for (const sd of stages2) {
      const cc = sd.prompt_component_chars;
      if (!cc) continue;
      if (!maxComponentChars) {
        maxComponentChars = { ...cc };
      } else {
        maxComponentChars.taxonomy_chars = Math.max(maxComponentChars.taxonomy_chars, cc.taxonomy_chars);
        maxComponentChars.transcript_chars = Math.max(maxComponentChars.transcript_chars, cc.transcript_chars);
        maxComponentChars.hints_chars = Math.max(maxComponentChars.hints_chars, cc.hints_chars);
        maxComponentChars.edge_chars = Math.max(maxComponentChars.edge_chars, cc.edge_chars);
        maxComponentChars.commitment_chars = Math.max(maxComponentChars.commitment_chars, cc.commitment_chars);
        maxComponentChars.an_summary_chars = Math.max(maxComponentChars.an_summary_chars, cc.an_summary_chars);
      }
    }
  }

  // ── Clarity metrics (Wachsmuth: Clarity, t/1120) ──
  const speakerTexts = (session.transcript ?? [])
    .filter(e => (e.type === 'opening' || e.type === 'statement') && e.content)
    .map(e => e.content);
  const clarityMSL = speakerTexts.length > 0
    ? speakerTexts.reduce((sum, t) => sum + meanSentenceLength(t), 0) / speakerTexts.length
    : null;
  const clarityLD = speakerTexts.length > 0
    ? speakerTexts.reduce((sum, t) => sum + lexicalDiversity(t), 0) / speakerTexts.length
    : null;
  const domainTerms = new Set<string>();
  for (const entry of an?.nodes ?? []) {
    for (const w of entry.text.toLowerCase().match(/[a-z'-]+/g) ?? []) {
      if (w.length >= 6) domainTerms.add(w);
    }
  }
  const clarityJD = speakerTexts.length > 0 && domainTerms.size > 0
    ? speakerTexts.reduce((sum, t) => sum + jargonDensity(t, domainTerms), 0) / speakerTexts.length
    : null;

  // ── Affect signals (Wachsmuth: Emotional Appeal, t/1121) ──
  const affectIntensities: number[] = [];
  const affectAppropScores: number[] = [];
  for (const entry of session.transcript ?? []) {
    if (entry.type !== 'opening' && entry.type !== 'statement') continue;
    if (!entry.content) continue;
    const intensity = computeAffectIntensity(entry.content);
    if (intensity != null) affectIntensities.push(intensity);
    const profile = computeAffectProfile(entry.content);
    if (profile) {
      const entryRound = (entry.metadata as Record<string, unknown>)?.round as number ?? 1;
      const phase = getDebatePhase(entryRound, rounds);
      const approp = computeAffectAppropriateness(profile, phase);
      if (approp != null) affectAppropScores.push(approp);
      if (phase === 'concluding' && approp != null && approp < 0.40 && profile.outrage > 0.50) {
        console.warn(`[calibration] concluding-phase turn has low affect_appropriateness (${approp.toFixed(3)}) with high outrage (${profile.outrage.toFixed(3)}) — debate ${session.id}`);
      }
    }
  }
  const affectIntensityMean = affectIntensities.length > 0
    ? affectIntensities.reduce((a, b) => a + b, 0) / affectIntensities.length
    : null;
  const affectIntensityVariance = affectIntensities.length > 0
    ? affectIntensities.reduce((sum, v) => sum + (v - affectIntensityMean!) ** 2, 0) / affectIntensities.length
    : null;
  const affectAppropMean = affectAppropScores.length > 0
    ? affectAppropScores.reduce((a, b) => a + b, 0) / affectAppropScores.length
    : null;

  // ── Source authority (Wachsmuth: Credibility, t/1122) ──
  const srcAuth = computeSourceAuthority(session.argument_network?.nodes ?? [], config.docMeta);

  // ── Camp insularity (BEA: Reflective User Engagement, t/1117) ──
  const speakerInsularityRates: number[] = [];
  const speakers = new Set<string>();
  for (const entry of session.transcript ?? []) {
    if (entry.type !== 'opening' && entry.type !== 'statement') continue;
    speakers.add(entry.speaker);
  }
  for (const speaker of speakers) {
    if (speaker === 'system' || speaker === 'moderator' || speaker === 'user') continue;
    const nodeIds = (session.transcript ?? [])
      .filter((e: { type: string; speaker: string }) =>
        (e.type === 'opening' || e.type === 'statement') && e.speaker === speaker)
      .flatMap((e: { taxonomy_refs?: { node_id: string }[] }) =>
        (e.taxonomy_refs ?? []).map(r => r.node_id));
    if (nodeIds.length > 0) {
      const rate = computeCampInsularityRate(nodeIds, speaker);
      if (rate != null) speakerInsularityRates.push(rate);
    }
  }
  const campInsularityRate = speakerInsularityRates.length > 0
    ? speakerInsularityRates.reduce((a, b) => a + b, 0) / speakerInsularityRates.length
    : null;
  const campInsularityMax = speakerInsularityRates.length > 0
    ? Math.max(...speakerInsularityRates)
    : null;

  return {
    schema_version: 1,
    debate_id: session.id,
    timestamp: now,
    origin,
    model: (session as any).debate_model ?? (session as any).config?.model ?? (session as any).model ?? 'unknown',
    rounds,

    argumentative_saturation_at_transition: argumentativeSaturationAtTransition,
    argumentation_exit_threshold: config.argumentationExitThreshold ?? 0.65,
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

    argumentative_saturation_signals_at_transition: signalsAtTransition,
    argumentative_saturation_weights: config.argumentativeSaturationWeights ?? {
      recycling_pressure: 0.30, crux_maturity: 0.25, concession_plateau: 0.15,
      engagement_fatigue: 0.15, pragmatic_convergence: 0.05, scheme_stagnation: 0.10,
    },

    claims_forgotten_rate: claimsForgottenRate,
    recent_window: config.recentWindow ?? 8,

    an_nodes_at_synthesis: anNodesAtSynthesis,
    gc_runs: gcRuns,
    gc_trigger: config.gcTrigger ?? 175,

    crux_resolution_divergence_rate: cruxDivergenceRate,
    counterfactual_type_distribution: cfTypeDist,
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

    hit_api_ceiling: session.transcript.some((e: { content: string }) =>
      typeof e.content === 'string' && e.content.includes('API hard ceiling hit'),
    ),
    total_api_calls: session.diagnostics?.overview?.total_ai_calls ?? 0,
    budget_hard_multiplier: config.budgetHardMultiplier ?? 15,

    situation_nodes_injected: sitNodesInjected,
    situation_nodes_referenced: sitNodesReferenced,
    situation_crux_alignment: sitCruxAlignment,
    situation_max_nodes: config.situationMaxNodes ?? 8,

    agent_utilities: agentUtilities,
    low_value_claims_rejected: lowValueRejected,
    topic_coherence_per_speaker: topicCoherencePerSpeaker,
    concession_asymmetry_per_speaker: agentUtilities
      ? Object.fromEntries(Object.entries(agentUtilities).map(([k, v]) => [k, v.concession_asymmetry]))
      : null,
    concession_cascades: concessionCascades,

    topic_wisdom_total: session.topic.critique?.composite_score ?? null,
    topic_reframed: session.topic.critique?.reframe_applied ?? false,
    topic_weakest: (() => {
      const critique = session.topic.critique;
      if (!critique) return [];
      const weak: string[] = [];
      const ss = critique.structural_score;
      if (ss.crux_density === 0) weak.push('crux_density');
      if (ss.evidence_coverage === 0) weak.push('evidence_coverage');
      if (ss.bdi_heterogeneity === 0) weak.push('bdi_heterogeneity');
      if (ss.abstraction_level === 0) weak.push('abstraction_level');
      if (ss.situation_activation === 0) weak.push('situation_activation');
      if (critique.frame_score) {
        if (critique.frame_score.conditionality === 0) weak.push('conditionality');
        if (critique.frame_score.mechanism === 0) weak.push('mechanism');
        if (critique.frame_score.stakeholder === 0) weak.push('stakeholder');
        if (critique.frame_score.tension === 0) weak.push('tension');
        if (critique.frame_score.scope === 0) weak.push('scope');
      }
      return weak;
    })(),
    lineage_frame: session.topic.critique?.lineage_frame ?? null,
    lineage_effectiveness: (() => {
      const allBoosted = new Set<string>();
      const allPromoted = new Set<string>();
      const allInjected = new Set<string>();
      const allReferenced = new Set<string>();

      for (const entry of session.transcript) {
        if (entry.type !== 'opening' && entry.type !== 'statement') continue;
        const manifest = (entry.metadata as Record<string, unknown>)?.injection_manifest as {
          lineage_boost?: { boostedNodeIds?: string[]; promotedNodeIds?: string[] };
          povNodeIds?: string[];
        } | undefined;
        if (!manifest) continue;

        const refs = new Set((entry.taxonomy_refs ?? []).map((r: { node_id: string }) => r.node_id));
        for (const id of refs) allReferenced.add(id);
        for (const id of manifest.povNodeIds ?? []) allInjected.add(id);

        const lb = manifest.lineage_boost;
        if (lb) {
          for (const id of lb.boostedNodeIds ?? []) allBoosted.add(id);
          for (const id of lb.promotedNodeIds ?? []) allPromoted.add(id);
        }
      }

      if (allBoosted.size === 0) return null;

      const promotedReferenced = [...allPromoted].filter(id => allReferenced.has(id)).length;
      const promotedRefRate = allPromoted.size > 0 ? promotedReferenced / allPromoted.size : 0;
      const baselineRefRate = allInjected.size > 0 ? allReferenced.size / allInjected.size : 0;

      return {
        boosted_node_count: allBoosted.size,
        promoted_node_count: allPromoted.size,
        promoted_referenced_count: promotedReferenced,
        promoted_reference_rate: Math.round(promotedRefRate * 1000) / 1000,
        baseline_reference_rate: Math.round(baselineRefRate * 1000) / 1000,
      };
    })(),

    sycophancy_guard_fired: (session.transcript ?? []).some(e => e.type === 'system' && e.content.includes('[Sycophancy guard]')),
    max_sycophancy_score: (session.per_claim_drift ?? []).reduce((max, s) => Math.max(max, s.sycophancy_score), 0),
    claims_abandoned_rate: (() => {
      const snapshots = session.per_claim_drift ?? [];
      if (snapshots.length === 0) return 0;
      // Use latest snapshot per speaker
      const bySpeaker = new Map<string, typeof snapshots[0]>();
      for (const s of snapshots) bySpeaker.set(s.speaker, s);
      let total = 0, abandoned = 0;
      for (const s of bySpeaker.values()) {
        total += s.claims.length;
        abandoned += s.claims.filter(c => c.status === 'abandoned').length;
      }
      return total > 0 ? abandoned / total : 0;
    })(),

    qbaf_oscillation_detected: (session.qbaf_runs_oscillated ?? 0) > 0,
    qbaf_iterations: session.last_qbaf_result?.iterations ?? 0,
    qbaf_damping_level: session.max_qbaf_damping_level ?? 0,
    qbaf_oscillation_rate: (session.qbaf_runs_total ?? 0) > 0
      ? (session.qbaf_runs_oscillated ?? 0) / session.qbaf_runs_total!
      : 0,

    claim_outcome_summary: (() => {
      const an = session.argument_network;
      if (!an || an.nodes.length === 0) return null;
      const outcomes = classifyClaimOutcomes(an.nodes, an.edges);
      return summarizeOutcomes(outcomes);
    })(),

    confidence_deferrals: session.adaptive_staging_diagnostics?.confidence_deferrals ?? 0,
    confidence_escalations: (() => {
      const telemetry = session.adaptive_staging_diagnostics?.signal_telemetry ?? [];
      return telemetry.filter((t: { confidence?: { global?: number } }) =>
        t.confidence?.global !== undefined
      ).reduce((count: number, t: { predicate_result?: { components?: Record<string, number> } }) => {
        const ef = t.predicate_result?.components?.effective_floor;
        return ef !== undefined && ef < 0.40 ? count + 1 : count;
      }, 0);
    })(),
    confidence_bottleneck: (() => {
      const telemetry = session.adaptive_staging_diagnostics?.signal_telemetry ?? [];
      let extLow = 0, stabLow = 0;
      for (const t of telemetry) {
        const conf = (t as { confidence?: { extraction?: number; stability?: number } }).confidence;
        if (conf) {
          if ((conf.extraction ?? 1) < (conf.stability ?? 1)) extLow++;
          else if ((conf.stability ?? 1) < (conf.extraction ?? 1)) stabLow++;
        }
      }
      if (extLow === 0 && stabLow === 0) return 'none' as const;
      return extLow >= stabLow ? 'extraction' as const : 'stability' as const;
    })(),

    // Process reward series + summary stats
    process_reward_series: (() => {
      const prs = session.process_rewards;
      if (!prs || prs.length === 0) return null;
      return prs.map(pr => ({
        round: pr.round,
        speaker: pr.speaker,
        score: pr.score,
        components: pr.components,
      }));
    })(),
    process_reward_mean: (() => {
      const prs = session.process_rewards;
      if (!prs || prs.length === 0) return null;
      return prs.reduce((s, pr) => s + pr.score, 0) / prs.length;
    })(),
    process_reward_stddev: (() => {
      const prs = session.process_rewards;
      if (!prs || prs.length === 0) return null;
      const mean = prs.reduce((s, pr) => s + pr.score, 0) / prs.length;
      const variance = prs.reduce((s, pr) => s + (pr.score - mean) ** 2, 0) / prs.length;
      return Math.sqrt(variance);
    })(),
    process_reward_min: (() => {
      const prs = session.process_rewards;
      if (!prs || prs.length === 0) return null;
      return Math.min(...prs.map(pr => pr.score));
    })(),

    topic_scope_extracted: !!session.topic.scope,
    topic_scope_confidence: session.topic.scope?.constraint_confidence ?? null,
    topic_scope_disciplines: session.topic.scope?.relevant_disciplines.length ?? null,
    topic_scope_off_topics: session.topic.scope?.off_scope_topics.length ?? null,
    topic_scope_drift_sigs: session.topic.scope?.drift_signatures.length ?? null,
    topic_alignment_rate: (() => {
      const diagEntries = session.diagnostics?.entries ?? {};
      const entries = session.transcript?.filter(e => diagEntries[e.id]?.topic_alignment) ?? [];
      if (entries.length === 0) return null;
      const aligned = entries.filter(e => diagEntries[e.id]!.topic_alignment!.topic_aligned).length;
      return Math.round((aligned / entries.length) * 1000) / 1000;
    })(),
    scope_extraction_populated: (() => {
      const s = session.topic?.scope;
      if (!s) return null;
      const fields = [
        s.core_proposition,
        s.relevant_disciplines?.length,
        s.key_tensions?.length,
        s.off_scope_topics?.length,
        s.drift_signatures?.length,
        s.example_ceiling,
      ];
      return Math.round((fields.filter(v => v != null && v !== '' && v !== 0).length / fields.length) * 1000) / 1000;
    })(),
    // Fraction of turns that triggered a regen (repaired=true). Higher means more drafts needed repair — does NOT penalize successful repairs vs never-needed ones for TopicHealthScore purposes.
    draft_repair_rate: (() => {
      const diagEntries = session.diagnostics?.entries ?? {};
      const entries = session.transcript?.filter(e => diagEntries[e.id]?.topic_alignment) ?? [];
      if (entries.length === 0) return null;
      const repaired = entries.filter(e => diagEntries[e.id]!.topic_alignment!.repaired).length;
      return Math.round((repaired / entries.length) * 1000) / 1000;
    })(),
    taxonomy_demotion_rate: (() => {
      const diagEntries = session.diagnostics?.entries ?? {};
      let totalInjected = 0;
      let totalDemoted = 0;
      for (const e of session.transcript ?? []) {
        const sft = (diagEntries[e.id]?.stage_diagnostics ?? [])
          .find((sd: { stage: string }) => sd.stage === 'brief')
          ?.work_product as Record<string, unknown> | undefined;
        const manifest = (e.metadata as Record<string, unknown>)?.injection_manifest as Record<string, unknown> | undefined;
        const filterTrace = manifest?.scope_filter_trace as { demoted?: unknown[] } | undefined;
        const povNodes = manifest?.povNodeIds as string[] | undefined;
        if (povNodes?.length) totalInjected += povNodes.length;
        if (filterTrace?.demoted?.length) totalDemoted += filterTrace.demoted.length;
      }
      return totalInjected > 0 ? Math.round((totalDemoted / totalInjected) * 1000) / 1000 : null;
    })(),
    demoted_node_reference_rate: (() => {
      const diagEntries = session.diagnostics?.entries ?? {};
      const allDemoted = new Set<string>();
      const referencedDemoted = new Set<string>();
      for (const e of session.transcript ?? []) {
        const manifest = (e.metadata as Record<string, unknown>)?.injection_manifest as Record<string, unknown> | undefined;
        const filterTrace = manifest?.scope_filter_trace as { demoted?: { nodeId: string }[] } | undefined;
        if (filterTrace?.demoted) {
          for (const d of filterTrace.demoted) allDemoted.add(d.nodeId);
          const refs = new Set((e.taxonomy_refs ?? []).map((r: { node_id: string }) => r.node_id));
          for (const d of filterTrace.demoted) {
            if (refs.has(d.nodeId)) referencedDemoted.add(d.nodeId);
          }
        }
      }
      return allDemoted.size > 0 ? Math.round((referencedDemoted.size / allDemoted.size) * 1000) / 1000 : null;
    })(),
    moderator_drift_intervention_rate: (() => {
      const modEntries = (session.transcript ?? []).filter(e =>
        (e.metadata as Record<string, unknown>)?.moderator_trace != null);
      if (modEntries.length === 0) return null;
      let driftCount = 0;
      for (const me of modEntries) {
        const trace = (me.metadata as Record<string, unknown>).moderator_trace as Record<string, unknown>;
        if (trace.drift_detected) driftCount++;
      }
      return Math.round((driftCount / modEntries.length) * 1000) / 1000;
    })(),

    max_prompt_chars: maxPromptChars,
    mean_prompt_chars: meanPromptChars,

    avg_grounding_confidence: groundingConfidences.length > 0
      ? groundingConfidences.reduce((a, b) => a + b, 0) / groundingConfidences.length
      : null,
    min_grounding_confidence: groundingConfidences.length > 0
      ? Math.min(...groundingConfidences)
      : null,

    max_component_chars: maxComponentChars,

    // ── Extraction coverage (t/391) ──
    ...(() => {
      const coverageSamples: number[] = [];
      let sampleCount = 0;
      for (const entryDiag of Object.values(diagEntries)) {
        const ec = (entryDiag as EntryDiagnostics).extraction_coverage;
        if (ec) {
          coverageSamples.push(ec.coverage_rate);
          sampleCount++;
        }
      }
      return {
        extraction_coverage_rate: coverageSamples.length > 0
          ? Math.round((coverageSamples.reduce((a, b) => a + b, 0) / coverageSamples.length) * 1000) / 1000
          : null,
        extraction_coverage_samples: sampleCount,
      };
    })(),

    // ── Extraction quality (t/379, t/380) ──
    ...(() => {
      const confidences = (an?.nodes ?? [])
        .map((n: ArgumentNetworkNode) => n.extraction_confidence)
        .filter((c): c is number => c != null);
      const meanConf = confidences.length > 0
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : null;
      const lowConfRate = confidences.length > 0
        ? confidences.filter(c => c < 0.6).length / confidences.length
        : null;

      const allRepairs: EntailmentRepairEvent[] = [];
      let totalAnNodes = an?.nodes.length ?? 0;
      for (const entryDiag of Object.values(diagEntries)) {
        const repairs = (entryDiag as EntryDiagnostics).entailment_repairs;
        if (repairs) allRepairs.push(...repairs);
      }
      const entailPassRate = allRepairs.length > 0
        ? allRepairs.filter(r => r.verdict === 'entailed').length / allRepairs.length
        : null;
      const entailRepairRate = allRepairs.length > 0
        ? allRepairs.filter(r => r.repaired_text != null).length / allRepairs.length
        : null;
      const entailSamplingCoverage = totalAnNodes > 0
        ? Math.round((allRepairs.length / totalAnNodes) * 1000) / 1000
        : null;

      return {
        mean_extraction_confidence: meanConf != null ? Math.round(meanConf * 1000) / 1000 : null,
        low_confidence_claims_rate: lowConfRate != null ? Math.round(lowConfRate * 1000) / 1000 : null,
        entailment_pass_rate: entailPassRate != null ? Math.round(entailPassRate * 1000) / 1000 : null,
        entailment_repair_rate: entailRepairRate != null ? Math.round(entailRepairRate * 1000) / 1000 : null,
        entailment_sampling_coverage: entailSamplingCoverage,
      };
    })(),

    // ── Clarity metrics (Wachsmuth: Clarity, t/1120) ──
    clarity_mean_sentence_length: clarityMSL != null ? Math.round(clarityMSL * 100) / 100 : null,
    clarity_lexical_diversity: clarityLD != null ? Math.round(clarityLD * 1000) / 1000 : null,
    clarity_jargon_density: clarityJD != null ? Math.round(clarityJD * 1000) / 1000 : null,

    // ── Affect signals (Wachsmuth: Emotional Appeal, t/1121) ──
    affect_intensity_mean: affectIntensityMean != null ? Math.round(affectIntensityMean * 1000) / 1000 : null,
    affect_intensity_variance: affectIntensityVariance != null ? Math.round(affectIntensityVariance * 1000) / 1000 : null,
    affect_appropriateness: affectAppropMean != null ? Math.round(affectAppropMean * 1000) / 1000 : null,

    // ── Source authority (Wachsmuth: Credibility, t/1122) ──
    source_authority_mean: srcAuth.source_authority_mean != null ? Math.round(srcAuth.source_authority_mean * 1000) / 1000 : null,
    source_recency_mean: srcAuth.source_recency_mean != null ? Math.round(srcAuth.source_recency_mean * 1000) / 1000 : null,
    evidence_breadth_per_claim: srcAuth.evidence_breadth_per_claim != null ? Math.round(srcAuth.evidence_breadth_per_claim * 100) / 100 : null,

    // ── Camp insularity (BEA: Reflective User Engagement, t/1117) ──
    camp_insularity_rate: campInsularityRate != null ? Math.round(campInsularityRate * 1000) / 1000 : null,
    camp_insularity_max: campInsularityMax != null ? Math.round(campInsularityMax * 1000) / 1000 : null,
    insularity_interventions: config.insularityInterventions?.length
      ? config.insularityInterventions.map(iv => {
          const engaged = session.transcript.some(e =>
            e.speaker === iv.speaker
            && e.type !== 'opening'
            && ((e.metadata as Record<string, unknown>)?.round as number ?? 0) > iv.round
            && (e.taxonomy_refs ?? []).some(r => r.node_id === iv.injected_node_id),
          );
          return { ...iv, engaged };
        })
      : null,

    // ── Exploration seeding ──
    ...(config.explorationSummary ? {
      exploration_source_id: config.explorationSummary.source_debate_id,
      exploration_source_model: config.explorationSummary.source_model,
      seeded_crux_count: config.explorationSummary.cruxes.length,
      seeded_effective_situation_count: config.explorationSummary.effective_situations.length,
      seeded_ineffective_situation_count: config.explorationSummary.ineffective_situations.length,
      seeded_an_node_count: config.explorationSummary.argument_sketch.nodes.length,
    } : {}),
  };
}

// ── File I/O ────────────────────────────────────────────────

/**
 * Append a calibration data point to both the per-user and core JSONL logs.
 * Per-user: calibration/users/{origin}/calibration-log.jsonl
 * Core:     calibration/core/calibration-log.jsonl
 * The core log is the source of truth for the optimizer and regression analysis.
 * Creates directories on first write. Uses JSONL (one JSON object per line)
 * for append-only writes without full-file rewrite.
 */
export function appendCalibrationLog(
  dataPoint: CalibrationDataPoint,
  dataRoot: string,
): void {
  const line = JSON.stringify(dataPoint) + '\n';

  const userDir = path.join(dataRoot, 'calibration', 'users', dataPoint.origin || 'local');
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  fs.appendFileSync(path.join(userDir, 'calibration-log.jsonl'), line, 'utf-8');

  const coreDir = path.join(dataRoot, 'calibration', 'core');
  if (!fs.existsSync(coreDir)) {
    fs.mkdirSync(coreDir, { recursive: true });
  }
  fs.appendFileSync(path.join(coreDir, 'calibration-log.jsonl'), line, 'utf-8');
}

/**
 * Read all calibration data points from the core JSONL log.
 * Reads from calibration/core/calibration-log.jsonl (one JSON object per line).
 */
export function readCalibrationLog(dataRoot: string): CalibrationDataPoint[] {
  const logPath = path.join(dataRoot, 'calibration', 'core', 'calibration-log.jsonl');
  if (!fs.existsSync(logPath)) return [];

  try {
    return fs.readFileSync(logPath, 'utf-8')
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

// ── Extraction coverage (t/391) ────────────────────────────

export type GenerateFn = (prompt: string) => Promise<string>;

const COVERAGE_SAMPLING_RATE = 0.20;

interface InformationElement {
  text: string;
  element_type: 'verifiable' | 'normative';
}

interface CoverageResult {
  coverage: { element_index: number; covered: boolean; covering_claim_index: number | null }[];
}

export async function computeExtractionCoverage(
  session: DebateSession,
  generateFn: GenerateFn,
  rng: () => number = Math.random,
): Promise<void> {
  const diagEntries = session.diagnostics?.entries;
  if (!diagEntries) return;

  const an = session.argument_network;
  if (!an || an.nodes.length === 0) return;

  const statementEntries = session.transcript.filter(
    e => e.type === 'statement' || e.type === 'opening',
  );
  if (statementEntries.length === 0) return;

  const sampled = statementEntries.filter(() => rng() < COVERAGE_SAMPLING_RATE);
  if (sampled.length === 0) return;

  for (const entry of sampled) {
    const entryDiag = diagEntries[entry.id];
    if (!entryDiag || entryDiag.extraction_coverage) continue;

    const myClaims = an.nodes
      .filter(n => n.source_entry_id === entry.id)
      .map(n => n.text);

    if (myClaims.length === 0) continue;

    try {
      const decompRaw = await generateFn(elementDecompositionPrompt(entry.content));
      const decompResult = parseJsonRobust(decompRaw) as { elements?: InformationElement[] };
      const elements = decompResult.elements ?? [];
      if (elements.length === 0) continue;

      const coverRaw = await generateFn(coverageCheckPrompt(elements, myClaims));
      const coverResult = parseJsonRobust(coverRaw) as CoverageResult;
      const coverageItems = coverResult.coverage ?? [];

      const verifiable = elements.filter(e => e.element_type === 'verifiable');
      const normative = elements.filter(e => e.element_type === 'normative');

      const coveredVerifiable = verifiable.filter((_, i) => {
        const globalIdx = elements.indexOf(verifiable[i]);
        return coverageItems.some(c => c.element_index === globalIdx + 1 && c.covered);
      }).length;

      const coveredNormative = normative.filter((_, i) => {
        const globalIdx = elements.indexOf(normative[i]);
        return coverageItems.some(c => c.element_index === globalIdx + 1 && c.covered);
      }).length;

      const coverageRate = verifiable.length > 0
        ? coveredVerifiable / verifiable.length
        : 1.0;

      const uncoveredElements = elements
        .filter((e, i) => !coverageItems.some(c => c.element_index === i + 1 && c.covered))
        .map(e => ({ text: e.text, element_type: e.element_type as 'verifiable' | 'normative' }));

      entryDiag.extraction_coverage = {
        total_elements: elements.length,
        verifiable_elements: verifiable.length,
        normative_elements: normative.length,
        covered_verifiable: coveredVerifiable,
        covered_normative: coveredNormative,
        coverage_rate: Math.round(coverageRate * 1000) / 1000,
        uncovered_elements: uncoveredElements.length > 0 ? uncoveredElements : undefined,
      };
    } catch {
      // Coverage computation failure is non-blocking
    }
  }
}

// ── Parameter snapshots & history ────────────────────────────

/** A point-in-time snapshot of all 15 tracked parameter values. */
export interface ParameterSnapshot {
  // Debate parameters (1-10)
  argumentation_exit: number;
  relevance_threshold: number;
  attack_weights: [number, number, number];
  draft_temperature: number;
  argumentative_saturation_weights: Record<string, number>;
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
  budget_hard_multiplier: number;
  situation_max_nodes: number;
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

/** Build the current snapshot from calibration-config.json + hardcoded defaults. */
export function captureSnapshot(weightsPath?: string): ParameterSnapshot {



  let weights: any = {};
  // Resolve relative to this file — use import.meta.url for ESM compatibility
  const thisDir = path.dirname(new URL(import.meta.url).pathname);
  const wPath = weightsPath ?? path.resolve(thisDir, 'calibration-config.json');
  try {
    weights = JSON.parse(fs.readFileSync(wPath, 'utf-8'));
  } catch { /* use defaults */ }

  return {
    argumentation_exit: weights?.thresholds?.argumentation_exit ?? 0.65,
    relevance_threshold: 0.45,
    attack_weights: [1.0, 1.1, 1.2],
    draft_temperature: DEFAULT_TEMPERATURE,
    argumentative_saturation_weights: weights?.argumentative_saturation ?? {
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
    budget_hard_multiplier: weights?.budget?.hard_multiplier ?? 15,
    situation_max_nodes: 8,
  };
}

/** Compute the diff between two snapshots — returns only changed parameters. */
export function diffSnapshots(
  before: ParameterSnapshot,
  after: ParameterSnapshot,
): ParameterHistoryEntry['changes'] {
  const changes: ParameterHistoryEntry['changes'] = [];

  const simpleKeys: (keyof ParameterSnapshot)[] = [
    'argumentation_exit', 'relevance_threshold', 'draft_temperature',
    'recent_window', 'gc_trigger', 'polarity_resolved', 'max_nodes_cap',
    'semantic_recycling_threshold', 'cluster_min_similarity',
    'duplicate_similarity_threshold', 'fire_confidence_threshold',
    'cohesion_clear_theme', 'kp_divisor', 'budget_hard_multiplier', 'situation_max_nodes',
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
  const bsw = before.argumentative_saturation_weights, asw = after.argumentative_saturation_weights;
  const swChanged = Object.keys({ ...bsw, ...asw }).some(k => (bsw[k] ?? 0) !== (asw[k] ?? 0));
  if (swChanged) {
    changes.push({ parameter: 'argumentative_saturation_weights', from: { ...bsw }, to: { ...asw } });
  }

  return changes;
}

/** Read the parameter history log. */
export function readParameterHistory(dataRoot: string): ParameterHistoryEntry[] {



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
