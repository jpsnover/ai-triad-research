// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Side drawer listing files that differ from origin/main on the user's session
 * branch, with per-file unified-diff preview and Discard actions.
 *
 * Phase 1 only — Create PR / Resync are rendered as disabled buttons with a
 * "coming in Phase 2" tooltip so the layout doesn't shift when they're enabled.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  listUnsynced,
  getFileDiff,
  discardFile,
  discardAll,
  type UnsyncedFile,
  type SyncStatus,
} from '../utils/syncApi';

interface Props {
  open: boolean;
  onClose: () => void;
  status: SyncStatus;
  onChanged: () => void; // invoked after discard so parent re-polls status
}

function statusLabel(code: string): string {
  switch (code) {
    case 'M': return 'modified';
    case 'A': return 'added';
    case 'D': return 'deleted';
    case 'R': return 'renamed';
    case '?': return 'untracked';
    default:  return code;
  }
}

function DiffLines({ diff }: { diff: string }) {
  if (!diff) return <div className="unsynced-drawer-diff-empty">No diff available.</div>;
  const lines = diff.split('\n');
  return (
    <pre className="unsynced-drawer-diff">
      {lines.map((line, i) => {
        let cls = 'unsynced-drawer-diff-line';
        if (line.startsWith('+++') || line.startsWith('---')) cls += ' diff-header';
        else if (line.startsWith('+')) cls += ' diff-add';
        else if (line.startsWith('-')) cls += ' diff-del';
        else if (line.startsWith('@@')) cls += ' diff-hunk';
        return <div key={i} className={cls}>{line || '\u00A0'}</div>;
      })}
    </pre>
  );
}

export function UnsyncedChangesDrawer({ open, onClose, status, onChanged }: Props) {
  const [files, setFiles] = useState<UnsyncedFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // path currently being discarded, or 'ALL'

  const refreshFiles = useCallback(async () => {
    setLoading(true);
    try {
      const next = await listUnsynced();
      setFiles(next);
      // Keep selection if still present; otherwise pick first.
      if (selected && next.some(f => f.path === selected)) {
        /* keep */
      } else {
        setSelected(next[0]?.path ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    if (open) void refreshFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!selected) { setDiff(''); return; }
    let cancelled = false;
    (async () => {
      const d = await getFileDiff(selected);
      if (!cancelled) setDiff(d);
    })();
    return () => { cancelled = true; };
  }, [selected]);

  const onDiscardFile = async (p: string) => {
    if (!confirm(`Discard local changes to ${p}? This cannot be undone.`)) return;
    setBusy(p);
    try {
      await discardFile(p);
      await refreshFiles();
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const onDiscardAll = async () => {
    if (!confirm(`Discard ALL ${files.length} local changes and reset to main? This cannot be undone.`)) return;
    setBusy('ALL');
    try {
      await discardAll();
      await refreshFiles();
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  if (!open) return null;

  return (
    <div className="unsynced-drawer-backdrop" onClick={onClose}>
      <div className="unsynced-drawer" onClick={e => e.stopPropagation()}>
        <div className="unsynced-drawer-header">
          <div>
            <h3 className="unsynced-drawer-title">Unsynced changes</h3>
            <div className="unsynced-drawer-subtitle">
              {status.session_branch
                ? <>Branch <code>{status.session_branch}</code> · {files.length} file{files.length === 1 ? '' : 's'}</>
                : 'Git sync disabled'}
            </div>
          </div>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="unsynced-drawer-actions">
          <button
            className="btn btn-primary"
            disabled
            title="Coming in Phase 2 — will open a pull request on GitHub"
          >
            Create pull request
          </button>
          <button
            className="btn btn-ghost"
            disabled
            title="Coming in Phase 2 — will fetch and rebase onto origin/main"
          >
            Resync with GitHub
          </button>
          <button
            className="btn btn-danger"
            onClick={onDiscardAll}
            disabled={busy !== null || files.length === 0}
            title="Reset the session branch to main, dropping all local commits"
          >
            {busy === 'ALL' ? 'Discarding…' : 'Discard all'}
          </button>
        </div>

        <div className="unsynced-drawer-body">
          <div className="unsynced-drawer-file-list">
            {loading && files.length === 0 && <div className="unsynced-drawer-empty">Loading…</div>}
            {!loading && files.length === 0 && <div className="unsynced-drawer-empty">No unsynced changes.</div>}
            {files.map(f => (
              <div
                key={f.path}
                className={`unsynced-drawer-file ${selected === f.path ? 'selected' : ''}`}
                onClick={() => setSelected(f.path)}
              >
                <span className={`unsynced-drawer-file-status status-${f.status.toLowerCase()}`}>
                  {f.status}
                </span>
                <span className="unsynced-drawer-file-path" title={f.path}>{f.path}</span>
                <span className="unsynced-drawer-file-label">{statusLabel(f.status)}</span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={(e) => { e.stopPropagation(); void onDiscardFile(f.path); }}
                  disabled={busy !== null}
                  title={`Discard changes to ${f.path}`}
                >
                  {busy === f.path ? '…' : 'Discard'}
                </button>
              </div>
            ))}
          </div>

          <div className="unsynced-drawer-diff-panel">
            {selected
              ? <DiffLines diff={diff} />
              : <div className="unsynced-drawer-empty">Select a file to see its diff.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
