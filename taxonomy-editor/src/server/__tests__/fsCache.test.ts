// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readFileWithMtime } from '../ai/fsCache.js';

describe('fsCache.readFileWithMtime (t/2021 — TOCTOU-safe read)', () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fscache-test-'));
    filePath = path.join(tmpDir, 'config.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the file content and a matching mtime from one fd', () => {
    fs.writeFileSync(filePath, '{"a":1}', 'utf-8');
    const expectedMtime = fs.statSync(filePath).mtimeMs;

    const { content, mtimeMs } = readFileWithMtime(filePath);
    expect(content).toBe('{"a":1}');
    // fstat on the same fd reports the same mtime as an independent stat.
    expect(mtimeMs).toBe(expectedMtime);
  });

  it('throws ENOENT for a missing file (callers rely on this for cache-miss)', () => {
    expect(() => readFileWithMtime(path.join(tmpDir, 'nope.json')))
      .toThrowError(expect.objectContaining({ code: 'ENOENT' }));
  });

  it('skips the read on a cache hit but still reads on a stale mtime', () => {
    fs.writeFileSync(filePath, '{"a":1}', 'utf-8');
    const { mtimeMs } = readFileWithMtime(filePath);

    // Same mtime → fast path: content is null so the caller reuses its cache.
    const hit = readFileWithMtime(filePath, mtimeMs);
    expect(hit.content).toBeNull();
    expect(hit.mtimeMs).toBe(mtimeMs);

    // A stale cached mtime → the read happens and returns the current content.
    const miss = readFileWithMtime(filePath, mtimeMs - 1);
    expect(miss.content).toBe('{"a":1}');
    expect(miss.mtimeMs).toBe(mtimeMs);
  });

  it('does not leak a file descriptor across many reads', () => {
    fs.writeFileSync(filePath, 'x', 'utf-8');
    // If the fd were leaked each call, this loop would exhaust the fd table.
    for (let i = 0; i < 300; i++) {
      expect(readFileWithMtime(filePath).content).toBe('x');
    }
  });
});
