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
 */

import { useState, useCallback } from 'react';
import { useUserProfile } from '../../hooks/useAuthStatus';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import './CalibrationAdmin.css';

// ── Types (subset of CalibrationDataPoint relevant to the preview) ──

export interface PendingEntry {
  debate_id: string;
  timestamp?: string;
  origin?: string;
  model?: string;
  rounds?: number;
  crux_addressed_ratio?: number | null;
  avg_utilization_rate?: number | null;
  [key: string]: unknown;
}

export interface PendingGroup {
  /** The user directory name under calibration/users/. */
  origin: string;
  /** "users/{origin}" — the source string the promote/reject endpoints expect. */
  source: string;
  entries: PendingEntry[];
}

// ── Server calls (web-only admin endpoints) ──

async function fetchPending(): Promise<PendingGroup[]> {
  const res = await fetch('/api/admin/calibration/pending');
  if (!res.ok) throw new Error(`GET pending failed: HTTP ${res.status}`);
  const data = (await res.json()) as { groups?: PendingGroup[] };
  return data.groups ?? [];
}

async function postPromote(source: string, entryIds: string[], notes?: string): Promise<{ promoted: number }> {
  const res = await fetch('/api/admin/calibration/promote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, entryIds, ...(notes ? { notes } : {}) }),
  });
  if (!res.ok) throw new Error(`promote failed: HTTP ${res.status}`);
  return res.json() as Promise<{ promoted: number }>;
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

// ── Entry row ──

function EntryRow({ entry, source, checked, onToggle }: {
  entry: PendingEntry;
  source: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="cal-adm-entry">
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span className="cal-adm-entry-id" title={entry.debate_id}>{entry.debate_id.slice(0, 12)}</span>
      <span className="cal-adm-entry-model">{entry.model || '—'}</span>
      <span className="cal-adm-entry-meta">{entry.rounds ?? '—'} rds</span>
      <span className="cal-adm-entry-meta">crux {fmtMetric(entry.crux_addressed_ratio)}</span>
      <span className="cal-adm-entry-meta">util {fmtMetric(entry.avg_utilization_rate)}</span>
      <span className="cal-adm-entry-date">{fmtDate(entry.timestamp)}</span>
    </label>
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

  const promote = useCallback(async (source: string, entryIds: string[]) => {
    if (entryIds.length === 0) return;
    setBusy(true);
    try {
      const { promoted } = await postPromote(source, entryIds);
      flash(`Promoted ${promoted} entr${promoted === 1 ? 'y' : 'ies'} to core`);
      await load();
    } catch (err) {
      record('Failed to promote calibration entries', err);
      flash('Promote failed — see flight recorder');
    } finally {
      setBusy(false);
    }
  }, [flash, load]);

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
                    <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void promote(group.source, allIds)}>
                      Promote all
                    </button>
                    <button className="btn btn-sm" disabled={busy || sel.length === 0} onClick={() => void promote(group.source, sel)}>
                      Promote selected ({sel.length})
                    </button>
                    <button className="btn btn-sm btn-danger" disabled={busy || sel.length === 0} onClick={() => void reject(group.source, sel)}>
                      Reject selected ({sel.length})
                    </button>
                  </div>
                </div>
                <div className="cal-adm-entries">
                  {group.entries.map(entry => (
                    <EntryRow
                      key={entry.debate_id}
                      entry={entry}
                      source={group.source}
                      checked={selected.has(entryKey(group.source, entry.debate_id))}
                      onToggle={() => toggleEntry(group.source, entry.debate_id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
