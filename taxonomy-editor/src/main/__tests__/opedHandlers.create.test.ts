// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Unit tests for create-oped-set / cancel-oped-set IPC handlers (t/2575, t/2588).
// Stage B (voice generation) is now in-process via lib/oped — see opedHandlers.migration.test.ts
// for the generator-wiring coverage. This file covers:
//   Stage-A source prep hoist, queued event sequence, event targeting, cancel no-op,
//   and fail-fast on unreadable source (TL cond 3).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { ipcMain } from 'electron';
import type { OpEdSet } from '../../../../lib/oped/types.js';

// ── child_process.spawn mock (Stage A only) ───────────────────────────────────

const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
  default: { spawn: mockSpawn },
  spawn: mockSpawn,
}));

// ── Electron mock ─────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showSaveDialog: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') },
  safeStorage: { isEncryptionAvailable: vi.fn(() => false) },
}));

// ── opedIO mock ───────────────────────────────────────────────────────────────

const mockSaveTemp = vi.hoisted(() => vi.fn());
const mockFinalize = vi.hoisted(() => vi.fn());

vi.mock('../opedIO.js', () => ({
  saveOpEdSetTemp: mockSaveTemp,
  finalizeOpEdSet: mockFinalize,
  loadOpEdSet: vi.fn(),
  saveOpEdSet: vi.fn(),
  deleteOpEdSet: vi.fn(),
  listOpEdSets: vi.fn(() => []),
}));

// ── lib/oped generator mock (Stage B) ────────────────────────────────────────

const mockGenerateOpEdSet = vi.hoisted(() => vi.fn());

vi.mock('../../../../lib/oped/generate.js', () => ({
  generateOpEdSet: (...args: unknown[]) => mockGenerateOpEdSet(...args),
}));

vi.mock('../electronAIAdapter.js', () => ({
  makeElectronAIAdapter: vi.fn(() => ({ generateText: vi.fn() })),
}));

// ── Remaining deps ────────────────────────────────────────────────────────────

vi.mock('../fileIO.js', () => ({
  PROJECT_ROOT: '/fake/root',
  getDataRootPath: vi.fn(() => '/fake/data'),
  resolveDataPath: vi.fn((p: string) => `/fake/data/${p}`),
}));

vi.mock('../../../../lib/debate/errors.js', () => ({ ActionableError: class extends Error { constructor(o: {goal:string;problem:string;location:string;nextSteps:string[]}) { super(o.problem); } } }));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: vi.fn(() => null) }));
vi.mock('../../../../lib/electron-shared/safeId.js', () => ({ assertSafeId: vi.fn() }));

import { registerOpEdHandlers } from '../ipc/opedHandlers.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls;
  const entry = calls.find((c: unknown[]) => c[0] === channel);
  if (!entry) throw new Error(`${channel} not registered`);
  return entry[1] as (...args: unknown[]) => Promise<unknown>;
}

function makeSender(id = 1) {
  const sent: unknown[] = [];
  return {
    sender: {
      id,
      isDestroyed: () => false,
      send: vi.fn((_ch: string, data: unknown) => sent.push(data)),
    },
    sent,
  };
}

interface FakeChild extends EventEmitter {
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

function makeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdin  = { write: vi.fn(), end: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill   = vi.fn();
  return child;
}

// Minimal complete generator: yields queued events and completes the run
async function* makeCompleteGenerator(set: OpEdSet): AsyncGenerator<{ type: string; set?: OpEdSet; pov?: string }> {
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
  registerOpEdHandlers();
});

// ── Queued events ─────────────────────────────────────────────────────────────

describe('create-oped-set — queued events', () => {
  it('fires queued for each voice before generation starts', async () => {
    const { sender, sent } = makeSender();
    const handler = getHandler('create-oped-set');

    await handler(
      { sender },
      { topic: 'topic', params: baseParams, voices: ['accelerationist', 'safetyist'] },
    );

    const queued = (sent as Array<{ stage: string; voice: string }>).filter(e => e.stage === 'queued');
    expect(queued).toHaveLength(2);
    expect(queued.map(e => e.voice).sort()).toEqual(['accelerationist', 'safetyist']);
  });
});

// ── Cancel ────────────────────────────────────────────────────────────────────

describe('cancel-oped-set', () => {
  it('unknown set_id cancel is silent no-op', () => {
    expect(() => getHandler('cancel-oped-set')({}, 'nonexistent-id')).not.toThrow();
  });
});

// ── Event targeting ───────────────────────────────────────────────────────────

