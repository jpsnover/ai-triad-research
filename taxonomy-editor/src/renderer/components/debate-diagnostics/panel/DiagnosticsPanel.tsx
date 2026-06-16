// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useCallback } from 'react';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { useDebateStore } from '../../../hooks/useDebateStore';
import { useShallow } from 'zustand/react/shallow';
import { EntryView } from './EntryView';
import { OverviewView } from './OverviewView';

export function DiagnosticsPanel() {
  const { selectedDiagEntry, selectDiagEntry, activeDebate } = useDebateStore(
    useShallow(s => ({ selectedDiagEntry: s.selectedDiagEntry, selectDiagEntry: s.selectDiagEntry, activeDebate: s.activeDebate }))
  );
  const [height, setHeight] = useState(() => {
    try { return parseInt(localStorage.getItem('diag-panel-height') || '250', 10); } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'diagnostics-panel',
        level: 'warn',
        message: 'Failed to load panel height from localStorage',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      return 250;
    }
  });
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startY.current = e.clientY;
    startH.current = height;

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startY.current - ev.clientY;
      const newH = Math.max(100, Math.min(window.innerHeight * 0.7, startH.current + delta));
      setHeight(newH);
    };
    const onMouseUp = () => {
      dragging.current = false;
      try { localStorage.setItem('diag-panel-height', String(height)); } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'diagnostics-panel',
          level: 'warn',
          message: 'Failed to save panel height to localStorage',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
      }
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [height]);

  return (
    <div className="diagnostics-panel-wrapper">
      <div className="diagnostics-resize-handle" onMouseDown={onMouseDown} />
      <div className="diagnostics-panel" style={{ height }}>
        <div className="diagnostics-panel-header">
          <h3>Debate Diagnostics</h3>
          {activeDebate && (
            <span style={{ fontSize: '0.55rem', color: 'var(--text-muted)', fontFamily: 'monospace', opacity: 0.7 }} title="Session start — matches flight recorder filename">
              {new Date(activeDebate.created_at).toISOString().replace(/\.\d{3}Z$/, 'Z')}
            </span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {selectedDiagEntry && (
              <button className="btn btn-sm" onClick={() => selectDiagEntry(null)} style={{ fontSize: '0.65rem' }}>
                Overview
              </button>
            )}
            <button className="btn btn-sm" onClick={async () => {
              await api.openDiagnosticsWindow();
              useDebateStore.getState().setDiagPopoutOpen(true);
              const debate = useDebateStore.getState().activeDebate;
              const entry = useDebateStore.getState().selectedDiagEntry;
              setTimeout(() => {
                void api.sendDiagnosticsState({ debate, selectedEntry: entry });
              }, 1000);
            }} style={{ fontSize: '0.65rem' }} title="Open in separate window">
              Popout
            </button>
            <button className="btn btn-sm" onClick={async () => {
              await api.openPovProgressionWindow();
              const debate = useDebateStore.getState().activeDebate;
              const entry = useDebateStore.getState().selectedDiagEntry;
              setTimeout(() => {
                void api.sendDiagnosticsState({ debate, selectedEntry: entry });
              }, 1000);
            }} style={{ fontSize: '0.65rem' }} title="Show how each Perspective's taxonomy context and citations evolve across turns">
              Perspective Progression
            </button>
          </div>
        </div>
        <div className="diagnostics-panel-body">
          {selectedDiagEntry ? (
            <EntryView entryId={selectedDiagEntry} />
          ) : (
            <OverviewView />
          )}
        </div>
      </div>
    </div>
  );
}
