// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Git-backed data-repo sync for the Taxonomy Editor.
 *
 * Phase 1 (local-only, gated by GIT_SYNC_ENABLED=1):
 *   - every server-side write commits to a per-user session branch,
 *   - status/list/diff/discard surface the working tree.
 *
 * Phase 2 (network-touching, user-initiated; additionally requires
 * GITHUB_REPO + either a GitHub App installation or a PAT):
 *   - createPullRequest() pushes the session branch and opens/updates a PR,
 *   - resync() fetches origin and optionally rebases the session onto main
 *     or resets the local main ref.
 *
 * See docs/azure-github-data-sync-proposal.md for the full design.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { getDataRoot } from './config';
import { getCurrentUser } from './userContext';
import { getCredentials, getRepoSlug, githubFetch } from './githubAppAuth';

const execFileP = promisify(execFile);

const GIT_TIMEOUT_MS = 15_000;

function isFeatureFlagEnabled(): boolean {
  return process.env.GIT_SYNC_ENABLED === '1';
}

function dataRootHasGit(): boolean {
  try {
    return fs.existsSync(path.join(getDataRoot(), '.git'));
  } catch {
    return false;
  }
}

/** Whether sync is operational in this deployment. Cheap to call. */
export function isEnabled(): boolean {
  return isFeatureFlagEnabled() && dataRootHasGit();
}

// ── Low-level git exec ──

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', args, {
    cwd: getDataRoot(),
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024, // 10 MB — large diffs
  });
  return stdout;
}

async function gitSafe(args: string[]): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  try {
    return { ok: true, stdout: await git(args) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Per-user session branch ──

function sanitizeBranchSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'user';
}

/** Branch name for the current user's session. Deterministic per user for phase 1. */
export function sessionBranchName(): string {
  const user = getCurrentUser();
  const id = user?.principalName && user.principalName !== '_local'
    ? sanitizeBranchSegment(user.principalName)
    : 'local';
  return `web-session/${id}`;
}

function authorIdentity(): { name: string; email: string } {
  const user = getCurrentUser();
  const name = user?.principalName && user.principalName !== '_local' ? user.principalName : 'local-web';
  const email = `${sanitizeBranchSegment(name)}@web-edits.local`;
  return { name, email };
}

// ── Serialize all git ops through a single promise chain. ──
// Container App is a single replica (minReplicas=0, maxReplicas=1 in Bicep), so
// in-process serialization is sufficient for phase 1. Multi-replica support
// would require a Redis or advisory-lock-backed mutex.

let gitChain: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = gitChain.then(fn, fn);
  gitChain = next.catch(() => {}); // don't poison the chain on failure
  return next;
}

// ── Branch setup ──

async function getCurrentBranchRaw(): Promise<string> {
  return (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
}

async function localBranchExists(name: string): Promise<boolean> {
  const r = await gitSafe(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]);
  return r.ok;
}

async function ensureSessionBranch(): Promise<string> {
  const branch = sessionBranchName();
  const current = await getCurrentBranchRaw().catch(() => '');
  if (current === branch) return branch;

  if (await localBranchExists(branch)) {
    await git(['checkout', branch]);
  } else {
    await git(['checkout', '-b', branch]);
  }
  return branch;
}

// ── Commit on save ──

/**
 * Stage + commit any working-tree changes on the session branch.
 * Safe to call after every write; a clean tree yields no commit.
 * Never throws — failures are logged and swallowed so the save path
 * is never blocked by a git hiccup.
 */
export async function commitWorkingTreeChanges(summary?: string): Promise<void> {
  if (!isEnabled()) return;

  try {
    await serialize(async () => {
      await ensureSessionBranch();

      const status = (await git(['status', '--porcelain'])).trim();
      if (!status) return;

      await git(['add', '-A']);

      const staged = (await git(['diff', '--cached', '--name-only'])).trim();
      if (!staged) return;

      const { name, email } = authorIdentity();
      const msg = summary || `web-edit: ${staged.split('\n').slice(0, 5).join(', ')}`;
      await git([
        '-c', `user.name=${name}`,
        '-c', `user.email=${email}`,
        'commit',
        '--author', `${name} <${email}>`,
        '-m', msg,
      ]);
    });
  } catch (err) {
    console.error('[gitRepoStore] commitWorkingTreeChanges failed:', err instanceof Error ? err.message : err);
  }
}

// ── Status / listing / diff ──

