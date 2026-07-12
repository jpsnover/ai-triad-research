// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1541 — crux external_evidence mutation helpers. Pure (no I/O) so the append/
// remove semantics stay unit-testable without booting server.ts (which starts the
// HTTP server on import). The routes in server.ts own the I/O — read
// aggregated-cruxes.json, ensure the caller's session branch, write it back — and
// call these to mutate the parsed document in place.
//
// external_evidence is CL-owned, display-only reviewer metadata (register entry
// 1584553e): it must never be read by scoring/sort/tier code. These helpers only
// append and remove entries — they never compute over the field.

export interface CruxEvidenceEntry {
  url: string;
  note?: string;
  added_by: string;
  added_at: string;
}

interface CruxRecord {
  id?: string;
  external_evidence?: CruxEvidenceEntry[];
  [k: string]: unknown;
}

interface CruxesDoc {
  cruxes?: CruxRecord[];
  [k: string]: unknown;
}

function findCrux(data: unknown, cruxId: string): CruxRecord | null {
  const cruxes = (data as CruxesDoc | null)?.cruxes;
  if (!Array.isArray(cruxes)) return null;
  return cruxes.find(c => c && c.id === cruxId) ?? null;
}

/**
 * Append an evidence entry to a crux — append-only, existing entries are never
 * touched. Mutates `data` in place. Returns the updated crux, or null if the crux
 * id isn't present. (t/1541)
 */
export function appendCruxEvidence(data: unknown, cruxId: string, entry: CruxEvidenceEntry): CruxRecord | null {
  const crux = findCrux(data, cruxId);
  if (!crux) return null;
  if (!Array.isArray(crux.external_evidence)) crux.external_evidence = [];
  crux.external_evidence.push(entry);
  return crux;
}

/**
 * Remove the evidence entry at `index`. Mutates `data` in place. Returns the
 * updated crux, or a reason code — 'not_found' (crux id absent) / 'out_of_range'
 * (no entry at that index).
 *
 * Positional delete: under concurrent edits to the same crux, the index can shift
 * between the client's read and this delete, removing the wrong entry. This is a
 * TL-accepted tradeoff for a low-concurrency reviewer tool (t/1541); switch to
 * matching on the entry's `added_at`+`url` tuple if it ever becomes a real problem.
 */
export function removeCruxEvidence(
  data: unknown, cruxId: string, index: number,
): CruxRecord | 'not_found' | 'out_of_range' {
  const crux = findCrux(data, cruxId);
  if (!crux) return 'not_found';
  const ev = crux.external_evidence;
  if (!Array.isArray(ev) || !Number.isInteger(index) || index < 0 || index >= ev.length) return 'out_of_range';
  ev.splice(index, 1);
  return crux;
}
