// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Calibration Curation — admin-only panel for promoting per-user calibration
 * data into the authoritative core files (or rejecting it).
 *
 * Renders only for admins in web mode. Backed by the admin curation endpoints
 * (see server t/643): pending entries are read from `calibration/users/*`,
 * subtracting anything already recorded in `integration-log.jsonl`. Promote
 * appends to `calibration/core/calibration-log.jsonl`; reject writes an audit
 * record only — user files are never modified.
 *
 * Edit-on-promote: the promote endpoint accepts an `edits` map (debate_id →
 * partial patch) shallow-merged onto the core copy before write (t/644#3). The
 * panel exposes the dominant lineage-frame label as the editable field so an
 * admin can correct a miscategorized topic before it lands in core. The user
 * source log is never mutated.
 *
 * Interim implementation: this standalone panel stays live until the unified
 * admin-review framework (t/648 shell + t/647 calibration handler) ships, at
 * which point its body is refactored into a `CalibrationReviewViewer` consuming
 * the unified ReviewItem/ReviewAction contract (seam confirmed in t/644#2/#3).
 */

import { useState, useCallback } from 'react';
import { useUserProfile } from '../../hooks/useAuthStatus';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import './CalibrationAdmin.css';

// ── Types (subset of CalibrationDataPoint relevant to the preview) ──

export interface LineageFrame {
  cluster_id: string;
  label: string;
  percentage: number;
}

export interface PendingEntry {
  debate_id: string;
  timestamp?: string;
  origin?: string;
  model?: string;
  rounds?: number;
  crux_addressed_ratio?: number | null;
  avg_utilization_rate?: number | null;
  lineage_frame?: LineageFrame[] | null;
  [key: string]: unknown;
}

export interface PendingGroup {
  /** The user directory name under calibration/users/. */
  origin: string;
  /** "users/{origin}" — the source string the promote/reject endpoints expect. */
  source: string;
  entries: PendingEntry[];
}

/** debate_id → partial patch shallow-merged onto the core copy before write. */
export type PromoteEdits = Record<string, Record<string, unknown>>;

// ── Server calls (web-only admin endpoints) ──

async function fetchPending(): Promise<PendingGroup[]> {
  const res = await fetch('/api/admin/calibration/pending');
  if (!res.ok) throw new Error(`GET pending failed: HTTP ${res.status}`);
  const data = (await res.json()) as { groups?: PendingGroup[] };
  return data.groups ?? [];
}

async function postPromote(
  source: string,
  entryIds: string[],
  edits?: PromoteEdits,
  notes?: string,
): Promise<{ promoted: number; edited?: string[] }> {
  const res = await fetch('/api/admin/calibration/promote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source,
      entryIds,
      ...(edits && Object.keys(edits).length > 0 ? { edits } : {}),
      ...(notes ? { notes } : {}),
    }),
  });
  if (!res.ok) throw new Error(`promote failed: HTTP ${res.status}`);
  return res.json() as Promise<{ promoted: number; edited?: string[] }>;
}

async function postReject(source: string, entryIds: string[], reason: string): Promise<{ rejected: number }> {
  const res = await fetch('/api/admin/calibration/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, entryIds, reason }),
  });
  if (!res.ok) throw new Error(`reject failed: HTTP ${res.status}`);
  return res.json() as Promise<{ rejected: number }>;
}

function record(message: string, err: unknown): void {
  getGlobalRecorder()?.record({
    type: 'system.error',
    component: 'calibration-admin',
    level: 'error',
    message,
    error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
  });
}

// ── Helpers ──

const entryKey = (source: string, debateId: string) => `${source}|${debateId}`;

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; /* display fallback — silent by design */ }
}

function fmtMetric(v: number | null | undefined): string {
  return v == null ? '—' : v.toFixed(2);
}

/** Dominant lineage-frame label for an entry, or '' if none. */
function dominantLabel(entry: PendingEntry): string {
  return entry.lineage_frame?.[0]?.label ?? '';
}

/**
 * Build the `lineage_frame` patch value for a corrected label. Relabels the
 * dominant frame when one exists; otherwise writes a single manual frame.
 */
