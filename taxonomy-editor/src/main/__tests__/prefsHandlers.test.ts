// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * t/2118 — covers get-preferences / set-preferences IPC handlers.
 * AC: get-preferences returns null (no file) or parsed object;
 *     set-preferences writes atomically (tmp → rename).
 * t/3536 — get-preferences now validates via the shared lib/userPreferencesSchema.ts
 * (t/3535): an invalid/corrupt file degrades to DEFAULT_USER_PREFERENCES + a
 * flight-recorder WARN naming the offending field, rather than returning the parsed
 * blob as-is. Missing file stays the distinct `null` case (regression guard).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import fs from 'fs';
import path from 'path';

type HandlerFn = (...args: unknown[]) => unknown;

const mockHandle = vi.hoisted(() => ({} as Record<string, HandlerFn>));
const mockRecord = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  app: { getPath: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel: string, cb: HandlerFn) => { mockHandle[channel] = cb; }),
  },
}));

vi.mock('../../../../lib/flight-recorder/index.js', () => ({
  getGlobalRecorder: () => ({ record: mockRecord }),
}));

import { app } from 'electron';
import { registerPrefsHandlers } from '../ipc/prefsHandlers.js';
import { DEFAULT_USER_PREFERENCES } from '../../../../lib/userPreferencesSchema.js';

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

describe('get-preferences — invalid file falls back to defaults (t/3536)', () => {
  const prefsFilePath = () => path.join(tmpRoot, 'preferences.json');

  it('an invalid enum value degrades to DEFAULT_USER_PREFERENCES and records a WARN naming the field', async () => {
    mockRecord.mockClear();
    fs.writeFileSync(prefsFilePath(), JSON.stringify({ viewMode: 'bogus' }), 'utf-8');

    const result = await mockHandle['get-preferences'](fakeEvent);

    expect(result).toEqual(DEFAULT_USER_PREFERENCES);
    expect(mockRecord).toHaveBeenCalledTimes(1);
    const call = mockRecord.mock.calls[0][0] as { level: string; message: string };
    expect(call.level).toBe('warn');
    expect(call.message).toContain('viewMode');
  });

  it('a non-object payload also degrades to defaults with a WARN', async () => {
    mockRecord.mockClear();
    fs.writeFileSync(prefsFilePath(), JSON.stringify('not-an-object'), 'utf-8');

    const result = await mockHandle['get-preferences'](fakeEvent);

    expect(result).toEqual(DEFAULT_USER_PREFERENCES);
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  it('a valid file still round-trips unchanged (no WARN)', async () => {
    mockRecord.mockClear();
    fs.writeFileSync(prefsFilePath(), JSON.stringify({ viewMode: 'advanced' }), 'utf-8');

    const result = await mockHandle['get-preferences'](fakeEvent);

    expect(result).toEqual({ viewMode: 'advanced' });
    expect(mockRecord).not.toHaveBeenCalled();
  });
});
