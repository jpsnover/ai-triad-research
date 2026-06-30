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
 * Write content to a file atomically — writes to a temp file then renames.
 * On same-filesystem rename is atomic, so a crash mid-write can't produce
 * a truncated target file.
 */
export function atomicWriteSync(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf-8');
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }
    throw err;
  }
}
