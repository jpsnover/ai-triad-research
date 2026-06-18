// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Client for GET /api/sync/node-conflicts (Phase 5D, t/654).
 *
 * Detects nodes the current user edited on their session branch that were
 * *also* changed on `main` since the branch diverged — "both-edited" conflicts.
 * This is informational only (t/634 AC5): it never blocks saves, and any
 * network/parse failure degrades to the disabled response so the UI simply
 * shows no badges.
 *
 * Distinct from the research-domain "conflicts" elsewhere in this directory
 * (POV-camp disagreements) — this is git edit/merge conflict detection.
 */

import { getGlobalRecorder } from '@lib/flight-recorder/index';

/** One node touched on both the session branch and `main` since divergence. */
export interface NodeConflict {
  /** Node id, e.g. `acc-belief-001`. The join key for badges. */
  id: string;
  /** File key, e.g. `accelerationist` / `safetyist` / `skeptic` / `cross-cutting` / `situations`. */
  pov: string;
  /** Fields changed on the user's session branch. */
  yourFields: string[];
  /** Fields changed on `main` since divergence. */
  theirFields: string[];
  /** Main-side `_edit_meta.last_edited_by`, when known. */
  theirUser?: string;
  /** Main-side `_edit_meta.last_edited_at` (ISO), when known. */
  theirEditedAt?: string;
}

/** Response shape locked with ServerAPI/Sync on t/654#2. */
export interface NodeConflictsResponse {
  /** False when no backend / no session branch (web-only; never fires in Electron). */
  enabled: boolean;
  session_branch: string | null;
  /** Commits `main` is ahead of the session branch (from compareBranches). */
  behind_by: number;
  conflicts: NodeConflict[];
}

export const DISABLED_NODE_CONFLICTS: NodeConflictsResponse = {
  enabled: false,
  session_branch: null,
  behind_by: 0,
  conflicts: [],
};

/**
 * Fetch the both-edited node-conflict set. Returns the disabled response on any
 * failure (server down, non-JSON, HTTP error) so callers render an empty state
 * rather than throwing into the render/save path.
 */
export async function getNodeConflicts(): Promise<NodeConflictsResponse> {
  try {
    const res = await fetch('/api/sync/node-conflicts');
    if (!res.ok) return DISABLED_NODE_CONFLICTS;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) return DISABLED_NODE_CONFLICTS;
    return (await res.json()) as NodeConflictsResponse;
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'node-conflicts-api',
      level: 'debug',
      message: 'Node-conflicts endpoint unavailable',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return DISABLED_NODE_CONFLICTS;
  }
}
