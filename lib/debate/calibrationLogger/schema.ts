// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Calibration data point schema (ADR-007 file-size split, t/1686).
 *
 * The `CalibrationDataPoint` interface — the shape of one row appended to
 * calibration-log.jsonl — plus the browser-safe `AgentUtility` type re-export
 * for backward compatibility. Consumed by every calibrationLogger sub-module.
 */

import type { AgentUtility } from '../agentUtility.js';
export type { AgentUtility } from '../agentUtility.js';

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
  /**
   * Synthetic-run marker (t/1770). `true` for fixture/smoke/batch runs produced by
   * the test harness (Invoke-DebateBatch, Test-AnonymousDebateFlow,
   * Invoke-TaxEditorSmokeTest, Test-PersonaEndpoints — wired in t/1812). Synthetic
   * entries are ROUTED to calibration/fixtures/ and never reach calibration/core/
   * (the optimizer + t/1668 replication-gate source of truth), so the production log
   * stays clean by *construction* — no consumer needs a `!synthetic` filter.
   *
   * Populated either explicitly on the data point OR from the
   * AI_TRIAD_SYNTHETIC_CALIBRATION env var read at the write funnel (appendCalibrationLog).
   * Additive/back-compat: absent on real debates and on all pre-t/1770 entries (those
   * ~14k fixtures are quarantined by CL's rounds-based backfill, not by this field).
   */
  synthetic?: boolean;

  // ── Preregistration-by-artifact provenance (t/1672) ──
  // Binds the instrument revision that produced this entry so a metric shift can
  // be attributed to prompt-vs-parameter-vs-model drift rather than left ambiguous.
  // Schema-only addition — no metric VALUES change (arXiv:2607.14399 §5 R-5).
  /** Prompt-builder revision active when this entry was produced (prompts.ts PROMPT_VERSION) */
  prompt_version: string;
  /** Config revision — content hash of calibration-config.json; '' if unreadable */
  config_revision: string;
  /** Git working-tree state when the run executed; 'unknown' when git is unavailable (e.g. server/Azure) */
  working_tree_state: 'clean' | 'dirty' | 'unknown';

  // ── Parameter 1: Exploration exit threshold ──
  /** Saturation score at the moment of exploration→synthesis transition (null if no transition) */
  argumentative_saturation_at_transition: number | null;
  /** The argumentation_exit threshold that was active */
  argumentation_exit_threshold: number;
  /** Neutral evaluator: debate engaging real disagreement? */
  engaging_real_disagreement: boolean | null;
  /** Neutral evaluator: fraction of cruxes addressed */
  crux_addressed_ratio: number | null;
  /**
   * Neutral evaluator: observation-class 3-way tally of crux statuses (t/1796).
   * Additive/back-compat — absent on pre-t/1796 entries (and when there are no
   * cruxes to tally). `crux_addressed_ratio` semantics are unchanged: it remains
   * `addressed / total`. This exposes `partially_addressed` separately so it is no
   * longer scored identically to `unaddressed`.
   */
  crux_status_counts?: { addressed: number; partially_addressed: number; unaddressed: number };

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

  // ── Peer referencing (Marandi: peer-referencing ↔ diversity trade-off, t/1279) ──
  /** Fraction of speaker turns with ≥1 cross-POV dialectical edge (attack/support targeting another POV's claim). Mean across speakers. */
  peer_referencing_rate: number | null;
  /** Per-speaker peer referencing rates. */
  peer_referencing_per_speaker: Record<string, number> | null;

  // ── Local sufficiency (Wachsmuth: Local Sufficiency, t/1341) ──
  /** Mean per-claim sufficiency score over eligible claims [0,1]. Excludes final-round claims (maturity window). */
  local_sufficiency_mean: number | null;
  /** Fraction of eligible claims with zero incoming 'supports' edges (bare assertion rate). */
  unsupported_claim_rate: number | null;
  /** Per-speaker mean sufficiency score. */
  local_sufficiency_by_speaker: Record<string, number> | null;

  // ── Operational closure (autopoiesis, t/1537) ──
  /** Mean operational closure rate across speakers [0,1]. Higher = more self-sealing. Null if no dialectical edges. */
  operational_closure_rate: number | null;
  /** Per-speaker operational closure stats. Null if no dialectical edges. */
  operational_closure_per_speaker: Record<string, { closure_rate: number; closure_edges: number; coupling_edges: number; standalone_rate: number }> | null;

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

  // ── Over-generate/select/rewrite pipeline (t/1581) ──
  /** Whether a coherence gate miss occurred (rewrite failed to preserve ≥3/4 selected claims). */
  coherence_gate_miss?: boolean;
}
