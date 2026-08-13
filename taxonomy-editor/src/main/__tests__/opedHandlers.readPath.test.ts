// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Unit tests for list/load/delete/save-oped-set IPC handlers (t/2591).
// Mirrors debate-session read-path coverage: safeId rejection + happy path.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';

vi.mock('child_process', () => ({ default: { spawn: vi.fn() }, spawn: vi.fn() }));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showSaveDialog: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') },
  safeStorage: { isEncryptionAvailable: vi.fn(() => false) },
}));

const mockListOpEdSets  = vi.hoisted(() => vi.fn());
const mockLoadOpEdSet   = vi.hoisted(() => vi.fn());
const mockDeleteOpEdSet = vi.hoisted(() => vi.fn());
const mockSaveOpEdSet   = vi.hoisted(() => vi.fn());

vi.mock('../opedIO.js', () => ({
  saveOpEdSetTemp: vi.fn(),
  finalizeOpEdSet: vi.fn(),
  loadOpEdSet:     mockLoadOpEdSet,
  deleteOpEdSet:   mockDeleteOpEdSet,
  listOpEdSets:    mockListOpEdSets,
  saveOpEdSet:     mockSaveOpEdSet,
}));

vi.mock('../fileIO.js', () => ({
  PROJECT_ROOT: '/fake/root',
  getDataRootPath: vi.fn(() => '/fake/data'),
  resolveDataPath: vi.fn((p: string) => `/fake/data/${p}`),
}));

const mockAssertSafeId = vi.hoisted(() => vi.fn());
vi.mock('../../../../lib/electron-shared/safeId.js', () => ({ assertSafeId: mockAssertSafeId }));
vi.mock('../../../../lib/debate/errors.js', () => ({
  ActionableError: class extends Error {
    constructor(o: { goal: string; problem: string; location: string; nextSteps: string[] }) { super(o.problem); }
  },
}));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: vi.fn(() => null) }));

import { registerOpEdHandlers } from '../ipc/opedHandlers.js';

function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls;
  const entry = calls.find((c: unknown[]) => c[0] === channel);
  if (!entry) throw new Error(`${channel} not registered`);
  return entry[1] as (...args: unknown[]) => Promise<unknown>;
}

const FAKE_SET = {
  schema_version: 1 as const,
  set_id: 'aaaabbbb-0000-0000-0000-000000000001',
  topic: 'AI policy',
  params: { wordCount: 600, model: 'test' },
  created_at: '2026-08-13T00:00:00.000Z',
  opeds: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  registerOpEdHandlers();
});

describe('list-oped-sets', () => {
  it('returns all sets from opedIO', async () => {
    mockListOpEdSets.mockReturnValue([FAKE_SET]);
    const result = await getHandler('list-oped-sets')({}, undefined);
    expect(result).toEqual([FAKE_SET]);
    expect(mockListOpEdSets).toHaveBeenCalledTimes(1);
  });

  it('returns empty array when no sets exist', async () => {
    mockListOpEdSets.mockReturnValue([]);
    const result = await getHandler('list-oped-sets')({}, undefined);
    expect(result).toEqual([]);
  });
});

describe('load-oped-set', () => {
  it('asserts safeId and returns set', async () => {
    mockLoadOpEdSet.mockReturnValue(FAKE_SET);
    const result = await getHandler('load-oped-set')({}, FAKE_SET.set_id);
    expect(mockAssertSafeId).toHaveBeenCalledWith(FAKE_SET.set_id, 'oped set id');
    expect(result).toEqual(FAKE_SET);
  });

  it('propagates safeId rejection', () => {
    mockAssertSafeId.mockImplementationOnce(() => { throw new Error('unsafe id'); });
    expect(() => getHandler('load-oped-set')({}, '../evil')).toThrow('unsafe id');
    expect(mockLoadOpEdSet).not.toHaveBeenCalled();
  });
});

describe('delete-oped-set', () => {
  it('asserts safeId and deletes', async () => {
    await getHandler('delete-oped-set')({}, FAKE_SET.set_id);
    expect(mockAssertSafeId).toHaveBeenCalledWith(FAKE_SET.set_id, 'oped set id');
    expect(mockDeleteOpEdSet).toHaveBeenCalledWith(FAKE_SET.set_id);
  });

  it('propagates safeId rejection', () => {
    mockAssertSafeId.mockImplementationOnce(() => { throw new Error('unsafe id'); });
    expect(() => getHandler('delete-oped-set')({}, '../evil')).toThrow('unsafe id');
    expect(mockDeleteOpEdSet).not.toHaveBeenCalled();
  });
});

describe('save-oped-set', () => {
  it('asserts safeId on set_id and saves', async () => {
    await getHandler('save-oped-set')({}, FAKE_SET);
    expect(mockAssertSafeId).toHaveBeenCalledWith(FAKE_SET.set_id, 'oped set id');
    expect(mockSaveOpEdSet).toHaveBeenCalledWith(FAKE_SET);
  });

  it('propagates safeId rejection', () => {
    mockAssertSafeId.mockImplementationOnce(() => { throw new Error('unsafe id'); });
    expect(() => getHandler('save-oped-set')({}, { ...FAKE_SET, set_id: '../evil' })).toThrow('unsafe id');
    expect(mockSaveOpEdSet).not.toHaveBeenCalled();
  });
});
