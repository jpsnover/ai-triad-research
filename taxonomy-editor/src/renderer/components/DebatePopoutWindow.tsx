// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Standalone Debate popout window — opens in its own BrowserWindow,
 * initializes stores independently, and renders DebateWorkspace.
 */

import { useEffect, useState } from 'react';
import { api } from '@bridge';
import { useDebateStore } from '../hooks/useDebateStore';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { DebateWorkspace } from './DebateWorkspace';

export function DebatePopoutWindow() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeDebateId = useDebateStore(s => s.activeDebateId);

  // Apply theme — popouts don't go through MainApp which sets data-theme
  useEffect(() => {
    const root = document.documentElement;
    if (!root.getAttribute('data-theme')) {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    }
  }, []);

  // Initialize taxonomy store (needed for debate context lookups)
  useEffect(() => {
    let cancelled = false;
    useTaxonomyStore.getState().loadAll().then(() => {
      if (!cancelled) setReady(true);
    }).catch(err => {
      if (!cancelled) {
        console.error('[DebatePopout] Failed to load taxonomy:', err);
        // Non-fatal — debate can still function without taxonomy context
        setReady(true);
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Listen for debate ID from main process (Electron) or parse from URL hash (web)
  useEffect(() => {
    // Web mode: parse debate ID from hash query string
    const hash = window.location.hash;
    const idMatch = hash.match(/[?&]id=([^&]+)/);
    if (idMatch) {
      const debateId = decodeURIComponent(idMatch[1]);
      useDebateStore.getState().loadDebate(debateId).catch(err => {
        setError(`Failed to load debate: ${err}`);
      });
    }

    // Electron mode: receive debate ID via IPC
    const unsub = api.onDebateWindowLoad((debateId: string) => {
      setError(null);
      useDebateStore.getState().loadDebate(debateId).catch(err => {
        setError(`Failed to load debate: ${err}`);
      });
      // Update window title
      document.title = `Debate — ${debateId.slice(0, 8)}`;
    });
    return unsub;
  }, []);

  if (error) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg)', color: 'var(--text)', fontFamily: 'system-ui, sans-serif',
      }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <h3 style={{ color: 'var(--danger, #ef4444)' }}>Error</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{error}</p>
        </div>
      </div>
    );
  }

  if (!ready || !activeDebateId) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg)', color: 'var(--text)', fontFamily: 'system-ui, sans-serif',
      }}>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Loading debate...</p>
      </div>
    );
  }

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: 'var(--bg)', color: 'var(--text)', fontFamily: 'system-ui, sans-serif',
    }}>
      <DebateWorkspace />
    </div>
  );
}
