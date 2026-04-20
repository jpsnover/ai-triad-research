// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useCallback } from 'react';
import {
  getSyncDiagnostics, resync, initDataRepo,
  type SyncDiagnostics, type DiagnosticsFile,
} from '../utils/syncApi';

interface SyncDiagnosticsDialogProps {
  open: boolean;
  onClose: () => void;
}

type ActionState = { running: boolean; label: string; error: string | null; success: string | null };

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`sync-diag-dot ${ok ? 'sync-diag-dot--ok' : 'sync-diag-dot--err'}`} />;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  if (!iso) return '--';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="sync-diag-section">
      <button className="sync-diag-section-header" onClick={() => setOpen(!open)}>
        <span className="sync-diag-section-arrow">{open ? '\u25BC' : '\u25B6'}</span>
        {title}
      </button>
      {open && <div className="sync-diag-section-body">{children}</div>}
    </div>
  );
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="sync-diag-kv">
      <span className="sync-diag-kv-label">{label}</span>
      <span className="sync-diag-kv-value">{children}</span>
    </div>
  );
}

export function SyncDiagnosticsDialog({ open, onClose }: SyncDiagnosticsDialogProps) {
  const [diag, setDiag] = useState<SyncDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [action, setAction] = useState<ActionState>({ running: false, label: '', error: null, success: null });
  const [confirmReset, setConfirmReset] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      setDiag(await getSyncDiagnostics());
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void refresh();
      setAction({ running: false, label: '', error: null, success: null });
      setConfirmReset(false);
    }
  }, [open, refresh]);

  const runAction = async (label: string, fn: () => Promise<unknown>) => {
    setAction({ running: true, label, error: null, success: null });
    try {
      await fn();
      setAction({ running: false, label: '', error: null, success: `${label} completed.` });
      void refresh();
    } catch (err) {
      setAction({ running: false, label: '', error: `${label} failed: ${err instanceof Error ? err.message : String(err)}`, success: null });
    }
  };

  if (!open) return null;

  const taxonomyFiles = diag?.files.filter(f => !f.relative_path.startsWith('conflicts/')) ?? [];
  const conflictFiles = diag?.files.filter(f => f.relative_path.startsWith('conflicts/')) ?? [];
  const missingCount = taxonomyFiles.filter(f => !f.exists).length;

  return (
    <div className="sync-diag-overlay" onClick={onClose}>
      <div className="sync-diag-dialog" onClick={e => e.stopPropagation()}>
        <div className="sync-diag-header">
          <h2>Sync Diagnostics</h2>
          <div className="sync-diag-header-actions">
            <button className="btn btn-ghost btn-sm" onClick={refresh} disabled={loading} title="Refresh">
              {loading ? 'Loading...' : 'Refresh'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>&times;</button>
          </div>
        </div>

        {fetchError && (
          <div className="sync-diag-error-banner">{fetchError}</div>
        )}

        {diag && (
          <div className="sync-diag-body">
            {/* Connection Status */}
            <Section title="Connection Status">
              <KV label="Git Sync Enabled"><StatusDot ok={diag.git_sync_enabled} /> {diag.git_sync_enabled ? 'Yes' : 'No'}</KV>
              <KV label="Data Root">{diag.data_root}</KV>
              <KV label="Git Initialized"><StatusDot ok={diag.data_root_has_git} /> {diag.data_root_has_git ? 'Yes' : 'No'}</KV>
              <KV label="GitHub Repo">{diag.github_repo ?? <span className="sync-diag-muted">Not configured</span>}</KV>
              <KV label="Credentials"><StatusDot ok={diag.github_credentials_valid} /> {diag.github_credentials_valid ? 'Valid' : 'Not configured'}</KV>
            </Section>

            {/* Repository State */}
            <Section title="Repository State">
              <KV label="Branch"><code>{diag.current_branch ?? '--'}</code></KV>
              <KV label="HEAD"><code>{diag.head_sha ?? '--'}</code></KV>
              <KV label="origin/main"><code>{diag.origin_main_sha ?? '--'}</code></KV>
              <KV label="Ahead / Behind">
                <span className={diag.ahead_of_main > 0 ? 'sync-diag-ahead' : ''}>+{diag.ahead_of_main}</span>
                {' / '}
                <span className={diag.behind_main > 0 ? 'sync-diag-behind' : ''}>-{diag.behind_main}</span>
              </KV>
              <KV label="Active Taxonomy Dir"><code>{diag.active_taxonomy_dir}</code></KV>
            </Section>

            {/* Data File Inventory */}
            <Section title={`Data Files${missingCount > 0 ? ` (${missingCount} missing)` : ''}`}>
              <table className="sync-diag-file-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>File</th>
                    <th>Size</th>
                    <th>Modified</th>
                  </tr>
                </thead>
                <tbody>
                  {taxonomyFiles.map((f: DiagnosticsFile) => (
                    <tr key={f.relative_path} className={f.exists ? '' : 'sync-diag-file-missing'}>
                      <td>{f.exists ? '\u2705' : '\u274C'}</td>
                      <td><code>{f.relative_path}</code></td>
                      <td>{formatBytes(f.size_bytes)}</td>
                      <td>{formatDate(f.modified_iso)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {conflictFiles.length > 0 && (
                <details className="sync-diag-conflicts-detail">
                  <summary>{conflictFiles.length} conflict file{conflictFiles.length !== 1 ? 's' : ''}</summary>
                  <table className="sync-diag-file-table">
                    <tbody>
                      {conflictFiles.map((f: DiagnosticsFile) => (
                        <tr key={f.relative_path}>
                          <td>{f.exists ? '\u2705' : '\u274C'}</td>
                          <td><code>{f.relative_path}</code></td>
                          <td>{formatBytes(f.size_bytes)}</td>
                          <td>{formatDate(f.modified_iso)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
            </Section>

            {/* Recent Commits */}
            <Section title="Recent Commits" defaultOpen={false}>
              {diag.recent_commits.length === 0 ? (
                <div className="sync-diag-muted">No commits found</div>
              ) : (
                <div className="sync-diag-commits">
                  {diag.recent_commits.map((c, i) => (
                    <div key={i} className="sync-diag-commit">
                      <code className="sync-diag-commit-sha">{c.sha}</code>
                      <span className="sync-diag-commit-date">{formatDate(c.date_iso)}</span>
                      <span className="sync-diag-commit-msg">{c.message}</span>
                      <span className="sync-diag-commit-author">{c.author}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Actions */}
            <Section title="Actions">
              {action.error && <div className="sync-diag-action-error">{action.error}</div>}
              {action.success && <div className="sync-diag-action-success">{action.success}</div>}

              <div className="sync-diag-actions">
                <button
                  className="btn btn-primary btn-sm"
                  disabled={action.running || !diag.data_root_has_git}
                  onClick={() => runAction('Fetch from origin', () => resync('fetch-only'))}
                  title="Fetch latest commits from origin without changing local files"
                >
                  {action.running && action.label === 'Fetch from origin' ? 'Fetching...' : 'Fetch from Origin'}
                </button>

                {!confirmReset ? (
                  <button
                    className="btn btn-sm sync-diag-btn-danger"
                    disabled={action.running || !diag.data_root_has_git}
                    onClick={() => setConfirmReset(true)}
                    title="Reset local data to match origin/main — discards all local changes"
                  >
                    Reset to origin/main
                  </button>
                ) : (
                  <div className="sync-diag-confirm">
                    <span className="sync-diag-confirm-text">This will discard all local changes. Continue?</span>
                    <button
                      className="btn btn-sm sync-diag-btn-danger"
                      disabled={action.running}
                      onClick={() => { setConfirmReset(false); void runAction('Reset to origin/main', () => resync('reset-main')); }}
                    >
                      {action.running && action.label === 'Reset to origin/main' ? 'Resetting...' : 'Confirm Reset'}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setConfirmReset(false)}>Cancel</button>
                  </div>
                )}

                <button
                  className="btn btn-sm"
                  disabled={action.running || diag.data_root_has_git}
                  onClick={() => runAction('Initialize repo', () => initDataRepo())}
                  title={diag.data_root_has_git ? 'Repo already initialized' : 'Clone data repo from GitHub'}
                >
                  {action.running && action.label === 'Initialize repo' ? 'Initializing...' : 'Initialize Repo'}
                </button>
              </div>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}
