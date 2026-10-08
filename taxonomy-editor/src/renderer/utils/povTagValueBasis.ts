// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/4052 (display spec t/4052#9; SO e/278#2 condition 4): what the review queue shows for a proposal's
// value_basis. Pure. TEXT COMES ONLY FROM THE RUN'S SNAPSHOT (`value_basis_run.value_hierarchies`), never from
// the live soul doc, so a later soul edit can't change what a citation says. Indices are 1-based (lib's doc).

import type { ValueBasis, ValueBasisShared, ValueBasisRun } from '@lib/schema/povTagProposals';
import { compareSoulProvenance, type SoulProvenance } from '@lib/debate/soulDocSchema';

/** The snapshot key for the base skeptic soul's shared-ground elements. */
export const SHARED_KEY = 'shared';

/** One cited Value Hierarchy element, resolved against the snapshot. `ok: false` means the index doesn't resolve. */
export type Citation =
  | { ok: true; index: number; title: string; text: string }
  | { ok: false; index: number };

/** The element title: the snapshot text before the first " — ", or the whole text when there's no dash. */
export function vhTitle(text: string): string {
  const cut = text.indexOf(' — ');
  return cut === -1 ? text : text.slice(0, cut);
}

/** Resolve a 1-based index into `value_hierarchies[key]`. Unresolvable → `ok: false` (rendered as an error state). */
export function resolveCitation(run: ValueBasisRun | undefined, key: string, index: number): Citation {
  const list = run?.value_hierarchies?.[key];
  const text = Number.isInteger(index) && index >= 1 && list ? list[index - 1] : undefined;
  return typeof text === 'string' ? { ok: true, index, title: vhTitle(text), text } : { ok: false, index };
}

/** An entry that both claims "unsupported" and cites elements contradicts itself. lib's parser refuses it; the
 *  queue re-checks so a contradiction can never render as a confident justification. */
export function isContradictory(entry: Pick<ValueBasis, 'vh_index' | 'vh_index_uncertain' | 'unsupported'>): boolean {
  const cites = (entry.vh_index?.length ?? 0) > 0 || entry.vh_index_uncertain.length > 0;
  return entry.unsupported === cites;
}

/** The value_basis fields the tiering reads. Structural, so lib's item type fits unchanged. */
export interface ValueBasisFields {
  proposed: string[];
  value_basis?: ValueBasis[];
  value_basis_shared?: ValueBasisShared;
}

/**
 * "Possibly misplaced in Skeptic" (t/4052#9 tier 1): a "both" item where NEITHER wing has a firm element and the
 * shared-ground entry is unsupported. A wing with only an uncertain element still counts as having no firm one
 * (skp-beliefs-161); this predicate reproduces CL's five named items on data 97c3f987.
 */
export function isPossiblyMisplaced(p: ValueBasisFields): boolean {
  if (!p.value_basis_shared || !p.value_basis || p.value_basis.length === 0) return false;
  return p.value_basis.every(v => v.vh_index === null) && p.value_basis_shared.unsupported;
}

/** Any element, wing or shared, cited in exactly one of the two runs. */
export function hasUncertain(p: ValueBasisFields): boolean {
  return (p.value_basis ?? []).some(v => v.vh_index_uncertain.length > 0)
    || (p.value_basis_shared?.vh_index_uncertain.length ?? 0) > 0;
}

/** Any proposed tag that no element supports. */
export function hasUnsupportedTag(p: ValueBasisFields): boolean {
  return (p.value_basis ?? []).some(v => v.unsupported);
}

/** Whether the soul docs behind the justifications still match the ones this app bundles. */
export type ProvenanceState = 'same' | 'changed' | 'unknown';

/**
 * Compare the run's recorded soul provenance with the bundled souls, via the one canonical comparator
 * (SO e/278#5/#7; no second hash). Any `different` → changed. Otherwise any `unknown` (absent on either side, or
 * not comparable) → unknown, which the queue shows as "cannot verify": it fails visible, never silent.
 */
export function provenanceState(
  recorded: Record<string, SoulProvenance> | undefined,
  bundled: Record<string, SoulProvenance | undefined>,
): ProvenanceState {
  const keys = Object.keys(bundled);
  if (!recorded || keys.length === 0) return 'unknown';
  const results = keys.map(k => compareSoulProvenance(recorded[k], bundled[k]));
  if (results.includes('different')) return 'changed';
  return results.includes('unknown') ? 'unknown' : 'same';
}
