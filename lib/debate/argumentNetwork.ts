// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Barrel module (ADR-007 file-size split, t/1686).
//
// argumentNetwork was split into cohesion-grouped modules under
// ./argumentNetwork/. This file re-exports every symbol so the public export
// surface at './argumentNetwork.js' is byte-for-byte unchanged and all existing
// importers keep working untouched. `export *` (not `export type *`) is required
// — most exports are runtime functions (extractClaimsPrompt, processExtractedClaims,
// normalizeMove, computeClaimTaxonomyAttribution, the discrete-strength helpers, …).

export * from './argumentNetwork/prompts.js';
export * from './argumentNetwork/ledger.js';
export * from './argumentNetwork/strength.js';
export * from './argumentNetwork/processClaims.js';
export * from './argumentNetwork/moves.js';
export * from './argumentNetwork/attribution.js';
