// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Text for an Inquiry share's POV-tag scope (t/3983; SO e/252 cond 2). A reader must be able to tell a
// single-wing answer (e.g. Skeptic scoped to Critical) from the whole camp's position.
//
// PURE (Quality TL t/3983#2): labels arrive already resolved. The caller maps pov → camp label and
// tag id → registry label (falling back to the id for a retired tag); nothing here touches the registry.

export type TagMode = 'scope' | 'prioritize';

/** A tag selection with its display labels resolved by the caller. Ids are kept for comparison. */
export interface ResolvedTag {
  pov: string;
  tag: string;
  mode: TagMode;
  campLabel: string;
  tagLabel: string;
}

/** What actually ran: the resolved tag plus derivation.tag's counts. */
export interface ResolvedAppliedTag extends ResolvedTag {
  included: number;
  excludedUntagged: number;
}

export interface TagScopeLines {
  /** Always present: what scope the answer reflects. */
  label: string;
  /** What actually ran, from derivation.tag. Absent when the tag was not applied. */
  detail?: string;
  /** The request asked for a tag that the run did not apply. */
  warn?: string;
}

/** "12 tagged Skeptic nodes" — count, qualifier, camp, then the noun, singular for 1. */
const counted = (n: number, qualifier: string, camp: string) => `${n} ${qualifier} ${camp} ${n === 1 ? 'node' : 'nodes'}`;

function scopePhrase(t: ResolvedTag): string {
  return t.mode === 'scope'
    ? `Scoped to ${t.campLabel} · ${t.tagLabel} (Scope mode)`
    : `Prioritizing ${t.campLabel} · ${t.tagLabel}`;
}

function sameSelection(a: ResolvedTag, b: ResolvedTag): boolean {
  return a.pov === b.pov && a.tag === b.tag && a.mode === b.mode;
}

function appliedDetail(t: ResolvedAppliedTag): string {
  // Prioritize drops nothing, so it reports no exclusion count: a number there would mislead.
  return t.mode === 'scope'
    ? `Grounded on ${counted(t.included, 'tagged', t.campLabel)}; ${counted(t.excludedUntagged, 'untagged', t.campLabel)} excluded.`
    : `${counted(t.included, 'tagged', t.campLabel)} ranked first; untagged nodes still included.`;
}

/**
 * The scope lines for a share, or null for an untagged share (which then renders exactly as before).
 * When the run differs from the request, the label shows WHAT RAN and notes what was requested, the way
 * derivation.fidelity pairs with request.fidelity.
 */
export function inquiryTagScopeLines(requested: ResolvedTag | undefined, applied: ResolvedAppliedTag | undefined): TagScopeLines | null {
  if (!requested && !applied) return null;
  if (!applied) {
    return {
      label: scopePhrase(requested!),
      warn: 'Requested tag scope was not applied; this answer reflects the whole camp.',
    };
  }
  const mismatch = requested && !sameSelection(requested, applied)
    ? ` (requested: ${requested.campLabel} · ${requested.tagLabel}, ${requested.mode} mode)`
    : '';
  return { label: scopePhrase(applied) + mismatch, detail: appliedDetail(applied) };
}
