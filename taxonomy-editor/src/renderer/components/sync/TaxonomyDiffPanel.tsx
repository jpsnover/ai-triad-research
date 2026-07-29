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
import { bridgeGet } from '../../bridge/web-bridge';
import { createPullRequestTracked, type CreatePrSuccess, type SyncStatus } from '../../utils/syncApi';
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
  /** Current sync status — drives the submit affordance (branch, existing PR, GitHub config). */
  status?: SyncStatus;
  /** Optional: switch to the file-level actions drawer (discard / resync). */
  onManageChanges?: () => void;
  /** Called after a PR is created/updated so the parent can re-poll sync status. */
  onSubmitted?: () => void;
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
  } catch (err) {
    // Recoverable display fallback (e.g. circular refs / BigInt) — debug level, not an error path.
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'TaxonomyDiffPanel',
      level: 'debug',
      message: 'formatValue: value not JSON-serializable, using String() fallback',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
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
    return await bridgeGet<NodeDiffResponse>('/api/sync/node-diff');
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

/** Build a default PR description summarising the node-level changes. */
function defaultPrBody(data: NodeDiffResponse): string {
  const { added, modified, removed } = data.totals;
  const summary = `Taxonomy edits via the web UI: ${added} added, ${modified} modified, ${removed} removed.`;
  const fileLines = data.files
    .slice(0, 20)
    .map(f => {
      const parts: string[] = [];
      if (f.added.length) parts.push(`+${f.added.length}`);
      if (f.modified.length) parts.push(`~${f.modified.length}`);
      if (f.removed.length) parts.push(`−${f.removed.length}`);
      return `- \`${fileLabel(f.path)}\` (${parts.join(' ')})`;
    });
  const extra = data.files.length > 20 ? `\n…and ${data.files.length - 20} more file(s).` : '';
  return `${summary}\n\n**Changed files:**\n${fileLines.join('\n')}${extra}`;
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

export function TaxonomyDiffPanel({ open, onClose, status, onManageChanges, onSubmitted }: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<NodeDiffResponse | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  // ── Pre-submission / PR state (Phase 5E) ──
  const [description, setDescription] = useState('');
  const [descTouched, setDescTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<CreatePrSuccess | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setUnavailable(false);
    const res = await fetchNodeDiff();
    if (res && res.enabled) {
      setData(res);
      // Seed the description from the diff unless the user has edited it.
      setDescription(prev => (descTouched ? prev : defaultPrBody(res)));
    } else {
      setData(null);
      setUnavailable(true);
    }
    setLoading(false);
  }, [descTouched]);

  useEffect(() => {
    if (!open) return;
    // Fresh review each time the panel opens.
    setSubmitted(null);
    setSubmitError(null);
    setDescTouched(false);
    void refresh();
    // refresh is intentionally excluded — we want this to run on open, not on
    // every descTouched-driven refresh identity change.
  }, [open]);

  const onSubmit = useCallback(async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await createPullRequestTracked({ body: description });
      setSubmitted(res);
      onSubmitted?.();
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'taxonomy-diff-panel',
        level: 'error',
        message: 'Submit for review (create/update PR) failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [description, onSubmitted]);

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

  // Submission affordance is only meaningful with real changes and a known status.
  const canSubmit = totalCount > 0 && !!status;
  const ghDisabled = !status?.github_configured;
  const existingPr = !!status?.pr_number;

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

        <DiffPanelBody loading={loading} unavailable={unavailable} totalCount={totalCount} data={data} />

        <DiffPanelFooter
          canSubmit={canSubmit}
          submitted={submitted}
          onManageChanges={onManageChanges}
          description={description}
          setDescription={setDescription}
          setDescTouched={setDescTouched}
          submitting={submitting}
          submitError={submitError}
          ghDisabled={ghDisabled}
          existingPr={existingPr}
          status={status}
          onSubmit={onSubmit}
          onClose={onClose}
        />
      </div>
    </div>
  );
}

// ── Panel body + footer (extracted for complexity, t/1918) ──

function DiffPanelBody({ loading, unavailable, totalCount, data }: {
  loading: boolean; unavailable: boolean; totalCount: number; data: NodeDiffResponse | null;
}) {
  return (
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
  );
}

function DiffPanelFooter({
  canSubmit, submitted, onManageChanges, description, setDescription, setDescTouched,
  submitting, submitError, ghDisabled, existingPr, status, onSubmit, onClose,
}: {
  canSubmit: boolean; submitted: CreatePrSuccess | null; onManageChanges?: () => void;
  description: string; setDescription: (v: string) => void; setDescTouched: (v: boolean) => void;
  submitting: boolean; submitError: string | null; ghDisabled: boolean; existingPr: boolean;
  status?: SyncStatus; onSubmit: () => void | Promise<void>; onClose: () => void;
}) {
  if (!(canSubmit || submitted || onManageChanges)) return null;
  return (
    <div className="txdiff-footer">
      {submitted ? (
        <div className="txdiff-submitted">
          <span className="txdiff-submitted-msg">
            {submitted.created ? 'Opened' : 'Updated'} PR #{submitted.number} ·{' '}
            <a href={submitted.url} target="_blank" rel="noreferrer noopener">View on GitHub ↗</a>
          </span>
          <button className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
        </div>
      ) : canSubmit ? (
        <DiffPanelSubmitForm
          description={description}
          setDescription={setDescription}
          setDescTouched={setDescTouched}
          submitting={submitting}
          submitError={submitError}
          ghDisabled={ghDisabled}
          existingPr={existingPr}
          status={status}
          onSubmit={onSubmit}
          onManageChanges={onManageChanges}
          onClose={onClose}
        />
      ) : onManageChanges ? (
        <button
          className="btn btn-ghost"
          onClick={() => { onClose(); onManageChanges(); }}
          title="Open the sync drawer to resync or discard changes"
        >
          Manage changes →
        </button>
      ) : null}
    </div>
  );
}

function DiffPanelSubmitForm({
  description, setDescription, setDescTouched, submitting, submitError,
  ghDisabled, existingPr, status, onSubmit, onManageChanges, onClose,
}: {
  description: string; setDescription: (v: string) => void; setDescTouched: (v: boolean) => void;
  submitting: boolean; submitError: string | null; ghDisabled: boolean; existingPr: boolean;
  status?: SyncStatus; onSubmit: () => void | Promise<void>; onManageChanges?: () => void; onClose: () => void;
}) {
  return (
    <div className="txdiff-submit">
      <label className="txdiff-submit-label">
        <span>Description</span>
        <textarea
          rows={4}
          value={description}
          onChange={e => { setDescription(e.target.value); setDescTouched(true); }}
          disabled={submitting}
          placeholder="Describe these changes for the reviewer…"
        />
      </label>
      {submitError && <div className="txdiff-submit-error">{submitError}</div>}
      <div className="txdiff-submit-actions">
        {onManageChanges && (
          <button
            className="btn btn-ghost"
            onClick={() => { onClose(); onManageChanges(); }}
            disabled={submitting}
            title="Open the sync drawer to resync or discard changes"
          >
            Manage changes →
          </button>
        )}
        <button
          className="btn btn-primary"
          onClick={() => void onSubmit()}
          disabled={submitting || ghDisabled}
          title={ghDisabled
            ? 'GitHub is not configured on this server.'
            : (existingPr ? 'Push the latest changes and update the pull request' : 'Open a pull request from your session branch to main')}
        >
          {submitting
            ? (existingPr ? 'Updating…' : 'Submitting…')
            : (existingPr ? `Update PR #${status!.pr_number}` : 'Submit for review')}
        </button>
      </div>
    </div>
  );
}
