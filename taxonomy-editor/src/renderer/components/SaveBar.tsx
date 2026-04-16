// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo, useEffect, useRef } from 'react';
import { nodePovFromId } from '@lib/debate';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { useSyncStatus } from '../hooks/useSyncStatus';
import { UnsyncedChangesDrawer } from './UnsyncedChangesDrawer';

function formatFileKey(key: string): string {
  if (key === 'situations') return 'Situations';
  if (key.startsWith('conflict-')) return key;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function SaveBar() {
  const { dirty, save, saveError, dismissSaveError, validationErrors, zoomLevel, zoomIn, zoomOut, zoomReset } = useTaxonomyStore();
  const isDirty = dirty.size > 0;
  const [showErrors, setShowErrors] = useState(false);
  const [syncDrawerOpen, setSyncDrawerOpen] = useState(false);
  const { status: syncStatus, refresh: refreshSync } = useSyncStatus();

  // Refresh sync status after a save completes (dirty transitions non-zero → 0).
  const prevDirtyCountRef = useRef(dirty.size);
  useEffect(() => {
    const prev = prevDirtyCountRef.current;
    const now = dirty.size;
    if (prev > 0 && now === 0 && syncStatus.enabled) {
      // Slight delay so the server-side commit has landed.
      const t = setTimeout(() => { void refreshSync(); }, 500);
      return () => clearTimeout(t);
    }
    prevDirtyCountRef.current = now;
    return undefined;
  }, [dirty.size, syncStatus.enabled, refreshSync]);

  const hasErrors = Object.keys(validationErrors).length > 0;

  const dirtyList = useMemo(() => [...dirty].map(formatFileKey).join(', '), [dirty]);

  const groupedErrors = useMemo(() => {
    const groups: Record<string, { path: string; message: string }[]> = {};
    for (const [path, message] of Object.entries(validationErrors)) {
      // path looks like "nodes.acc-goal-001.label" or "conflict-xyz.description"
      const parts = path.split('.');
      let fileKey: string;
      let fieldPath: string;
      if (parts[0] === 'nodes' && parts.length >= 3) {
        // POV / situations: nodes.NODE_ID.field
        const nodeId = parts[1];
        fileKey = nodePovFromId(nodeId) ?? 'unknown';
        fieldPath = `${nodeId} → ${parts.slice(2).join('.')}`;
      } else if (parts[0].startsWith('conflict-')) {
        fileKey = parts[0];
        fieldPath = parts.slice(1).join('.');
      } else {
        fileKey = parts[0];
        fieldPath = parts.slice(1).join('.') || parts[0];
      }
      const displayKey = formatFileKey(fileKey);
      if (!groups[displayKey]) groups[displayKey] = [];
      groups[displayKey].push({ path: fieldPath, message });
    }
    return groups;
  }, [validationErrors]);

  return (
    <div className="save-bar">
      <span className={`save-bar-status ${isDirty ? 'dirty' : ''}`}>
        {isDirty
          ? `Unsaved: ${dirtyList}`
          : 'All changes saved'}
      </span>
      {saveError && (
        <span className="save-bar-error-wrap">
          <span
            className={`save-bar-error ${hasErrors ? 'clickable' : ''}`}
            onClick={() => hasErrors && setShowErrors(v => !v)}
            title={hasErrors ? 'Click to see error details' : undefined}
          >
            {saveError}{hasErrors && (showErrors ? ' ▾' : ' ▸')}
          </span>
          <button
            type="button"
            className="save-bar-error-dismiss"
            onClick={(e) => { e.stopPropagation(); setShowErrors(false); dismissSaveError(); }}
            title="Dismiss error"
            aria-label="Dismiss error"
          >
            ×
          </button>
        </span>
      )}
      {showErrors && hasErrors && (
        <div className="save-bar-error-panel">
          {Object.entries(groupedErrors).map(([file, errs]) => (
            <div key={file} className="save-bar-error-group">
              <div className="save-bar-error-file">{file}</div>
              {errs.map((e, i) => (
                <div key={i} className="save-bar-error-item">
                  <span className="save-bar-error-path">{e.path}</span>
                  <span className="save-bar-error-msg">{e.message}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="save-bar-right">
        {syncStatus.enabled && syncStatus.unsynced_count > 0 && (
          <button
            type="button"
            className="save-bar-unsynced"
            onClick={() => setSyncDrawerOpen(true)}
            title={`${syncStatus.unsynced_count} unsynced change${syncStatus.unsynced_count === 1 ? '' : 's'} on ${syncStatus.session_branch ?? 'session branch'} — click to review`}
          >
            <span className="save-bar-unsynced-dot" aria-hidden="true" />
            {syncStatus.unsynced_count} unsynced
          </button>
        )}
        <div className="zoom-controls">
          <button className="btn btn-ghost btn-sm" onClick={zoomOut} title="Zoom out (Ctrl+-)">-</button>
          <button
            className="btn btn-ghost btn-sm zoom-level"
            onClick={zoomReset}
            title="Reset zoom (Ctrl+0)"
          >
            {zoomLevel}%
          </button>
          <button className="btn btn-ghost btn-sm" onClick={zoomIn} title="Zoom in (Ctrl+=)">+</button>
        </div>
        <button
          className="btn btn-primary"
          onClick={save}
          disabled={!isDirty}
        >
          Save
        </button>
      </div>
      <UnsyncedChangesDrawer
        open={syncDrawerOpen}
        onClose={() => setSyncDrawerOpen(false)}
        status={syncStatus}
        onChanged={() => { void refreshSync(); }}
      />
    </div>
  );
}
