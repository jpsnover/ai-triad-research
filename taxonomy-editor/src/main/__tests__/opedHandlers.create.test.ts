// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Unit tests for create-oped-set / cancel-oped-set IPC handlers (t/2575, t/2588).
// Verifies: Stage-A source prep hoist, N-voice fan-out, per-voice progress,
// partial-set finalization, cancel mid-run, 2-window event targeting, and
// fail-fast on unreadable source (TL cond 3).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { ipcMain } from 'electron';

// ── child_process.spawn mock ──────────────────────────────────────────────────

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
  deleteOpEdSet: vi.fn(),
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

function emitResult(child: FakeChild, data: Record<string, unknown>): void {
  const line = JSON.stringify({ type: 'result', data }) + '\n';
  child.stdout.emit('data', Buffer.from(line));
  child.emit('close', 0);
}

function emitStage(child: FakeChild, stage: string): void {
  child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'stage', stage }) + '\n'));
}

const baseParams = { wordCount: 600, model: 'test-model' };

beforeEach(() => {
  vi.clearAllMocks();
  registerOpEdHandlers();
});

// ── Fan-out ───────────────────────────────────────────────────────────────────

describe('create-oped-set — fan-out', () => {
  it('spawns one pwsh child per voice', async () => {
    const children = [makeChild(), makeChild()];
    let spawnIdx = 0;
    mockSpawn.mockImplementation(() => children[spawnIdx++]);

    const { sender } = makeSender();
    const handler = getHandler('create-oped-set');

    const resultP = handler(
      { sender },
      { topic: 'AI safety', params: baseParams, voices: ['accelerationist', 'safetyist'] },
    ) as Promise<{ set_id: string }>;

    await Promise.resolve(); // let handler start
    emitResult(children[0], { Headline: 'H1', Subtitle: 'S1', Body: 'B1', WordCount: 600, Grounding: [] });
    emitResult(children[1], { Headline: 'H2', Subtitle: 'S2', Body: 'B2', WordCount: 600, Grounding: [] });

    const result = await resultP;
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(result).toHaveProperty('set_id');
    expect(mockFinalize).toHaveBeenCalledTimes(1);
    const finalizedSet = mockFinalize.mock.calls[0][0];
    expect(finalizedSet.opeds).toHaveLength(2);
    expect(finalizedSet.opeds[0].status).toBe('complete');
    expect(finalizedSet.opeds[1].status).toBe('complete');
  });

  it('queued progress fires for each voice before any spawn completes', async () => {
    const children = [makeChild(), makeChild()];
    let spawnIdx = 0;
    mockSpawn.mockImplementation(() => children[spawnIdx++]);

    const { sender, sent } = makeSender();
    const handler = getHandler('create-oped-set');

    const resultP = handler(
      { sender },
      { topic: 'topic', params: baseParams, voices: ['accelerationist', 'safetyist'] },
    ) as Promise<unknown>;

    await Promise.resolve();
    const queued = (sent as Array<{ stage: string; voice: string }>).filter(e => e.stage === 'queued');
    expect(queued).toHaveLength(2);
    expect(queued.map(e => e.voice).sort()).toEqual(['accelerationist', 'safetyist']);

    emitResult(children[0], { Headline: 'H', Subtitle: 'S', Body: 'B', WordCount: 600, Grounding: [] });
    emitResult(children[1], { Headline: 'H', Subtitle: 'S', Body: 'B', WordCount: 600, Grounding: [] });
    await resultP;
  });

  it('stage events from shim are forwarded to sender', async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);

    const { sender, sent } = makeSender();
    const handler = getHandler('create-oped-set');

    const resultP = handler(
      { sender },
      { topic: 'topic', params: baseParams, voices: ['accelerationist'] },
    ) as Promise<unknown>;

    await Promise.resolve();
    emitStage(child, 'grounding');
    emitStage(child, 'generating');
    emitResult(child, { Headline: 'H', Subtitle: 'S', Body: 'B', WordCount: 600, Grounding: [] });
    await resultP;

    const stages = (sent as Array<{ stage: string }>).map(e => e.stage);
    expect(stages).toContain('grounding');
    expect(stages).toContain('generating');
    expect(stages).toContain('complete');
  });
});

// ── Partial-set contract ──────────────────────────────────────────────────────

