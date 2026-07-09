// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import { getGlobalRecorder } from '../flight-recorder/index.js';

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
 */
export function atomicWriteSync(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf-8');
  try {
    renameSyncWithRetry(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }
    throw err;
  }
}
