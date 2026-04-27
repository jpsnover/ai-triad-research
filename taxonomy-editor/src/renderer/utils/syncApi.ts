// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Client wrapper for the Phase-1 /api/sync/* endpoints.
 *
 * Kept out of the full AppAPI bridge on purpose — sync is a server-side
 * capability (the server owns the git working tree). Renderer code calls
 * these directly via fetch; no IPC path is needed because the feature is
 * only meaningful when a server process is running.
 *
 * When GIT_SYNC_ENABLED is off the server returns `enabled: false` from
 * `getSyncStatus()` and empty arrays/strings elsewhere, so callers can
 * render a disabled UI without special-casing the network layer.
 */

export interface SyncStatus {
  enabled: boolean;
  unsynced_count: number;
  session_branch: string | null;
  pr_number: number | null;
  pr_url: string | null;
  push_pending: boolean;
  /** True when GITHUB_REPO + credentials are configured on the server. */
  github_configured: boolean;
  /** Set by the GitHub webhook when a PR merges on origin/main. */
  main_updated_available: boolean;
  /** True when a rebase is paused with unresolved conflicts. */
  rebase_in_progress: boolean;
}

export type ResyncMode = 'rebase' | 'fetch-only' | 'reset-main';

export interface CreatePrSuccess {
  ok: true;
  number: number;
  url: string;
  branch: string;
  created: boolean;
}

export interface ResyncSuccess {
  ok: true;
  mode: ResyncMode;
  session_ahead: number;
  main_sha: string;
  conflicts: boolean;
  /** Set when a rebase paused on conflict. */
  conflict_files?: string[];
  message: string;
}

export interface RebaseState {
  in_progress: boolean;
  conflict_files: string[];
  onto_branch: string | null;
}

export interface RebaseResolveResult { ok: true; remaining_files: string[]; }
export interface ContinueRebaseResult {
  ok: true;
  completed: boolean;
  conflict_files: string[];
  message: string;
}
export interface AbortRebaseResult { ok: true; message: string; }

export interface UnsyncedFile {
  path: string;
  /** Single-char git status code: 'M' | 'A' | 'D' | 'R' | '?' */
  status: string;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    throw new Error(`Sync server not available (got ${ct || 'text/html'} instead of JSON). Is the server running?`);
  }
  return res.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

const DISABLED_STATUS: SyncStatus = {
  enabled: false,
  unsynced_count: 0,
  session_branch: null,
  pr_number: null,
  pr_url: null,
  push_pending: false,
  github_configured: false,
  main_updated_available: false,
  rebase_in_progress: false,
};

export async function getSyncStatus(): Promise<SyncStatus> {
  try {
    return await getJson<SyncStatus>('/api/sync/status');
  } catch {
    return DISABLED_STATUS;
  }
}

export async function listUnsynced(): Promise<UnsyncedFile[]> {
  try {
    return await getJson<UnsyncedFile[]>('/api/sync/unsynced');
  } catch {
    return [];
  }
}

export async function getFileDiff(relPath: string): Promise<string> {
  try {
    const res = await getJson<{ path: string; diff: string }>(
      `/api/sync/diff?path=${encodeURIComponent(relPath)}`,
    );
    return res.diff || '';
  } catch {
    return '';
  }
}

export async function discardFile(relPath: string): Promise<void> {
  await postJson('/api/sync/discard', { path: relPath });
}

export async function discardAll(): Promise<void> {
  await postJson('/api/sync/discard', { all: true });
}

export async function createPullRequest(opts: { title?: string; body?: string }): Promise<CreatePrSuccess> {
  return postJson<CreatePrSuccess>('/api/sync/create-pr', opts);
}

export async function resync(mode: ResyncMode): Promise<ResyncSuccess> {
  return postJson<ResyncSuccess>('/api/sync/resync', { mode });
}

// ── Phase 4: rebase conflict resolution ──

export async function getRebaseState(): Promise<RebaseState> {
  try {
    return await getJson<RebaseState>('/api/sync/rebase-state');
  } catch {
    return { in_progress: false, conflict_files: [], onto_branch: null };
  }
}

export async function getRebaseFile(relPath: string): Promise<string> {
  const res = await getJson<{ path: string; content: string }>(
    `/api/sync/rebase-file?path=${encodeURIComponent(relPath)}`,
  );
  return res.content || '';
}

export async function resolveRebaseFile(relPath: string, content: string): Promise<RebaseResolveResult> {
  return postJson<RebaseResolveResult>('/api/sync/rebase/resolve', { path: relPath, content });
}

export async function continueRebase(): Promise<ContinueRebaseResult> {
  return postJson<ContinueRebaseResult>('/api/sync/rebase/continue', {});
}

export async function abortRebase(): Promise<AbortRebaseResult> {
  return postJson<AbortRebaseResult>('/api/sync/rebase/abort', {});
}

// ── Diagnostics ──

export interface DiagnosticsFile {
  relative_path: string;
  exists: boolean;
  size_bytes: number;
  modified_iso: string;
}

export interface DiagnosticsCommit {
  sha: string;
  message: string;
  author: string;
  date_iso: string;
}

export interface SyncDiagnostics {
  git_sync_enabled: boolean;
  data_root: string;
  data_root_has_git: boolean;
  github_repo: string | null;
  github_credentials_valid: boolean;
  current_branch: string | null;
  head_sha: string | null;
  origin_main_sha: string | null;
  ahead_of_main: number;
  behind_main: number;
  active_taxonomy_dir: string;
  files: DiagnosticsFile[];
  recent_commits: DiagnosticsCommit[];
}

export async function getSyncDiagnostics(): Promise<SyncDiagnostics> {
  return getJson<SyncDiagnostics>('/api/sync/diagnostics');
}

export async function initDataRepo(): Promise<{ ok: boolean; action?: string; message?: string; error?: string }> {
  return postJson('/api/sync/init', {});
}
