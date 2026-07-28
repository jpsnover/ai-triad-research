// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Evaluator loop-integrity guard (t/1846; TL ruling t/1843#1).
 *
 * Covers: the same-evaluator optimizer comparison window (legacy rows never
 * eligible), the explicit cold-start hold, the crux-axis apply-gate (zero weight
 * in config writes until reference-calibrated, t/1847), the evaluator-cutover
 * parameter-history baseline, extraction's invalid-evaluation nulling
 * (truncation → null, never fake zeros), and the evaluator_model_id stamp.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { recalibrateParameters } from './calibrationOptimizer.js';
import { extractCalibrationData } from './calibrationLogger.js';
import type { CalibrationDataPoint, ParameterHistoryEntry } from './calibrationLogger.js';
import { runNeutralEvaluation, PINNED_EVALUATOR_MODEL, resolveEvaluatorModel } from './neutralEvaluator.js';
import type { NeutralEvaluation } from './neutralEvaluator.js';
import type { AIAdapter } from './aiAdapter.js';
import type { DebateSession } from './types.js';

const PINNED = PINNED_EVALUATOR_MODEL;

// ── Fixtures ────────────────────────────────────────────────

function row(overrides: Partial<CalibrationDataPoint> = {}): CalibrationDataPoint {
  return {
    schema_version: 1,
    debate_id: 'debate-test',
    timestamp: '2026-07-28T00:00:00.000Z',
    origin: 'test',
    model: 'test-model',
    rounds: 4,
    prompt_version: 'v-test',
    config_revision: 'rev-test',
    working_tree_state: 'clean',
    argumentative_saturation_at_transition: null,
    argumentation_exit_threshold: 0.72,
    engaging_real_disagreement: true,
    crux_addressed_ratio: 0.5,
    avg_utilization_rate: null,
    avg_primary_utilization: null,
    relevance_threshold: 0.48,
    qbaf_preference_concordance: null,
    attack_weights: [1.0, 1.1, 1.2],
    structural_error_rate: 0,
    repetition_rate: 0,
    draft_temperature: 0.7,
    argumentative_saturation_signals_at_transition: null,
    argumentative_saturation_weights: {},
    claims_forgotten_rate: 0.2,
    recent_window: 8,
    an_nodes_at_synthesis: 10,
    gc_runs: 0,
    gc_trigger: 175,
    crux_resolution_divergence_rate: 0.5,
    counterfactual_type_distribution: null,
    polarity_resolved_threshold: 0.85,
    relevance_score_variance: null,
    max_nodes_cap: 50,
    recycling_novelty_agreement: null,
    semantic_recycling_threshold: 0.85,
    taxonomy_mapped_ratio: null,
    cluster_min_similarity: 0.55,
    near_miss_duplicate_count: null,
    duplicate_similarity_threshold: 0.85,
    borderline_claim_survival_rate: null,
    fire_confidence_threshold: 0.7,
    avg_branch_cohesion: null,
    cohesion_clear_theme: 0.6,
    claims_per_1k_words: null,
    kp_divisor: 500,
    hit_api_ceiling: false,
    total_api_calls: 10,
    budget_hard_multiplier: 15,
    situation_nodes_injected: 0,
    situation_nodes_referenced: 0,
    situation_crux_alignment: null,
    situation_max_nodes: 8,
    ...overrides,
  } as unknown as CalibrationDataPoint;
}

function writeLog(dataRoot: string, rows: CalibrationDataPoint[]): void {
  const coreDir = path.join(dataRoot, 'calibration', 'core');
  fs.mkdirSync(coreDir, { recursive: true });
  fs.writeFileSync(
    path.join(coreDir, 'calibration-log.jsonl'),
    rows.map(r => JSON.stringify(r)).join('\n') + '\n',
    'utf-8',
  );
}

let tmpRoot: string;
let weightsPath: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-guard-'));
  weightsPath = path.join(tmpRoot, 'calibration-config.json');
  fs.copyFileSync(path.resolve(__dirname, 'calibration-config.json'), weightsPath);
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ── Same-evaluator comparison window ────────────────────────

