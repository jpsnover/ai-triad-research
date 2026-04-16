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
  createPullRequest,
  resync,
  type UnsyncedFile,
  type SyncStatus,
  type ResyncMode,
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
  const [prDialog, setPrDialog] = useState(false);
  const [resyncDialog, setResyncDialog] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);

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

  const ghDisabled = !status.github_configured;
  const ghDisabledTitle = 'GitHub is not configured on this server. Set GITHUB_REPO and either GITHUB_APP_* credentials or GITHUB_TOKEN.';

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
              {status.pr_number && status.pr_url && (
                <> · <a href={status.pr_url} target="_blank" rel="noreferrer noopener" className="unsynced-drawer-pr-pill">
                  PR #{status.pr_number}{status.push_pending ? ' ⏳' : ''}
                </a></>
              )}
            </div>
          </div>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="unsynced-drawer-actions">
          <button
            className="btn btn-primary"
            onClick={() => { setActionError(null); setPrDialog(true); }}
            disabled={ghDisabled || busy !== null || (files.length === 0 && !status.pr_number)}
            title={ghDisabled ? ghDisabledTitle : (status.pr_number ? 'Update the existing pull request' : 'Push the session branch and open a pull request')}
          >
            {status.pr_number ? `Update PR #${status.pr_number}` : 'Create pull request'}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => { setActionError(null); setResyncDialog(true); }}
            disabled={ghDisabled || busy !== null}
            title={ghDisabled ? ghDisabledTitle : 'Fetch origin/main and optionally rebase your session branch'}
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

        {status.main_updated_available && (
          <div className="unsynced-drawer-alert upstream">
            <span>
              Upstream <code>main</code> has new commits. Resync to avoid merge
              surprises the next time you open a PR.
            </span>
            <button
              className="btn btn-sm"
              onClick={() => { setActionError(null); setResyncDialog(true); }}
              disabled={ghDisabled || busy !== null}
              title={ghDisabled ? ghDisabledTitle : 'Open the Resync dialog'}
            >
              Resync
            </button>
          </div>
        )}

        {(actionError || actionInfo) && (
          <div className={`unsynced-drawer-alert ${actionError ? 'error' : 'info'}`}>
            <span>{actionError ?? actionInfo}</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { setActionError(null); setActionInfo(null); }}
              aria-label="Dismiss"
            >×</button>
          </div>
        )}

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

      {prDialog && (
        <CreatePrDialog
          files={files}
          status={status}
          onCancel={() => setPrDialog(false)}
          onDone={async (message) => {
            setPrDialog(false);
            setActionInfo(message);
            onChanged();
            await refreshFiles();
          }}
          onError={(msg) => { setPrDialog(false); setActionError(msg); }}
        />
      )}

      {resyncDialog && (
        <ResyncDialog
          status={status}
          hasLocalChanges={files.length > 0}
          onCancel={() => setResyncDialog(false)}
          onDone={async (message) => {
            setResyncDialog(false);
            setActionInfo(message);
            onChanged();
            await refreshFiles();
          }}
          onError={(msg) => { setResyncDialog(false); setActionError(msg); }}
        />
      )}
    </div>
  );
}

// ── Create-PR dialog ──

interface CreatePrDialogProps {
  files: UnsyncedFile[];
  status: SyncStatus;
  onCancel: () => void;
  onDone: (message: string) => void | Promise<void>;
  onError: (message: string) => void;
}

function defaultPrBody(files: UnsyncedFile[]): string {
  if (files.length === 0) return '';
  const lines = files.slice(0, 50).map(f => `- \`${f.path}\` (${statusLabel(f.status)})`);
  const extra = files.length > 50 ? `\n\n…and ${files.length - 50} more file(s).` : '';
  return `Edits made via the Taxonomy Editor web UI.\n\n**Changed files:**\n${lines.join('\n')}${extra}`;
}

function CreatePrDialog({ files, status, onCancel, onDone, onError }: CreatePrDialogProps) {
  const existing = !!status.pr_number;
  const [title, setTitle] = useState(existing
    ? `Update PR #${status.pr_number}`
    : `Web edits on ${status.session_branch ?? 'session branch'}`);
  const [body, setBody] = useState(defaultPrBody(files));
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      const res = await createPullRequest({ title: title.trim() || undefined, body });
      const msg = res.created
        ? `Opened PR #${res.number}. ${res.url}`
        : `Updated PR #${res.number}. ${res.url}`;
      await onDone(msg);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog sync-dialog" onClick={e => e.stopPropagation()}>
        <h3 className="dialog-title">{existing ? `Update pull request #${status.pr_number}` : 'Create pull request'}</h3>
        <p className="dialog-description">
          {existing
            ? 'Push the latest commits on your session branch and refresh the PR metadata.'
            : <>Push <code>{status.session_branch}</code> to GitHub and open a pull request against <code>main</code>.</>}
        </p>
        <label className="sync-dialog-label">
          <span>Title</span>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            disabled={submitting}
          />
        </label>
        <label className="sync-dialog-label">
          <span>Description</span>
          <textarea
            rows={8}
            value={body}
            onChange={e => setBody(e.target.value)}
            disabled={submitting}
          />
        </label>
        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={onCancel} disabled={submitting}>Cancel</button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={submitting || !title.trim()}>
            {submitting ? 'Pushing…' : (existing ? 'Update PR' : 'Create PR')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Resync dialog ──

interface ResyncDialogProps {
  status: SyncStatus;
  hasLocalChanges: boolean;
  onCancel: () => void;
  onDone: (message: string) => void | Promise<void>;
  onError: (message: string) => void;
}

function ResyncDialog({ status, hasLocalChanges, onCancel, onDone, onError }: ResyncDialogProps) {
  const [submitting, setSubmitting] = useState<ResyncMode | null>(null);

  const run = async (mode: ResyncMode) => {
    setSubmitting(mode);
    try {
      const res = await resync(mode);
      await onDone(res.message);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog sync-dialog" onClick={e => e.stopPropagation()}>
        <h3 className="dialog-title">Resync with GitHub</h3>
        <p className="dialog-description">
          {hasLocalChanges ? (
            <>You have unsynced changes on <code>{status.session_branch}</code>. Pick how to reconcile with the latest <code>origin/main</code>.</>
          ) : (
            <>No unsynced changes. You can fast-forward <code>main</code> to match <code>origin/main</code>.</>
          )}
        </p>
        <div className="sync-dialog-options">
          {hasLocalChanges ? (
            <>
              <button
                className="btn btn-primary"
                onClick={() => void run('rebase')}
                disabled={submitting !== null}
                title="Fetch origin and rebase your session branch onto origin/main. Conflicts will abort the rebase."
              >
                {submitting === 'rebase' ? 'Rebasing…' : 'Rebase my session onto main'}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => void run('fetch-only')}
                disabled={submitting !== null}
                title="Fetch origin without moving main or the session branch"
              >
                {submitting === 'fetch-only' ? 'Fetching…' : 'Fetch only'}
              </button>
            </>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => void run('reset-main')}
              disabled={submitting !== null}
              title="Fast-forward local main to origin/main"
            >
              {submitting === 'reset-main' ? 'Resyncing…' : 'Fast-forward main'}
            </button>
          )}
        </div>
        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={onCancel} disabled={submitting !== null}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
