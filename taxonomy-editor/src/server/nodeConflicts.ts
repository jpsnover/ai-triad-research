// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Both-edited node detection for Phase 5D (t/654).
 *
 * Given three versions of one taxonomy POV file — the merge-base, the main tip,
 * and the session-branch tip — find nodes changed on BOTH the session side and
 * the main side since the branch diverged. This is the conflict set the
 * /api/sync/node-conflicts endpoint returns; the git/IO plumbing lives in
 * server.ts, this module is pure so it can be unit-tested in isolation.
 */

import { diffNodes, changedFields } from './editMeta.js';

export interface TaxNode {
  id: string;
  _edit_meta?: { last_edited_by?: string; last_edited_at?: string };
  [k: string]: unknown;
}

export interface NodeConflict {
  /** Node id (both-edited). */
  id: string;
  /** File/POV key, e.g. 'accelerationist'. */
  pov: string;
  /** Fields changed on the session branch since the merge-base. */
  yourFields: string[];
  /** Fields changed on main since the merge-base. */
  theirFields: string[];
  /** main-side `_edit_meta.last_edited_by`, when present. */
  theirUser?: string;
  /** main-side `_edit_meta.last_edited_at` (ISO), when present. */
  theirEditedAt?: string;
}

/** Ids changed (added | modified | deleted) between two node sets. */
function changedIds(base: TaxNode[], side: TaxNode[]): Set<string> {
  const d = diffNodes(base, side);
  return new Set([...d.added, ...d.modified, ...d.deleted]);
}

/**
 * Per-side field changes vs the merge-base: a normal edit reports its changed
 * fields, an add reports all content fields, a delete reports none (no field-level
 * change to show).
 */
function sideFields(baseNode: TaxNode | undefined, sideNode: TaxNode | undefined, id: string): string[] {
  if (!sideNode) return [];
  return changedFields(
    (baseNode ?? { id }) as Parameters<typeof changedFields>[0],
    sideNode as Parameters<typeof changedFields>[1],
  );
}

/**
 * Compute the both-edited conflicts for a single POV file. Returns one entry per
 * node id that was changed on both the session branch and main relative to the
 * shared merge-base.
 */
export function computeNodeConflicts(
  baseNodes: TaxNode[],
  mainNodes: TaxNode[],
  branchNodes: TaxNode[],
  pov: string,
): NodeConflict[] {
  const yourChanged = changedIds(baseNodes, branchNodes);
  const theirChanged = changedIds(baseNodes, mainNodes);

  const baseMap = new Map(baseNodes.map(n => [n.id, n]));
  const mainMap = new Map(mainNodes.map(n => [n.id, n]));
  const branchMap = new Map(branchNodes.map(n => [n.id, n]));

  const conflicts: NodeConflict[] = [];
  for (const id of yourChanged) {
    if (!theirChanged.has(id)) continue; // both-edited only
    const mainNode = mainMap.get(id);
    const meta = mainNode?._edit_meta;
    conflicts.push({
      id,
      pov,
      yourFields: sideFields(baseMap.get(id), branchMap.get(id), id),
      theirFields: sideFields(baseMap.get(id), mainNode, id),
      ...(meta?.last_edited_by ? { theirUser: meta.last_edited_by } : {}),
      ...(meta?.last_edited_at ? { theirEditedAt: meta.last_edited_at } : {}),
    });
  }
  return conflicts;
}
