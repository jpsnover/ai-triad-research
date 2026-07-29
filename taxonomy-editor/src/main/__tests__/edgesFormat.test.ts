// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * t/1942 (t/673 Option B): the desktop edges writer must emit the shared HYBRID edges.json
 * format (docs/edges-json-format.md) so it stays byte-identical to the web writer, while the
 * generic writeJsonFileAtomic default for every OTHER taxonomy file stays 2-space pretty.
 *
 * Point AI_TRIAD_DATA_ROOT at a temp dir BEFORE fileIO loads — activeTaxonomyDir is captured
 * at module-eval from it (vi.hoisted runs before the imports below). fileIO imports electron
 * (app), so we stub it to load under vitest.
 */
const H = vi.hoisted(() => {
  const base = process.env.TEMP || process.env.TMPDIR || '/tmp';
  const root = `${base}/edges-fmt-${process.pid}-${Date.now()}`;
  process.env.AI_TRIAD_DATA_ROOT = root;
  return { root };
});

vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd(), isPackaged: false } }));

// Imported AFTER the hoisted env + electron mock so activeTaxonomyDir resolves into the temp root.
import { writeEdgesFile, writeJsonFileAtomic, resolveDataPath, loadDataConfig } from '../fileIO.js';

// vitest runs with cwd = taxonomy-editor/; the golden fixture lives at the REPO ROOT
// tests/fixtures/edges-format (shared across all writers), i.e. one level up.
const FIXTURES = path.resolve(process.cwd(), '..', 'tests/fixtures/edges-format');
let edgesDir: string;

beforeAll(() => {
  // Same path writeEdgesFile targets: resolveDataPath(taxonomy_dir) under the temp data root.
  edgesDir = resolveDataPath(loadDataConfig().taxonomy_dir);
  fs.mkdirSync(edgesDir, { recursive: true });
});
afterAll(() => { fs.rmSync(H.root, { recursive: true, force: true }); });

describe('edges.json hybrid write path (t/1942)', () => {
  it('writeEdgesFile round-trips the golden fixture byte-identically', () => {
    const input = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'input.json'), 'utf-8'));
    writeEdgesFile(input);
    const written = fs.readFileSync(path.join(edgesDir, 'edges.json'));   // raw bytes
    const expected = fs.readFileSync(path.join(FIXTURES, 'expected.json')); // raw bytes
    expect(written.equals(expected)).toBe(true);   // byte-exact hybrid output
  });

  it('writeEdgesFile does not double the trailing newline', () => {
    writeEdgesFile(JSON.parse(fs.readFileSync(path.join(FIXTURES, 'input.json'), 'utf-8')));
    const written = fs.readFileSync(path.join(edgesDir, 'edges.json'), 'utf-8');
    expect(written.endsWith('\n')).toBe(true);
    expect(written.endsWith('\n\n')).toBe(false);   // serializeEdgesJson supplies exactly one
  });

  it('writeJsonFileAtomic (generic) keeps NON-edges files 2-space pretty', () => {
    // The guard the whole ticket hinges on: the generic default must NOT be compacted.
    const p = path.join(edgesDir, 'not-edges.json');
    writeJsonFileAtomic(p, { b: 2, a: 1, nested: { x: [1, 2] } });
    expect(fs.readFileSync(p, 'utf-8')).toBe(
      '{\n  "b": 2,\n  "a": 1,\n  "nested": {\n    "x": [\n      1,\n      2\n    ]\n  }\n}\n',
    );
  });
});
