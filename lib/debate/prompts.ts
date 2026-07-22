// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * All AI prompts for the POV Debater feature.
 * Prompts are separated from logic per project convention.
 *
 * Barrel module (ADR-007, t/1686). This file was split from a single ~4,667-LOC
 * source into cohesion-grouped modules under ./prompts/. It re-exports the full
 * surface so every importer of './prompts.js' keeps working byte-for-byte.
 * Shared MUTABLE module state (compact flag, topic scope) lives ONLY in
 * ./prompts/state.js — all readers import its getters so the singletons are
 * never duplicated across modules.
 */

export * from './prompts/state.js';
export * from './prompts/shared-helpers.js';
export * from './prompts/shared-instructions.js';
export * from './prompts/turn.js';
export * from './prompts/opening.js';
export * from './prompts/turn-pipeline.js';
export * from './prompts/synthesis.js';
export * from './prompts/reflection.js';
export * from './prompts/moderator.js';
export * from './prompts/topic-crux.js';

// Aliased re-exports for envelope builders (lib/debate/envelopes.ts).
// Preserves the underscore-prefixed public names the original module exposed.
export {
  MUST_CORE_BEHAVIORS as _MUST_CORE_BEHAVIORS,
  MUST_EXTENDED as _MUST_EXTENDED,
  STEELMAN_INSTRUCTION as _STEELMAN_INSTRUCTION,
  PHASE_INSTRUCTIONS as _PHASE_INSTRUCTIONS,
  CONSTRUCTIVE_MOVES as _CONSTRUCTIVE_MOVES,
  sourceReminder as _sourceReminder,
} from './prompts/shared-instructions.js';
export {
  otherDebaters as _otherDebaters,
  getCharacterBlock as _getCharacterBlock,
  getReadingLevel as _getReadingLevel,
  getDetailInstruction as _getDetailInstruction,
} from './prompts/shared-helpers.js';
