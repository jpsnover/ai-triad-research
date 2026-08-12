// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression tests for M13 open-file RCE guard (t/2531).
// Verifies: executable extensions refused; path traversal refused;
// path outside both roots refused; valid file within data root opened.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';

const mockShellOpenPath = vi.hoisted(() => vi.fn());
const mockFsExistsSync = vi.hoisted(() => vi.fn(() => true));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  shell: { openPath: mockShellOpenPath, openExternal: vi.fn() },
  clipboard: { writeText: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  dialog: { showOpenDialog: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp'), getVersion: vi.fn(() => '1.0.0') },
  safeStorage: { isEncryptionAvailable: vi.fn(() => false), encryptString: vi.fn(), decryptString: vi.fn() },
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: mockFsExistsSync, default: { ...actual, existsSync: mockFsExistsSync } };
});

// On Windows, path.resolve('/fake/...') converts to a drive-letter path, breaking the
// startsWith containment check. Use path.posix.resolve — it normalizes '..' sequences
// without adding a Windows drive prefix, keeping tests portable across platforms.
vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('path')>();
  const posixResolve = actual.posix.resolve.bind(actual.posix);
  return { ...actual, default: { ...actual, resolve: posixResolve, sep: '/' }, resolve: posixResolve, sep: '/' };
});

const DATA_ROOT = '/fake/data';
const PROJECT_ROOT_VAL = '/fake/root';

vi.mock('../fileIO.js', () => ({
  PROJECT_ROOT: '/fake/root',
  getDataRootPath: vi.fn(() => '/fake/data'),
  resolveDataPath: vi.fn((p: string) => `/fake/data/${p}`),
  writeJsonFileAtomic: vi.fn(),
}));

vi.mock('../../../../lib/debate/errors.js', () => ({ ActionableError: class extends Error {} }));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: vi.fn(() => null) }));

import { registerSystemHandlers } from '../ipc/systemHandlers.js';

function getHandler(channel: string): (event: unknown, ...args: unknown[]) => unknown {
  const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls;
  const entry = calls.find((c: unknown[]) => c[0] === channel);
  if (!entry) throw new Error(`${channel} not registered`);
  return entry[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFsExistsSync.mockReturnValue(true);
  registerSystemHandlers();
});

describe('open-file M13 guard', () => {
  const handler = () => getHandler('open-file');

  it.each(['.exe', '.bat', '.cmd', '.ps1', '.lnk', '.sh', '.py', '.rb', '.jar'])(
    'blocks executable extension %s', (ext) => {
      handler()({}, `${DATA_ROOT}/malware${ext}`);
      expect(mockShellOpenPath).not.toHaveBeenCalled();
    },
  );

  it('blocks path traversal outside data root', () => {
    handler()({}, `${DATA_ROOT}/../../etc/passwd`);
    expect(mockShellOpenPath).not.toHaveBeenCalled();
  });

  it('blocks path outside both roots', () => {
    handler()({}, '/tmp/external.pdf');
    expect(mockShellOpenPath).not.toHaveBeenCalled();
  });

  it('allows valid file inside data root with safe extension', () => {
    handler()({}, `${DATA_ROOT}/docs/paper.pdf`);
    expect(mockShellOpenPath).toHaveBeenCalledWith(`${DATA_ROOT}/docs/paper.pdf`);
  });

  it('allows valid file inside PROJECT_ROOT with safe extension', () => {
    handler()({}, `${PROJECT_ROOT_VAL}/docs/readme.md`);
    expect(mockShellOpenPath).toHaveBeenCalledWith(`${PROJECT_ROOT_VAL}/docs/readme.md`);
  });

  it('blocks if file does not exist even with safe path+ext', () => {
    mockFsExistsSync.mockReturnValue(false);
    handler()({}, `${DATA_ROOT}/missing.pdf`);
    expect(mockShellOpenPath).not.toHaveBeenCalled();
  });
});