describe('create-oped-set — event targeting', () => {
  it('progress events reach only the initiating window sender, not a second sender', async () => {
    const { sender: sender1, sent: sent1 } = makeSender(1);
    const { sender: sender2 } = makeSender(2);

    const handler = getHandler('create-oped-set');
    await handler(
      { sender: sender1 },
      { topic: 'topic', params: baseParams, voices: ['accelerationist'] },
    );

    expect(sent1.length).toBeGreaterThan(0);
    expect(sender2.send).not.toHaveBeenCalled();
  });
});

// ── Stage-A source hoist (t/2588) ─────────────────────────────────────────────

const PREP_SHIM_FILE = 'invoke-get-oped-source.ps1';

const FAKE_SOURCE_PREP = {
  Url: 'https://example.com/article',
  SourceMarkdown: '# Article\n\nSome content.',
  SourceFormat: 'markdown',
  ReadableWords: 500,
  ReadableRatio: 0.85,
  ContentHash: 'abc123',
};

function makePrepChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdin  = { write: vi.fn(), end: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill   = vi.fn();
  return child;
}

function emitPrepResult(child: FakeChild, data: Record<string, unknown>): void {
  child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'result', data }) + '\n'));
  child.emit('close', 0);
}

describe('create-oped-set — Stage-A source hoist', () => {
  it('emits preparing-source set-phase event (no voice field) before queued events', async () => {
    const prepChild = makePrepChild();
    mockSpawn.mockReturnValue(prepChild);

    const { sender, sent } = makeSender();
    const handler = getHandler('create-oped-set');

    const resultP = handler(
      { sender },
      { topic: 'topic', url: 'https://example.com', params: baseParams, voices: ['accelerationist'] },
    ) as Promise<unknown>;

    // Let Stage A start, then emit prep result to unblock
    await Promise.resolve();
    emitPrepResult(prepChild, FAKE_SOURCE_PREP);
    await resultP;

    const events = sent as Array<{ stage: string; voice?: string }>;
    const prepIdx   = events.findIndex(e => e.stage === 'preparing-source');
    const queuedIdx = events.findIndex(e => e.stage === 'queued');
    expect(prepIdx).toBeGreaterThanOrEqual(0);
    expect(events[prepIdx].voice).toBeUndefined();
    expect(prepIdx).toBeLessThan(queuedIdx);
  });

  it('passes SourceMarkdown as sourceBrief to generateOpEdSet', async () => {
    const prepChild = makePrepChild();
    mockSpawn.mockReturnValue(prepChild);

    const { sender } = makeSender();
    const handler = getHandler('create-oped-set');

    const resultP = handler(
      { sender },
      { topic: 'topic', url: 'https://example.com', params: baseParams, voices: ['accelerationist'] },
    ) as Promise<unknown>;

    await Promise.resolve();
    emitPrepResult(prepChild, FAKE_SOURCE_PREP);
    await resultP;

    expect(mockGenerateOpEdSet).toHaveBeenCalledOnce();
    const [request] = mockGenerateOpEdSet.mock.calls[0] as [{ sourceBrief?: string }];
    expect(request.sourceBrief).toBe(FAKE_SOURCE_PREP.SourceMarkdown);
  });

  it('fail-fast: unreadable source throws ActionableError, no generateOpEdSet call, no finalize', async () => {
    const prepChild = makePrepChild();
    mockSpawn.mockReturnValue(prepChild);

    const { sender } = makeSender();
    const handler = getHandler('create-oped-set');

    const resultP = handler(
      { sender },
      { topic: 'topic', url: 'https://example.com', params: baseParams, voices: ['accelerationist'] },
    ) as Promise<unknown>;

    await Promise.resolve();
    // Prep shim exits non-zero (readability gate trip)
    prepChild.emit('close', 1);

    await expect(resultP).rejects.toThrow();
    expect(mockFinalize).not.toHaveBeenCalled();
    expect(mockGenerateOpEdSet).not.toHaveBeenCalled();
    // Only the prep shim was spawned — no voice shims
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect((mockSpawn.mock.calls[0] as [string, string[]])[1][3]).toContain(PREP_SHIM_FILE);
  });

  it('no Stage-A spawn when url is absent (topic-only path)', async () => {
    const { sender } = makeSender();
    await getHandler('create-oped-set')(
      { sender },
      { topic: 'topic', params: baseParams, voices: ['accelerationist'] },
    );

    // No spawns at all — Stage A skipped, Stage B is in-process
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockGenerateOpEdSet).toHaveBeenCalledOnce();
  });
});
