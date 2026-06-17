// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Phase 5C — node-level diff view for the user's session branch vs main.
 *
 * Unlike <UnsyncedChangesDrawer>, which shows raw per-file unified-diff text,
 * this panel renders a *semantic* diff: added / modified / removed nodes with
 * field-level old → new detail. It reads the structured diff from
 * `GET /api/sync/node-diff` (server-side, computed from `diffNodes()` +
 * `changedFields()` in editMeta.ts).
 *
 * The panel degrades gracefully when the server endpoint is unavailable (older
 * server, git sync disabled, or endpoint not yet deployed): it shows a friendly
 * "unavailable" message rather than erroring.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import './TaxonomyDiffPanel.css';

// ── Response contract (mirrors GET /api/sync/node-diff) ──────────────────────

export interface NodeFieldChange {
  field: string;
  /** Value on `main` (the base branch). `undefined` for newly-set fields. */
  old: unknown;
  /** Value on the session branch. `undefined` for cleared fields. */
  new: unknown;
}

export interface NodeDiffEntry {
  id: string;
  /** Human-readable node label, when available. */
  label?: string;
  /** Field-level changes — present for modified nodes only. */
  fields?: NodeFieldChange[];
}

export interface FileNodeDiff {
  /** Repo-relative file path, e.g. "accelerationist.json". */
  path: string;
  added: NodeDiffEntry[];
  removed: NodeDiffEntry[];
  modified: NodeDiffEntry[];
}

export interface NodeDiffResponse {
  enabled: boolean;
  session_branch: string | null;
  files: FileNodeDiff[];
  totals: { added: number; modified: number; removed: number };
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Optional: switch to the file-level actions drawer (PR / discard / resync). */
  onManageChanges?: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────

const MAX_VALUE_CHARS = 240;

/** Render an arbitrary JSON value compactly for a field diff cell. */
function formatValue(value: unknown): string {
  if (value === undefined) return '∅';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  let out: string;
  try {
    out = JSON.stringify(value);
  } catch {
    out = String(value);
  }
  return out.length > MAX_VALUE_CHARS ? `${out.slice(0, MAX_VALUE_CHARS)}…` : out;
}

function fileLabel(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.json$/i, '');
}

async function fetchNodeDiff(): Promise<NodeDiffResponse | null> {
  try {
    const res = await fetch('/api/sync/node-diff');
    if (!res.ok) {
      // 404 → endpoint not deployed yet; any other status → server-side issue.
      return null;
    }
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) return null;
    return (await res.json()) as NodeDiffResponse;
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'taxonomy-diff-panel',
      level: 'debug',
      message: 'Node-level diff unavailable',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return null;
  }
}

// ── Subcomponents ──────────────────────────────────────────────────────────

function NodeRow({ entry, kind }: { entry: NodeDiffEntry; kind: 'added' | 'removed' | 'modified' }) {
  const [expanded, setExpanded] = useState(kind === 'modified');
  const hasFields = kind === 'modified' && !!entry.fields?.length;

  return (
    <div className={`txdiff-node txdiff-node--${kind}`}>
      <div
        className={`txdiff-node-head ${hasFields ? 'clickable' : ''}`}
        onClick={() => hasFields && setExpanded(v => !v)}
      >
        <span className={`txdiff-node-badge badge-${kind}`} aria-hidden="true">
          {kind === 'added' ? '+' : kind === 'removed' ? '−' : '~'}
        </span>
        <span className="txdiff-node-id" title={entry.id}>{entry.id}</span>
        {entry.label && <span className="txdiff-node-label">{entry.label}</span>}
        {hasFields && (
          <span className="txdiff-node-fieldcount">
            {entry.fields!.length} field{entry.fields!.length === 1 ? '' : 's'} {expanded ? '▾' : '▸'}
          </span>
        )}
      </div>
      {hasFields && expanded && (
        <div className="txdiff-fields">
          {entry.fields!.map(f => (
            <div key={f.field} className="txdiff-field">
              <span className="txdiff-field-name">{f.field}</span>
              <span className="txdiff-field-values">
                <span className="txdiff-field-old" title={formatValue(f.old)}>{formatValue(f.old)}</span>
                <span className="txdiff-field-arrow" aria-hidden="true">→</span>
                <span className="txdiff-field-new" title={formatValue(f.new)}>{formatValue(f.new)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FileSection({ file }: { file: FileNodeDiff }) {
  const count = file.added.length + file.removed.length + file.modified.length;
  if (count === 0) return null;
  return (
    <section className="txdiff-file">
      <header className="txdiff-file-head">
        <span className="txdiff-file-name">{fileLabel(file.path)}</span>
        <span className="txdiff-file-counts">
          {file.added.length > 0 && <span className="count-added">+{file.added.length}</span>}
          {file.modified.length > 0 && <span className="count-modified">~{file.modified.length}</span>}
          {file.removed.length > 0 && <span className="count-removed">−{file.removed.length}</span>}
        </span>
      </header>
      <div className="txdiff-file-body">
        {file.added.map(n => <NodeRow key={`a-${n.id}`} entry={n} kind="added" />)}
        {file.modified.map(n => <NodeRow key={`m-${n.id}`} entry={n} kind="modified" />)}
        {file.removed.map(n => <NodeRow key={`r-${n.id}`} entry={n} kind="removed" />)}
      </div>
    </section>
  );
}

// ── Main panel ──────────────────────────────────────────────────────────────

export function TaxonomyDiffPanel({ open, onClose, onManageChanges }: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<NodeDiffResponse | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setUnavailable(false);
    const res = await fetchNodeDiff();
    if (res && res.enabled) {
      setData(res);
    } else {
      setData(null);
      setUnavailable(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // Close on Escape for keyboard dismissal.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const totals = data?.totals;
  const totalCount = useMemo(
    () => totals ? totals.added + totals.modified + totals.removed : 0,
    [totals],
  );

  if (!open) return null;

  return (
    <div className="txdiff-backdrop" onClick={onClose}>
      <div className="txdiff-panel" onClick={e => e.stopPropagation()} role="dialog" aria-label="Pending taxonomy changes">
        <div className="txdiff-header">
          <div>
            <h3 className="txdiff-title">Pending changes</h3>
            <div className="txdiff-subtitle">
              {data?.session_branch
                ? <>Branch <code>{data.session_branch}</code> vs <code>main</code></>
                : 'Node-level diff of your session branch'}
              {totals && totalCount > 0 && (
                <> · {totals.added} added · {totals.modified} modified · {totals.removed} removed</>
              )}
            </div>
          </div>
          <div className="txdiff-header-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => void refresh()} disabled={loading} title="Refresh">
              ⟳
            </button>
            <button className="btn btn-ghost" onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>

        <div className="txdiff-body">
          {loading && <div className="txdiff-empty">Loading changes…</div>}

          {!loading && unavailable && (
            <div className="txdiff-empty">
              Node-level diff isn’t available right now. This view needs the sync
              server with git sync enabled.
            </div>
          )}

          {!loading && !unavailable && totalCount === 0 && (
            <div className="txdiff-empty">No pending changes — your session branch matches <code>main</code>.</div>
          )}

          {!loading && !unavailable && totalCount > 0 && data && (
            <div className="txdiff-files">
              {data.files.map(f => <FileSection key={f.path} file={f} />)}
            </div>
          )}
        </div>

        {onManageChanges && (
          <div className="txdiff-footer">
            <button
              className="btn btn-ghost"
              onClick={() => { onClose(); onManageChanges(); }}
              title="Open the sync drawer to create a PR, resync, or discard changes"
            >
              Manage changes →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
