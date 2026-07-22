// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Barrel module (ADR-007 file-size split, t/1686).
//
// The post-debate calibration data logger was split into cohesion-grouped
// modules under ./calibrationLogger/. This file re-exports every symbol so the
// public export surface at './calibrationLogger.js' is byte-for-byte unchanged
// and all existing importers (calibrationOptimizer.ts, taxonomy-editor, …) keep
// working untouched. `export *` (not `export type *`) is required — many exports
// are runtime values (extractCalibrationData, appendCalibrationLog,
// readCalibrationLog, REPLICATION_GATE_MIN_N, fixedConfigKey, medianSorted,
// quantileSorted, computeDistribution, replicationSet, evaluateReplicationGate,
// replicationGateByConfig, computeExtractionCoverage, captureSnapshot,
// diffSnapshots, readParameterHistory, appendParameterHistory,
// seedInitialSnapshot).
//
// Also re-export the browser-safe agentUtility symbols for backward
// compatibility (previously re-exported directly from this file).
export { computeAgentUtility, PERSONA_UTILITY_WEIGHTS } from './agentUtility.js';

export * from './calibrationLogger/schema.js';
export * from './calibrationLogger/extract.js';
export * from './calibrationLogger/io.js';
export * from './calibrationLogger/replicationGate.js';
export * from './calibrationLogger/coverage.js';
export * from './calibrationLogger/history.js';