describe('create-oped-set — partial-set contract', () => {
  it('one voice fails → partial set finalized with failed member', async () => {
    const children = [makeChild(), makeChild()];
    let spawnIdx = 0;
    mockSpawn.mockImplementation(() => children[spawnIdx++]);

    const { sender } = makeSender();
    const handler = getHandler('create-oped-set');

    const resultP = handler(
      { sender },
      { topic: 'topic', params: baseParams, voices: ['accelerationist', 'safetyist'] },
    ) as Promise<{ set_id: string }>;

    await Promise.resolve();
    // voice 0 succeeds
    emitResult(children[0], { Headline: 'H', Subtitle: 'S', Body: 'B', WordCount: 600, Grounding: [] });
    // voice 1 errors
    children[1].emit('error', new Error('pwsh not found'));

    const result = await resultP;
    expect(result).toHaveProperty('set_id');
    expect(mockFinalize).toHaveBeenCalledTimes(1);
    const set = mockFinalize.mock.calls[0][0];
    expect(set.opeds[0].status).toBe('complete');
    expect(set.opeds[1].status).toBe('failed');
  });

  it('all voices fail → all-failed set still finalized', async () => {
    const children = [makeChild(), makeChild()];
    let spawnIdx = 0;
    mockSpawn.mockImplementation(() => children[spawnIdx++]);

    const { sender } = makeSender();
    const resultP = getHandler('create-oped-set')(
      { sender },
      { topic: 'topic', params: baseParams, voices: ['accelerationist', 'safetyist'] },
    ) as Promise<unknown>;

    await Promise.resolve();
    children[0].emit('error', new Error('err'));
    children[1].emit('error', new Error('err'));

    await resultP;
    expect(mockFinalize).toHaveBeenCalledTimes(1);
    const set = mockFinalize.mock.calls[0][0];
    expect(set.opeds.every((m: { status: string }) => m.status === 'failed')).toBe(true);
  });
});

// ── Cancel ────────────────────────────────────────────────────────────────────

