// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import { execFileSync } from 'child_process';
import { getGlobalRecorder } from '../flight-recorder/index.js';
import { ActionableError } from './errors.js';

/**
 * Safely serialize a value to JSON, catching circular references and
 * non-serializable fields. On failure, retries with a sanitizing replacer
 * that strips functions, undefined, and circular references.
 */
export function safeSerialize(value: unknown, indent: number = 2): { json: string; hadError: boolean; errorMessage?: string } {
  try {
    const json = JSON.stringify(value, null, indent);
    return { json, hadError: false };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'persistence', level: 'error',
      message: `JSON.stringify failed, retrying with sanitizing replacer: ${errorMessage}`,
      error: { name: (err as Error).name ?? 'Error', message: errorMessage, stack: (err as Error).stack },
    });

    // Retry with a replacer that handles circular refs and non-serializable values
    const seen = new WeakSet();
    const json = JSON.stringify(value, (_key, val) => {
      if (typeof val === 'function') return undefined;
      if (typeof val === 'bigint') return val.toString();
      if (val != null && typeof val === 'object') {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      return val;
    }, indent);

    return { json, hadError: true, errorMessage };
  }
}

// t/2544: identify the process holding a file lock (Windows only, requires handle.exe on PATH).
function queryLockHolder(filePath: string): { processName?: string; pid?: number; unavailable?: boolean; reason?: string } {
  if (process.platform !== 'win32') return { unavailable: true, reason: 'non-Windows' };
  try {
    const output = execFileSync('handle.exe', [filePath], { timeout: 2000, encoding: 'utf-8' });
    // handle.exe output: "<ProcessName>  pid: <pid>  type: File  <handle>: <path>"
    const match = output.match(/^(\S+)\s+pid:\s+(\d+)\s/m);
    if (match) return { processName: match[1], pid: parseInt(match[2], 10) };
    return { unavailable: true, reason: 'handle.exe output not parseable' };
  } catch {
    return { unavailable: true, reason: 'handle.exe not on PATH or timed out' };
  }
}

/**
 * Rename with exponential-backoff retry for transient Windows file locks.
 * EPERM / EACCES on rename are almost always caused by antivirus, search
 * indexer, or another process briefly holding the target file open.
 *
 * When maxWallClockMs is provided (large payloads >200KB), retries continue
 * until the wall-clock cap is hit rather than a fixed attempt count — AV scan
 * time grows with file size, so a fixed attempt budget starves large files.
 * Small files use the default maxRetries=7 (~6.35s total) unchanged.
 *
 * On budget exhaustion, emits io.lock-holder FR event naming the lock holder
 * (via handle.exe if on PATH; unavailable:true otherwise) before rethrowing.
 */
export function renameSyncWithRetry(oldPath: string, newPath: string, maxRetries = 7, maxWallClockMs?: number): void {
  const deadline = maxWallClockMs !== undefined ? Date.now() + maxWallClockMs : undefined;
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(oldPath, newPath);
      return;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      const isTransient = code === 'EPERM' || code === 'EACCES';
      const withinBudget = deadline !== undefined ? Date.now() < deadline : i < maxRetries;
      if (isTransient && withinBudget) {
        const delayMs = Math.min(50 * Math.pow(2, i), 5_000);
        getGlobalRecorder()?.record({
          type: 'io.retry', component: 'persistence', level: 'warn',
          message: `renameSyncWithRetry failed (${code}), retry ${i + 1} after ${delayMs}ms`,
          data: { oldPath, newPath, attempt: i + 1, code, delayMs },
        });
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
        continue;
      }
      // t/2544: budget exhausted on a transient error — identify the lock holder before rethrowing.
      if (isTransient) {
        const lockHolder = queryLockHolder(newPath);
        getGlobalRecorder()?.record({
          type: 'io.lock-holder', component: 'persistence', level: 'warn',
          message: lockHolder.unavailable
            ? `io.lock-holder: unavailable (${lockHolder.reason})`
            : `io.lock-holder: ${lockHolder.processName} pid ${lockHolder.pid}`,
          data: { filePath: newPath, ...lockHolder },
        });
      }
      throw err;
    }
  }
}

/**
 * Async rename with exponential-backoff retry for transient Windows file locks.
 */