function patchedFrame(entry: PendingEntry, label: string): LineageFrame[] {
  const frames = entry.lineage_frame;
  if (Array.isArray(frames) && frames.length > 0) {
    return [{ ...frames[0], label }, ...frames.slice(1)];
  }
  return [{ cluster_id: 'manual-override', label, percentage: 100 }];
}

// ── Entry row ──

function EntryRow({ entry, source, checked, onToggle, editing, editedLabel, onToggleEdit, onLabelChange }: {
  entry: PendingEntry;
  source: string;
  checked: boolean;
  onToggle: () => void;
  editing: boolean;
  /** Corrected label, or undefined if untouched. */
  editedLabel: string | undefined;
  onToggleEdit: () => void;
  onLabelChange: (value: string) => void;
}) {
  const original = dominantLabel(entry);
  const isEdited = editedLabel !== undefined && editedLabel.trim() !== original;
  const shown = editedLabel ?? original;

  return (
    <div className="cal-adm-entry-wrap">
      <div className="cal-adm-entry">
        <label className="cal-adm-entry-main">
          <input type="checkbox" checked={checked} onChange={onToggle} />
          <span className="cal-adm-entry-id" title={entry.debate_id}>{entry.debate_id.slice(0, 12)}</span>
          <span className="cal-adm-entry-model">{entry.model || '—'}</span>
          <span className="cal-adm-entry-meta">{entry.rounds ?? '—'} rds</span>
          <span className="cal-adm-entry-meta">crux {fmtMetric(entry.crux_addressed_ratio)}</span>
          <span className="cal-adm-entry-meta">util {fmtMetric(entry.avg_utilization_rate)}</span>
          <span className="cal-adm-entry-frame" title={shown || 'no lineage frame'}>{shown || '—'}</span>
          {isEdited && <span className="cal-adm-edited">edited</span>}
          <span className="cal-adm-entry-date">{fmtDate(entry.timestamp)}</span>
        </label>
        <button className="cal-adm-edit-btn" onClick={onToggleEdit} title="Correct lineage topic before promoting">
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>
      {editing && (
        <div className="cal-adm-editor">
          <label className="cal-adm-editor-field">
            Lineage topic
            <input
              type="text"
              value={shown}
              placeholder="Corrected topic label (applied to core copy only)"
              onChange={e => onLabelChange(e.target.value)}
            />
          </label>
          {original && <span className="cal-adm-editor-orig">was: {original}</span>}
        </div>
      )}
    </div>
  );
}

// ── Main component ──

