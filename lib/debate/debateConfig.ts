// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Runtime-behavior knobs for the debate engine. Values here are tunable
// configuration; structural invariants (embedding dim, dedup thresholds, etc.)
// live in constants.ts. Calibration-coupled values (budget multipliers,
// embedding/lexical thresholds) are in phaseTransitions.ts fallback and
// covered by the parity gate in phaseTransitions.test.ts.

// ── Timeouts ──────────────────────────────────────────────────────────────────

export const CLAIM_VERIFY_SETTLE_TIMEOUT_MS = 30_000;
export const SUMMARIZATION_TIMEOUT_MS = 15_000;
export const JUDGE_TIMEOUT_MS = 20_000;

// ── Generation parameters ─────────────────────────────────────────────────────

export const EVALUATOR_TEMPERATURE = 0;
export const SUMMARIZATION_TEMPERATURE = 0.3;
export const SUMMARIZATION_MAX_TOKENS = 500;

// ── Round / phase control ─────────────────────────────────────────────────────

export const MIDPOINT_NEUTRAL_EVAL_ROUND_CAP = 3;
export const DIVERSITY_MIN_ACTIVATION_ROUND = 3;
export const DIVERSITY_REPETITION_RATE_THRESHOLD = 0.5;
export const CROSS_POV_CITATION_ACTIVATION_ROUND = 4;

// ── Transcript / context-window sizes ────────────────────────────────────────

export const COMPRESSION_TRIGGER_TRANSCRIPT_LENGTH = 12;
export const RECENT_TRANSCRIPT_WINDOW_TURNS = 8;
export const PROBING_TRANSCRIPT_WINDOW_TURNS = 50;
export const OVERGEN_TRANSCRIPT_WINDOW_TURNS = 6;
export const PRIOR_MOVES_DIVERSITY_WINDOW = 6;
export const PROCESS_REWARD_SIGNAL_HISTORY_DEPTH = 12;
export const SOURCE_DOC_SUMMARY_CHAR_LIMIT = 2_000;

// ── Node / claim limits ───────────────────────────────────────────────────────

export const ESTABLISHED_POINTS_LIMIT = 14;
export const PROBING_UNREFERENCED_NODES_CAP = 20;
export const PROBING_UNCOVERED_CLAIMS_LIMIT = 10;
export const CROSS_POV_NODE_DIVERSITY_LIMIT = 8;
export const EDGE_CONTEXT_TOP_N = 15;
export const TAXONOMY_MAX_POV_NODES_DEFAULT = 12;
export const TAXONOMY_MIN_NODES_PER_BDI_DEFAULT = 3;
export const EXPLORATION_SEEDING_RECOMMENDATION_SLICE = 10;

// ── Scoring / strength thresholds ────────────────────────────────────────────

export const CONCESSION_CANDIDATE_MIN_QBAF_STRENGTH = 0.65;
export const RECENT_CITATION_PENALTY_MULTIPLIER = 0.55;
export const TOPIC_SCORE_FLOOR_MULTIPLIER = 0.50;
export const NON_APPROVED_EDGE_CONFIDENCE_FILTER = 0.75;
export const LINEAGE_BOOST_INCREMENT = 0.08;
export const PERTURBATION_ARCO_BASELINE = 0.5;

// ── Insularity intervention limits ────────────────────────────────────────────

export const INSULARITY_INTERVENTION_COOLDOWN_ROUNDS = 2;
export const INSULARITY_INTERVENTION_PER_SPEAKER_CAP = 2;

// ── Exploration seeding ───────────────────────────────────────────────────────

export const EXPLORATION_EFFECTIVE_SITUATION_BOOST = 0.15;
export const EXPLORATION_INEFFECTIVE_SITUATION_PENALTY = -0.10;
/** [min, max] clamp applied to maxTotalRounds when seeding from situation data. */
export const EXPLORATION_ROUNDS_CLAMP = [6, 20] as const;
/** [min, max] clamp applied to argumentation/concluding exit thresholds when seeding. */
export const EXPLORATION_EXIT_THRESHOLD_CLAMP = [0.4, 0.9] as const;
/** [min, max] clamp applied to temperature when seeding from situation data. */
export const EXPLORATION_TEMPERATURE_CLAMP = [0.3, 1.0] as const;

// ── Doctrinal boundary weights ────────────────────────────────────────────────

export const DOCTRINAL_HARDCODED_BOUNDARY_WEIGHT = 1.0;
export const DOCTRINAL_SOFTCODED_BOUNDARY_WEIGHT = 0.7;
