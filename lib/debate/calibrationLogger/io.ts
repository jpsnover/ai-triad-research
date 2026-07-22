// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Calibration log file I/O (ADR-007 file-size split, t/1686).
 *
 * The append/read funnel for calibration-log.jsonl plus the write-time
 * preregistration-by-artifact provenance capture (t/1672). Split out of the
 * calibrationLogger barrel; behavior is byte-for-byte unchanged.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { CalibrationDataPoint } from './schema.js';

// ── File I/O ────────────────────────────────────────────────

/**
 * Append a calibration data point to both the per-user and core JSONL logs.
 * Per-user: calibration/users/{origin}/calibration-log.jsonl
 * Core:     calibration/core/calibration-log.jsonl
 * The core log is the source of truth for the optimizer and regression analysis.
 * Creates directories on first write. Uses JSONL (one JSON object per line)
 * for append-only writes without full-file rewrite.
 */
/**
 * Preregistration-by-artifact provenance captured at log-write time (t/1672).
 *
 * The extractor is a pure function, so the two I/O-dependent provenance fields —
 * config revision and git working-tree state — are computed here, at the single
 * write funnel, and stamped onto the entry before serialization.
 *
 * Both fields degrade gracefully: a missing config file or an unavailable git
 * (e.g. the server/Azure deployment, which has no repo checkout) is an *absent*
 * input, not a discarded payload — so returning the '' / 'unknown' sentinel is
 * legitimate recovery, not silent loss (contrast t/1626). No throw, no
 * ActionableError; this path must never fail a debate write.
 */
function captureRunProvenance(): { config_revision: string; working_tree_state: 'clean' | 'dirty' | 'unknown' } {
  // Resolve relative to this file — use import.meta.url for ESM compatibility (mirrors captureSnapshot).
  // This module lives in lib/debate/calibrationLogger/, so calibration-config.json (in lib/debate/)
  // is one directory up.
  const thisDir = path.dirname(new URL(import.meta.url).pathname);

  let config_revision = '';
  try {
    const wPath = path.resolve(thisDir, '..', 'calibration-config.json');
    const content = fs.readFileSync(wPath, 'utf-8');
    config_revision = createHash('sha256').update(content).digest('hex').slice(0, 12);
  } catch { /* config unreadable — leave '' */ }

  let working_tree_state: 'clean' | 'dirty' | 'unknown' = 'unknown';
  try {
    const out = execFileSync('git', ['status', '--porcelain'], {
      cwd: thisDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    working_tree_state = out.trim().length === 0 ? 'clean' : 'dirty';
  } catch { /* git unavailable (e.g. server/Azure) — leave 'unknown' */ }

  return { config_revision, working_tree_state };
}

export function appendCalibrationLog(
  dataPoint: CalibrationDataPoint,
  dataRoot: string,
): void {
  // Stamp I/O-dependent provenance without mutating the caller's object (t/1672).
  const stamped: CalibrationDataPoint = { ...dataPoint, ...captureRunProvenance() };
  const line = JSON.stringify(stamped) + '\n';

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
