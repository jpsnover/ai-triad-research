// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2611 migration test: proves Stage B uses lib/oped generateOpEdSet in-process,
// not the PS shim. Mocks the generator to yield canned events and asserts:
//   (a) correct IPC progress sequence
//   (b) finalizeOpEdSet called with assembled set
//   (c) partial-set finalization on abort
//   (d) STOPGAP helpers (normalizePov / normalizeGrounding) are gone

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import type { OpEdMember } from '../../../../lib/oped/types.js';
import type { OpEdProgressEvent as LibEvent } from '../../../../lib/oped/generate.js';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: {},
  BrowserWindow: { fromWebContents: vi.fn() },
}));

vi.mock('../opedIO.js', () => ({
  listOpEdSets:    vi.fn(() => []),
  loadOpEdSet:     vi.fn(),
  saveOpEdSet:     vi.fn(),
  deleteOpEdSet:   vi.fn(),
  saveOpEdSetTemp: vi.fn(),
  finalizeOpEdSet: vi.fn(),
}));

vi.mock('../fileIO.js', () => ({
  PROJECT_ROOT:   '/fake/root',
  getDataRootPath: vi.fn(() => '/fake/data'),
}));

vi.mock('../../../../lib/flight-recorder/index.js', () => ({
  getGlobalRecorder: vi.fn(() => null),
}));

vi.mock('../../../../lib/electron-shared/safeId.js', () => ({
  assertSafeId: vi.fn(),
}));

vi.mock('../electronAIAdapter.js', () => ({
  makeElectronAIAdapter: vi.fn(() => ({ generateText: vi.fn() })),
}));

// generateOpEdSet is the core mock — we control what it yields per test
const mockGenerateOpEdSet = vi.fn();
vi.mock('../../../../lib/oped/generate.js', () => ({
  generateOpEdSet: (...args: unknown[]) => mockGenerateOpEdSet(...args),
}));

// ── Test helpers ──────────────────────────────────────────────────────────────

import { ipcMain } from 'electron';
import { finalizeOpEdSet, saveOpEdSetTemp } from '../opedIO.js';
import { registerOpEdHandlers } from '../ipc/opedHandlers.js';

// Collect the handler registered for a given channel
function captureHandler(channel: string): (event: Partial<IpcMainInvokeEvent>, payload: unknown) => Promise<unknown> {
  const handle = vi.mocked(ipcMain.handle);
  const call = handle.mock.calls.find(([ch]) => ch === channel);
  if (!call) throw new Error(`No handler registered for channel: ${channel}`);
  return call[1] as (event: Partial<IpcMainInvokeEvent>, payload: unknown) => Promise<unknown>;
}

function makeSender(): { send: ReturnType<typeof vi.fn>; isDestroyed: ReturnType<typeof vi.fn> } {
  return { send: vi.fn(), isDestroyed: vi.fn(() => false) };
}

function fakeEvent(sender: ReturnType<typeof makeSender>): Partial<IpcMainInvokeEvent> {
  return { sender } as unknown as Partial<IpcMainInvokeEvent>;
}

// Async generator factory — yields a fixed sequence of lib/oped progress events
async function* makeGenerator(events: LibEvent[]): AsyncGenerator<LibEvent> {
  for (const evt of events) yield evt;
}

