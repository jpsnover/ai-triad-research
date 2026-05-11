// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useCallback } from 'react';
import {
  getSyncDiagnostics, getSyncStatus, createPullRequestTracked, initDataRepoTracked,
  fetchOriginTracked, resetMainTracked,
  setGithubCredentials, clearGithubCredentials,
  type SyncDiagnostics, type SyncStatus, type DiagnosticsFile, type EditCounts,
} from '../utils/syncApi';
import { GitProgressBanner } from './GitProgressBanner';

interface SyncDiagnosticsDialogProps {
  open: boolean;
  onClose: () => void;
}

type ActionState = { running: boolean; label: string; error: string | null; success: string | null };

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`sync-diag-dot ${ok ? 'sync-diag-dot--ok' : 'sync-diag-dot--err'}`} />;
}

function FileStatusIcon({ file }: { file: DiagnosticsFile }) {
  if (!file.exists) return <span className="file-status-icon file-status-missing" title="Missing">\u274C</span>;
  if (file.git_status === 'D') return <span className="file-status-icon file-status-missing" title="Deleted">\u274C</span>;
  if (file.git_status) return <span className="file-status-icon file-status-modified" title={`Modified (${file.git_status})`}>\uD83D\uDFE1</span>;
  return <span className="file-status-icon file-status-clean" title="Clean">\u2705</span>;
}

