import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { appendCalibrationLog, readCalibrationLog } from '../../../../lib/debate/calibrationLogger';
import type { CalibrationDataPoint } from '../../../../lib/debate/calibrationLogger';

function makeDataPoint(overrides: Partial<CalibrationDataPoint> = {}): CalibrationDataPoint {
  return {
    schema_version: 1,
    debate_id: `debate-${Math.random().toString(36).slice(2)}`,
    timestamp: '2026-06-17T12:00:00Z',
    origin: 'local',
    model: 'test-model',
    rounds: 3,
    argumentative_saturation_at_transition: 0.8,
    argumentation_exit_threshold: 0.75,
    engaging_real_disagreement: true,
    crux_addressed_ratio: 0.6,
    avg_utilization_rate: 0.5,
    avg_primary_utilization: 0.4,
    relevance_threshold: 0.45,
    qbaf_preference_concordance: 0.7,
    attack_weights: [1.0, 1.1, 1.2],
    structural_error_rate: 0.02,
    repetition_rate: 0.05,
    draft_temperature: 0.7,
    argumentative_saturation_signals_at_transition: { novelty: 0.3 },
    argumentative_saturation_weights: { novelty: 1.0 },
    claims_forgotten_rate: 0.1,
    recent_window: 3,
    an_nodes_at_synthesis: 42,
    gc_trigger_threshold: 100,
    gc_triggered: false,
    gc_nodes_removed: 0,
    total_claims: 20,
    avg_claims_per_turn: 3.5,
    avg_attack_ratio: 0.4,
    avg_support_ratio: 0.3,
    ...overrides,
  } as CalibrationDataPoint;
}

describe('calibration log — per-user JSONL', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calib-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes to calibration/users/{origin}/calibration-log.jsonl', () => {
    const dp = makeDataPoint({ origin: 'local', debate_id: 'debate-001' });
    appendCalibrationLog(dp, tmpDir);

    const expected = path.join(tmpDir, 'calibration', 'users', 'local', 'calibration-log.jsonl');
    expect(fs.existsSync(expected)).toBe(true);

    const lines = fs.readFileSync(expected, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).debate_id).toBe('debate-001');
  });

  it('creates user directory on first write', () => {
    const dp = makeDataPoint({ origin: 'jsnover13-at-gmail-com' });
    appendCalibrationLog(dp, tmpDir);

    const userDir = path.join(tmpDir, 'calibration', 'users', 'jsnover13-at-gmail-com');
    expect(fs.existsSync(userDir)).toBe(true);
  });

  it('appends multiple entries as separate JSONL lines', () => {
    const dp1 = makeDataPoint({ origin: 'local', debate_id: 'debate-001' });
    const dp2 = makeDataPoint({ origin: 'local', debate_id: 'debate-002' });
    appendCalibrationLog(dp1, tmpDir);
    appendCalibrationLog(dp2, tmpDir);

    const logPath = path.join(tmpDir, 'calibration', 'users', 'local', 'calibration-log.jsonl');
    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).debate_id).toBe('debate-001');
    expect(JSON.parse(lines[1]).debate_id).toBe('debate-002');
  });

  it('partitions by origin — different users get different files', () => {
    const dp1 = makeDataPoint({ origin: 'local', debate_id: 'debate-001' });
    const dp2 = makeDataPoint({ origin: 'azure-user', debate_id: 'debate-002' });
    appendCalibrationLog(dp1, tmpDir);
    appendCalibrationLog(dp2, tmpDir);

    const localPath = path.join(tmpDir, 'calibration', 'users', 'local', 'calibration-log.jsonl');
    const azurePath = path.join(tmpDir, 'calibration', 'users', 'azure-user', 'calibration-log.jsonl');
    expect(fs.existsSync(localPath)).toBe(true);
    expect(fs.existsSync(azurePath)).toBe(true);

    const localLines = fs.readFileSync(localPath, 'utf-8').trim().split('\n');
    const azureLines = fs.readFileSync(azurePath, 'utf-8').trim().split('\n');
    expect(localLines).toHaveLength(1);
    expect(azureLines).toHaveLength(1);
  });

  it('falls back to "local" when origin is empty', () => {
    const dp = makeDataPoint({ origin: '', debate_id: 'debate-001' });
    appendCalibrationLog(dp, tmpDir);

    const expected = path.join(tmpDir, 'calibration', 'users', 'local', 'calibration-log.jsonl');
    expect(fs.existsSync(expected)).toBe(true);
  });

  it('does not write to the old calibration-log.json path', () => {
    const dp = makeDataPoint({ origin: 'local' });
    appendCalibrationLog(dp, tmpDir);

    const oldPath = path.join(tmpDir, 'calibration', 'calibration-log.json');
    expect(fs.existsSync(oldPath)).toBe(false);
  });

  it('readCalibrationLog reads from core/calibration-log.jsonl', () => {
    const coreDir = path.join(tmpDir, 'calibration', 'core');
    fs.mkdirSync(coreDir, { recursive: true });

    const dp1 = makeDataPoint({ origin: 'local', debate_id: 'debate-001' });
    const dp2 = makeDataPoint({ origin: 'azure', debate_id: 'debate-002' });
    fs.writeFileSync(
      path.join(coreDir, 'calibration-log.jsonl'),
      JSON.stringify(dp1) + '\n' + JSON.stringify(dp2) + '\n',
      'utf-8',
    );

    const result = readCalibrationLog(tmpDir);
    expect(result).toHaveLength(2);
    expect(result[0].debate_id).toBe('debate-001');
    expect(result[1].debate_id).toBe('debate-002');
  });

  it('readCalibrationLog returns empty when core/ does not exist', () => {
    const result = readCalibrationLog(tmpDir);
    expect(result).toEqual([]);
  });

  it('readCalibrationLog handles trailing newline and empty lines', () => {
    const coreDir = path.join(tmpDir, 'calibration', 'core');
    fs.mkdirSync(coreDir, { recursive: true });

    const dp = makeDataPoint({ origin: 'local', debate_id: 'debate-001' });
    fs.writeFileSync(
      path.join(coreDir, 'calibration-log.jsonl'),
      JSON.stringify(dp) + '\n\n',
      'utf-8',
    );

    const result = readCalibrationLog(tmpDir);
    expect(result).toHaveLength(1);
  });
});
