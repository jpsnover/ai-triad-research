// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Shared fact-check verdict vocabulary (t/1701 design, TL-approved t/1701#2).
//
// Zero-dependency module by design: both `FactCheckResult.verdict`
// (./synthesis.ts) and `ArgumentNetworkNode.verification_status`
// (./argumentNetwork.ts) import `FactVerdict` from here. Keeping this module
// import-free guarantees no import cycle between those two type modules.

/**
 * The shared fact-check verdict axis — polarity of the *core* claim.
 * Genus-differentia definitions (t/1701#1):
 * - `supported`          — core claim + material details corroborated by the weight of evidence.
 * - `partially_accurate` — a *support* verdict: direction corroborated, but evidence identifies a
 *                          specific, material discrepancy in a detail. REQUIRES a populated
 *                          `discrepancy` object (see FactCheckResult) — evidence-gated, never a
 *                          lazy default.
 * - `disputed`           — a *contested* verdict: authoritative sources conflict on the central
 *                          assertion and evidence is mixed, not decisive. Does NOT absorb detail errors.
 * - `false`              — the central assertion is directly contradicted by authoritative sources
 *                          (direction wrong, decisively).
 * - `unverifiable`       — can be neither confirmed nor denied with available evidence.
 */
export type FactVerdict = 'supported' | 'partially_accurate' | 'disputed' | 'false' | 'unverifiable';

/** All valid FactVerdict values — single source of truth for validation/tests. */
export const FACT_VERDICTS = ['supported', 'partially_accurate', 'disputed', 'false', 'unverifiable'] as const satisfies readonly FactVerdict[];

/**
 * Read-time alias shim for the legacy `verified` verdict (TL refinement 1, t/1701#2).
 *
 * `ArgumentNetworkNode.verification_status` historically stored `'verified'`; the shared
 * vocabulary uses `'supported'` for that concept. This normalizer maps legacy `'verified'`
 * to `'supported'` **on read** — no data write, zero data-repo churn. Apply it at every
 * lib/debate site that reads/consumes `verification_status` (and at the boundary where AI
 * output is assigned to it). Unknown strings pass through unchanged (best-effort; the widened
 * union already constrains callers at compile time).
 *
 * @param v a stored/parsed verdict string (possibly legacy `'verified'` or the lifecycle `'pending'`).
 */
export function normalizeVerdict(v: string): FactVerdict | 'pending' {
  return v === 'verified' ? 'supported' : (v as FactVerdict | 'pending');
}
