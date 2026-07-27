// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Barrel module (ADR-007 file-size split, t/1686).
//
// The turn-pipeline logic was split into cohesion-grouped modules under
// ./turnPipeline/. This file re-exports every ORIGINALLY-PUBLIC symbol so the
// public export surface at './turnPipeline.js' is byte-for-byte unchanged and
// all existing importers keep working untouched.
//
// The split modules also export several helpers that were internal to the
// original single file (needed across the new module boundaries — e.g.
// buildStageInput / parseStageResponse / tagProvenance / toPromptJson,
// normalizeSpeakerNames, DraftField / ALL_DRAFT_FIELDS / the freeze helpers,
// buildRepairBlock / the micro-fix passes, extractDraftMeta,
// stripLeadingHeadings / deduplicateStatement, normalizeDisagreementType).
// Those were NEVER part of the public surface, so this barrel re-exports the
// original public symbols EXPLICITLY (not `export *`) for every module that
// leaks such internals, keeping the surface exactly the original 13 exports.
// Only opening.ts exports solely public symbols, so it is star-exported.

export type {
  TurnPipelineInput,
  StageGenerateFn,
  EnvelopeGenerateFn,
  StageProgressFn,
} from './turnPipeline/types.js';
export { DEFAULT_STAGE_TEMPERATURES } from './turnPipeline/types.js';

export { runTurnPipeline } from './turnPipeline/runTurn.js';
export { splitIntoParagraphs } from './turnPipeline/repair.js';
export { validateMicroFix } from './turnPipeline/microFix.js';
export { assemblePipelineResult } from './turnPipeline/assemble.js';

// opening.ts exports only originally-public symbols (OpeningPipelineInput,
// runOpeningPipeline, getOpeningRepairHints, assembleOpeningPipelineResult).
export * from './turnPipeline/opening.js';
