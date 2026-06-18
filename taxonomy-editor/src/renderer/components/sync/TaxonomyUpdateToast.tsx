// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Phase 5F — real-time "someone else saved" notifications for concurrent editors.
 *
 * Subscribes to `taxonomy-updated` events broadcast over the server's `/ws/events`
 * WebSocket channel (web/container builds only) and shows a transient toast:
 *   "{user} updated {N} nodes in {pov}".
 *
 * This is notification-only — NOT collaborative editing. Conflict detection (5D)
 * handles the hard cases when two people touch the same node.
 *
 * Graceful degradation (AC4 / AC5):
 *   - In Electron (single-user) the bridge's `onTaxonomyUpdated` is a no-op that
 *     never fires, so this component renders nothing.
 *   - The underlying web-bridge event socket auto-reconnects; if the WebSocket
 *     never connects, no events arrive and the UI is simply quiet.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import './TaxonomyUpdateToast.css';

/** Payload of a `taxonomy-updated` WS event (mirror in the server broadcast + bridge). */
export interface TaxonomyUpdatedEvent {
  /** Display name or id of the editor who saved. */
  user: string;
  /** Total number of nodes changed in the save. */
  nodeCount: number;
  /** Affected POV / file keys, e.g. ['accelerationist', 'safetyist']. */
  povs: string[];
}

const POV_LABELS: Record<string, string> = {
  accelerationist: 'Accelerationist',
  safetyist: 'Safetyist',
  skeptic: 'Skeptic',
  'cross-cutting': 'Cross-cutting',
  situations: 'Situations',
};

function povLabel(key: string): string {
  return POV_LABELS[key] ?? key;
}

const TOAST_TTL_MS = 8000;
const MAX_TOASTS = 4;

interface ToastItem extends TaxonomyUpdatedEvent {
  id: number;
}

export function TaxonomyUpdateToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    let counter = 0;
    let unsub: (() => void) | undefined;
    try {
      unsub = api.onTaxonomyUpdated((evt: TaxonomyUpdatedEvent) => {
        const id = ++counter;
        setToasts(prev => [...prev.slice(-(MAX_TOASTS - 1)), { ...evt, id }]);
        const timer = setTimeout(() => {
          dismiss(id);
          timers.delete(timer);
        }, TOAST_TTL_MS);
        timers.add(timer);
      });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'taxonomy-update-toast',
        level: 'debug',
        message: 'Failed to subscribe to taxonomy-updated events',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
    }

    return () => {
      try { unsub?.(); } catch { /* telemetry — silent by design */ }
      for (const t of timers) clearTimeout(t);
      timers.clear();
    };
  }, [dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div className="txupdate-toasts" role="status" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className="txupdate-toast">
          <span className="txupdate-toast-dot" aria-hidden="true" />
          <span className="txupdate-toast-text">
            <strong>{t.user}</strong> updated {t.nodeCount} node{t.nodeCount === 1 ? '' : 's'}
            {t.povs.length > 0 && <> in {t.povs.map(povLabel).join(', ')}</>}
          </span>
          <button
            className="txupdate-toast-dismiss"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