describe('same-evaluator optimizer window (t/1846)', () => {
  it('consumes only rows stamped with the pinned evaluator and reports exclusions', () => {
    const rows = [
      ...Array.from({ length: 12 }, () => row({ evaluator_model_id: PINNED })),
      ...Array.from({ length: 6 }, () => row({ evaluator_model_id: 'claude-haiku-4-5' })),
      ...Array.from({ length: 5 }, () => row()), // legacy, unstamped — never eligible
    ];
    writeLog(tmpRoot, rows);

    const report = recalibrateParameters(tmpRoot, { weightsPath });

    expect(report.evaluator_model_id).toBe(PINNED);
    expect(report.data_points).toBe(12);
    expect(report.excluded_rows_wrong_evaluator).toBe(11);
    expect(report.cold_start_hold).toBeUndefined();
    expect(report.results.length).toBeGreaterThan(0);
  });

  it('holds with an explicit cold-start state when too few rows carry the pin', () => {
    const rows = [
      ...Array.from({ length: 3 }, () => row({ evaluator_model_id: PINNED })),
      ...Array.from({ length: 10 }, () => row()), // enough rows overall, wrong window
    ];
    writeLog(tmpRoot, rows);

    const report = recalibrateParameters(tmpRoot, { weightsPath });

    expect(report.data_points).toBe(3);
    expect(report.excluded_rows_wrong_evaluator).toBe(10);
    expect(report.cold_start_hold).toContain('3/10');
    expect(report.cold_start_hold).toContain(PINNED);
    expect(report.results).toHaveLength(0);
  });
});

// ── Crux-axis apply-gate ────────────────────────────────────

describe('crux-axis apply-gate (t/1843 ruling)', () => {
  it('computes crux-axis recommendations but never writes them under --apply', () => {
    writeLog(tmpRoot, Array.from({ length: 12 }, () => row({ evaluator_model_id: PINNED })));
    const before = fs.readFileSync(weightsPath, 'utf-8');

    const report = recalibrateParameters(tmpRoot, { apply: true, weightsPath });

    // Recommendations exist for crux-axis params (visibility preserved) …
    const cruxResults = report.results.filter(r =>
      r.parameter === 'thresholds.argumentation_exit' || r.parameter === 'crux_resolution.polarity_resolved');
    expect(cruxResults.length).toBeGreaterThan(0);
    // … but they are held, not applied, and the config file is untouched.
    const heldParams = (report.held_recommendations ?? []).map(h => h.parameter);
    for (const r of cruxResults) expect(heldParams).toContain(r.parameter);
    expect(report.applied).toBe(false);
    expect(fs.readFileSync(weightsPath, 'utf-8')).toBe(before);
  });
});

// ── Evaluator-cutover baseline ──────────────────────────────

describe('evaluator-cutover parameter-history baseline (t/1670 discipline)', () => {
  it('appends one cutover entry stamped with the pin, idempotently', () => {
    writeLog(tmpRoot, Array.from({ length: 12 }, () => row({ evaluator_model_id: PINNED })));

    recalibrateParameters(tmpRoot, { weightsPath });
    recalibrateParameters(tmpRoot, { weightsPath }); // second run must not add another

    const history: ParameterHistoryEntry[] = JSON.parse(
      fs.readFileSync(path.join(tmpRoot, 'calibration', 'parameter-history.json'), 'utf-8'));
    const cutovers = history.filter(h => h.source === 'evaluator-cutover');
    expect(cutovers).toHaveLength(1);
    expect(cutovers[0].evaluator_id).toBe(PINNED);
    expect(cutovers[0].changes).toHaveLength(0);
  });
});

// ── Extraction: invalid evaluation → null, stamp flows through ──

function minimalSession(overrides: Partial<DebateSession> = {}): DebateSession {
  return {
    id: 'debate-guard-test',
    topic: { original: 'test topic', final: 'test topic' },
    transcript: [],
    ...overrides,
  } as unknown as DebateSession;
}

