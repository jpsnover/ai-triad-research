// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyRelevanceThresholdAdaptation } from './calibrationOptimizer.js';
import type { AdaptiveState, OptimizationResult } from './calibrationOptimizer.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── Helpers ───────────────────────────────────────────────

function makeRecommendation(overrides: Partial<OptimizationResult> = {}): OptimizationResult {
  return {
    parameter: 'relevance_threshold',
    current_value: 0.48,
    recommended_value: 0.51,
    confidence: 'medium',
    data_points_used: 8,
    rationale: 'Avg utilization 25%, adjusting 0.48 → 0.51',
    ...overrides,
  };
}

function makeState(overrides: Partial<AdaptiveState> = {}): AdaptiveState {
  return {
    debates_since_last_adjustment: 6,
    last_adjusted_at: null,
    ...overrides,
  };
}

function makeWeightsFile(dir: string, overrides: Record<string, unknown> = {}): string {
  const weightsPath = path.join(dir, 'calibration-config.json');
  const weights = {
    schema_version: 1,
    relevance: {
      embedding_threshold: 0.48,
      adaptation_enabled: true,
      adaptation_history: [],
      ...overrides,
    },
  };
  fs.writeFileSync(weightsPath, JSON.stringify(weights, null, 2), 'utf-8');
  return weightsPath;
}

// ── Tests ─────────────────────────────────────────────────

describe('applyRelevanceThresholdAdaptation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adaptive-threshold-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('applies threshold increase when all rails pass', () => {
    const weightsPath = makeWeightsFile(tmpDir);
    const result = applyRelevanceThresholdAdaptation(
      makeRecommendation({ current_value: 0.48, recommended_value: 0.51 }),
      makeState({ debates_since_last_adjustment: 6 }),
      weightsPath,
    );

    expect(result.applied).toBe(true);
    expect(result.reason).toContain('0.48 → 0.51');

    // Verify the file was actually updated
    const updated = JSON.parse(fs.readFileSync(weightsPath, 'utf-8'));
    expect(updated.relevance.embedding_threshold).toBe(0.51);
    expect(updated.relevance.adaptation_history).toHaveLength(1);
    expect(updated.relevance.adaptation_history[0].from).toBe(0.48);
    expect(updated.relevance.adaptation_history[0].to).toBe(0.51);
  });

  it('blocks adjustment when < 5 debates since last change', () => {
    const weightsPath = makeWeightsFile(tmpDir);
    const result = applyRelevanceThresholdAdaptation(
      makeRecommendation(),
      makeState({ debates_since_last_adjustment: 3 }),
      weightsPath,
    );

    expect(result.applied).toBe(false);
    expect(result.reason).toContain('only 3/5');
  });

  it('blocks adjustment when confidence is low', () => {
    const weightsPath = makeWeightsFile(tmpDir);
    const result = applyRelevanceThresholdAdaptation(
      makeRecommendation({ confidence: 'low' }),
      makeState(),
      weightsPath,
    );

    expect(result.applied).toBe(false);
    expect(result.reason).toContain('confidence too low');
  });

  it('blocks adjustment when recommended value outside bounds', () => {
    const weightsPath = makeWeightsFile(tmpDir);
    const result = applyRelevanceThresholdAdaptation(
      makeRecommendation({ recommended_value: 0.65 }),
      makeState(),
      weightsPath,
    );

    expect(result.applied).toBe(false);
    expect(result.reason).toContain('outside bounds');
  });

  it('blocks adjustment when adaptation_enabled is false', () => {
    const weightsPath = makeWeightsFile(tmpDir, { adaptation_enabled: false });
    const result = applyRelevanceThresholdAdaptation(
      makeRecommendation(),
      makeState(),
      weightsPath,
    );

    expect(result.applied).toBe(false);
    expect(result.reason).toContain('adaptation_enabled is false');
  });

  it('returns no-change when current equals recommended', () => {
    const result = applyRelevanceThresholdAdaptation(
      makeRecommendation({ current_value: 0.48, recommended_value: 0.48 }),
      makeState(),
    );

    expect(result.applied).toBe(false);
    expect(result.reason).toBe('no change needed');
  });

  it('returns no-recommendation when null', () => {
    const result = applyRelevanceThresholdAdaptation(null, makeState());
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('no recommendation');
  });

  it('caps adaptation_history at 10 entries', () => {
    const existingHistory = Array.from({ length: 10 }, (_, i) => ({
      from: 0.45 + i * 0.01,
      to: 0.46 + i * 0.01,
      at: `2026-04-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      rationale: `test ${i}`,
      data_points: 10,
    }));
    const weightsPath = makeWeightsFile(tmpDir, { adaptation_history: existingHistory });

    applyRelevanceThresholdAdaptation(
      makeRecommendation(),
      makeState(),
      weightsPath,
    );

    const updated = JSON.parse(fs.readFileSync(weightsPath, 'utf-8'));
    expect(updated.relevance.adaptation_history).toHaveLength(10);
    expect(updated.relevance.adaptation_history[9].to).toBe(0.51);
  });

  it('allows high confidence', () => {
    const weightsPath = makeWeightsFile(tmpDir);
    const result = applyRelevanceThresholdAdaptation(
      makeRecommendation({ confidence: 'high' }),
      makeState(),
      weightsPath,
    );

    expect(result.applied).toBe(true);
  });

  it('applies threshold decrease within bounds', () => {
    const weightsPath = makeWeightsFile(tmpDir, { embedding_threshold: 0.50 });
    const result = applyRelevanceThresholdAdaptation(
      makeRecommendation({ current_value: 0.50, recommended_value: 0.47 }),
      makeState(),
      weightsPath,
    );

    expect(result.applied).toBe(true);

    const updated = JSON.parse(fs.readFileSync(weightsPath, 'utf-8'));
    expect(updated.relevance.embedding_threshold).toBe(0.47);
  });
});
