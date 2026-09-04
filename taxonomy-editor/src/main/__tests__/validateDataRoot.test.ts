// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';

/**
 * t/3296: validateDataRoot() in fileIO.ts must throw ActionableError when the
 * resolved data root lacks the expected sentinel directories (taxonomy/,
 * dictionary/), naming the resolved path and resolution method so the fix is
 * one glance. Prevention for the t/3290 silent-empty-panels incident.
 *
 * Strategy: mock electron + heavy deps so fileIO.ts loads under vitest, then
 * spy on fs.existsSync to control which sentinel dirs "exist" per test.
 * AI_TRIAD_DATA_ROOT env var controls the data root (highest priority path,
 * cleanest way to inject a known root without touching config files).
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

beforeEach(() => {
  process.env.AI_TRIAD_DATA_ROOT = DATA_ROOT;
});

afterEach(() => {
  delete process.env.AI_TRIAD_DATA_ROOT;
  vi.restoreAllMocks();
});

describe('validateDataRoot (t/3296)', () => {
  it('passes when both taxonomy/ and dictionary/ exist', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
      const s = String(p);
      return s.endsWith('taxonomy') || s.endsWith('dictionary');
    });
    expect(() => validateDataRoot()).not.toThrow();
  });

  it('throws ActionableError when taxonomy/ is missing', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
      return String(p).endsWith('dictionary');
    });
    expect(() => validateDataRoot()).toThrow(ActionableError);
  });

  it('throws ActionableError when dictionary/ is missing', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
      return String(p).endsWith('taxonomy');
    });
    expect(() => validateDataRoot()).toThrow(ActionableError);
  });

  it('throws ActionableError when both sentinel dirs are missing', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    expect(() => validateDataRoot()).toThrow(ActionableError);
  });

  it('throws ActionableError when taxonomy/ exists but is empty (same silent-degradation class as absent)', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
      const s = String(p);
      return s.endsWith('taxonomy') || s.endsWith('dictionary');
    });
    vi.spyOn(fs, 'readdirSync').mockImplementation((p) => {
      // taxonomy/ is empty, dictionary/ has content
      return (String(p).endsWith('taxonomy') ? [] : ['somefile.json']) as unknown as fs.Dirent[];
    });
    expect(() => validateDataRoot()).toThrow(ActionableError);
  });

  it('error names the resolved data root path', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    let err: ActionableError | undefined;
    try { validateDataRoot(); } catch (e) { err = e as ActionableError; }
    expect(err).toBeInstanceOf(ActionableError);
    expect(err!.problem).toContain(DATA_ROOT);
  });

  it('error names AI_TRIAD_DATA_ROOT as resolution method when env var is set', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    let err: ActionableError | undefined;
    try { validateDataRoot(); } catch (e) { err = e as ActionableError; }
    expect(err!.problem).toContain('AI_TRIAD_DATA_ROOT env var');
  });

  it('error names .aitriad.json as resolution method when env var is absent but config file exists', () => {
    delete process.env.AI_TRIAD_DATA_ROOT;
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
      // Config file exists; sentinel dirs do not
      return String(p).endsWith('.aitriad.json');
    });
    let err: ActionableError | undefined;
    try { validateDataRoot(); } catch (e) { err = e as ActionableError; }
    expect(err).toBeInstanceOf(ActionableError);
    expect(err!.problem).toContain('.aitriad.json');
  });

  it('error names PROJECT_ROOT fallback when no env var and no config file', () => {
    delete process.env.AI_TRIAD_DATA_ROOT;
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    let err: ActionableError | undefined;
    try { validateDataRoot(); } catch (e) { err = e as ActionableError; }
    expect(err).toBeInstanceOf(ActionableError);
    expect(err!.problem).toContain('PROJECT_ROOT fallback');
  });
});
