// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Git-backed data-repo sync for the Taxonomy Editor (Phase 1).
 *
 * When GIT_SYNC_ENABLED=1 and the data root is a git working tree, every
 * server-side write is followed by a local commit on a per-user session
 * branch. No push, no GitHub API — phase 1 is strictly local. Phase 2 adds
 * "Create pull request" and "Resync with GitHub" actions that go through
 * a registered GitHub App.
 *
 * See docs/azure-github-data-sync-proposal.md for the full design.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { getDataRoot } from './config';
import { getCurrentUser } from './userContext';

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
  push_pending: boolean;
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
    return { enabled: false, unsynced_count: 0, session_branch: null, pr_number: null, push_pending: false };
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

    return {
      enabled: true,
      unsynced_count: files.size,
      session_branch: branch,
      pr_number: null, // phase 2
      push_pending: false, // phase 2
    };
  });
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
  });
}
