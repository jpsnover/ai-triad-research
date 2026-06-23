// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useMemo } from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import type { EditHistoryEntry, NodeEditMeta, TextHistoryEntry } from '../../types/taxonomy';

interface NodeEditHistoryProps {
  editMeta?: NodeEditMeta;
  editHistory?: EditHistoryEntry[];
  descriptionHistory?: TextHistoryEntry[];
  labelHistory?: TextHistoryEntry[];
}

interface MergedEntry {
  date: string;
  user?: string;
  fields_changed: string[];
  source?: string;
  debate_id?: string;
  reason?: string;
  summary?: string;
  kind: 'edit' | 'text';
  field?: string;
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
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return iso;
  }
}

function userDisplay(userId: string): string {
  if (userId === '_local') return 'Local (Electron)';
  const atIdx = userId.indexOf('@');
  return atIdx > 0 ? userId.slice(0, atIdx) : userId;
}

function sourceLabel(source: string): string {
  if (source === 'debate_reflection') return 'Debate Reflection';
  if (source === 'batch_audit') return 'Batch Audit';
  return source;
}

function sourceBadgeClass(source: string): string {
  if (source === 'debate_reflection') return 'debate-reflection';
  if (source === 'batch_audit') return 'batch-audit';
  return '';
}

function mergeTimelines(
  editHistory: EditHistoryEntry[] | undefined,
  descHistory: TextHistoryEntry[] | undefined,
  labelHistory: TextHistoryEntry[] | undefined,
): MergedEntry[] {
  const entries: MergedEntry[] = [];
  const coveredDates = new Set<string>();

  for (const e of editHistory ?? []) {
    entries.push({
      date: e.timestamp,
      user: e.user,
      fields_changed: e.fields_changed,
      source: e.source,
      debate_id: e.debate_id,
      reason: e.reason,
      summary: e.summary,
      kind: 'edit',
    });
    coveredDates.add(e.timestamp.slice(0, 10));
  }

  // Add text history entries that bring new information (debate source/reason)
  // not already present in _edit_history. Skip 'initial' entries and plain
  // 'interactive' entries that would just duplicate the _edit_history view.
  for (const [field, hist] of [['description', descHistory], ['label', labelHistory]] as const) {
    for (const t of hist ?? []) {
      if (!t.source || t.source === 'initial' || t.source === 'interactive') continue;

      // Skip if an _edit_history entry on the same date already carries this source
      const dateKey = t.date.slice(0, 10);
      const alreadyCovered = entries.some(e =>
        e.kind === 'edit' && e.date.slice(0, 10) === dateKey && e.source === t.source
        && e.debate_id === t.debate_id
      );
      if (alreadyCovered) continue;

      entries.push({
        date: t.date,
        fields_changed: [field],
        source: t.source,
        debate_id: t.debate_id,
        reason: t.reason,
        kind: 'text',
        field,
      });
    }
  }

  entries.sort((a, b) => b.date.localeCompare(a.date));
  return entries;
}

export function NodeEditHistory({ editMeta, editHistory, descriptionHistory, labelHistory }: NodeEditHistoryProps) {
  const merged = useMemo(
    () => mergeTimelines(editHistory, descriptionHistory, labelHistory),
    [editHistory, descriptionHistory, labelHistory],
  );
  const hasMeta = editMeta && editMeta.last_edited_by;

  if (merged.length === 0 && !hasMeta) {
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

      {merged.length > 0 && (
        <div className="node-edit-history-list">
          <div className="node-edit-history-list-header">
            <span>Edit log ({merged.length} entries)</span>
          </div>
          <div className="node-edit-history-entries">
            {merged.map((entry, i) => (
              <div key={i} className="node-edit-history-entry">
                <div className="node-edit-history-entry-header">
                  {entry.user && (
                    <span className="node-edit-history-entry-user">{userDisplay(entry.user)}</span>
                  )}
                  {entry.source && entry.source !== 'interactive' && entry.source !== 'initial' && (
                    <span className={`node-edit-history-source-badge ${sourceBadgeClass(entry.source)}`}>
                      {sourceLabel(entry.source)}
                    </span>
                  )}
                  <span className="node-edit-history-entry-time">{formatTimestamp(entry.date)}</span>
                </div>
                <div className="node-edit-history-entry-fields">
                  {entry.fields_changed.map(f => (
                    <span key={f} className="node-edit-history-field-chip">
                      {f === '*' ? 'Created' : f}
                    </span>
                  ))}
                </div>
                {entry.reason && (
                  <div className="node-edit-history-entry-reason">{entry.reason}</div>
                )}
                {entry.debate_id && (
                  <div className="node-edit-history-entry-debate-id">Debate: {entry.debate_id.slice(0, 8)}…</div>
                )}
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
