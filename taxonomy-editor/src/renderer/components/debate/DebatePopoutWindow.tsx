// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Standalone Debate popout window — opens in its own BrowserWindow,
 * initializes stores independently, and renders DebateWorkspace.
 */

import { useEffect, useState, useCallback } from 'react';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { useDebateStore } from '../../hooks/useDebateStore';
import { markAsPopout } from '../../hooks/useDebateStore/shared/guards';
import { usePopoutTheme } from '../../hooks/usePopoutTheme';
import { useTheoryLinkHotkey } from '../../hooks/useTheoryLinkHotkey';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import { DebateWorkspace } from '../debate-workspace';
import { parseDebateHash, shouldShowLoadError, type DebateLoadTarget } from './popoutLoad';
import { useBriefTimeoutEvents } from './useBriefTimeoutEvents';
import { BriefTimeoutToast } from './BriefTimeoutToast';
import { BriefTimeoutDialog } from './BriefTimeoutDialog';
import './DebatePopoutWindow.css';

export function DebatePopoutWindow() {
  usePopoutTheme();
  useTheoryLinkHotkey(); // F1-to-nearest must work in the popout document too (t/2343)
  useEffect(() => { markAsPopout(); }, []);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeDebateId = useDebateStore(s => s.activeDebateId);
  const { toastData, dialogData, dismissToast, dismissDialog, retryWithModel, promoteToDiag } =
    useBriefTimeoutEvents(activeDebateId);
  const debateError = useDebateStore(s => s.debateError);
  // Remember what to (re)load so the error screen's "Try Again" can re-attempt it (t/941).
  const [loadTarget, setLoadTarget] = useState<DebateLoadTarget | null>(null);
  const [retrying, setRetrying] = useState(false);

  const runLoad = useCallback(async (debateId: string, community: boolean) => {
    setError(null);
    if (community) {
      try {
        const raw = await api.loadCommunityDebateSession(debateId);
        if (raw && typeof raw === 'object' && 'found' in (raw as Record<string, unknown>) && !(raw as Record<string, unknown>).found) {
          setError('Community debate not found');
          return;
        }
        useDebateStore.getState().loadDebateFromData(raw, { readOnly: true });
      } catch (err) {
        getGlobalRecorder()?.record({ type: 'state.error', component: 'debatePopout', level: 'error', message: 'Failed to load community debate', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack }, data: { debateId } });
        setError(`Failed to load community debate: ${err}`);
      }
    } else {
      // loadDebate() clears debateError on entry and catches internally (no rethrow),
      // so re-calling it on retry re-runs cleanly; debateError is what renders on failure.
      try {
        await useDebateStore.getState().loadDebate(debateId);
        const title = useDebateStore.getState().activeDebate?.title;
        document.title = title ? `Debate — ${title}` : `Debate — ${debateId.slice(0, 8)}`;
      } catch (err) {
        getGlobalRecorder()?.record({ type: 'state.error', component: 'debatePopout', level: 'error', message: 'Failed to load debate', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack }, data: { debateId } });
        setError(`Failed to load debate: ${err}`);
      }
    }
  }, []);

  const handleRetry = useCallback(async () => {
    if (!loadTarget || retrying) return;
    setRetrying(true);
    await runLoad(loadTarget.id, loadTarget.community);
    setRetrying(false);
  }, [loadTarget, retrying, runLoad]);

  const handleDismiss = useCallback(() => {
    setError(null);
    useDebateStore.getState().setError(null);
  }, []);

  // Initialize taxonomy store (needed for debate context lookups)
  useEffect(() => {
    let cancelled = false;
    useTaxonomyStore.getState().loadAll().then(() => {
      if (!cancelled) setReady(true);
    }).catch(err => {
      if (!cancelled) {
        getGlobalRecorder()?.record({ type: 'state.error', component: 'debatePopout', level: 'warn', message: 'Failed to load taxonomy in popout — non-fatal', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
        setReady(true);
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Listen for debate ID from main process (Electron) or parse from URL hash (web)
  useEffect(() => {
    // Web mode: parse debate ID from hash query string
    const target = parseDebateHash(window.location.hash);
    if (target) {
      setLoadTarget(target);
      void runLoad(target.id, target.community);
    }

    // Electron mode: receive debate ID via IPC
    // Also check if the main process already sent the ID before we mounted
    // (can happen with the bootstrap indirection — did-finish-load fires before React mounts)
    const unsub = api.onDebateWindowLoad((debateId: string) => {
      setLoadTarget({ id: debateId, community: false });
      void runLoad(debateId, false);
    });

    return unsub;
  }, [runLoad]);

  // Only take over the whole window for load/startup failures (no debate loaded yet).
  // Once a debate is active, transient errors (rate-limits, etc.) render inline in
  // DebateWorkspace's action bar with context-aware Retry/Dismiss (t/953) — the popout
  // must not hijack the screen with a full-page error, which is what the tester hit.
  const displayError = error || debateError;
  if (shouldShowLoadError(displayError, activeDebateId)) {
    return (
      <div className="debate-popout-fullscreen">
        <div className="debate-popout-error-box">
          <h3 className="debate-popout-error-title">Error</h3>
          <p className="debate-popout-hint">{displayError}</p>
          <div className="debate-popout-error-actions">
            {loadTarget && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleRetry()}
                disabled={retrying}
              >
                {retrying ? 'Retrying…' : 'Try Again'}
              </button>
            )}
            <button
              type="button"
              className="btn"
              onClick={handleDismiss}
              disabled={retrying}
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!ready || !activeDebateId) {
    return (
      <div className="debate-popout-fullscreen">
        <p className="debate-popout-hint">Loading debate...</p>
      </div>
    );
  }

  return (
    <div className="debate-popout-shell">
      <DebateWorkspace />
      {toastData && (
        <BriefTimeoutToast
          speakerLabel={toastData.speakerLabel}
          attempt={toastData.attempt}
          maxAttempts={toastData.maxAttempts}
          currentModel={toastData.currentModel}
          onSwitchModel={promoteToDiag}
          onDismiss={dismissToast}
        />
      )}
      {dialogData && (
        <BriefTimeoutDialog
          speakerLabel={dialogData.speakerLabel}
          totalAttempts={dialogData.totalAttempts}
          currentModel={dialogData.currentModel}
          onRetry={retryWithModel}
          onAbort={dismissDialog}
        />
      )}
    </div>
  );
}