function finalEvaluation(overrides: Partial<NeutralEvaluation> = {}): NeutralEvaluation {
  return {
    checkpoint: 'final',
    timestamp: '2026-07-28T00:00:00.000Z',
    cruxes: [
      { id: 'crux-1', description: 'c1', disagreement_type: 'empirical', speakers_involved: ['A', 'B'], status: 'addressed', confidence: 'high' },
      { id: 'crux-2', description: 'c2', disagreement_type: 'values', speakers_involved: ['A', 'B'], status: 'unaddressed', confidence: 'high' },
    ],
    claims: [],
    overall_assessment: {
      strongest_unaddressed_claim_id: null,
      debate_is_engaging_real_disagreement: true,
      notes: 'test',
    },
    ...overrides,
  };
}

describe('extraction under the guard (t/1846)', () => {
  it('stamps evaluator_model_id from the session and computes crux metrics from a valid eval', () => {
    const session = minimalSession({
      evaluator_model_id: PINNED,
      neutral_evaluations: [finalEvaluation()],
    });
    const dp = extractCalibrationData(session, 'test');
    expect(dp.evaluator_model_id).toBe(PINNED);
    expect(dp.crux_addressed_ratio).toBe(0.5);
    expect(dp.engaging_real_disagreement).toBe(true);
  });

  it('treats an evaluation_invalid final eval as ABSENT — null metrics, never fake zeros', () => {
    const session = minimalSession({
      evaluator_model_id: PINNED,
      neutral_evaluations: [finalEvaluation({ evaluation_invalid: true, invalid_reason: 'parse_salvaged' })],
    });
    const dp = extractCalibrationData(session, 'test');
    expect(dp.crux_addressed_ratio).toBeNull();
    expect(dp.engaging_real_disagreement).toBeNull();
    expect(dp.crux_resolution_divergence_rate).toBeNull();
    expect(dp.situation_crux_alignment).toBeNull();
    // The stamp still flows — the row is attributable even though its metrics are null.
    expect(dp.evaluator_model_id).toBe(PINNED);
  });

  it('omits the stamp on sessions that predate the pin (legacy rows stay unstamped)', () => {
    const dp = extractCalibrationData(minimalSession(), 'test');
    expect(dp.evaluator_model_id).toBeUndefined();
  });
});

// ── Neutral evaluator: strict parse, salvage marking, pin resolution ──

function fakeAdapter(response: string): AIAdapter {
  return { generateText: async () => response } as unknown as AIAdapter;
}

const VALID_RESPONSE = JSON.stringify({
  checkpoint: 'final',
  timestamp: '2026-07-28T00:00:00.000Z',
  cruxes: [],
  claims: [],
  overall_assessment: {
    strongest_unaddressed_claim_id: null,
    debate_is_engaging_real_disagreement: false,
    notes: 'clean',
  },
});

describe('neutral evaluator parse integrity (t/1846)', () => {
  const baseConfig = (adapter: AIAdapter) => ({
    adapter,
    topic: 'test',
    transcript: [],
    activePovers: ['accelerationist', 'safetyist'] as import('./types.js').SpeakerId[],
    model: 'test-model',
  });

  it('a strict-valid response is NOT marked invalid', async () => {
    const evaluation = await runNeutralEvaluation('final', baseConfig(fakeAdapter(VALID_RESPONSE)));
    expect(evaluation.evaluation_invalid).toBeUndefined();
    expect(evaluation.overall_assessment.debate_is_engaging_real_disagreement).toBe(false);
  });

  it('a truncated response is marked evaluation_invalid (salvaged or failed), never a trusted 0-crux result', async () => {
    const truncated = VALID_RESPONSE.slice(0, Math.floor(VALID_RESPONSE.length / 2));
    const evaluation = await runNeutralEvaluation('final', baseConfig(fakeAdapter(truncated)));
    expect(evaluation.evaluation_invalid).toBe(true);
    expect(['parse_salvaged', 'parse_failed']).toContain(evaluation.invalid_reason);
  });

  it('resolveEvaluatorModel returns the pin by default and honors an explicit probe override', () => {
    expect(resolveEvaluatorModel()).toBe(PINNED);
    expect(resolveEvaluatorModel('claude-haiku-4-5')).toBe('claude-haiku-4-5');
  });
});
