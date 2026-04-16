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
  push_pending: boolean;
}

export interface UnsyncedFile {
  path: string;
  /** Single-char git status code: 'M' | 'A' | 'D' | 'R' | '?' */
  status: string;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
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
  push_pending: false,
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
