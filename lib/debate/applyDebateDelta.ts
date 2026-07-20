// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Pure merge function for delta / incremental debate save (t/1470; ticket A).
// HLD: docs/hld-delta-debate-save.md. Shared so the server merge step and any
// client-side verification use ONE implementation (HLD Risk: "Client and server
// merge logic diverge").
//
// Exported-for-B: the future importer is Server Storage's version-aware
// read-merge-write (taxonomy-editor/src/server/storage/fileIO.ts). This file is
// pure and does no I/O; the storage layer wraps it at the blob read/write boundary
// and is where ADR-003 flight-recorder events belong. Here, the thrown
// ActionableError on a version mismatch IS the signal.

import type {
  DebateSession,
  DebateDelta,
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  ANMutation,
} from './types.js';
import { ActionableError } from './errors.js';

/**
 * Upsert `incoming` into `existing` by `id` (last-wins), then drop any id in
 * `removedIds`. Returns a new array; inputs are not mutated. Removal is applied
 * AFTER upsert so a same-id collision resolves removal-wins (HLD merge rule).
 */
function upsertByIdThenRemove<T extends { id: string }>(
  existing: readonly T[],
  incoming: readonly T[],
  removedIds?: readonly string[],
): T[] {
  const byId = new Map<string, T>();
  for (const item of existing) byId.set(item.id, item);
  for (const item of incoming) byId.set(item.id, item);
  if (removedIds) {
    for (const id of removedIds) byId.delete(id);
  }
  return Array.from(byId.values());
}

/**
 * Apply a {@link DebateDelta} to a full {@link DebateSession}, returning a new
 * session. **Pure**: never mutates its inputs and performs no I/O.
 *
 * Optimistic concurrency: the delta declares the `baseVersion` it was computed
 * against. If that does not equal the session's current `_saveVersion` (absent =
 * 0, lazy migration), the merge is rejected with an {@link ActionableError} — the
 * caller (Server Storage) maps this to an HTTP 409 so the client falls back to a
 * full PUT. We never best-effort merge a stale delta (HLD Risk: "A delta computed
 * against a stale base corrupts the doc").
 *
 * Merge order (load-bearing):
 *   1. `changedFields` shallow-overlay onto the root FIRST (per-turn analytics
 *      fields with no dedicated surface — t/1634#3 Case 3). Any `_saveVersion`
 *      inside it is ignored; the version is authoritative here.
 *   2. Structured surfaces applied AFTER, so they always win over the overlay:
 *      transcript append, argument_network node/edge upsert-then-remove, mutations
 *      append, `meta` shallow-merge.
 *   3. `_saveVersion` incremented LAST (baseVersion + 1).
 */
export function applyDebateDelta(
  fullSession: DebateSession,
  delta: DebateDelta,
): DebateSession {
  const currentVersion = fullSession._saveVersion ?? 0;

  if (delta.baseVersion !== currentVersion) {
    throw new ActionableError({
      goal: 'Apply an incremental debate-save delta to the stored session',
      problem:
        `Delta baseVersion (${delta.baseVersion}) does not match the session's ` +
        `current _saveVersion (${currentVersion}) — a concurrent write landed first, ` +
        `so this delta was computed against a stale base.`,
      location: `applyDebateDelta (lib/debate/applyDebateDelta.ts), debateId=${delta.debateId}`,
      nextSteps: [
        'Reject the delta with HTTP 409 version_conflict, returning the current _saveVersion.',
        'Client: re-read the session and fall back to a full PUT to re-establish a clean base version.',
        'Do not best-effort merge a stale delta — it would corrupt the document.',
      ],
    });
  }

  // 1. Generic overlay first (structured surfaces below override it). Strip any
  //    client-supplied _saveVersion — the version is authoritative from the guard
  //    + increment, never taken from the payload.
  const { _saveVersion: _ignoredClientVersion, ...overlay } =
    delta.changedFields ?? {};
  const merged: DebateSession = { ...fullSession, ...overlay };

  // 2a. Transcript append (append-only tail beyond base).
  if (delta.newTranscriptEntries.length > 0) {
    merged.transcript = [
      ...(fullSession.transcript ?? []),
      ...delta.newTranscriptEntries,
    ];
  }

  // 2b. Argument network: upsert nodes/edges by id (last-wins), then removals
  //     (removal-wins on a same-id collision); append mutations. Init the nested
  //     surface if the base session has none.
  const baseAN = fullSession.argument_network;
  const hasANWork =
    delta.changedNodes.length > 0 ||
    delta.changedEdges.length > 0 ||
    delta.newMutations.length > 0 ||
    (delta.removedNodeIds?.length ?? 0) > 0 ||
    (delta.removedEdgeIds?.length ?? 0) > 0;

  if (hasANWork || baseAN) {
    const baseNodes: ArgumentNetworkNode[] = baseAN?.nodes ?? [];
    const baseEdges: ArgumentNetworkEdge[] = baseAN?.edges ?? [];
    const baseMutations: ANMutation[] = baseAN?.mutations ?? [];

    merged.argument_network = {
      nodes: upsertByIdThenRemove(baseNodes, delta.changedNodes, delta.removedNodeIds),
      edges: upsertByIdThenRemove(baseEdges, delta.changedEdges, delta.removedEdgeIds),
      mutations: [...baseMutations, ...delta.newMutations],
    };
  }

  // 2c. Meta shallow-merge onto the root (title / updated_at / phase).
  if (delta.meta) {
    Object.assign(merged, delta.meta);
  }

  // 3. Version increment last — authoritative, ignores any client-supplied value.
  merged._saveVersion = delta.baseVersion + 1;

  return merged;
}
