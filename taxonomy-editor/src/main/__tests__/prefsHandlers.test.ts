// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * t/2118 — covers get-preferences / set-preferences IPC handlers.
 * AC: get-preferences returns null (no file) or parsed object;
 *     set-preferences writes atomically (tmp → rename).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import fs from 'fs';
import path from 'path';

type HandlerFn = (...args: unknown[]) => unknown;

const mockHandle = vi.hoisted(() => ({} as Record<string, HandlerFn>));

vi.mock('electron', () => ({
  app: { getPath: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel: string, cb: HandlerFn) => { mockHandle[channel] = cb; }),
  },
}));

import { app } from 'electron';
import { registerPrefsHandlers } from '../ipc/prefsHandlers.js';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-handler-'));
const fakeEvent = {} as Electron.IpcMainInvokeEvent;

beforeAll(() => {
  vi.mocked(app.getPath).mockReturnValue(tmpRoot);
  registerPrefsHandlers();
});

afterAll(() => { fs.rmSync(tmpRoot, { recursive: true, force: true }); });

describe('get-preferences', () => {
  it('returns null when preferences.json does not exist', async () => {
    const result = await mockHandle['get-preferences'](fakeEvent);
    expect(result).toBeNull();
  });
});

describe('set-preferences / get-preferences round-trip', () => {
  it('persists preferences and retrieves them', async () => {
    const prefs = { viewMode: 'advanced' as const };
    await mockHandle['set-preferences'](fakeEvent, prefs);
    const result = await mockHandle['get-preferences'](fakeEvent);
    expect(result).toEqual(prefs);
  });

  it('overwrites with a new value', async () => {
    await mockHandle['set-preferences'](fakeEvent, { viewMode: 'simple' as const });
    const result = await mockHandle['get-preferences'](fakeEvent);
    expect(result).toEqual({ viewMode: 'simple' });
  });
});
