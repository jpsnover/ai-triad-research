// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Polls /api/sync/status so the status bar can surface unsynced-change counts.
 *
 * When the server reports `enabled: false` (i.e. GIT_SYNC_ENABLED is off or the
 * data root is not a git working tree) polling stops after the first response —
 * there's nothing to show and no reason to keep hitting the server.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { getSyncStatus, type SyncStatus } from '../utils/syncApi';

const POLL_INTERVAL_MS = 10_000;

const DISABLED: SyncStatus = {
  enabled: false,
  unsynced_count: 0,
  session_branch: null,
  pr_number: null,
  push_pending: false,
};

export function useSyncStatus(): { status: SyncStatus; refresh: () => Promise<void> } {
  const [status, setStatus] = useState<SyncStatus>(DISABLED);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    const next = await getSyncStatus();
    if (mountedRef.current) setStatus(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    (async () => {
      const first = await getSyncStatus();
      if (!mountedRef.current) return;
      setStatus(first);
      if (!first.enabled) return; // don't start polling if the feature is off
      timer = setInterval(() => { void refresh(); }, POLL_INTERVAL_MS);
    })();

    return () => {
      mountedRef.current = false;
      if (timer) clearInterval(timer);
    };
  }, [refresh]);

  return { status, refresh };
}
