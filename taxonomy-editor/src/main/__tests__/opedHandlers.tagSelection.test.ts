// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3994 — the Electron create-oped-set IPC handler must validate params.tagSelection with the
// real lib/oped/schemas.js parseOpEdRequest (t/3960; SO e/254#6) before starting generation, so an
// unknown/unregistered tag is rejected rather than the set running untagged or crashing mid-fan-out.
// Mirrors opedHandlers.create.test.ts's mock scaffold exactly — only parseOpEdRequest/the real
// pov-tags registry are left unmocked, since the point is to exercise the live validation boundary.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import type { OpEdSet } from '../../../../lib/oped/types.js';

const mockSpawn = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ default: { spawn: mockSpawn }, spawn: mockSpawn }));

const mockFetchBinary = vi.hoisted(() => vi.fn());
vi.mock('../../../../lib/url-fetch/fetchUrlForPrompt.js', () => ({
  fetchUrlForPromptBinary: (...args: unknown[]) => mockFetchBinary(...args),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, writeFileSync: vi.fn(), rmSync: vi.fn() };
});

vi.mock('os', () => ({ default: { tmpdir: () => '/tmp' }, tmpdir: () => '/tmp' }));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showSaveDialog: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') },
  safeStorage: { isEncryptionAvailable: vi.fn(() => false) },
}));

vi.mock('../opedIO.js', () => ({
  saveOpEdSetTemp: vi.fn(),
  finalizeOpEdSet: vi.fn(),
  loadOpEdSet: vi.fn(),
  saveOpEdSet: vi.fn(),
  deleteOpEdSet: vi.fn(),
  listOpEdSets: vi.fn(() => []),
}));

const mockGenerateOpEdSet = vi.hoisted(() => vi.fn());
vi.mock('../../../../lib/oped/generate.js', () => ({
  generateOpEdSet: (...args: unknown[]) => mockGenerateOpEdSet(...args),
}));

vi.mock('../electronAIAdapter.js', () => ({
  makeElectronAIAdapter: vi.fn(() => ({ generateText: vi.fn() })),
}));

vi.mock('../fileIO.js', () => ({
  PROJECT_ROOT: '/fake/root',
  getDataRootPath: vi.fn(() => '/fake/data'),
  resolveDataPath: vi.fn((p: string) => `/fake/data/${p}`),
}));

vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: vi.fn(() => null) }));
vi.mock('../../../../lib/electron-shared/safeId.js', () => ({ assertSafeId: vi.fn() }));

// parseOpEdRequest/ActionableError are NOT mocked — this proves the real validation boundary.
import { registerOpEdHandlers } from '../ipc/opedHandlers.js';
import { ActionableError } from '../../../../lib/debate/errors.js';

function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls;
  const entry = calls.find((c: unknown[]) => c[0] === channel);
  if (!entry) throw new Error(`${channel} not registered`);
  return entry[1] as (...args: unknown[]) => Promise<unknown>;
}

function makeSender(id = 1) {
  return { sender: { id, isDestroyed: () => false, send: vi.fn() } };
}

async function* makeCompleteGenerator(set: OpEdSet): AsyncGenerator<{ type: string; set?: OpEdSet }> {
  yield { type: 'complete', set };
}

const baseParams = { wordCount: 600, model: 'test-model' };

const FAKE_SET: OpEdSet = {
  schema_version: 1,
  set_id: 'test-id',
  topic: 'topic',
  params: baseParams,
  created_at: '2026-08-13T00:00:00.000Z',
  opeds: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateOpEdSet.mockImplementation(() => makeCompleteGenerator(FAKE_SET));
  mockFetchBinary.mockResolvedValue({ ok: true, bytes: Buffer.from('x'), contentType: 'text/html', finalUrl: 'https://x' });
  registerOpEdHandlers();
});

describe('create-oped-set — tagSelection validation (t/3994)', () => {
  it('REGRESSION: an unregistered tag is rejected with ActionableError before generation starts', async () => {
    const { sender } = makeSender();
    const handler = getHandler('create-oped-set');

    await expect(
      handler(
        { sender },
        {
          topic: 'topic',
          params: { ...baseParams, tagSelection: { pov: 'skeptic', tag: 'nonexistent-tag', mode: 'scope' } },
          voices: ['skeptic'],
        },
      ),
    ).rejects.toThrow(ActionableError);

    expect(mockGenerateOpEdSet).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockFetchBinary).not.toHaveBeenCalled();
  });

  it('REGRESSION: a tag whose POV is not among the requested voices is rejected before generation starts', async () => {
    const { sender } = makeSender();
    const handler = getHandler('create-oped-set');

    await expect(
      handler(
        { sender },
        {
          topic: 'topic',
          params: { ...baseParams, tagSelection: { pov: 'skeptic', tag: 'critical', mode: 'scope' } },
          voices: ['accelerationist'],
        },
      ),
    ).rejects.toThrow(ActionableError);

    expect(mockGenerateOpEdSet).not.toHaveBeenCalled();
  });

  it('a registered tag for a requested POV passes validation and reaches generateOpEdSet with tagSelection intact', async () => {
    const { sender } = makeSender();
    const handler = getHandler('create-oped-set');
    const tagSelection = { pov: 'skeptic' as const, tag: 'critical', mode: 'scope' as const };

    await handler(
      { sender },
      { topic: 'topic', params: { ...baseParams, tagSelection }, voices: ['skeptic'] },
    );

    expect(mockGenerateOpEdSet).toHaveBeenCalledOnce();
    const [request] = mockGenerateOpEdSet.mock.calls[0] as [{ params: { tagSelection?: unknown } }];
    expect(request.params.tagSelection).toEqual(tagSelection);
  });

  it('the untagged path is unchanged: no tagSelection passes validation and generateOpEdSet sees params.tagSelection undefined', async () => {
    const { sender } = makeSender();
    const handler = getHandler('create-oped-set');

    await handler(
      { sender },
      { topic: 'topic', params: baseParams, voices: ['accelerationist', 'safetyist'] },
    );

    expect(mockGenerateOpEdSet).toHaveBeenCalledOnce();
    const [request] = mockGenerateOpEdSet.mock.calls[0] as [{ params: { tagSelection?: unknown } }];
    expect(request.params.tagSelection).toBeUndefined();
  });
});
