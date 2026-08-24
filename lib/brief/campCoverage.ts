// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Shared camp-coverage helpers (t/2883). Extracted so the narrate stage's
// completeness check (repair + backfill) and the verify stage's presence-symmetry
// arm read camp membership through the SAME logic — a divergence between "which
// camps must be covered" and "which camps a narration entry covers" would let a
// backfill target a camp the gate doesn't check (or vice-versa), reopening the
// exact 0-slides gap this ticket closes.

import type { DeckSpec } from './types.js';
import { resolveTrace } from './traceResolver.js';

/**
 * The camps that MUST have per-camp coverage — the debate's "positions" (spec §2.3
 * slide 5, one card per camp). Derived from `top_claims` camps: those are the
 * canonical camp positions the deck renders. Deliberately NOT the union of every
 * camp-bearing node type (argument_map/concessions can carry incidental or
 * cross-camp labels that don't warrant a slide) — a broader set would false-fire
 * the symmetry gate, which TL flagged as the next-incident risk (e/112#4).
 * Entry→camp ATTRIBUTION ({@link campOfTrace}) still reads all camp-bearing node
 * types per MUST 3; only the EXPECTED set is narrowed here.
 */
export function expectedCamps(spec: DeckSpec): string[] {
  const camps = new Set<string>();
  for (const c of spec.top_claims) camps.add(c.camp);
  return [...camps].sort();
}

/**
 * Attribute a narration entry to a camp by resolving its trace to the spec node and
 * reading that node's `camp`. Camp-less sections (question, agreements, cruxes, framing)
 * resolve to nodes without a `camp` and are excluded (TL, e/112 MUST 3).
 */
export function campOfTrace(spec: DeckSpec, trace: string): string | null {
  let node: unknown;
  try {
    node = resolveTrace(spec, trace);
  } catch {
    return null;
  }
  if (node && typeof node === 'object' && 'camp' in node) {
    const camp = (node as { camp: unknown }).camp;
    if (typeof camp === 'string' && camp.length > 0) return camp;
  }
  return null;
}

/** Set of camps covered by ≥1 of the given narration traces. */
export function campsCovered(spec: DeckSpec, traces: string[]): Set<string> {
  const covered = new Set<string>();
  for (const t of traces) {
    const camp = campOfTrace(spec, t);
    if (camp !== null) covered.add(camp);
  }
  return covered;
}

/** Expected camps with zero covering narration entries — the drop the narrator made. */
export function missingCamps(spec: DeckSpec, traces: string[]): string[] {
  const covered = campsCovered(spec, traces);
  return expectedCamps(spec).filter(c => !covered.has(c));
}
