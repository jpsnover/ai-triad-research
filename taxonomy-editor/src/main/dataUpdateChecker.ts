// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Checks the ai-triad-data git repo for available updates.
 * Only runs if connected to the internet and the data repo is a git repo.
 */

import { execFile } from 'child_process';
import { resolveDataPath } from './fileIO';
import fs from 'fs';
import path from 'path';
import { net } from 'electron';

export interface DataUpdateStatus {
  available: boolean;
  behindCount: number;
  currentCommit: string;
  remoteCommit: string;
  error?: string;
}

function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: 15000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

async function isOnline(): Promise<boolean> {
  try {
    const resp = await net.fetch('https://github.com', { method: 'HEAD' });
    return resp.ok || resp.status === 301 || resp.status === 302;
  } catch {
    return false;
  }
}

export async function checkForDataUpdates(): Promise<DataUpdateStatus> {
  const dataRoot = resolveDataPath('.');
  const gitDir = path.join(dataRoot, '.git');

  // Not a git repo — nothing to check
  if (!fs.existsSync(gitDir)) {
    return { available: false, behindCount: 0, currentCommit: '', remoteCommit: '', error: 'Data directory is not a git repo' };
  }

  // Check connectivity
  const online = await isOnline();
  if (!online) {
    return { available: false, behindCount: 0, currentCommit: '', remoteCommit: '', error: 'offline' };
  }

  try {
    // Fetch latest from remote without merging
    await runGit(['fetch', 'origin', '--quiet'], dataRoot);

    // Get current and remote HEAD
    const currentCommit = await runGit(['rev-parse', 'HEAD'], dataRoot);
    const remoteCommit = await runGit(['rev-parse', 'origin/main'], dataRoot);

    if (currentCommit === remoteCommit) {
      return { available: false, behindCount: 0, currentCommit, remoteCommit };
    }

    // Count commits behind
    const behindOutput = await runGit(['rev-list', '--count', `HEAD..origin/main`], dataRoot);
    const behindCount = parseInt(behindOutput, 10) || 0;

    return { available: behindCount > 0, behindCount, currentCommit, remoteCommit };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[DataUpdateChecker] Error:', msg);
    return { available: false, behindCount: 0, currentCommit: '', remoteCommit: '', error: msg };
  }
}

export async function pullDataUpdates(): Promise<{ success: boolean; message: string }> {
  const dataRoot = resolveDataPath('.');
  try {
    // Clear stale lock file left by a crashed git process
    const lockPath = path.join(dataRoot, '.git', 'index.lock');
    try {
      const st = fs.statSync(lockPath);
      if (Date.now() - st.mtimeMs > 5 * 60 * 1000) {
        fs.unlinkSync(lockPath);
        console.log('[DataUpdateChecker] Removed stale index.lock');
      }
    } catch { /* doesn't exist — normal */ }

    // Auto-commit any dirty working tree so pull doesn't fail on conflicts
    const status = await runGit(['status', '--porcelain'], dataRoot);
    if (status) {
      await runGit(['add', '-A'], dataRoot);
      await runGit(['-c', 'user.name=electron-auto', '-c', 'user.email=auto@local',
        'commit', '-m', 'auto-commit: stash local changes before pull'], dataRoot);
    }

    const output = await runGit(['pull', '--rebase', 'origin', 'main'], dataRoot);
    return { success: true, message: output || 'Up to date' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: msg };
  }
}
