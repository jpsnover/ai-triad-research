// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Polls /api/sync/node-conflicts and exposes the both-edited node set keyed by
 * node id, so taxonomy views can badge nodes that collide with `main`.
 *
 * Mirrors useSyncStatus: stops polling once the server reports `enabled:false`
 * (feature off / no session branch). Callers should also call `refresh()` on
 * the same triggers Sync uses — after a save and when `main_updated_available`
 * flips — to pick up new upstream commits without waiting for the poll.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { getNodeConflicts, type NodeConflict } from './nodeConflictsApi';

const POLL_INTERVAL_MS = 30_000;

export interface UseNodeConflicts {
  /** Conflicted nodes keyed by node id; empty when disabled or up to date. */
  conflicts: Map<string, NodeConflict>;
  /** Whether the backend reports the feature enabled. */
  enabled: boolean;
  /** Commits `main` is ahead of the session branch. */
  behindBy: number;
  /** Force a re-fetch (e.g. after save). */
  refresh: () => Promise<void>;
}

export function useNodeConflicts(): UseNodeConflicts {
  const [conflicts, setConflicts] = useState<Map<string, NodeConflict>>(new Map());
  const [enabled, setEnabled] = useState(false);
  const [behindBy, setBehindBy] = useState(0);
  const mountedRef = useRef(true);

  const apply = useCallback((res: Awaited<ReturnType<typeof getNodeConflicts>>) => {
    if (!mountedRef.current) return;
    setEnabled(res.enabled);
    setBehindBy(res.behind_by);
    setConflicts(new Map(res.conflicts.map((c) => [c.id, c])));
  }, []);

  const refresh = useCallback(async () => {
    apply(await getNodeConflicts());
  }, [apply]);

  useEffect(() => {
    mountedRef.current = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    void (async () => {
      const first = await getNodeConflicts();
      if (!mountedRef.current) return;
      apply(first);
      if (!first.enabled) return; // feature off — don't poll
      timer = setInterval(() => { void refresh(); }, POLL_INTERVAL_MS);
    })();

    return () => {
      mountedRef.current = false;
      if (timer) clearInterval(timer);
    };
  }, [apply, refresh]);

  return { conflicts, enabled, behindBy, refresh };
}