// A complete voice member for the generator to hand back
const FAKE_MEMBER: OpEdMember = {
  pov: 'accelerationist',
  status: 'complete',
  headline: 'Test Headline',
  subtitle: 'Test Subtitle',
  pitch: 'Test Pitch',
  body: 'Body text.',
  wordCount: 2,
  grounding: [{ node_id: 'acc-bel-001', label: 'Node A', category: 'Beliefs', pov: 'accelerationist', relevance: 'High', how_reflected: 'Directly cited' }],
};

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.mocked(ipcMain.handle).mockClear();
  vi.mocked(finalizeOpEdSet).mockClear();
  vi.mocked(saveOpEdSetTemp).mockClear();
  mockGenerateOpEdSet.mockClear();
  registerOpEdHandlers();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('t/2611 migration: create-oped-set uses lib/oped in-process', () => {
  it('routes Stage B through generateOpEdSet, not spawn', async () => {
    const FAKE_SET = {
      schema_version: 1 as const,
      set_id: 'test-set-id',
      topic: 'AI safety',
      params: { model: 'gemini-pro', wordTarget: 700 },
      created_at: '2026-08-13T00:00:00.000Z',
      opeds: [FAKE_MEMBER],
    };

    mockGenerateOpEdSet.mockImplementation(() => makeGenerator([
      { type: 'grounding_done' },
      { type: 'voice_start', pov: 'accelerationist' },
      { type: 'voice_complete', pov: 'accelerationist', member: FAKE_MEMBER },
      { type: 'complete', set: FAKE_SET },
    ] as LibEvent[]));

    const sender = makeSender();
    const handler = captureHandler('create-oped-set');
    const result = await handler(
      fakeEvent(sender),
      { topic: 'AI safety', params: { model: 'gemini-pro', wordTarget: 700 }, voices: ['accelerationist'] },
    );

    // Returned set_id is a UUID (generated inside handler)
    expect((result as { set_id: string }).set_id).toBeTruthy();

    // generateOpEdSet was called (not spawn)
    expect(mockGenerateOpEdSet).toHaveBeenCalledOnce();

    // Progress events: queued, then grounding, then generating, then complete
    const stages = sender.send.mock.calls.map((c: unknown[]) => (c[1] as { stage: string }).stage);
    expect(stages).toEqual(['queued', 'grounding', 'generating', 'complete']);

    // finalizeOpEdSet called with the complete event's set
    expect(finalizeOpEdSet).toHaveBeenCalledOnce();
    expect(finalizeOpEdSet).toHaveBeenCalledWith(FAKE_SET);
  });

  it('temp-saves after each voice_complete', async () => {
    const FAKE_SET = {
      schema_version: 1 as const,
      set_id: 'ts-id',
      topic: 'topic',
      params: {},
      created_at: '2026-08-13T00:00:00.000Z',
      opeds: [FAKE_MEMBER],
    };

    mockGenerateOpEdSet.mockImplementation(() => makeGenerator([
      { type: 'voice_start', pov: 'accelerationist' },
      { type: 'voice_complete', pov: 'accelerationist', member: FAKE_MEMBER },
      { type: 'complete', set: FAKE_SET },
    ] as LibEvent[]));

    const handler = captureHandler('create-oped-set');
    const s2 = makeSender();
    await handler(
      fakeEvent(s2),
      { topic: 'topic', params: {}, voices: ['accelerationist'] },
    );

    expect(saveOpEdSetTemp).toHaveBeenCalledOnce();
    const tempSet = vi.mocked(saveOpEdSetTemp).mock.calls[0][0];
    expect(tempSet.opeds).toHaveLength(1);
    expect(tempSet.opeds[0].pov).toBe('accelerationist');
  });

  it('includes failed voice in finalizeOpEdSet on voice_failed', async () => {
    const FAKE_SET = {
      schema_version: 1 as const,
      set_id: 'fail-id',
      topic: 'topic',
      params: {},
      created_at: '2026-08-13T00:00:00.000Z',
      opeds: [{ pov: 'safetyist' as const, status: 'failed' as const, headline: '', subtitle: '', body: '', wordCount: 0, grounding: [] }],
    };

    mockGenerateOpEdSet.mockImplementation(() => makeGenerator([
      { type: 'voice_start', pov: 'safetyist' },
      { type: 'voice_failed', pov: 'safetyist', error: 'LLM timeout' },
      { type: 'complete', set: FAKE_SET },
    ] as LibEvent[]));

    const sender = makeSender();
    const handler = captureHandler('create-oped-set');
    await handler(
      fakeEvent(sender),
      { topic: 'topic', params: {}, voices: ['safetyist'] },
    );

    const stages = sender.send.mock.calls.map((c: unknown[]) => (c[1] as { stage: string }).stage);
    expect(stages).toContain('failed');
    expect(finalizeOpEdSet).toHaveBeenCalledWith(FAKE_SET);
  });

  it('finalizes partial set on abort before complete fires', async () => {
    const ac = new AbortController();

    mockGenerateOpEdSet.mockImplementation(async function* ({ signal }: { signal: AbortSignal }) {
      yield { type: 'voice_start', pov: 'accelerationist' } as LibEvent;
      yield { type: 'voice_complete', pov: 'accelerationist', member: FAKE_MEMBER } as LibEvent;
      // Simulate abort before complete
      ac.abort();
      if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });

    const handler = captureHandler('create-oped-set');
    try {
      await handler(
        fakeEvent(makeSender()),
        { topic: 'topic', params: {}, voices: ['accelerationist'] },
      );
    } catch { /* abort throws — expected */ }

    // finalizeOpEdSet must have been called with partial set containing the completed member
    expect(finalizeOpEdSet).toHaveBeenCalledOnce();
    const partialSet = vi.mocked(finalizeOpEdSet).mock.calls[0][0];
    expect(partialSet.opeds).toHaveLength(1);
    expect(partialSet.opeds[0].pov).toBe('accelerationist');
    expect(partialSet.opeds[0].status).toBe('complete');
  });

  it('STOPGAP normalizePov and normalizeGrounding do not exist on module', async () => {
    // If the STOPGAP helpers are still present they would be exported or at least visible
    // at the module level. This import verifies they are NOT re-exported.
    const mod = await import('../ipc/opedHandlers.js');
    expect((mod as Record<string, unknown>).normalizePov).toBeUndefined();
    expect((mod as Record<string, unknown>).normalizeGrounding).toBeUndefined();
  });
});
