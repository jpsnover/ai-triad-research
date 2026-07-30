// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * t/2022 (#4743, js/file-system-race): updateSyntheticEmbeddings previously used
 * existsSync-then-read/write TOCTOU guards. The fix reads directly and distinguishes a
 * missing file (ENOENT → start from the default) from a CORRUPT file (rethrow — never
 * silently default-and-overwrite, which would clobber recoverable data). Point
 * AI_TRIAD_DATA_ROOT at a temp dir before fileIO loads (activeTaxonomyDir is captured at
 * module-eval, like edgesFormat.test); fileIO imports electron (app), so stub it.
 */
const H = vi.hoisted(() => {
  const base = process.env.TEMP || process.env.TMPDIR || '/tmp';
  const root = `${base}/synemb-${process.pid}-${Date.now()}`;
  process.env.AI_TRIAD_DATA_ROOT = root;
  return { root };
});

vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd(), isPackaged: false } }));

import { updateSyntheticEmbeddings, resolveDataPath, loadDataConfig } from '../fileIO.js';

let synDir: string;
const embFile = (): string => path.join(synDir, 'synthetic_embeddings.json');

beforeEach(() => {
  synDir = path.join(resolveDataPath(loadDataConfig().taxonomy_dir), 'synthetic');
  fs.rmSync(synDir, { recursive: true, force: true });
});
afterAll(() => { fs.rmSync(H.root, { recursive: true, force: true }); });

describe('updateSyntheticEmbeddings file-race + data-loss guard (t/2022 #4743)', () => {
  it('creates the file with defaults when none exists (missing → default, no existsSync guard)', () => {
    updateSyntheticEmbeddings('acc-x', 'acc', [[1, 2, 3]]);
    const file = JSON.parse(fs.readFileSync(embFile(), 'utf-8'));
    expect(file.model).toBe('all-MiniLM-L6-v2');
    expect(file.dimension).toBe(384);
    expect(file.nodes['acc-x']).toEqual({ pov: 'acc', vectors: [[1, 2, 3]] });
    expect(file.node_count).toBe(1);
  });

  it('merges into an existing valid file without dropping prior nodes', () => {
    fs.mkdirSync(synDir, { recursive: true });
    fs.writeFileSync(embFile(), JSON.stringify({
      model: 'all-MiniLM-L6-v2', dimension: 384, node_count: 1,
      nodes: { 'saf-y': { pov: 'saf', vectors: [[9]] } },
    }));
    updateSyntheticEmbeddings('acc-x', 'acc', [[1]]);
    const file = JSON.parse(fs.readFileSync(embFile(), 'utf-8'));
    expect(Object.keys(file.nodes).sort()).toEqual(['acc-x', 'saf-y']);
    expect(file.node_count).toBe(2);
  });

  it('rethrows on a CORRUPT existing file and does NOT overwrite it (data-loss guard)', () => {
    fs.mkdirSync(synDir, { recursive: true });
    const corrupt = '{ this is not valid json';
    fs.writeFileSync(embFile(), corrupt);
    expect(() => updateSyntheticEmbeddings('acc-x', 'acc', [[1]])).toThrow();
    // The corrupt file is untouched — no silent default-and-clobber of recoverable data.
    expect(fs.readFileSync(embFile(), 'utf-8')).toBe(corrupt);
  });
});
