// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
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

/**
 * Rename with exponential-backoff retry for transient Windows file locks.
 * EPERM / EACCES on rename are almost always caused by antivirus, search
 * indexer, or another process briefly holding the target file open.
 */
export function renameSyncWithRetry(oldPath: string, newPath: string, maxRetries = 7): void {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      fs.renameSync(oldPath, newPath);
      return;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if ((code === 'EPERM' || code === 'EACCES') && i < maxRetries) {
        const delayMs = 50 * Math.pow(2, i);
        getGlobalRecorder()?.record({
          type: 'io.retry', component: 'persistence', level: 'warn',
          message: `renameSyncWithRetry failed (${code}), retry ${i + 1}/${maxRetries} after ${delayMs}ms`,
          data: { oldPath, newPath, attempt: i + 1, code, delayMs },
        });
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
        continue;
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
 * The retry budget is deliberately bounded by attempt count, not wall-clock:
 * the sync retry sleeps via Atomics.wait, which blocks the Electron main
 * thread, so more retries deepen the UI freeze without buying durability.
 * Durability beyond the retry window comes from the copy fallback and the
 * preserved artifact + a later re-persist, not from waiting longer here.
 */
export function atomicWriteSync(filePath: string, content: string): void {
  // codeql[js/insecure-temporary-file] FP: same-directory atomic write via rename, not an os.tmpdir() temp file
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf-8');
  try {
    renameSyncWithRetry(tmpPath, filePath);
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
    // new content. Fallback: copy tmp *over* the target in place. copyFileSync
    // opens the destination for write rather than requiring the rename swap, so
    // it can win against a different lock class. It is non-atomic (a crash
    // mid-copy can truncate the target), which is exactly why it is the
    // fallback and not the primary path.
    try {
      fs.copyFileSync(tmpPath, filePath);
      try { fs.unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }
      getGlobalRecorder()?.record({
        type: 'io.recovered', component: 'persistence', level: 'warn',
        message: `atomicWriteSync: rename exhausted, recovered via in-place copy fallback`,
        data: {
          filePath, tmpPath,
          bytes: Buffer.byteLength(content, 'utf-8'),
          renameCode: (renameErr as NodeJS.ErrnoException).code,
        },
      });
      return;
    } catch (copyErr) {
      // Both strategies were denied — almost certainly the same exclusive lock
      // on filePath. DO NOT unlink tmpPath: it is now the ONLY durable copy of
      // the new content and serves as a recovery artifact for the next save.
      // The loader enumerates *.json only, so a lingering .tmp is invisible to
      // it and cannot be mistaken for a session (see persistenceFaults.test).
      const bytes = Buffer.byteLength(content, 'utf-8');
      const renameCode = (renameErr as NodeJS.ErrnoException).code;
      const copyCode = (copyErr as NodeJS.ErrnoException).code;
      getGlobalRecorder()?.record({
        type: 'io.data-loss', component: 'persistence', level: 'error',
        message: `atomicWriteSync: DATA LOSS RISK — rename and copy both failed; new content preserved at ${tmpPath}`,
        data: { filePath, tmpPath, bytes, renameCode, copyCode },
        error: {
          name: (copyErr as Error).name ?? 'Error',
          message: (copyErr as Error).message,
          stack: (copyErr as Error).stack,
        },
      });
      throw new ActionableError({
        goal: `Persist ${bytes} bytes to ${filePath}`,
        problem: `Atomic rename and in-place copy fallback were both denied (rename ${renameCode}, copy ${copyCode}) — the target is held by another process (Windows antivirus/indexer) longer than the retry budget allows.`,
        location: 'lib/debate/persistence.ts atomicWriteSync',
        nextSteps: [
          `The new content is preserved at ${tmpPath} and was NOT deleted — it is the only durable copy of this write. Do not remove it.`,
          `Retry the save once the lock clears: a subsequent successful atomicWriteSync replaces ${filePath}, after which ${tmpPath} may be removed.`,
          `If saves keep failing, exclude the debates directory from antivirus/search-indexer scanning.`,
        ],
        innerError: copyErr,
      });
    }
  }
}
