// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Cross-transport entity-resolution helpers (t/1974). Factored out of
// server/routes/entity.ts so the server route, the desktop IPC handler
// (main/ipc/entityHandlers.ts), and the renderer share ONE copy of the
// merge-tombstone follow + polymorphic-field coercion instead of hand-synced
// mirrors (TL flag t/1898#12; ServerAPI p/78#24). Pure — depends only on
// ActionableError and the Entity type, with no transport coupling. The DI seam
// (resolveMergedInto takes an injected sync `lookup`) lets both the async server
// registry and the sync desktop file read reuse the same resolver.

import { ActionableError } from '../debate/errors.js';
import type { Entity } from './types.js';

/**
 * Coerce a polymorphic string-array field to a real `string[]` at the read boundary.
 * entities.json stores `aliases` and `source_refs` in THREE shapes (t/1964 / Design
 * field audit t/1882#7): array | null | bare string — e.g. aliases `["OAI"]` | `null` |
 * `"GDPR"`, source_refs `["doc-1"]` | `"doc-1"`. A null crashes `.some`/`.length`; a bare
 * string crashes `.map`/`.join` and renders its first character on `[0]`. Normalize here
 * so no downstream consumer (server route, desktop IPC, renderer) ever sees either.
 * array→as-is · null/undefined→[] · string→single-element.
 */
export function coerceStringArray(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : v == null ? [] : [v as string];
}

/**
 * Normalize an Entity's polymorphic string-array fields (`aliases`, `source_refs`) at
 * the read boundary. The genus audit (t/1964#3, Design t/1882#7) bounds the coercion set
 * to exactly these two fields — every other UI-rendered field is single-shape.
 */
export function normalizeEntity(e: Entity): Entity {
  return { ...e, aliases: coerceStringArray(e.aliases), source_refs: coerceStringArray(e.source_refs) };
}

export interface MergedIntoResult {
  /** The terminal (non-tombstone) record the chain resolves to. */
  record: Entity;
  /** The originally-requested id, set only when ≥1 merge pointer was followed. */
  redirectedFrom?: string;
}

/**
 * Follow an Entity's single canonical `merged_into` tombstone pointer (Section 7)
 * to the terminal record, recording the original id as `redirectedFrom` once any
 * hop is taken. Returns null if any id in the chain is absent. Throws
 * {@link ActionableError} on a cycle or when the chain exceeds `maxDepth` — both
 * indicate corrupt merge data, not a deep-but-valid graph. Organizations have NO
 * merged_into, so this is entity-only.
 */
export function resolveMergedInto(
  id: string,
  lookup: (id: string) => Entity | null | undefined,
  opts: { maxDepth: number },
): MergedIntoResult | null {
  const seen = new Set<string>();
  let currentId = id;
  let redirectedFrom: string | undefined;

  for (let depth = 0; depth <= opts.maxDepth; depth++) {
    if (seen.has(currentId)) {
      throw new ActionableError({
        goal: 'Resolve a merged entity to its canonical record',
        problem: `merged_into chain forms a cycle at "${currentId}" (started from "${id}")`,
        location: 'lib/entities/entityResolve.ts → resolveMergedInto',
        nextSteps: [
          'Inspect entities.json for a merged_into loop (A→B→A) starting at this id',
          'Break the cycle so exactly one record in the chain has no merged_into',
        ],
      });
    }
    seen.add(currentId);

    const rec = lookup(currentId);
    if (!rec) return null; // a hop points at a missing id → unresolved
    if (!rec.merged_into) return { record: rec, redirectedFrom };

    redirectedFrom = redirectedFrom ?? id; // first hop: remember where we started
    currentId = rec.merged_into;
  }

  throw new ActionableError({
    goal: 'Resolve a merged entity to its canonical record',
    problem: `merged_into chain from "${id}" exceeded the depth cap (${opts.maxDepth})`,
    location: 'lib/entities/entityResolve.ts → resolveMergedInto',
    nextSteps: [
      'Verify the merge graph is a short chain, not a deep or unbounded one',
      `If a legitimately long chain exists, raise MAX_MERGE_DEPTH (currently ${opts.maxDepth})`,
    ],
  });
}
