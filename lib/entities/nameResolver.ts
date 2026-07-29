// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Pure name→entity resolver (Phase 2 DAG node D1, epic t/1890; design-of-record §5).
// Given a surface name/alias, resolve it to an `entity_ref` or refuse. Three steps:
//   1. alias-first — deterministic exact match over APPROVED entities (high precision);
//   2. embedding tie-break — ONLY to break an alias collision the table already raised,
//      never an open nearest-neighbor (t/1881: name vectors do not separate siblings on
//      this corpus; an open-NN's error is an unrecoverable wrong-link, so a no-alias-hit
//      name is a curation gap, not something fuzzy NN should paper over — TL t/1896#2);
//   3. refusal on ambiguity — ambiguous stays unlinked rather than guessed (§5).
//
// PURE: no I/O, no embedding-model call. The caller (D2 / ServerAPI) filters to approved
// records, loads entity_embeddings.json, and computes the query context vector.

import type { EntityRef } from './types.js';
import { parseEntityRef } from './types.js';
import { cosineSimilarity } from '../embeddings/similarity.js';

/**
 * Resolution-seam cosine floor. Reuses the §7 entity-linking cosine (0.60, stipulated,
 * mirrors org-stance) — registered in metric-provenance-register.md; NOT a new scalar.
 */
export const ENTITY_RESOLUTION_MIN_COSINE = 0.60;
/**
 * Separation guard: the top candidate must beat the runner-up by at least this much, else
 * a weakly-separated collision refuses rather than guesses. NEW stipulated resolution-seam
 * threshold (distinct from t/1881's advisory dedup-surfacing threshold). Only ever fires in
 * the alias-collision case (>=2 exact matches), so its risk surface is tiny by construction.
 */
export const ENTITY_RESOLUTION_MARGIN = 0.05;

// Whitespace code points collapsed by normalizeName — pinned as an explicit set so the rule
// is byte-for-byte reproducible in the PowerShell indexer (t/1894), independent of any regex
// engine's whitespace definition: TAB, LF, VT, FF, CR, SPACE, NBSP.
const WHITESPACE_CODES = new Set<number>([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0]);

/**
 * Canonical name normalization. **Load-bearing cross-consumer contract (TL t/1896#2 cond. 1):**
 * the indexer (t/1894) matches aliases at index time and MUST apply this identical rule, or an
 * indexed name won't match a query-time resolution and mentions silently fail to link.
 *
 * Rule, in order: Unicode NFC -> lowercase (Unicode-default / invariant, locale-independent) ->
 * collapse each run of {@link WHITESPACE_CODES} to a single U+0020 -> trim (drop leading and
 * trailing whitespace). Deliberately NO stemming, NO diacritic folding, NO punctuation
 * stripping — widening the match would violate §5 refusal discipline (e.g. an accented name
 * matches only its accented form).
 */
export function normalizeName(raw: string): string {
  const lowered = raw.normalize('NFC').toLowerCase();
  let out = '';
  let pendingSpace = false;
  for (const ch of lowered) {
    if (WHITESPACE_CODES.has(ch.codePointAt(0) as number)) {
      // Defer emitting a separator: a run collapses to one space, and a trailing run to none.
      if (out.length > 0) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      out += ' ';
      pendingSpace = false;
    }
    out += ch;
  }
  return out;
}

/** A surface mention to resolve. `contextVector` (the mention's embedded context) is only
 *  consulted to break an alias collision; alias-first needs no vector. */
export interface NameQuery {
  name: string;
  contextVector?: number[];
}

/** Minimal view of an APPROVED entity the resolver needs. The caller is responsible for
 *  filtering to `status === 'approved'` and excluding `merged_into` tombstones — D1 never
 *  walks the merge chain (that is getEntity's job). `id` is a raw token (`ent-*` / `org-*`). */
export interface ApprovedEntityView {
  id: string;
  name: string;
  aliases: string[];
}

/**
 * Outcome of a resolution. A miss is a designed result, never an exception:
 * - `resolved` — `ref` + `via` set (`score` when via `embedding`);
 * - `ambiguous` — an alias collision could not be broken; `candidates` carries the colliding
 *   refs for curation;
 * - `unresolved` — no alias hit at all (curation gap) or an empty query.
 */
export interface NameResolution {
  status: 'resolved' | 'ambiguous' | 'unresolved';
  ref?: EntityRef;
  via?: 'alias' | 'embedding';
  score?: number;
  candidates?: EntityRef[];
}

function refsOf(entities: ApprovedEntityView[]): EntityRef[] {
  const refs: EntityRef[] = [];
  for (const e of entities) {
    const ref = parseEntityRef(e.id);
    if (ref) refs.push(ref);
  }
  return refs;
}

/**
 * Resolve a surface name to an {@link EntityRef}, or refuse. Pure. See file header for the
 * three-step contract. `getVector` maps an entity id to its approved name+description vector
 * (entity_embeddings.json), returning undefined when absent.
 */
export function resolveEntityName(
  query: NameQuery,
  approved: ApprovedEntityView[],
  getVector: (id: string) => number[] | undefined,
  opts?: { minCosine?: number; margin?: number },
): NameResolution {
  const minCosine = opts?.minCosine ?? ENTITY_RESOLUTION_MIN_COSINE;
  const margin = opts?.margin ?? ENTITY_RESOLUTION_MARGIN;

  const q = normalizeName(query.name);
  if (!q) return { status: 'unresolved' };

  // Step 1 — alias-first: exact normalized match on name or any alias.
  const matches: ApprovedEntityView[] = [];
  for (const e of approved) {
    if (normalizeName(e.name) === q) {
      matches.push(e);
      continue;
    }
    for (const a of e.aliases) {
      if (normalizeName(a) === q) {
        matches.push(e);
        break;
      }
    }
  }

  if (matches.length === 0) {
    // No alias hit → curation gap. Refuse; the §7 re-index links it once an alias is added.
    return { status: 'unresolved' };
  }

  if (matches.length === 1) {
    const ref = parseEntityRef(matches[0].id);
    return ref ? { status: 'resolved', ref, via: 'alias' } : { status: 'unresolved' };
  }

  // Step 2 — alias collision (>=2). Embedding tie-break AMONG the colliding candidates only.
  const cv = query.contextVector;
  if (!cv || cv.length === 0) {
    return { status: 'ambiguous', candidates: refsOf(matches) };
  }

  const scored: { ref: EntityRef; score: number }[] = [];
  for (const e of matches) {
    const ref = parseEntityRef(e.id);
    const vec = getVector(e.id);
    if (!ref || !vec) continue;
    scored.push({ ref, score: cosineSimilarity(cv, vec) });
  }

  // Every colliding candidate must be scoreable — we cannot assert separation from a
  // candidate we could not rank, so a missing vector refuses rather than risks a wrong link.
  if (scored.length !== matches.length) {
    return { status: 'ambiguous', candidates: refsOf(matches) };
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const runnerUp = scored[1].score; // matches.length >= 2 and all scoreable => exists

  if (top.score >= minCosine && top.score - runnerUp >= margin) {
    return { status: 'resolved', ref: top.ref, via: 'embedding', score: top.score };
  }
  return { status: 'ambiguous', candidates: refsOf(matches) };
}
