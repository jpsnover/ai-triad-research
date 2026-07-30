// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';

/**
 * TOCTOU-safe read of a config file's content + mtime.
 *
 * The mtime-cache loaders in this directory previously did `fs.statSync(p)`
 * (check) followed by `fs.readFileSync(p)` (use) — two separate path
 * resolutions, so a concurrent replace between them could return an mtime
 * that doesn't match the bytes actually read (CodeQL js/file-system-race).
 *
 * Here the path is resolved exactly once (`openSync`); the mtime (`fstatSync`)
 * and the content (`readFileSync`) are both taken from that single file
 * descriptor, so they always describe the same underlying file — no race.
 *
 * Throws like `fs` does (e.g. ENOENT) so callers keep their existing
 * try/catch for cache-miss and error semantics.
 *
 * Pass `cachedMtimeMs` to preserve the mtime-cache fast path: the fstat and
 * the read still happen on the same fd (no race), but the (larger) read is
 * skipped when the file is unchanged, returning `content: null` so the caller
 * reuses its already-parsed cache.
 */
export function readFileWithMtime(
  filePath: string,
  cachedMtimeMs?: number,
): { content: string | null; mtimeMs: number } {
  const fd = fs.openSync(filePath, 'r');
  try {
    const mtimeMs = fs.fstatSync(fd).mtimeMs;
    if (cachedMtimeMs !== undefined && mtimeMs === cachedMtimeMs) {
      return { content: null, mtimeMs };
    }
    return { content: fs.readFileSync(fd, 'utf-8'), mtimeMs };
  } finally {
    fs.closeSync(fd);
  }
}
