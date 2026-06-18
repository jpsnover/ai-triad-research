// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * CalibrationReviewViewer — the calibration domain viewer rendered in the
 * right pane of the unified admin-review shell (t/648). Given a selected review
 * group (`groupId = calibration:{origin}` from `GET /api/admin/review/queue`),
 * it loads the group's pending entries across all three calibration file kinds,
 * shows core-average / core-value comparison context, and promotes / rejects
 * them via the unified `POST /api/admin/review/action`.
 *
 * Contract (t/646#2, t/647#1, t/647#3):
 *  - detail:  GET /api/admin/review/detail/:groupId  → CalibrationDetail
 *  - action:  POST /api/admin/review/action          → { ok: true }
 *             body = { domain:'calibration', action, itemIds, reason?, edits?, groupId }
 *  - item ids are qualified `${kind}::${key}` — passed back verbatim; edit-on-
 *    promote patches are keyed by the same id (lineage-enrichments only here).
 *
 * It owns only the right-pane viewer; the shell (queue list, routing, header
 * badge) is t/648 (Taxonomy Editor). Seam: the shell renders this with the
 * selected item's `groupId` and refreshes its queue/stats on `onActionComplete`.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import './CalibrationReviewViewer.css';

// ── Detail contract types (t/647#3) ──

export interface DetailEntry {
  /** Qualified id: `${kind}::${key}`. */
  itemId: string;
  entry: Record<string, unknown>;
}

export interface LineageDetailEntry {
  itemId: string;
  key: string;
  value: Record<string, unknown> | null;
  /** Case-normalized core lookup; null when the key is new to core (conflict signal). */
  coreValue: Record<string, unknown> | null;
}

export interface JsonlKindBlock {
  coreAverages?: Record<string, number>;
  coreCount?: number;
  entries: DetailEntry[];
}

export interface CalibrationDetail {
  domain: string;
  origin: string;
  source: string;
  calibrationLog: JsonlKindBlock;
  extractionMetrics: JsonlKindBlock;
  lineageEnrichments: { entries: LineageDetailEntry[] };
}

export interface CalibrationReviewViewerProps {
  /** Selected review group id, e.g. "calibration:jpsnover" (ReviewItem.id from the queue). */
  groupId: string;
  /** Fired after a successful promote/reject so the host shell can refresh queue + stats. */
  onActionComplete?: () => void;
}

type ReviewActionBody = {
  domain: 'calibration';
  action: 'promote' | 'reject';
  itemIds: string[];
  groupId: string;
  reason?: string;
  edits?: Record<string, Record<string, unknown>>;
};

// ── Server calls ──

async function fetchDetail(groupId: string): Promise<CalibrationDetail> {
  const res = await fetch(`/api/admin/review/detail/${encodeURIComponent(groupId)}`);
  if (!res.ok) throw new Error(`GET detail failed: HTTP ${res.status}`);
  return res.json() as Promise<CalibrationDetail>;
}

async function postAction(body: ReviewActionBody): Promise<{ ok: boolean }> {
  const res = await fetch('/api/admin/review/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${body.action} failed: HTTP ${res.status}`);
  return res.json() as Promise<{ ok: boolean }>;
}

function record(message: string, err: unknown): void {
  getGlobalRecorder()?.record({
    type: 'system.error',
    component: 'calibration-review-viewer',
    level: 'error',
    message,
    error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
  });
}

// ── Helpers ──

/** Key portion of a qualified `${kind}::${key}` item id. */
function keyOf(itemId: string): string {
  const idx = itemId.indexOf('::');
  return idx === -1 ? itemId : itemId.slice(idx + 2);
}

function str(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}

/**
 * Top-level keys of `editedText` (parsed JSON object) that differ from `original`.
 * Returns null when the text is not a valid JSON object (caller surfaces as
 * validation). Empty object means no effective change.
 */
function lineagePatch(original: Record<string, unknown> | null, editedText: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(editedText);
  } catch {
    return null; /* invalid JSON — surfaced to the user as validation, not an error */
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const orig = original ?? {};
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (JSON.stringify(v) !== JSON.stringify(orig[k])) patch[k] = v;
  }
  return patch;
}

// ── JSONL kind section (calibration-log / extraction-metrics) ──

function JsonlSection({ title, block, selected, onToggle }: {
  title: string;
  block: JsonlKindBlock;
  selected: Set<string>;
  onToggle: (itemId: string) => void;
}) {
  if (block.entries.length === 0) return null;
  return (
    <section className="crv-section">
      <h4 className="crv-section-head">
        {title}
        <span className="crv-section-meta">{block.entries.length} pending · core n={block.coreCount ?? 0}</span>
      </h4>
      <div className="crv-rows">
        {block.entries.map(({ itemId, entry }) => (
          <label key={itemId} className="crv-row">
            <input type="checkbox" checked={selected.has(itemId)} onChange={() => onToggle(itemId)} />
            <span className="crv-row-key" title={keyOf(itemId)}>{keyOf(itemId)}</span>
            <span className="crv-row-cell">{str(entry.model)}</span>
            <span className="crv-row-cell">{str(entry.rounds)} rds</span>
            <span className="crv-row-cell">crux {str(entry.crux_addressed_ratio)}</span>
            <span className="crv-row-cell crv-row-core" title="core average">
              ⌀ {str(block.coreAverages?.crux_addressed_ratio)}
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

// ── Lineage section (editable, conflict-aware) ──

function LineageSection({ entries, selected, onToggle, editing, drafts, onToggleEdit, onDraftChange }: {
  entries: LineageDetailEntry[];
  selected: Set<string>;
  onToggle: (itemId: string) => void;
  editing: string | null;
  drafts: Record<string, string>;
  onToggleEdit: (itemId: string, initial: string) => void;
  onDraftChange: (itemId: string, value: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <section className="crv-section">
      <h4 className="crv-section-head">
        Lineage Enrichments
        <span className="crv-section-meta">{entries.length} pending</span>
      </h4>
      <div className="crv-rows">
        {entries.map(({ itemId, key, value, coreValue }) => {
          const conflict = coreValue !== null;
          const isEditing = editing === itemId;
          const draft = drafts[itemId];
          const edited = draft !== undefined;
          return (
            <div key={itemId} className="crv-lineage-wrap">
              <div className="crv-row">
                <label className="crv-row-main">
                  <input type="checkbox" checked={selected.has(itemId)} onChange={() => onToggle(itemId)} />
                  <span className="crv-row-key" title={key}>{key}</span>
                  <span className={`crv-badge ${conflict ? 'crv-badge-conflict' : 'crv-badge-new'}`}>
                    {conflict ? 'overwrites core' : 'new to core'}
                  </span>
                  {edited && <span className="crv-badge crv-badge-edited">edited</span>}
                </label>
                <button
                  className="crv-edit-btn"
                  onClick={() => onToggleEdit(itemId, JSON.stringify(value ?? {}, null, 2))}
                  title="Edit the enrichment value before promoting"
                >
                  {isEditing ? 'Done' : 'Edit'}
                </button>
              </div>
              {isEditing && (
                <div className="crv-editor">
                  <textarea
                    className="crv-editor-json"
                    spellCheck={false}
                    value={draft ?? JSON.stringify(value ?? {}, null, 2)}
                    onChange={e => onDraftChange(itemId, e.target.value)}
                  />
                  {conflict && (
                    <pre className="crv-editor-core" title="current core value">{JSON.stringify(coreValue, null, 2)}</pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Main viewer ──

export function CalibrationReviewViewer({ groupId, onActionComplete }: CalibrationReviewViewerProps) {
  const [detail, setDetail] = useState<CalibrationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // lineage itemId → edited JSON text
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchDetail(groupId);
      setDetail(d);
      setSelected(new Set());
      setDrafts({});
      setEditing(null);
    } catch (err) {
      record('Failed to load calibration review detail', err);
      setError('Could not load this review group. It may have been resolved already.');
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => { void load(); }, [load]);

  const allItemIds = useMemo(() => {
    if (!detail) return [];
    return [
      ...detail.calibrationLog.entries.map(e => e.itemId),
      ...detail.extractionMetrics.entries.map(e => e.itemId),
      ...detail.lineageEnrichments.entries.map(e => e.itemId),
    ];
  }, [detail]);

  const lineageById = useMemo(() => {
    const m = new Map<string, LineageDetailEntry>();
    detail?.lineageEnrichments.entries.forEach(e => m.set(e.itemId, e));
    return m;
  }, [detail]);

  const toggle = useCallback((itemId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  }, []);

  /** Build the edits map for the promoted ids, or null if a lineage draft is invalid JSON. */
  const buildEdits = useCallback((ids: string[]): Record<string, Record<string, unknown>> | null => {
    const edits: Record<string, Record<string, unknown>> = {};
    for (const id of ids) {
      const draft = drafts[id];
      if (draft === undefined) continue;
      const entry = lineageById.get(id);
      if (!entry) continue; // drafts only apply to lineage entries
      const patch = lineagePatch(entry.value, draft);
      if (patch === null) {
        flash(`Invalid JSON in the edit for "${entry.key}" — fix it before promoting`);
        return null;
      }
      if (Object.keys(patch).length > 0) edits[id] = patch;
    }
    return edits;
  }, [drafts, lineageById, flash]);

  const promote = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const edits = buildEdits(ids);
    if (edits === null) return; // invalid lineage JSON; user already notified
    setBusy(true);
    try {
      await postAction({
        domain: 'calibration',
        action: 'promote',
        itemIds: ids,
        groupId,
        ...(Object.keys(edits).length > 0 ? { edits } : {}),
      });
      const editNote = Object.keys(edits).length > 0 ? ` (${Object.keys(edits).length} edited)` : '';
      flash(`Promoted ${ids.length} item${ids.length === 1 ? '' : 's'} to core${editNote}`);
      onActionComplete?.();
      await load();
    } catch (err) {
      record('Failed to promote calibration review items', err);
      flash('Promote failed — see flight recorder');
    } finally {
      setBusy(false);
    }
  }, [buildEdits, groupId, flash, onActionComplete, load]);

  const reject = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    if (!reason.trim()) { flash('Enter a rejection reason first'); return; }
    setBusy(true);
    try {
      await postAction({ domain: 'calibration', action: 'reject', itemIds: ids, groupId, reason: reason.trim() });
      flash(`Rejected ${ids.length} item${ids.length === 1 ? '' : 's'}`);
      setReason('');
      onActionComplete?.();
      await load();
    } catch (err) {
      record('Failed to reject calibration review items', err);
      flash('Reject failed — see flight recorder');
    } finally {
      setBusy(false);
    }
  }, [reason, groupId, flash, onActionComplete, load]);

  if (loading) return <div className="crv"><p className="crv-placeholder">Loading review detail…</p></div>;
  if (error) return <div className="crv"><div className="crv-error">{error}</div></div>;
  if (!detail) return <div className="crv"><p className="crv-placeholder">No detail available.</p></div>;

  const selectedIds = Array.from(selected);
  const empty = allItemIds.length === 0;

  return (
    <div className="crv">
      <div className="crv-header">
        <h3>Calibration · {detail.origin}</h3>
        <span className="crv-header-meta">{allItemIds.length} pending across 3 kinds</span>
      </div>

      {toast && <div className="crv-toast">{toast}</div>}

      {empty ? (
        <p className="crv-placeholder">Nothing pending for this user — all entries promoted or rejected.</p>
      ) : (
        <>
          <JsonlSection title="Calibration Log" block={detail.calibrationLog} selected={selected} onToggle={toggle} />
          <JsonlSection title="Extraction Metrics" block={detail.extractionMetrics} selected={selected} onToggle={toggle} />
          <LineageSection
            entries={detail.lineageEnrichments.entries}
            selected={selected}
            onToggle={toggle}
            editing={editing}
            drafts={drafts}
            onToggleEdit={(itemId, initial) => {
              setEditing(cur => (cur === itemId ? null : itemId));
              setDrafts(prev => (prev[itemId] === undefined ? { ...prev, [itemId]: initial } : prev));
            }}
            onDraftChange={(itemId, value) => setDrafts(prev => ({ ...prev, [itemId]: value }))}
          />

          <div className="crv-actionbar">
            <input
              className="crv-reason"
              placeholder="Rejection reason (required to reject)"
              value={reason}
              onChange={e => setReason(e.target.value)}
              disabled={busy}
            />
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void promote(allItemIds)}>
              Promote all
            </button>
            <button className="btn btn-sm" disabled={busy || selectedIds.length === 0} onClick={() => void promote(selectedIds)}>
              Promote selected ({selectedIds.length})
            </button>
            <button className="btn btn-sm btn-danger" disabled={busy || selectedIds.length === 0} onClick={() => void reject(selectedIds)}>
              Reject selected ({selectedIds.length})
            </button>
          </div>
        </>
      )}
    </div>
  );
}