function EditCountsCell({ counts }: { counts: EditCounts | null }) {
  if (!counts) return <span className="sync-diag-muted">\u2014</span>;
  const parts: string[] = [];
  if (counts.added > 0) parts.push(`+${counts.added}`);
  if (counts.modified > 0) parts.push(`~${counts.modified}`);
  if (counts.deleted > 0) parts.push(`-${counts.deleted}`);
  if (parts.length === 0) return <span className="sync-diag-muted">\u2014</span>;
  return (
    <span className="edit-counts" title={`${counts.added} added, ${counts.modified} modified, ${counts.deleted} deleted`}>
      {counts.added > 0 && <span className="edit-count-added">+{counts.added}</span>}
      {counts.modified > 0 && <span className="edit-count-modified">~{counts.modified}</span>}
      {counts.deleted > 0 && <span className="edit-count-deleted">-{counts.deleted}</span>}
    </span>
  );
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
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [action, setAction] = useState<ActionState>({ running: false, label: '', error: null, success: null });
  const [confirmReset, setConfirmReset] = useState(false);
  const [prFormOpen, setPrFormOpen] = useState(false);
  const [credFormOpen, setCredFormOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const [diagData, statusData] = await Promise.all([
        getSyncDiagnostics(),
        getSyncStatus(),
      ]);
      setDiag(diagData);
      setSyncStatus(statusData);
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
      setPrFormOpen(false);
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

        <GitProgressBanner />

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
              <KV label="Credentials">
                <StatusDot ok={diag.github_credentials_valid} />{' '}
                {diag.github_credentials_valid ? (
                  <>
                    Valid
                    <button
                      className="btn btn-ghost btn-xs"
                      style={{ marginLeft: 8, fontSize: '0.65rem' }}
                      onClick={async () => {
                        await clearGithubCredentials();
                        void refresh();
                      }}
                      title="Clear stored credentials"
                    >
                      Clear
                    </button>
                  </>
                ) : (
                  <>
                    Not configured
                    <button
                      className="btn btn-ghost btn-xs"
                      style={{ marginLeft: 8, fontSize: '0.65rem' }}
                      onClick={() => setCredFormOpen(!credFormOpen)}
                    >
                      {credFormOpen ? 'Cancel' : 'Configure'}
                    </button>
                  </>
                )}
              </KV>
              {credFormOpen && !diag.github_credentials_valid && (
                <GitHubCredentialsForm
                  defaultRepo={diag.github_repo ?? ''}
                  running={action.running && action.label === 'Set credentials'}
                  onSubmit={async (repo, token) => {
                    setAction({ running: true, label: 'Set credentials', error: null, success: null });
                    try {
                      const result = await setGithubCredentials(repo, token);
                      if (result.configured) {
                        setAction({ running: false, label: '', error: null, success: 'GitHub credentials configured.' });
                        setCredFormOpen(false);
                        void refresh();
                      } else {
                        setAction({ running: false, label: '', error: 'Credentials were saved but could not be validated. Check your token.', success: null });
                      }
                    } catch (err) {
                      setAction({ running: false, label: '', error: `Set credentials failed: ${err instanceof Error ? err.message : String(err)}`, success: null });
                    }
                  }}
                  onCancel={() => setCredFormOpen(false)}
                />
              )}
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
              {syncStatus && syncStatus.pr_number != null && (
                <KV label="Pull Request">
                  <span className="sync-diag-pr-info">
                    <a
                      className="sync-diag-pr-link"
                      href={syncStatus.pr_url ?? '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      #{syncStatus.pr_number}
                    </a>
                    <span className="sync-diag-pr-status sync-diag-pr-open">Open</span>
                    {syncStatus.push_pending && (
                      <span className="sync-diag-pr-push-pending" title="Local commits not yet pushed to this PR">
                        Push pending
                      </span>
                    )}
                  </span>
                </KV>
              )}
            </Section>

            {/* Data File Inventory */}
            <Section title={`Data Files${missingCount > 0 ? ` (${missingCount} missing)` : ''}`}>
              <table className="sync-diag-file-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>File</th>
                    <th>Size</th>
                    <th>Local Edits</th>
                    <th>Modified</th>
                  </tr>
                </thead>
                <tbody>
                  {taxonomyFiles.map((f: DiagnosticsFile) => (
                    <tr key={f.relative_path} className={f.exists ? '' : 'sync-diag-file-missing'}>
                      <td><FileStatusIcon file={f} /></td>
                      <td><code>{f.relative_path}</code></td>
                      <td>{formatBytes(f.size_bytes)}</td>
                      <td><EditCountsCell counts={f.edit_counts} /></td>
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
                          <td><FileStatusIcon file={f} /></td>
                          <td><code>{f.relative_path}</code></td>
                          <td>{formatBytes(f.size_bytes)}</td>
                          <td><EditCountsCell counts={f.edit_counts} /></td>
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
                  disabled={action.running || !diag.data_root_has_git || diag.ahead_of_main === 0 || !diag.github_credentials_valid}
                  onClick={() => setPrFormOpen(!prFormOpen)}
                  title={
                    !diag.github_credentials_valid ? 'GitHub credentials required'
                    : diag.ahead_of_main === 0 ? 'No local changes to submit'
                    : 'Create a pull request from your local changes'
                  }
                >
                  Create Pull Request
                </button>

                <button
                  className="btn btn-sm"
                  disabled={action.running || !diag.data_root_has_git}
                  onClick={() => runAction('Fetch from origin', () => fetchOriginTracked())}
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
                      onClick={() => { setConfirmReset(false); void runAction('Reset to origin/main', () => resetMainTracked()); }}
                    >
                      {action.running && action.label === 'Reset to origin/main' ? 'Resetting...' : 'Confirm Reset'}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setConfirmReset(false)}>Cancel</button>
                  </div>
                )}

                <button
                  className="btn btn-sm"
                  disabled={action.running || diag.data_root_has_git}
                  onClick={() => runAction('Initialize repo', () => initDataRepoTracked())}
                  title={diag.data_root_has_git ? 'Repo already initialized' : 'Clone data repo from GitHub'}
                >
                  {action.running && action.label === 'Initialize repo' ? 'Initializing...' : 'Initialize Repo'}
                </button>
              </div>

              {prFormOpen && (
                <CreatePrForm
                  files={taxonomyFiles.filter(f => !!f.git_status)}
                  running={action.running && action.label === 'Create Pull Request'}
                  onSubmit={async (title, body) => {
                    setAction({ running: true, label: 'Create Pull Request', error: null, success: null });
                    try {
                      const result = await createPullRequestTracked({ title, body });
                      setAction({
                        running: false, label: '', error: null,
                        success: `PR #${result.number} ${result.created ? 'created' : 'updated'}: ${result.url}`,
                      });
                      setPrFormOpen(false);
                      void refresh();
                    } catch (err) {
                      setAction({
                        running: false, label: '',
                        error: `Create Pull Request failed: ${err instanceof Error ? err.message : String(err)}`,
                        success: null,
                      });
                    }
                  }}
                  onCancel={() => setPrFormOpen(false)}
                />
              )}
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Create PR inline form (t/240) ──

function generatePrTitle(files: DiagnosticsFile[]): string {
  if (files.length === 0) return 'Data updates';
  const names = files.map(f => f.relative_path.split('/').pop() ?? f.relative_path);
  if (names.length <= 3) return `Update ${names.join(', ')}`;
  return `Update ${names.slice(0, 2).join(', ')} (+${names.length - 2} more)`;
}

function generatePrBody(files: DiagnosticsFile[]): string {
  if (files.length === 0) return '';
  const lines: string[] = ['## Changed files\n'];
  for (const f of files) {
    const status = f.git_status === 'A' ? 'Added' : f.git_status === 'D' ? 'Deleted' : 'Modified';
    let detail = `- **${f.relative_path}** — ${status}`;
    if (f.edit_counts) {
      const parts: string[] = [];
      if (f.edit_counts.added > 0) parts.push(`+${f.edit_counts.added} added`);
      if (f.edit_counts.modified > 0) parts.push(`~${f.edit_counts.modified} modified`);
      if (f.edit_counts.deleted > 0) parts.push(`-${f.edit_counts.deleted} deleted`);
      if (parts.length > 0) detail += ` (${parts.join(', ')})`;
    }
    lines.push(detail);
  }
  return lines.join('\n');
}

function CreatePrForm({
  files,
  running,
  onSubmit,
  onCancel,
}: {
  files: DiagnosticsFile[];
  running: boolean;
  onSubmit: (title: string, body: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(() => generatePrTitle(files));
  const [body, setBody] = useState(() => generatePrBody(files));

  return (
    <div className="pr-form">
      <div className="pr-form-section">
        <label className="pr-form-label">Files to include</label>
        <div className="pr-form-file-list">
          {files.length === 0 ? (
            <span className="sync-diag-muted">No modified files</span>
          ) : (
            files.map(f => (
              <div key={f.relative_path} className="pr-form-file-item">
                <FileStatusIcon file={f} />
                <code>{f.relative_path}</code>
                {f.edit_counts && (
                  <span className="edit-counts" style={{ marginLeft: 'auto' }}>
                    <EditCountsCell counts={f.edit_counts} />
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="pr-form-section">
        <label className="pr-form-label" htmlFor="pr-title">Title</label>
        <input
          id="pr-title"
          className="pr-form-input"
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="PR title"
          disabled={running}
        />
      </div>

      <div className="pr-form-section">
        <label className="pr-form-label" htmlFor="pr-body">Description</label>
        <textarea
          id="pr-body"
          className="pr-form-textarea"
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="PR description (Markdown)"
          rows={6}
          disabled={running}
        />
      </div>

      <div className="pr-form-actions">
        <button
          className="btn btn-primary btn-sm"
          disabled={running || !title.trim()}
          onClick={() => void onSubmit(title.trim(), body.trim())}
        >
          {running ? 'Creating...' : 'Submit Pull Request'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={running}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── GitHub Credentials Form ──

function GitHubCredentialsForm({
  defaultRepo,
  running,
  onSubmit,
  onCancel,
}: {
  defaultRepo: string;
  running: boolean;
  onSubmit: (repo: string, token: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [repo, setRepo] = useState(defaultRepo);
  const [token, setToken] = useState('');

  return (
    <div className="pr-form" style={{ marginTop: 8 }}>
      <div className="pr-form-section">
        <label className="pr-form-label" htmlFor="gh-repo">Repository (owner/repo)</label>
        <input
          id="gh-repo"
          className="pr-form-input"
          type="text"
          value={repo}
          onChange={e => setRepo(e.target.value)}
          placeholder="owner/repo"
          disabled={running}
          autoComplete="off"
        />
      </div>
      <div className="pr-form-section">
        <label className="pr-form-label" htmlFor="gh-token">Personal Access Token</label>
        <input
          id="gh-token"
          className="pr-form-input"
          type="password"
          value={token}
          onChange={e => setToken(e.target.value)}
          placeholder="ghp_..."
          disabled={running}
          autoComplete="off"
        />
        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>
          Needs <code>repo</code> scope. Create at github.com/settings/tokens.
        </div>
      </div>
      <div className="pr-form-actions">
        <button
          className="btn btn-primary btn-sm"
          disabled={running || !repo.includes('/') || !token.trim()}
          onClick={() => void onSubmit(repo.trim(), token.trim())}
        >
          {running ? 'Saving...' : 'Save Credentials'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={running}>
          Cancel
        </button>
      </div>
    </div>
  );
}