export interface SyncStatus {
  enabled: boolean;
  unsynced_count: number;
  session_branch: string | null;
  pr_number: number | null;
  pr_url: string | null;
  /** True when a PR is open but the session branch has commits not yet pushed. */
  push_pending: boolean;
  /** True when GITHUB_REPO + credentials are configured. Drives Phase-2 UI. */
  github_configured: boolean;
  /**
   * Phase 3: set by the webhook handler when a PR merges on GitHub, so the UI
   * can proactively prompt the user to resync. Cleared after a successful
   * resync of any mode.
   */
  main_updated_available: boolean;
}

export interface UnsyncedFile {
  path: string;
  /** Single-char git status code: 'M' modified, 'A' added, 'D' deleted, 'R' renamed, '?' untracked. */
  status: string;
}

/**
 * Returns the current sync state for the UI.
 * Disabled when GIT_SYNC_ENABLED is off — still safe to call.
 */
export async function getSyncStatus(): Promise<SyncStatus> {
  if (!isEnabled()) {
    return {
      enabled: false, unsynced_count: 0, session_branch: null,
      pr_number: null, pr_url: null, push_pending: false,
      github_configured: false, main_updated_available: false,
    };
  }

  return serialize(async () => {
    const branch = await ensureSessionBranch();

    // Count files that differ between the session branch and origin/main.
    // Falls back to just the working-tree diff vs main if origin/main is missing.
    const mainRef = (await gitSafe(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'])).ok
      ? 'origin/main'
      : 'main';

    const changed = (await git(['diff', '--name-only', mainRef, 'HEAD'])).trim();
    const workingTreeDiff = (await git(['status', '--porcelain'])).trim();

    const files = new Set<string>();
    if (changed) changed.split('\n').forEach(p => files.add(p));
    if (workingTreeDiff) {
      workingTreeDiff.split('\n').forEach(line => {
        const p = line.slice(3).trim();
        if (p) files.add(p);
      });
    }

    const prInfo = readPrInfo(branch);
    let pushPending = false;
    if (prInfo) {
      // PR is open: compare local session-branch HEAD with its remote tracking ref.
      const remoteRef = `refs/remotes/origin/${branch}`;
      const remoteExists = (await gitSafe(['rev-parse', '--verify', '--quiet', remoteRef])).ok;
      if (remoteExists) {
        const local = (await git(['rev-parse', 'HEAD'])).trim();
        const remote = (await git(['rev-parse', remoteRef])).trim();
        pushPending = local !== remote;
      } else {
        pushPending = true; // PR recorded but no remote tracking ref yet
      }
    }

    return {
      enabled: true,
      unsynced_count: files.size,
      session_branch: branch,
      pr_number: prInfo?.number ?? null,
      pr_url: prInfo?.url ?? null,
      push_pending: pushPending,
      github_configured: !!getRepoSlug(),
      main_updated_available: mainUpdatedAvailable,
    };
  });
}

// ── Phase 3: upstream-updated flag ──
//
// The GitHub webhook handler (server.ts /api/sync/webhook/github) sets this
// flag when a PR merges on origin/main. The UI banners "new changes available".
// Cleared whenever resync() runs successfully (any mode), since any of them
// results in the user having seen / applied the new main.

let mainUpdatedAvailable = false;

export function markMainUpdatedAvailable(): void {
  mainUpdatedAvailable = true;
}

function clearMainUpdatedAvailable(): void {
  mainUpdatedAvailable = false;
}

/** Per-file list for the unsynced-changes drawer. */
export async function listUnsynced(): Promise<UnsyncedFile[]> {
  if (!isEnabled()) return [];

  return serialize(async () => {
    await ensureSessionBranch();

    const mainRef = (await gitSafe(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'])).ok
      ? 'origin/main'
      : 'main';

    // Committed-on-branch deltas
    const nameStatus = (await git(['diff', '--name-status', mainRef, 'HEAD'])).trim();
    const map = new Map<string, string>();
    if (nameStatus) {
      for (const line of nameStatus.split('\n')) {
        const [code, ...rest] = line.split('\t');
        const p = rest.join('\t');
        if (p) map.set(p, code[0] || 'M');
      }
    }

    // Plus anything dirty in the working tree not yet committed
    const porcelain = (await git(['status', '--porcelain'])).trim();
    if (porcelain) {
      for (const line of porcelain.split('\n')) {
        const code = line.slice(0, 2).trim() || 'M';
        const p = line.slice(3).trim();
        if (p && !map.has(p)) map.set(p, code[0] === '?' ? 'A' : code[0]);
      }
    }

    return Array.from(map.entries())
      .map(([path, status]) => ({ path, status }))
      .sort((a, b) => a.path.localeCompare(b.path));
  });
}

/** Unified diff of a single file vs origin/main (or main). */
export async function getFileDiff(relPath: string): Promise<string> {
  if (!isEnabled()) return '';

  // Guard against shell injection / path escape
  if (relPath.includes('..') || path.isAbsolute(relPath)) {
    throw new Error(`Invalid path: ${relPath}`);
  }

  return serialize(async () => {
    await ensureSessionBranch();
    const mainRef = (await gitSafe(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'])).ok
      ? 'origin/main'
      : 'main';

    // Prefer session-branch vs main; fall back to working-tree if nothing committed yet.
    const committed = await gitSafe(['diff', '--no-color', mainRef, 'HEAD', '--', relPath]);
    if (committed.ok && committed.stdout.trim()) return committed.stdout;

    const working = await gitSafe(['diff', '--no-color', 'HEAD', '--', relPath]);
    if (working.ok && working.stdout.trim()) return working.stdout;

    // Untracked file: synthesise an "added" diff.
    const untracked = await gitSafe(['status', '--porcelain', '--', relPath]);
    if (untracked.ok && untracked.stdout.startsWith('??')) {
      const full = path.join(getDataRoot(), relPath);
      try {
        const content = fs.readFileSync(full, 'utf-8');
        const lines = content.split('\n');
        return [
          `--- /dev/null`,
          `+++ b/${relPath}`,
          `@@ -0,0 +1,${lines.length} @@`,
          ...lines.map(l => `+${l}`),
        ].join('\n');
      } catch {
        return '';
      }
    }

    return '';
  });
}

// ── Discard ──

/** Revert a single file on the session branch, then rewrite history to exclude it. */
export async function discardFile(relPath: string): Promise<void> {
  if (!isEnabled()) return;
  if (relPath.includes('..') || path.isAbsolute(relPath)) {
    throw new Error(`Invalid path: ${relPath}`);
  }

  await serialize(async () => {
    await ensureSessionBranch();
    const mainRef = (await gitSafe(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'])).ok
      ? 'origin/main'
      : 'main';

    // 1) Restore the file content to what main has. If main doesn't have it, delete it.
    const existsOnMain = await gitSafe(['cat-file', '-e', `${mainRef}:${relPath}`]);
    if (existsOnMain.ok) {
      await git(['checkout', mainRef, '--', relPath]);
    } else {
      const full = path.join(getDataRoot(), relPath);
      if (fs.existsSync(full)) fs.unlinkSync(full);
      await gitSafe(['rm', '--cached', '--ignore-unmatch', '--', relPath]);
    }

    // 2) Commit the restoration on the session branch.
    const status = (await git(['status', '--porcelain'])).trim();
    if (status) {
      await git(['add', '-A']);
      const { name, email } = authorIdentity();
      await git([
        '-c', `user.name=${name}`,
        '-c', `user.email=${email}`,
        'commit',
        '--author', `${name} <${email}>`,
        '-m', `discard: ${relPath}`,
      ]);
    }
  });
}

/** Reset the session branch to origin/main (or main), dropping all local commits. */
export async function discardAll(): Promise<void> {
  if (!isEnabled()) return;

  await serialize(async () => {
    await ensureSessionBranch();
    const mainRef = (await gitSafe(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'])).ok
      ? 'origin/main'
      : 'main';
    await git(['reset', '--hard', mainRef]);
    await git(['clean', '-fd']);
    clearPrInfo(await getCurrentBranchRaw());
  });
}

// ── PR state persistence ──
//
// The server remembers which PR (if any) corresponds to a given session
// branch in .git/webedit-pr-map.json. This avoids a GitHub API roundtrip on
// every status poll, and survives container restarts because .git lives on
// the same persistent volume as the working tree.

interface PrInfo { number: number; url: string; }
type PrMap = Record<string, PrInfo>;

function prMapPath(): string {
  return path.join(getDataRoot(), '.git', 'webedit-pr-map.json');
}

function readPrMap(): PrMap {
  try {
    const raw = fs.readFileSync(prMapPath(), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as PrMap;
  } catch { /* file missing or corrupt — treat as empty */ }
  return {};
}

function writePrMap(map: PrMap): void {
  try {
    fs.writeFileSync(prMapPath(), JSON.stringify(map, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[gitRepoStore] could not persist PR map:', err);
  }
}

function readPrInfo(branch: string): PrInfo | null {
  return readPrMap()[branch] ?? null;
}

function setPrInfo(branch: string, info: PrInfo): void {
  const map = readPrMap();
  map[branch] = info;
  writePrMap(map);
}

function clearPrInfo(branch: string): void {
  const map = readPrMap();
  if (map[branch]) {
    delete map[branch];
    writePrMap(map);
  }
}

// ── Phase 2: Create pull request ──

export interface CreatePrResult {
  ok: true;
  number: number;
  url: string;
  branch: string;
  created: boolean; // false when we reused an existing PR
}
export interface CreatePrError {
  ok: false;
  error: string;
  code: 'disabled' | 'no-credentials' | 'no-changes' | 'push-failed' | 'api-failed';
}

/**
 * Pushes the session branch to origin and opens (or updates) a PR against main.
 * Idempotent: if a PR already exists for `head = session-branch` it returns
 * that PR's info and only re-pushes.
 */
export async function createPullRequest(opts: { title?: string; body?: string }): Promise<CreatePrResult | CreatePrError> {
  if (!isEnabled()) return { ok: false, error: 'Git sync is disabled on this server.', code: 'disabled' };

  const creds = await getCredentials();
  if (!creds) return { ok: false, error: 'GitHub credentials are not configured.', code: 'no-credentials' };

  return serialize(async () => {
    const branch = await ensureSessionBranch();
    const mainRef = (await gitSafe(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'])).ok
      ? 'origin/main' : 'main';

    // Refuse to open a PR for a clean branch — there's nothing to review.
    const aheadCount = (await git(['rev-list', '--count', `${mainRef}..HEAD`])).trim();
    if (aheadCount === '0') {
      return { ok: false as const, error: 'Session branch has no new commits vs main.', code: 'no-changes' as const };
    }

    // Push via token-auth URL. Keep the token off origin's persisted remote.
    const remoteUrl = `https://x-access-token:${creds.token}@github.com/${creds.repo}.git`;
    const push = await gitSafe(['push', '--force-with-lease', remoteUrl, `HEAD:${branch}`]);
    if (!push.ok) {
      return { ok: false as const, error: `git push failed: ${push.error}`, code: 'push-failed' as const };
    }

    // Fetch the remote tracking ref so push_pending calculations work.
    await gitSafe(['fetch', 'origin', branch]);

    const [owner, repoName] = creds.repo.split('/');

    // Does a PR already exist for head = <branch>?
    const existing = await githubFetch(creds, `/repos/${owner}/${repoName}/pulls?head=${owner}:${encodeURIComponent(branch)}&state=open`);
    if (existing.ok && Array.isArray(existing.data) && existing.data.length > 0) {
      const pr = existing.data[0] as { number: number; html_url: string };
      setPrInfo(branch, { number: pr.number, url: pr.html_url });
      // Best-effort body refresh if the caller provided one.
      if (opts.body) {
        await githubFetch(creds, `/repos/${owner}/${repoName}/pulls/${pr.number}`, {
          method: 'PATCH',
          body: { body: opts.body, ...(opts.title ? { title: opts.title } : {}) },
        });
      }
      return { ok: true as const, number: pr.number, url: pr.html_url, branch, created: false };
    }

    // Open a new PR.
    const title = opts.title?.trim() || `Web edits on ${branch}`;
    const body = opts.body ?? '';
    const created = await githubFetch(creds, `/repos/${owner}/${repoName}/pulls`, {
      method: 'POST',
      body: { title, body, head: branch, base: 'main' },
    });
    if (!created.ok) {
      return { ok: false as const, error: created.error ?? 'GitHub API failed', code: 'api-failed' as const };
    }
    const pr = created.data as { number: number; html_url: string };
    setPrInfo(branch, { number: pr.number, url: pr.html_url });
    return { ok: true as const, number: pr.number, url: pr.html_url, branch, created: true };
  });
}

// ── Phase 2: Resync with GitHub ──

export type ResyncMode = 'rebase' | 'fetch-only' | 'reset-main';
export interface ResyncResult {
  ok: true;
  mode: ResyncMode;
  /** Commits the session branch gained relative to new origin/main (after operation). */
  session_ahead: number;
  /** origin/main SHA after fetch. */
  main_sha: string;
  /** True when a rebase paused on conflict and needs manual resolution. */
  conflicts: boolean;
  message: string;
}
export interface ResyncError {
  ok: false;
  error: string;
  code: 'disabled' | 'no-credentials' | 'fetch-failed' | 'reset-failed' | 'rebase-failed';
}

export async function resync(mode: ResyncMode): Promise<ResyncResult | ResyncError> {
  if (!isEnabled()) return { ok: false, error: 'Git sync is disabled on this server.', code: 'disabled' };

  const creds = await getCredentials();
  if (!creds) return { ok: false, error: 'GitHub credentials are not configured.', code: 'no-credentials' };

  return serialize(async () => {
    const branch = await ensureSessionBranch();
    const remoteUrl = `https://x-access-token:${creds.token}@github.com/${creds.repo}.git`;

    // 1) Always fetch first.
    const fetchRes = await gitSafe(['fetch', remoteUrl, 'main', `+refs/heads/main:refs/remotes/origin/main`]);
    if (!fetchRes.ok) {
      return { ok: false as const, error: `git fetch failed: ${fetchRes.error}`, code: 'fetch-failed' as const };
    }

    const mainShaRaw = await gitSafe(['rev-parse', 'refs/remotes/origin/main']);
    const mainSha = mainShaRaw.ok ? mainShaRaw.stdout.trim() : '';

    if (mode === 'fetch-only') {
      const ahead = (await git(['rev-list', '--count', `refs/remotes/origin/main..HEAD`])).trim();
      clearMainUpdatedAvailable();
      return {
        ok: true as const, mode, session_ahead: parseInt(ahead, 10) || 0,
        main_sha: mainSha, conflicts: false,
        message: `Fetched origin/main at ${mainSha.slice(0, 7)}. Session branch not moved.`,
      };
    }

    if (mode === 'reset-main') {
      // Move local `main` to match origin/main — does not touch the session branch.
      // Uses update-ref so we don't have to checkout/restore the session branch.
      const reset = await gitSafe(['update-ref', 'refs/heads/main', 'refs/remotes/origin/main']);
      if (!reset.ok) {
        return { ok: false as const, error: `reset main failed: ${reset.error}`, code: 'reset-failed' as const };
      }
      const ahead = (await git(['rev-list', '--count', `refs/remotes/origin/main..HEAD`])).trim();
      clearMainUpdatedAvailable();
      return {
        ok: true as const, mode, session_ahead: parseInt(ahead, 10) || 0,
        main_sha: mainSha, conflicts: false,
        message: `Local main reset to ${mainSha.slice(0, 7)}.`,
      };
    }

    // mode === 'rebase' — rebase the session branch onto the new origin/main.
    // Also fast-forward local `main` so future discards go to the right place.
    await gitSafe(['update-ref', 'refs/heads/main', 'refs/remotes/origin/main']);

    const rebase = await gitSafe(['rebase', 'refs/remotes/origin/main']);
    if (!rebase.ok) {
      // Conflict — leave the rebase paused so the user can resolve (Phase 2.1 UI
      // will surface this). For now, abort so we don't leave the repo in a
      // half-rebased state, and report the conflict to the caller.
      await gitSafe(['rebase', '--abort']);
      return {
        ok: false as const,
        error: `rebase conflict on ${branch}. Rebase was aborted — resolve manually or choose Fetch-only.`,
        code: 'rebase-failed' as const,
      };
    }

    // If there's an open PR, push the rebased tip (force-with-lease).
    const prInfo = readPrInfo(branch);
    if (prInfo) {
      await gitSafe(['push', '--force-with-lease', remoteUrl, `HEAD:${branch}`]);
      await gitSafe(['fetch', 'origin', branch]);
    }

    const ahead = (await git(['rev-list', '--count', `refs/remotes/origin/main..HEAD`])).trim();
    clearMainUpdatedAvailable();
    return {
      ok: true as const, mode, session_ahead: parseInt(ahead, 10) || 0,
      main_sha: mainSha, conflicts: false,
      message: `Rebased ${branch} onto ${mainSha.slice(0, 7)}.`,
    };
  });
}

/**
 * Re-used by the status endpoint. Surfaces whether any credentials are wired up
 * so the UI can render Phase-2 controls enabled vs. disabled-with-tooltip.
 */
export async function hasGithubCredentials(): Promise<boolean> {
  return (await getCredentials()) !== null;
}
