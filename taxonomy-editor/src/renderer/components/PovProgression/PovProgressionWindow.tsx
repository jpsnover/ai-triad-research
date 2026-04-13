// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Standalone POV Progression window — popout that subscribes to the same
 * diagnostics-state IPC channel as DiagnosticsWindow and renders the
 * POV Progression timeline.
 */

import { useEffect, useState } from 'react';
import { api } from '@bridge';
import type { DebateSession } from '../../types/debate';
import { PovProgressionView } from './PovProgressionView';

export function PovProgressionWindow() {
  const [debate, setDebate] = useState<DebateSession | null>(null);
  const [nodeLabels, setNodeLabels] = useState<Map<string, string>>(new Map());

  // Apply theme — popouts don't go through MainApp which sets data-theme
  useEffect(() => {
    const root = document.documentElement;
    if (!root.getAttribute('data-theme')) {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    }
  }, []);

  // Subscribe to diagnostics state — same payload structure
  useEffect(() => {
    const unsub = api.onDiagnosticsStateUpdate((state) => {
      const s = state as { debate: DebateSession | null };
      setDebate(s.debate);
    });
    return unsub;
  }, []);

  // Load taxonomy files for label lookup
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const files = await Promise.all([
          api.loadTaxonomyFile('accelerationist').catch(() => null),
          api.loadTaxonomyFile('safetyist').catch(() => null),
          api.loadTaxonomyFile('skeptic').catch(() => null),
          api.loadTaxonomyFile('situations').catch(() => null),
        ]);
        if (cancelled) return;
        const labels = new Map<string, string>();
        for (const f of files) {
          const nodes = (f as { nodes?: Array<{ id?: string; label?: string }> } | null)?.nodes;
          if (!Array.isArray(nodes)) continue;
          for (const n of nodes) {
            if (n.id && typeof n.label === 'string') labels.set(n.id, n.label);
          }
        }
        setNodeLabels(labels);
      } catch {
        // non-fatal — chips just render without labels
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: 'var(--bg)', color: 'var(--text)',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <PovProgressionView session={debate} nodeLabels={nodeLabels} />
    </div>
  );
}
