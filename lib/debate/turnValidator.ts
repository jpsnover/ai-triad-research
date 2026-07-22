// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Hybrid process reward model for per-turn debate validation.
 *
 * Combines deterministic symbolic verification (Stage-A: 9 structural rules)
 * with an optional neural judge (Stage-B: LLM quality assessment). Unlike
 * standard PRMs that rely on a single neural verifier, this hybrid approach
 * provides transparent, reproducible base scoring with neural augmentation
 * for soft quality dimensions (argument advancement, taxonomy clarification).
 *
 * The process reward (formerly "score") evaluates each debate turn as an
 * intermediate reasoning step — correct process matters independent of
 * final debate outcome (Lightman et al. 2023).
 *
 * See docs/debate-turn-validation.md for the design, and
 * specs/debate-turn-validation-impl.md for the implementation spec.
 */

// Barrel module (ADR-007 file-size split, t/1686).
//
// The hybrid turn validator was split into cohesion-grouped modules under
// ./turnValidator/. This file re-exports the public surface so imports from
// './turnValidator.js' are byte-for-byte unchanged and all existing importers
// (debateEngine.ts, orchestration.ts, turnPipeline.ts, taxonomy-editor, …) keep
// working untouched. `export *` (not `export type *`) is required — most exports
// are runtime functions (resolveMoveName, isFillerRelevance,
// resolveTurnValidationConfig, validateTurn, buildRepairPrompt,
// checkDirectiveContentCompliance, parseDraftQualityResult,
// checkBoundaryConcession, classifyHintKey, validateDraftStage,
// validateCiteStage, validatePlanStage).
//
// moves.ts and repair.ts additionally export cross-module internals
// (MOVE_CATALOG_RAW, MOVE_CATALOG, DISAGREEMENT_TYPES, computeHedgeDensity,
// getHedgeThreshold) that were never part of the public surface, so those two
// modules are re-exported by explicit named lists rather than `export *`.

export { resolveMoveName, isFillerRelevance } from './turnValidator/moves.js';
export { resolveTurnValidationConfig } from './turnValidator/config.js';
export { buildRepairPrompt } from './turnValidator/repair.js';
export * from './turnValidator/core.js';
export * from './turnValidator/directiveCompliance.js';
export * from './turnValidator/draftQuality.js';
export * from './turnValidator/stageValidation.js';
