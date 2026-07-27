import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { resolveRepoRootForApp } from './resolveRepoRootForApp.js';

afterEach(() => vi.restoreAllMocks());

describe('resolveRepoRootForApp', () => {
  it('walks up to the dir containing .aitriad.json', () => {
    const root = path.resolve('/repo');
    const start = path.join(root, 'app', 'src', 'main');
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === path.join(root, '.aitriad.json'));
    expect(resolveRepoRootForApp(start, path.resolve('/fallback'))).toBe(root);
  });

  it('recognizes the scripts/AITriad marker', () => {
    const root = path.resolve('/repo');
    const start = path.join(root, 'app', 'src');
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === path.join(root, 'scripts', 'AITriad'));
    expect(resolveRepoRootForApp(start, path.resolve('/fallback'))).toBe(root);
  });

  it('returns packagedFallback when no marker is found up to the filesystem root', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const fallback = path.resolve('/packaged/app');
    expect(resolveRepoRootForApp(path.resolve('/a/b/c/d'), fallback)).toBe(fallback);
  });
});
