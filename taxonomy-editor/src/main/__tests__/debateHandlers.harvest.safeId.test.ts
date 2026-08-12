// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression tests for M5 assertSafeId guards in debateHandlers.ts harvest
// handlers (t/2531): harvest-create-conflict, harvest-add-verdict,
// harvest-save-manifest all construct paths from user-supplied IDs.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';

const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn(() => true));
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn(() => '{"id":"x"}'));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getFocusedWindow: vi.fn(() => null), fromWebContents: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  dialog: { showSaveDialog: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp'), getVersion: vi.fn(() => '1.0.0') },
  safeStorage: { isEncryptionAvailable: vi.fn(() => false), encryptString: vi.fn(), decryptString: vi.fn() },
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: mockExistsSync,
    writeFileSync: mockWriteFileSync,
    mkdirSync: mockMkdirSync,
    readFileSync: mockReadFileSync,
    default: { ...actual, existsSync: mockExistsSync, writeFileSync: mockWriteFileSync, mkdirSync: mockMkdirSync, readFileSync: mockReadFileSync },
  };
});

vi.mock('../debateIO.js', () => ({
  listDebateSessions: vi.fn(),
  loadDebateSession: vi.fn(),
  saveDebateSession: vi.fn(),
  deleteDebateSession: vi.fn(),
  loadDebateComments: vi.fn(),
  saveDebateComments: vi.fn(),
}));

vi.mock('../debateExport.js', () => ({
  debateToText: vi.fn(),
  debateToMarkdown: vi.fn(),
  debateToPdf: vi.fn(),
  debateToPackage: vi.fn(),
}));

vi.mock('../fileIO.js', () => ({
  getDataRootPath: vi.fn(() => '/fake/data'),
  loadDataConfig: vi.fn(() => ({ taxonomy_dir: 'taxonomy' })),
  getSourcesDir: vi.fn(() => null),
}));

vi.mock('../embeddings.js', () => ({ generateText: vi.fn() }));
vi.mock('../ipcSchemas.js', () => ({
  VALID_POV: { parse: vi.fn() },
  NodeId: { parse: vi.fn() },
}));

vi.mock('../../../../lib/debate/errors.js', () => ({
  ActionableError: class ActionableError extends Error {
    constructor(args: { goal: string; problem: string; location: string; nextSteps: string[] }) {
      super(args.problem);
      this.name = 'ActionableError';
    }
  },
}));

vi.mock('../../../../lib/debate/persistence.js', () => ({ renameSyncWithRetry: vi.fn() }));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: vi.fn(() => null) }));
vi.mock('../../../../lib/ai-client/index.js', () => ({ DEFAULT_MODEL: 'gemini-2.0-flash' }));

import { registerDebateHandlers } from '../ipc/debateHandlers.js';

function getHandler(channel: string): (event: unknown, ...args: unknown[]) => Promise<unknown> {
  const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls;
  const entry = calls.find((c: unknown[]) => c[0] === channel);
  if (!entry) throw new Error(`${channel} not registered`);
  return entry[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  registerDebateHandlers();
});

const TRAVERSAL_IDS = ['../../etc/passwd', '../shadow', 'a/b', '/abs/path'];

describe('harvest-create-conflict — assertSafeId on claim_id', () => {
  it.each(TRAVERSAL_IDS)('rejects traversal claim_id "%s"', async (id) => {
    const handler = getHandler('harvest-create-conflict');
    await expect(handler({}, { claim_id: id })).rejects.toThrow();
  });

  it('accepts valid claim_id', async () => {
    const handler = getHandler('harvest-create-conflict');
    await expect(handler({}, { claim_id: 'conflict-001' })).resolves.toBeDefined();
  });
});

describe('harvest-add-verdict — assertSafeId on conflictId', () => {
  it.each(TRAVERSAL_IDS)('rejects traversal conflictId "%s"', async (id) => {
    const handler = getHandler('harvest-add-verdict');
    await expect(handler({}, id, {})).rejects.toThrow();
  });

  it('accepts valid conflictId (file not found → not-found path)', async () => {
    mockExistsSync.mockReturnValue(false);
    const handler = getHandler('harvest-add-verdict');
    const result = await handler({}, 'conflict-001', {});
    expect((result as { updated: boolean }).updated).toBe(false);
  });
});

describe('harvest-save-manifest — assertSafeId on debate_id', () => {
  it.each(TRAVERSAL_IDS)('rejects traversal debate_id "%s"', async (id) => {
    const handler = getHandler('harvest-save-manifest');
    await expect(handler({}, { debate_id: id })).rejects.toThrow();
  });

  it('accepts valid debate_id', async () => {
    const handler = getHandler('harvest-save-manifest');
    await expect(handler({}, { debate_id: 'debate-xyz' })).resolves.toBeDefined();
  });
});
