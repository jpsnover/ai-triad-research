// @vitest-environment node
//
// t/2475 — resolveProjectRoot must PREFER the `.aitriad.json` marker over the
// ambiguous `scripts/` marker. `taxonomy-editor/` has its own `scripts/`, so a
// walk that accepted either marker stopped one level short at `taxonomy-editor/`
// in local compiled/dev runs — mis-resolving PROJECT_ROOT and 404-ing the
// root-only ai-models.json / ai-usages.json registries. These tests drive the
// pure resolver against simulated on-disk layouts (real temp dirs), since the
// module-level PROJECT_ROOT is frozen from the real __dirname at import time.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveProjectRoot } from '../config.js';

let root: string;

// Build a directory tree under `root` from a list of relative dir paths, plus a
// list of relative file paths (empty files). Returns nothing; `root` is the base.
function scaffold(dirs: string[], files: string[] = []): void {
  for (const d of dirs) fs.mkdirSync(path.join(root, d), { recursive: true });
  for (const f of files) {
    fs.mkdirSync(path.join(root, path.dirname(f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), '');
  }
}

describe('t/2475 — resolveProjectRoot prefers .aitriad.json over scripts/', () => {
  beforeEach(() => {
    // realpathSync: macOS/Windows temp dirs are symlinks; resolveProjectRoot uses
    // path.resolve (no symlink deref), so compare against the resolved base.
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'projroot-')));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('local compiled dist: resolves the monorepo root, NOT taxonomy-editor/ (the regression)', () => {
    // root/ has .aitriad.json + scripts/; taxonomy-editor/ has its OWN scripts/.
    scaffold(
      ['scripts', 'taxonomy-editor/scripts', 'taxonomy-editor/dist/server'],
      ['.aitriad.json', 'ai-models.json', 'ai-usages.json'],
    );
    const startDir = path.join(root, 'taxonomy-editor', 'dist', 'server');
    const resolved = resolveProjectRoot(startDir);
    expect(resolved).toBe(root);
    expect(resolved).not.toBe(path.join(root, 'taxonomy-editor'));
    // the registries the bug couldn't find are present at the resolved root
    expect(fs.existsSync(path.join(resolved, 'ai-models.json'))).toBe(true);
  });

  it('local source layout: resolves the monorepo root from src/server', () => {
    scaffold(
      ['scripts', 'taxonomy-editor/scripts', 'taxonomy-editor/src/server'],
      ['.aitriad.json'],
    );
    const startDir = path.join(root, 'taxonomy-editor', 'src', 'server');
    expect(resolveProjectRoot(startDir)).toBe(root);
  });

  it('container /app layout: resolves /app (.aitriad.json at the marker level)', () => {
    // Mirrors the Dockerfile: .aitriad.json + registries + scripts/ all at /app.
    scaffold(['scripts', 'dist/server'], ['.aitriad.json', 'ai-models.json', 'ai-usages.json']);
    const startDir = path.join(root, 'dist', 'server');
    expect(resolveProjectRoot(startDir)).toBe(root);
  });

  it('no .aitriad.json anywhere: falls back to the scripts/ marker', () => {
    scaffold(['scripts', 'dist/server']); // no .aitriad.json
    const startDir = path.join(root, 'dist', 'server');
    expect(resolveProjectRoot(startDir)).toBe(root);
  });

  it('ambiguity guard: with a nested scripts/ closer than the config root, .aitriad.json still wins', () => {
    // sub/ (closer) has scripts/ but no config; root (farther) has .aitriad.json.
    scaffold(['sub/scripts', 'sub/dist/server'], ['.aitriad.json']);
    const startDir = path.join(root, 'sub', 'dist', 'server');
    // scripts-first would return sub/; config-first must return root.
    expect(resolveProjectRoot(startDir)).toBe(root);
    expect(resolveProjectRoot(startDir)).not.toBe(path.join(root, 'sub'));
  });
});