describe('cancel-oped-set', () => {
  it('aborts in-flight voices and finalizes a partial cancelled set', async () => {
    const children = [makeChild(), makeChild()];
    let spawnIdx = 0;
    mockSpawn.mockImplementation(() => children[spawnIdx++]);

    const { sender } = makeSender();
    const create = getHandler('create-oped-set');
    const cancel = getHandler('cancel-oped-set');

    const resultP = create(
      { sender },
      { topic: 'topic', params: baseParams, voices: ['accelerationist', 'safetyist'] },
    ) as Promise<{ set_id: string }>;

    await Promise.resolve();
    // voice 0 completes before cancel
    emitResult(children[0], { Headline: 'H', Subtitle: 'S', Body: 'B', WordCount: 600, Grounding: [] });

    // Get set_id from the queued events on sender
    const sentData = (sender.send as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const queuedCall = sentData.find(c => (c[1] as { stage: string }).stage === 'queued');
    const setId: string = (queuedCall![1] as { set_id: string }).set_id;

    // Cancel — triggers abort on all remaining voices
    cancel({}, setId);

    // voice 1 receives SIGTERM signal (child.kill called)
    await Promise.resolve();

    const result = await resultP;
    expect(result).toHaveProperty('set_id', setId);
    expect(mockFinalize).toHaveBeenCalledTimes(1);
    const set = mockFinalize.mock.calls[0][0];
    expect(set.opeds[0].status).toBe('complete');
    expect(set.opeds[1].status).toBe('cancelled');
    expect(children[1].kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('unknown set_id cancel is silent no-op', () => {
    expect(() => getHandler('cancel-oped-set')({}, 'nonexistent-id')).not.toThrow();
  });
});

// ── Event targeting ───────────────────────────────────────────────────────────

describe('create-oped-set — event targeting', () => {
  it('progress events reach only the initiating window sender, not a second sender', async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);

    const { sender: sender1, sent: sent1 } = makeSender(1);
    const { sender: sender2 } = makeSender(2);

    const handler = getHandler('create-oped-set');
    const resultP = handler(
      { sender: sender1 },
      { topic: 'topic', params: baseParams, voices: ['accelerationist'] },
    ) as Promise<unknown>;

    await Promise.resolve();
    emitResult(child, { Headline: 'H', Subtitle: 'S', Body: 'B', WordCount: 600, Grounding: [] });
    await resultP;

    expect(sent1.length).toBeGreaterThan(0);
    expect(sender2.send).not.toHaveBeenCalled();
  });
});

// ── Stage-A source hoist (t/2588) ─────────────────────────────────────────────

// Identify spawned shims by filename (avoids path-separator differences on Windows).
const PREP_SHIM_FILE  = 'invoke-get-oped-source.ps1';
const VOICE_SHIM_FILE = 'invoke-oped.ps1';

const FAKE_SOURCE_PREP = {
  Url: 'https://example.com/article',
  SourceMarkdown: '# Article\n\nSome content.',
  SourceFormat: 'markdown',
  ReadableWords: 500,
  ReadableRatio: 0.85,
  ContentHash: 'abc123',
};

function makeSpawnRouter(prepChild: FakeChild, voiceChildren: FakeChild[]): (_cmd: string, args: string[]) => FakeChild {
  let voiceIdx = 0;
  return (_cmd: string, args: string[]) => {
    const file = args[3] ?? '';
    if (file.includes('invoke-get-oped-source')) return prepChild;
    return voiceChildren[voiceIdx++] as FakeChild;
  };
}

function emitPrepResult(child: FakeChild, data: Record<string, unknown>): void {
  const line = JSON.stringify({ type: 'result', data }) + '\n';
  child.stdout.emit('data', Buffer.from(line));
  child.emit('close', 0);
}

describe('create-oped-set — Stage-A source hoist', () => {
  it('spawns prep shim first, then one voice shim per voice', async () => {
    const prepChild = makeChild();
    const voiceChildren = [makeChild(), makeChild()];
    mockSpawn.mockImplementation(makeSpawnRouter(prepChild, voiceChildren));

    const { sender } = makeSender();
    const handler = getHandler('create-oped-set');

    const resultP = handler(
      { sender },
      { topic: 'AI safety', url: 'https://example.com', params: baseParams, voices: ['accelerationist', 'safetyist'] },
    ) as Promise<{ set_id: string }>;

    await Promise.resolve();
    emitPrepResult(prepChild, FAKE_SOURCE_PREP);
    await Promise.resolve();

    emitResult(voiceChildren[0], { Headline: 'H1', Subtitle: 'S1', Body: 'B1', WordCount: 600, Grounding: [] });
    emitResult(voiceChildren[1], { Headline: 'H2', Subtitle: 'S2', Body: 'B2', WordCount: 600, Grounding: [] });
    await resultP;

    expect(mockSpawn).toHaveBeenCalledTimes(3); // 1 prep + 2 voices
    expect((mockSpawn.mock.calls[0] as [string, string[]])[1][3]).toContain(PREP_SHIM_FILE);
    expect((mockSpawn.mock.calls[1] as [string, string[]])[1][3]).toContain(VOICE_SHIM_FILE);
    expect((mockSpawn.mock.calls[2] as [string, string[]])[1][3]).toContain(VOICE_SHIM_FILE);
  });

  it('emits preparing-source set-phase event (no voice field) before queued events', async () => {
    const prepChild = makeChild();
    const voiceChild = makeChild();
    mockSpawn.mockImplementation(makeSpawnRouter(prepChild, [voiceChild]));

    const { sender, sent } = makeSender();
    const handler = getHandler('create-oped-set');

    const resultP = handler(
      { sender },
      { topic: 'topic', url: 'https://example.com', params: baseParams, voices: ['accelerationist'] },
    ) as Promise<unknown>;

    await Promise.resolve();
    emitPrepResult(prepChild, FAKE_SOURCE_PREP);
    await Promise.resolve();

    emitResult(voiceChild, { Headline: 'H', Subtitle: 'S', Body: 'B', WordCount: 600, Grounding: [] });
    await resultP;

    const events = sent as Array<{ stage: string; voice?: string }>;
    const prepIdx   = events.findIndex(e => e.stage === 'preparing-source');
    const queuedIdx = events.findIndex(e => e.stage === 'queued');
    expect(prepIdx).toBeGreaterThanOrEqual(0);
    expect(events[prepIdx].voice).toBeUndefined();
    expect(prepIdx).toBeLessThan(queuedIdx);
  });

  it('threads SourcePrep into each voice spawn stdin', async () => {
    const prepChild = makeChild();
    const voiceChildren = [makeChild(), makeChild()];
    mockSpawn.mockImplementation(makeSpawnRouter(prepChild, voiceChildren));

    const { sender } = makeSender();
    const handler = getHandler('create-oped-set');

    const resultP = handler(
      { sender },
      { topic: 'topic', url: 'https://example.com', params: baseParams, voices: ['accelerationist', 'safetyist'] },
    ) as Promise<unknown>;

    await Promise.resolve();
    emitPrepResult(prepChild, FAKE_SOURCE_PREP);
    await Promise.resolve();

    emitResult(voiceChildren[0], { Headline: 'H', Subtitle: 'S', Body: 'B', WordCount: 600, Grounding: [] });
    emitResult(voiceChildren[1], { Headline: 'H', Subtitle: 'S', Body: 'B', WordCount: 600, Grounding: [] });
    await resultP;

    // Both voice spawns must receive SourcePrep in stdin
    for (const voiceChild of voiceChildren) {
      const writtenArg = (voiceChild.stdin.write as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      const parsed = JSON.parse(writtenArg) as Record<string, unknown>;
      expect(parsed).toHaveProperty('SourcePrep');
      expect((parsed.SourcePrep as Record<string, unknown>).ContentHash).toBe('abc123');
    }
  });

  it('fail-fast: unreadable source throws ActionableError, no voice spawns, no finalize', async () => {
    const prepChild = makeChild();
    mockSpawn.mockImplementation(makeSpawnRouter(prepChild, []));

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
    // Only the prep shim was spawned — no voice shims
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect((mockSpawn.mock.calls[0] as [string, string[]])[1][3]).toContain(PREP_SHIM_FILE);
  });

  it('no prep shim when url is absent (topic-only path unchanged)', async () => {
    const voiceChild = makeChild();
    mockSpawn.mockReturnValue(voiceChild);

    const { sender } = makeSender();
    const resultP = getHandler('create-oped-set')(
      { sender },
      { topic: 'topic', params: baseParams, voices: ['accelerationist'] },
    ) as Promise<unknown>;

    await Promise.resolve();
    emitResult(voiceChild, { Headline: 'H', Subtitle: 'S', Body: 'B', WordCount: 600, Grounding: [] });
    await resultP;

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect((mockSpawn.mock.calls[0] as [string, string[]])[1][3]).toContain(VOICE_SHIM_FILE);
  });
});
