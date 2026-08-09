// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Standalone POV Progression window — popout that subscribes to the same
 * diagnostics-state IPC channel as DiagnosticsWindow and renders the
 * POV Progression timeline.
 */

import { useEffect, useState } from 'react';
import './PovProgressionWindow.css';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { usePopoutTheme } from '../../hooks/usePopoutTheme';
import type { DebateSession } from '../../types/debate';
import { PovProgressionView } from './PovProgressionView';

export function PovProgressionWindow() {
  const [debate, setDebate] = useState<DebateSession | null>(null);
  const [nodeLabels, setNodeLabels] = useState<Map<string, string>>(new Map());

  // Apply the selected theme + live-update — popouts don't go through MainApp (t/2338).
  usePopoutTheme();

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
    void (async () => {
      try {
        const files = await Promise.all([
          api.loadTaxonomyFile('accelerationist').catch((err) => { getGlobalRecorder()?.record({ type: 'system.error', component: 'pov-progression', level: 'warn', message: 'Failed to load accelerationist taxonomy', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); return null; }),
          api.loadTaxonomyFile('safetyist').catch((err) => { getGlobalRecorder()?.record({ type: 'system.error', component: 'pov-progression', level: 'warn', message: 'Failed to load safetyist taxonomy', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); return null; }),
          api.loadTaxonomyFile('skeptic').catch((err) => { getGlobalRecorder()?.record({ type: 'system.error', component: 'pov-progression', level: 'warn', message: 'Failed to load skeptic taxonomy', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); return null; }),
          api.loadTaxonomyFile('situations').catch((err) => { getGlobalRecorder()?.record({ type: 'system.error', component: 'pov-progression', level: 'warn', message: 'Failed to load situations taxonomy', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); return null; }),
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
      } catch (err) {
        // non-fatal — chips just render without labels
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'pov-progression',
          level: 'debug',
          message: 'Failed to load taxonomy files for node label lookup',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="pov-progression-window-root">
      <PovProgressionView session={debate} nodeLabels={nodeLabels} />
    </div>
  );
}
