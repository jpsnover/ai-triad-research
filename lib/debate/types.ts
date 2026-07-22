// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Barrel module (ADR-007 file-size split, t/1686).
//
// The debate type definitions were split into cohesion-grouped domain modules
// under ./types/. This file re-exports every symbol so the public export surface
// at './types.js' is byte-for-byte unchanged and all existing importers keep
// working untouched. `export *` (not `export type *`) is required — several
// exports are runtime values (LEGACY_SPEAKER_MAP, migrateSpeakerId,
// normalizeActivePovers, getDebatePhase, DEBATE_AUDIENCES,
// HINT_SUPPRESSION_THRESHOLD, MOVE_TO_FAMILY, MOVE_TO_FORCE,
// FAMILY_BURDEN_WEIGHT, AI_POVERS, POV_KEYS, POVER_INFO).

export * from './types/phase.js';
export * from './types/session.js';
export * from './types/convergence.js';
export * from './types/validation.js';
export * from './types/argumentNetwork.js';
export * from './types/diagnostics.js';
export * from './types/pipeline.js';
export * from './types/synthesis.js';
export * from './types/moderator.js';
export * from './types/promptInspector.js';