export async function renameWithRetry(oldPath: string, newPath: string, maxRetries = 7): Promise<void> {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      await fs.promises.rename(oldPath, newPath);
      return;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if ((code === 'EPERM' || code === 'EACCES') && i < maxRetries) {
        const delayMs = 50 * Math.pow(2, i);
        getGlobalRecorder()?.record({
          type: 'io.retry', component: 'persistence', level: 'warn',
          message: `renameWithRetry failed (${code}), retry ${i + 1}/${maxRetries} after ${delayMs}ms`,
          data: { oldPath, newPath, attempt: i + 1, code, delayMs },
        });
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Write content to a file atomically — writes to a temp file then renames.
 * On same-filesystem rename is atomic, so a crash mid-write can't produce
 * a truncated target file.
 *
 * Durability under sustained Windows locks (t/1627): the primary path is the
 * atomic rename. When that is denied past the bounded retry budget, the tmp
 * file still holds the complete new content, so we fall back to a non-atomic
 * in-place copy. If BOTH are denied, the tmp file is PRESERVED (not unlinked)
 * as the sole durable copy of the write, and the failure is surfaced as an
 * ActionableError — never a silent loss of the payload.
 *
 * Retry budget scales with payload size (t/2546): files >200KB get a 30s
 * wall-clock cap instead of the 7-attempt (~6.35s) small-file budget, since
 * AV scan time grows with file size. Small-file fast-fail behavior is unchanged.
 */
export function atomicWriteSync(filePath: string, content: string): void {
  // codeql[js/insecure-temporary-file] FP: same-directory atomic write via rename, not an os.tmpdir() temp file
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf-8');
  // t/2546: scale retry budget with payload size — AV scan time grows with file size.
  const bytes = Buffer.byteLength(content, 'utf-8');
  const wallClockCapMs = bytes > 200 * 1024 ? 30_000 : undefined;
  try {
    renameSyncWithRetry(tmpPath, filePath, 7, wallClockCapMs);
    return;
  } catch (renameErr) {
    const renameCode = (renameErr as NodeJS.ErrnoException).code;
    // The copy fallback is scoped to the exact failure this ticket targets: a
    // sustained lock (EPERM/EACCES) that exhausted the bounded rename-retry
    // budget. Any other rename error (e.g. EXDEV cross-device — tmp and target
    // are same-dir here, so it signals a genuine misconfiguration, not a lock)
    // keeps the original contract: clean up the tmp and rethrow. Copying over
    // the target for a non-lock error would mask a real bug rather than absorb
    // a transient lock.
    if (renameCode !== 'EPERM' && renameCode !== 'EACCES') {
      try { fs.unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }
      throw renameErr;
    }
    // Sustained rename EPERM/EACCES: a Windows AV/indexer held an exclusive
    // handle on the target longer than the bounded retry budget. The atomic
    // directory-entry swap is unavailable, but tmpPath still holds the COMPLETE
    // new content. Fallback: write to .tmp2, then rename atomically.
    // This avoids writing directly to the (possibly locked) target — the old
    // copyFileSync approach could partially overwrite a locked target and produce
    // corrupt JSON when the lock interrupted the copy (t/2211 incident: debate
    // e8f41c82, 120161 bytes written, JSON corrupt at position 119988).
    const tmp2Path = `${filePath}.tmp2`;
    try {
      fs.writeFileSync(tmp2Path, content, 'utf-8');
      // writeFileSync closes the handle on return, flushing OS write buffers.
      renameSyncWithRetry(tmp2Path, filePath, 7, wallClockCapMs);
      // .tmp2 rename succeeded — clean up the original .tmp (best-effort)
      try { fs.unlinkSync(tmpPath); } catch { /* best-effort */ }
      getGlobalRecorder()?.record({
        type: 'io.recovered', component: 'persistence', level: 'warn',
        message: `atomicWriteSync: rename exhausted, recovered via .tmp2 rename fallback`,
        data: {
          filePath, tmpPath, tmp2Path,
          bytes: Buffer.byteLength(content, 'utf-8'),
          renameCode: (renameErr as NodeJS.ErrnoException).code,
        },
      });
      return;
    } catch (tmp2Err) {
      // Both rename strategies were denied — DO NOT unlink tmpPath: it is the
      // ONLY durable copy of the new content and serves as a recovery artifact.
      // Best-effort clean up the .tmp2 orphan (it's a duplicate; .tmp is canonical).
      // The loader enumerates *.json only, so lingering .tmp/.tmp2 files are
      // invisible to it and cannot be mistaken for sessions (persistenceFaults.test).
      try { fs.unlinkSync(tmp2Path); } catch { /* best-effort */ }
      const firstRenameCode = (renameErr as NodeJS.ErrnoException).code;
      const tmp2Code = (tmp2Err as NodeJS.ErrnoException).code;
      getGlobalRecorder()?.record({
        type: 'io.data-loss', component: 'persistence', level: 'error',
        message: `atomicWriteSync: DATA LOSS RISK — rename and .tmp2 rename both failed; new content preserved at ${tmpPath}`,
        data: { filePath, tmpPath, tmp2Path, bytes, renameCode: firstRenameCode, tmp2Code },
        error: {
          name: (tmp2Err as Error).name ?? 'Error',
          message: (tmp2Err as Error).message,
          stack: (tmp2Err as Error).stack,
        },
      });
      throw new ActionableError({
        goal: `Persist ${bytes} bytes to ${filePath}`,
        problem: `Atomic rename and .tmp2 rename fallback were both denied (rename ${firstRenameCode}, fallback ${tmp2Code}) — the target is held by another process (Windows antivirus/indexer) longer than the retry budget allows.`,
        location: 'lib/debate/persistence.ts atomicWriteSync',
        nextSteps: [
          `The new content is preserved at ${tmpPath} and was NOT deleted — it is the only durable copy of this write. Do not remove it.`,
          `Retry the save once the lock clears: a subsequent successful atomicWriteSync replaces ${filePath}, after which ${tmpPath} may be removed.`,
          `If saves keep failing, exclude the debates directory from antivirus/search-indexer scanning.`,
        ],
        innerError: tmp2Err,
      });
    }
  }
}
