// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';

/**
 * t/3296: validateDataRoot() in fileIO.ts must throw ActionableError when the
 * resolved data root lacks the expected sentinel directories (taxonomy/,
 * dictionary/) — either absent (ENOENT) or empty (0 entries). Names the resolved
 * path and resolution method so the fix is one glance. Prevention for t/3290.
 *
 * Implementation uses readdirSync + ENOENT catch (mirrors server fs convention).
 * Tests spy on readdirSync to control per-path counts; existsSync is only spied
 * for the method-detection (.aitriad.json presence) tests.
 */

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/fake/app', getPath: () => '/fake/home' },
}));

vi.mock('../../../lib/electron-shared/resolveRepoRootForApp.js', () => ({
  resolveRepoRootForApp: () => '/fake/root',
}));

vi.mock('../../../lib/debate/persistence.js', () => ({ renameSyncWithRetry: vi.fn() }));
vi.mock('../../../lib/debate/lockHolder.js', () => ({ recordLockHolder: vi.fn() }));
vi.mock('../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: () => null, setGlobalRecorder: vi.fn(), RECORDER_CAPACITY_SECONDARY: 256 }));
vi.mock('../../../lib/npy.js', () => ({ parseNpy: vi.fn(), extractNodeVectors: vi.fn() }));
vi.mock('../../../lib/electron-shared/safeId.js', () => ({ assertSafeId: vi.fn() }));
vi.mock('../../../lib/edges/serializeEdges.js', () => ({ serializeEdgesJson: vi.fn() }));

import { validateDataRoot } from '../fileIO.js';
import { ActionableError } from '../../../../lib/debate/errors.js';

const DATA_ROOT = '/test-data-root';

/** Stub readdirSync: return non-empty for listed dirs, ENOENT for everything else. */
function stubReaddirSync(presentDirs: string[]): void {
  vi.spyOn(fs, 'readdirSync').mockImplementation((p) => {
    const s = String(p);
    if (presentDirs.some(d => s.endsWith(d))) {
      return ['somefile.json'] as unknown as fs.Dirent[];
    }
    const err = Object.assign(new Error(`ENOENT: no such file or directory, scandir '${s}'`), { code: 'ENOENT' });
    throw err;
  });
}

beforeEach(() => {
  process.env.AI_TRIAD_DATA_ROOT = DATA_ROOT;
});

afterEach(() => {
  delete process.env.AI_TRIAD_DATA_ROOT;
  vi.restoreAllMocks();
});

describe('validateDataRoot (t/3296)', () => {
  it('passes when both taxonomy/ and dictionary/ are non-empty', () => {
    stubReaddirSync(['taxonomy', 'dictionary']);
    expect(() => validateDataRoot()).not.toThrow();
  });

  it('throws ActionableError when taxonomy/ is absent (ENOENT)', () => {
    stubReaddirSync(['dictionary']);
    expect(() => validateDataRoot()).toThrow(ActionableError);
  });

  it('throws ActionableError when dictionary/ is absent (ENOENT)', () => {
    stubReaddirSync(['taxonomy']);
    expect(() => validateDataRoot()).toThrow(ActionableError);
  });

  it('throws ActionableError when both sentinels are absent', () => {
    stubReaddirSync([]);
    expect(() => validateDataRoot()).toThrow(ActionableError);
  });

  it('throws ActionableError when taxonomy/ exists but is empty (same silent-degradation class as absent)', () => {
    vi.spyOn(fs, 'readdirSync').mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('dictionary')) return ['somefile.json'] as unknown as fs.Dirent[];
      if (s.endsWith('taxonomy')) return [] as unknown as fs.Dirent[];
      const err = Object.assign(new Error(`ENOENT: ${s}`), { code: 'ENOENT' });
      throw err;
    });
    expect(() => validateDataRoot()).toThrow(ActionableError);
  });

  it('error names the resolved data root path', () => {
    stubReaddirSync([]);
    let err: ActionableError | undefined;
    try { validateDataRoot(); } catch (e) { err = e as ActionableError; }
    expect(err).toBeInstanceOf(ActionableError);
    expect(err!.problem).toContain(DATA_ROOT);
  });

  it('error names AI_TRIAD_DATA_ROOT as resolution method when env var is set', () => {
    stubReaddirSync([]);
    let err: ActionableError | undefined;
    try { validateDataRoot(); } catch (e) { err = e as ActionableError; }
    expect(err!.problem).toContain('AI_TRIAD_DATA_ROOT env var');
  });

  it('error names .aitriad.json as resolution method when env var is absent but config file exists', () => {
    delete process.env.AI_TRIAD_DATA_ROOT;
    // existsSync: .aitriad.json present; readdirSync: sentinels absent
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => String(p).endsWith('.aitriad.json'));
    stubReaddirSync([]);
    let err: ActionableError | undefined;
    try { validateDataRoot(); } catch (e) { err = e as ActionableError; }
    expect(err).toBeInstanceOf(ActionableError);
    expect(err!.problem).toContain('.aitriad.json');
  });

  it('error names PROJECT_ROOT fallback when no env var and no config file', () => {
    delete process.env.AI_TRIAD_DATA_ROOT;
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    stubReaddirSync([]);
    let err: ActionableError | undefined;
    try { validateDataRoot(); } catch (e) { err = e as ActionableError; }
    expect(err).toBeInstanceOf(ActionableError);
    expect(err!.problem).toContain('PROJECT_ROOT fallback');
  });
});
