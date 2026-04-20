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
const GIT_INIT_TIMEOUT_MS = 120_000;

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

// ── Auto-init data repo ──

export interface InitResult {
  ok: true;
  action: 'initialized' | 'already-exists' | 'skipped';
  message: string;
}
export interface InitError {
  ok: false;
  error: string;
}

/**
 * If GIT_SYNC_ENABLED=1 but /data has no .git directory, clone the data repo
 * into place (git init + fetch + checkout). Called at server startup and
 * exposed via /api/sync/init for deploy-time triggering.
 *
 * Safe to call repeatedly — no-ops if .git already exists or if the feature
 * flag is off.
 */
export async function initDataRepo(): Promise<InitResult | InitError> {
  if (!isFeatureFlagEnabled()) {
    return { ok: true, action: 'skipped', message: 'GIT_SYNC_ENABLED is not set.' };
  }
  if (dataRootHasGit()) {
    return { ok: true, action: 'already-exists', message: 'Data repo already initialized.' };
  }

  const repoSlug = getRepoSlug();
  if (!repoSlug) {
    return { ok: false, error: 'GITHUB_REPO is not configured — cannot initialize data repo.' };
  }

  const dataRoot = getDataRoot();
  console.log(`[gitRepoStore] Initializing data repo in ${dataRoot} from ${repoSlug}...`);

  try {
    const creds = await getCredentials();
    const remoteUrl = creds
      ? `https://x-access-token:${creds.token}@github.com/${repoSlug}.git`
      : `https://github.com/${repoSlug}.git`;

    const opts = { cwd: dataRoot, timeout: GIT_INIT_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 };
    await execFileP('git', ['init'], opts);
    await execFileP('git', ['remote', 'add', 'origin', remoteUrl], opts);
    await execFileP('git', ['fetch', 'origin', 'main', '--depth=1'], opts);
    await execFileP('git', ['checkout', '-f', 'FETCH_HEAD'], opts);
    await execFileP('git', ['branch', '-M', 'main'], opts);

    console.log(`[gitRepoStore] Data repo initialized successfully.`);
    return { ok: true, action: 'initialized', message: `Initialized data repo from ${repoSlug}.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[gitRepoStore] initDataRepo failed: ${msg}`);
    return { ok: false, error: msg };
  }
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
  /**
   * Phase 4: true when a rebase is paused with unresolved conflicts. The UI
   * surfaces a persistent banner directing the user to the conflict modal.
   */
  rebase_in_progress: boolean;
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
      rebase_in_progress: false,
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

    const rebaseInProgress = await isRebaseInProgress();
    return {
      enabled: true,
      unsynced_count: files.size,
      session_branch: branch,
      pr_number: prInfo?.number ?? null,
      pr_url: prInfo?.url ?? null,
      push_pending: pushPending,
      github_configured: !!getRepoSlug(),
      main_updated_available: mainUpdatedAvailable,
      rebase_in_progress: rebaseInProgress,
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
  /** Present only when `conflicts === true`. Files with merge markers. */
  conflict_files?: string[];
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
      // Phase 4: leave the rebase paused so the user can resolve conflicts
      // through the UI. The conflict list comes from `git diff --name-only
      // --diff-filter=U` rather than parsing rebase output — more reliable.
      const files = await listConflictFiles();
      if (files.length === 0) {
        // Non-conflict rebase failure (lock contention, etc). Abort + report.
        await gitSafe(['rebase', '--abort']);
        return {
          ok: false as const,
          error: `rebase failed: ${rebase.error}`,
          code: 'rebase-failed' as const,
        };
      }
      return {
        ok: true as const, mode, session_ahead: 0,
        main_sha: mainSha, conflicts: true, conflict_files: files,
        message: `Rebase paused on ${files.length} conflict${files.length === 1 ? '' : 's'}. Resolve in the editor.`,
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

// ── Phase 4: interactive rebase conflict resolution ──
//
// When resync('rebase') hits a conflict we now leave the working tree in the
// paused state (HEAD detached on a replayed commit, merge markers in the
// conflicting files). These helpers let the UI walk the user through resolving
// each file and then continue or abort the rebase.

/** True when `.git/rebase-merge` or `.git/rebase-apply` exists. */
export async function isRebaseInProgress(): Promise<boolean> {
  if (!isEnabled()) return false;
  const root = getDataRoot();
  try {
    return fs.existsSync(path.join(root, '.git', 'rebase-merge'))
        || fs.existsSync(path.join(root, '.git', 'rebase-apply'));
  } catch { return false; }
}

/** Files with unmerged (conflict) entries in the index. */
async function listConflictFiles(): Promise<string[]> {
  const res = await gitSafe(['diff', '--name-only', '--diff-filter=U']);
  if (!res.ok) return [];
  return res.stdout.split('\n').map(s => s.trim()).filter(Boolean);
}

export interface RebaseState {
  in_progress: boolean;
  /** Files still unresolved (unmerged entries in the index). */
  conflict_files: string[];
  /** Session branch being rebased (null if no rebase is in progress). */
  onto_branch: string | null;
}

export async function getRebaseState(): Promise<RebaseState> {
  if (!(await isRebaseInProgress())) {
    return { in_progress: false, conflict_files: [], onto_branch: null };
  }
  const files = await listConflictFiles();
  // .git/rebase-merge/head-name holds "refs/heads/<branch>" for interactive-
  // style rebases. Fall back to the current symbolic ref if missing.
  let ontoBranch: string | null = null;
  try {
    const raw = fs.readFileSync(path.join(getDataRoot(), '.git', 'rebase-merge', 'head-name'), 'utf-8').trim();
    if (raw.startsWith('refs/heads/')) ontoBranch = raw.slice('refs/heads/'.length);
  } catch { /* not interactive-style or file missing */ }
  return { in_progress: true, conflict_files: files, onto_branch: ontoBranch };
}

/**
 * Return the current (working-tree) contents of a conflicted file, including
 * the `<<<<<<< HEAD ... ======= ... >>>>>>> branch` merge markers. The UI uses
 * this to render an editable textarea that the user resolves.
 */
export async function getRebaseFile(relPath: string): Promise<string | null> {
  if (!(await isRebaseInProgress())) return null;
  // Reject path traversal — same guard as discardFile.
  if (relPath.includes('..') || path.isAbsolute(relPath)) return null;
  const full = path.join(getDataRoot(), relPath);
  try { return fs.readFileSync(full, 'utf-8'); }
  catch { return null; }
}

export interface RebaseResolveResult {
  ok: true;
  remaining_files: string[];
}
export interface RebaseActionError {
  ok: false;
  error: string;
  code: 'not-in-progress' | 'invalid-path' | 'write-failed' | 'stage-failed';
}

/** Write user-edited content for one conflicted file and stage it. */
export async function resolveRebaseFile(relPath: string, content: string): Promise<RebaseResolveResult | RebaseActionError> {
  if (!(await isRebaseInProgress())) {
    return { ok: false, error: 'No rebase in progress.', code: 'not-in-progress' };
  }
  if (relPath.includes('..') || path.isAbsolute(relPath)) {
    return { ok: false, error: 'Invalid path.', code: 'invalid-path' };
  }
  return serialize(async () => {
    const full = path.join(getDataRoot(), relPath);
    try { fs.writeFileSync(full, content, 'utf-8'); }
    catch (err) { return { ok: false as const, error: `write failed: ${err instanceof Error ? err.message : String(err)}`, code: 'write-failed' as const }; }

    const staged = await gitSafe(['add', '--', relPath]);
    if (!staged.ok) return { ok: false as const, error: `git add failed: ${staged.error}`, code: 'stage-failed' as const };

    return { ok: true as const, remaining_files: await listConflictFiles() };
  });
}

export interface ContinueRebaseOk {
  ok: true;
  completed: boolean;
  /** Populated when the rebase hit another conflict commit (loop). */
  conflict_files: string[];
  message: string;
}
export interface ContinueRebaseError {
  ok: false;
  error: string;
  code: 'not-in-progress' | 'unresolved-files' | 'continue-failed';
  /** Files still unresolved (when code === 'unresolved-files'). */
  conflict_files?: string[];
}

/** Run `git rebase --continue`. If the next commit also conflicts, pause again. */
export async function continueRebase(): Promise<ContinueRebaseOk | ContinueRebaseError> {
  if (!(await isRebaseInProgress())) {
    return { ok: false, error: 'No rebase in progress.', code: 'not-in-progress' };
  }
  const remaining = await listConflictFiles();
  if (remaining.length > 0) {
    return {
      ok: false,
      error: `${remaining.length} file(s) still have conflicts.`,
      code: 'unresolved-files',
      conflict_files: remaining,
    };
  }

  return serialize(async () => {
    // --continue requires an author commit env when nothing changed in a file
    // (empty commit). GIT_EDITOR=true means the default commit message is kept.
    const cont = await gitSafe(['-c', 'core.editor=true', 'rebase', '--continue']);
    if (!cont.ok) {
      // Could be another conflict commit in the stack. Re-check.
      const nextConflicts = await listConflictFiles();
      if (nextConflicts.length > 0) {
        return {
          ok: true as const, completed: false, conflict_files: nextConflicts,
          message: `Next commit hit ${nextConflicts.length} conflict${nextConflicts.length === 1 ? '' : 's'}.`,
        };
      }
      return { ok: false as const, error: `rebase --continue failed: ${cont.error}`, code: 'continue-failed' as const };
    }

    // Rebase finished. Push rebased tip if a PR is open.
    const branch = await getCurrentBranchRaw();
    const prInfo = readPrInfo(branch);
    if (prInfo) {
      const creds = await getCredentials();
      if (creds) {
        const remoteUrl = `https://x-access-token:${creds.token}@github.com/${creds.repo}.git`;
        await gitSafe(['push', '--force-with-lease', remoteUrl, `HEAD:${branch}`]);
        await gitSafe(['fetch', 'origin', branch]);
      }
    }

    clearMainUpdatedAvailable();
    return {
      ok: true as const, completed: true, conflict_files: [],
      message: `Rebase completed on ${branch}.`,
    };
  });
}

export interface AbortRebaseOk { ok: true; message: string; }
export async function abortRebase(): Promise<AbortRebaseOk | RebaseActionError> {
  if (!(await isRebaseInProgress())) {
    return { ok: false, error: 'No rebase in progress.', code: 'not-in-progress' };
  }
  return serialize(async () => {
    const res = await gitSafe(['rebase', '--abort']);
    if (!res.ok) return { ok: false as const, error: `rebase --abort failed: ${res.error}`, code: 'stage-failed' as const };
    return { ok: true as const, message: 'Rebase aborted; session branch restored.' };
  });
}

/**
 * Re-used by the status endpoint. Surfaces whether any credentials are wired up
 * so the UI can render Phase-2 controls enabled vs. disabled-with-tooltip.
 */
export async function hasGithubCredentials(): Promise<boolean> {
  return (await getCredentials()) !== null;
}