export function CalibrationAdmin() {
  const profile = useUserProfile();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<PendingGroup[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // entryKey currently showing its inline editor.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  // entryKey → corrected dominant lineage label.
  const [labelEdits, setLabelEdits] = useState<Record<string, string>>({});

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const g = await fetchPending();
      setGroups(g);
      setSelected(new Set());
      setLabelEdits({});
      setEditingKey(null);
      setLoaded(true);
    } catch (err) {
      record('Failed to load pending calibration entries', err);
      setError('Could not load pending entries. Check that you are signed in as an admin.');
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleOpen = useCallback(() => {
    setOpen(prev => {
      const next = !prev;
      if (next && !loaded && !loading) void load();
      return next;
    });
  }, [loaded, loading, load]);

  const toggleEntry = useCallback((source: string, debateId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      const k = entryKey(source, debateId);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }, []);

  /** Selected debate_ids belonging to a single source. */
  const selectedFor = useCallback((source: string): string[] => {
    const prefix = `${source}|`;
    return Array.from(selected)
      .filter(k => k.startsWith(prefix))
      .map(k => k.slice(prefix.length));
  }, [selected]);

  const totalPending = groups.reduce((sum, g) => sum + g.entries.length, 0);

  /** Assemble the edits map for the given source + promoted ids (only changed labels). */
  const buildEdits = useCallback((group: PendingGroup, ids: string[]): PromoteEdits => {
    const out: PromoteEdits = {};
    const byId = new Map(group.entries.map(e => [e.debate_id, e]));
    for (const id of ids) {
      const entry = byId.get(id);
      if (!entry) continue;
      const edited = labelEdits[entryKey(group.source, id)];
      if (edited === undefined) continue;
      const trimmed = edited.trim();
      if (!trimmed || trimmed === dominantLabel(entry)) continue;
      out[id] = { lineage_frame: patchedFrame(entry, trimmed) };
    }
    return out;
  }, [labelEdits]);

  const promote = useCallback(async (group: PendingGroup, entryIds: string[]) => {
    if (entryIds.length === 0) return;
    setBusy(true);
    try {
      const edits = buildEdits(group, entryIds);
      const { promoted, edited } = await postPromote(group.source, entryIds, edits);
      const editedNote = edited && edited.length > 0 ? ` (${edited.length} edited)` : '';
      flash(`Promoted ${promoted} entr${promoted === 1 ? 'y' : 'ies'} to core${editedNote}`);
      await load();
    } catch (err) {
      record('Failed to promote calibration entries', err);
      flash('Promote failed — see flight recorder');
    } finally {
      setBusy(false);
    }
  }, [buildEdits, flash, load]);

  const reject = useCallback(async (source: string, entryIds: string[]) => {
    if (entryIds.length === 0) return;
    if (!reason.trim()) { flash('Enter a rejection reason first'); return; }
    setBusy(true);
    try {
      const { rejected } = await postReject(source, entryIds, reason.trim());
      flash(`Rejected ${rejected} entr${rejected === 1 ? 'y' : 'ies'}`);
      setReason('');
      await load();
    } catch (err) {
      record('Failed to reject calibration entries', err);
      flash('Reject failed — see flight recorder');
    } finally {
      setBusy(false);
    }
  }, [reason, flash, load]);

  // Admin-only, web-only. useUserProfile returns null outside web mode, so this
  // also hides the panel in Electron builds.
  if (!profile?.isAdmin) return null;

  return (
    <div className="cal-adm">
      <button className="cal-adm-toggle" onClick={toggleOpen} aria-expanded={open}>
        <span className="cal-adm-caret">{open ? '▾' : '▸'}</span>
        Calibration Curation
        {loaded && <span className="cal-adm-badge">{totalPending} pending · {groups.length} user{groups.length === 1 ? '' : 's'}</span>}
      </button>

      {open && (
        <div className="cal-adm-body">
          <div className="cal-adm-bar">
            <button className="btn btn-sm" onClick={() => void load()} disabled={loading || busy}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            <input
              className="cal-adm-reason"
              placeholder="Rejection reason (required to reject)"
              value={reason}
              onChange={e => setReason(e.target.value)}
              disabled={busy}
            />
          </div>

          {toast && <div className="cal-adm-toast">{toast}</div>}
          {error && <div className="cal-adm-error">{error}</div>}

          {loading && <p className="cal-adm-placeholder">Loading pending entries…</p>}

          {!loading && !error && loaded && groups.length === 0 && (
            <p className="cal-adm-placeholder">Nothing pending — all user entries have been promoted or rejected.</p>
          )}

          {!loading && groups.map(group => {
            const sel = selectedFor(group.source);
            const allIds = group.entries.map(e => e.debate_id);
            return (
              <div key={group.source} className="cal-adm-group">
                <div className="cal-adm-group-head">
                  <span className="cal-adm-group-name">{group.origin}</span>
                  <span className="cal-adm-group-count">{group.entries.length}</span>
                  <div className="cal-adm-group-actions">
                    <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void promote(group, allIds)}>
                      Promote all
                    </button>
                    <button className="btn btn-sm" disabled={busy || sel.length === 0} onClick={() => void promote(group, sel)}>
                      Promote selected ({sel.length})
                    </button>
                    <button className="btn btn-sm btn-danger" disabled={busy || sel.length === 0} onClick={() => void reject(group.source, sel)}>
                      Reject selected ({sel.length})
                    </button>
                  </div>
                </div>
                <div className="cal-adm-entries">
                  {group.entries.map(entry => {
                    const k = entryKey(group.source, entry.debate_id);
                    return (
                      <EntryRow
                        key={entry.debate_id}
                        entry={entry}
                        source={group.source}
                        checked={selected.has(k)}
                        onToggle={() => toggleEntry(group.source, entry.debate_id)}
                        editing={editingKey === k}
                        editedLabel={labelEdits[k]}
                        onToggleEdit={() => setEditingKey(cur => (cur === k ? null : k))}
                        onLabelChange={value => setLabelEdits(prev => ({ ...prev, [k]: value }))}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
