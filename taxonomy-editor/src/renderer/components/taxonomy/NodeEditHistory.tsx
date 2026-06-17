// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { getGlobalRecorder } from '@lib/flight-recorder/index';
import type { EditHistoryEntry, NodeEditMeta } from '../../types/taxonomy';

interface NodeEditHistoryProps {
  editMeta?: NodeEditMeta;
  editHistory?: EditHistoryEntry[];
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'NodeEditHistory',
      level: 'error',
      message: 'Failed to format timestamp',
      error: { name: (err as Error).name ?? 'Error', message: String(err) },
    });
    return iso;
  }
}

function userDisplay(userId: string): string {
  if (userId === '_local') return 'Local (Electron)';
  const atIdx = userId.indexOf('@');
  return atIdx > 0 ? userId.slice(0, atIdx) : userId;
}

export function NodeEditHistory({ editMeta, editHistory }: NodeEditHistoryProps) {
  const hasHistory = editHistory && editHistory.length > 0;
  const hasMeta = editMeta && editMeta.last_edited_by;

  if (!hasHistory && !hasMeta) {
    return (
      <div className="node-edit-history-empty">
        <p>No edit history available for this node.</p>
        <p className="node-edit-history-hint">Edit history is recorded when nodes are saved through the server.</p>
      </div>
    );
  }

  return (
    <div className="node-edit-history">
      {hasMeta && (
        <div className="node-edit-history-summary">
          <div className="node-edit-history-meta-row">
            <span className="node-edit-history-meta-label">Last edited by</span>
            <span className="node-edit-history-meta-value">{userDisplay(editMeta.last_edited_by)}</span>
            <span className="node-edit-history-meta-time">{formatTimestamp(editMeta.last_edited_at)}</span>
          </div>
          {editMeta.created_by && (
            <div className="node-edit-history-meta-row">
              <span className="node-edit-history-meta-label">Created by</span>
              <span className="node-edit-history-meta-value">{userDisplay(editMeta.created_by)}</span>
              {editMeta.created_at && (
                <span className="node-edit-history-meta-time">{formatTimestamp(editMeta.created_at)}</span>
              )}
            </div>
          )}
        </div>
      )}

      {hasHistory && (
        <div className="node-edit-history-list">
          <div className="node-edit-history-list-header">
            <span>Edit log ({editHistory.length} entries)</span>
          </div>
          <div className="node-edit-history-entries">
            {[...editHistory].reverse().map((entry, i) => (
              <div key={i} className="node-edit-history-entry">
                <div className="node-edit-history-entry-header">
                  <span className="node-edit-history-entry-user">{userDisplay(entry.user)}</span>
                  <span className="node-edit-history-entry-time">{formatTimestamp(entry.timestamp)}</span>
                </div>
                <div className="node-edit-history-entry-fields">
                  {entry.fields_changed.map(f => (
                    <span key={f} className="node-edit-history-field-chip">
                      {f === '*' ? 'Created' : f}
                    </span>
                  ))}
                </div>
                {entry.summary && (
                  <div className="node-edit-history-entry-summary">{entry.summary}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
