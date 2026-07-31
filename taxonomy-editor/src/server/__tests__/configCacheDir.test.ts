// @vitest-environment node
//
// t/2061 — CACHE_DIR fallback chain. Root cause of the empty-data prod bug: the
// container image sets AI_TRIAD_DATA_ROOT (=/tmp/taxonomy-cache) but NOT
// TAXONOMY_CACHE_DIR, so CACHE_DIR fell straight through to the ~/.cache/taxonomy
// homedir default and diverged from where the data actually lived — toRepoPath()
// then couldn't strip the prefix, listDirectory returned empty, isDataAvailable was
// always false. The fix inserts AI_TRIAD_DATA_ROOT as the middle fallback so the
// cache dir tracks the same data root getDataRoot() resolves.
//
// CACHE_DIR is a module-level const resolved from process.env at import time, so each
// case resets the module registry and re-imports under a fresh env.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';

describe('CACHE_DIR fallback chain (t/2061)', () => {
  const orig = {
    cache: process.env.TAXONOMY_CACHE_DIR,
    dataRoot: process.env.AI_TRIAD_DATA_ROOT,
  };

  beforeEach(() => { vi.resetModules(); });

  afterEach(() => {
    restore('TAXONOMY_CACHE_DIR', orig.cache);
    restore('AI_TRIAD_DATA_ROOT', orig.dataRoot);
  });

  function restore(key: string, value: string | undefined): void {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  async function loadCacheDir(): Promise<string> {
    return (await import('../config.js')).CACHE_DIR;
  }

  it('prefers TAXONOMY_CACHE_DIR when it is set (even if AI_TRIAD_DATA_ROOT is too)', async () => {
    process.env.TAXONOMY_CACHE_DIR = '/explicit/cache';
    process.env.AI_TRIAD_DATA_ROOT = '/data/root';
    expect(await loadCacheDir()).toBe('/explicit/cache');
  });

  it('falls back to AI_TRIAD_DATA_ROOT when TAXONOMY_CACHE_DIR is unset (the t/2061 fix)', async () => {
    delete process.env.TAXONOMY_CACHE_DIR;
    process.env.AI_TRIAD_DATA_ROOT = '/tmp/taxonomy-cache';
    // Pre-fix this returned ~/.cache/taxonomy, diverging from the data root.
    expect(await loadCacheDir()).toBe('/tmp/taxonomy-cache');
  });

  it('falls back to the user-private homedir cache when neither env var is set', async () => {
    delete process.env.TAXONOMY_CACHE_DIR;
    delete process.env.AI_TRIAD_DATA_ROOT;
    // The security-relevant default (not world-writable /tmp) is preserved.
    expect(await loadCacheDir()).toBe(path.join(os.homedir(), '.cache', 'taxonomy'));
  });
});
