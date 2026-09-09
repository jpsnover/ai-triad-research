// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3415 regression: save-debate-session EPERM is a same-process self-lock (a
// concurrent read holding an open handle on the target when the save's rename fires),
// not antivirus. Two things are covered here:
//   1. A per-id async mutex serializes save vs load/list for the SAME id, closing the
//      race — an interleaved save+load on the same id must not let the write proceed
//      while a read is still in flight.
//   2. The outer save-failure error reuses the inner self-lock-aware diagnosis
//      (persistence.ts) instead of overwriting it with a hardcoded "Windows
//      antivirus/indexer" message — self-lock text vs external-lock text, both arms.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionableError } from '../../../../lib/debate/errors.js';

const mockAtomicWriteSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn(() => true));
const mockStatSync = vi.hoisted(() => vi.fn(() => ({ mtimeMs: 1 })));
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn(() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }));

// A controllable deferred readFile so a "read in flight" can be held open across the
// moment a same-id save is issued — proving the mutex actually serializes them.
const readFileDeferred = vi.hoisted(() => {
  let resolve!: (v: string) => void;
  const promise = new Promise<string>((r) => { resolve = r; });
  return { promise, resolve };
});

const events: string[] = [];

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const mockReadFileProm = vi.fn(() => {
    events.push('read:start');
    return readFileDeferred.promise.then((v) => { events.push('read:resolve'); return v; });
  });
  const mockPromises = { ...actual.promises, readFile: mockReadFileProm };
  const overrides = {
    existsSync: mockExistsSync, statSync: mockStatSync, mkdirSync: mockMkdirSync,
    writeFileSync: mockWriteFileSync, readFileSync: mockReadFileSync, promises: mockPromises,
  };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

vi.mock('../fileIO.js', () => ({
  resolveDataPath: vi.fn(() => '/fake/debates'),
  PROJECT_ROOT: '/fake/root',
}));

vi.mock('../../../../lib/debate/calibrationLogger.js', () => ({
  extractCalibrationData: vi.fn(),
  appendCalibrationLog: vi.fn(),
}));

vi.mock('../../../../lib/debate/harvestOnSave.js', () => ({
  harvestDebateTestedForSession: vi.fn(),
}));

vi.mock('../../../../lib/debate/persistence.js', () => ({
  safeSerialize: vi.fn((v: unknown) => ({ json: JSON.stringify(v), hadError: false })),
  atomicWriteSync: (...args: unknown[]) => {
    events.push('write:atomic');
    return mockAtomicWriteSync(...args);
  },
  renameSyncWithRetry: vi.fn(),
}));

vi.mock('../../../../lib/debate/lockHolder.js', () => ({ recordLockHolder: vi.fn() }));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: vi.fn(() => null) }));

import { loadDebateSession, saveDebateSession } from '../debateIO.js';

beforeEach(() => {
  vi.clearAllMocks();
  events.length = 0;
  mockAtomicWriteSync.mockReset();
  mockAtomicWriteSync.mockImplementation(() => undefined);
});

// withIdLock chains through several microtask hops (Promise.resolve().catch().then())
// before fn() actually runs, so a single `await Promise.resolve()` doesn't reliably
// observe the read having started. Flush via a macrotask, which only runs once the
// microtask queue is fully drained.
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('debateIO — per-id read/write serialization (t/3415)', () => {
  it('a save for the SAME id waits for an in-flight read to finish before writing', async () => {
    const loadPromise = loadDebateSession('same-id');
    await flushMicrotasks();
    expect(events).toEqual(['read:start']);

    const savePromise = saveDebateSession({ id: 'same-id', transcript: [] }, 'test');
    // The read is still in flight — the save must not have written yet.
    await flushMicrotasks();
    expect(events).toEqual(['read:start']);

    readFileDeferred.resolve('{"id":"same-id"}');
    await loadPromise;
    await savePromise;

    expect(events).toEqual(['read:start', 'read:resolve', 'write:atomic']);
  });
});

describe('debateIO — save error reuses inner self-lock diagnosis, not hardcoded AV (t/3415)', () => {
  it('self-lock: outer error names the Electron process, not antivirus', async () => {
    mockAtomicWriteSync.mockImplementation(() => {
      throw new ActionableError({
        goal: 'Persist bytes to debate file',
        problem: 'Atomic rename and .tmp2 rename fallback were both denied (rename EPERM, fallback EPERM) — the target is held by electron.exe (pid 52308) longer than the retry budget allows.',
        location: 'lib/debate/persistence.ts atomicWriteSync',
        nextSteps: [
          'The new content is preserved at the .tmp and was NOT deleted.',
          'Retry the save once the lock clears.',
          'The locker is the Electron process itself (electron.exe (pid 52308)) — check for overlapping write operations or an unclosed read handle in the same process.',
        ],
      });
    });

    const err = await saveDebateSession({ id: 'x', transcript: [] }, 'test').catch(e => e);
    expect(err).toBeInstanceOf(ActionableError);
    const ae = err as ActionableError;
    expect(ae.problem).toContain('electron.exe (pid 52308)');
    expect(ae.nextSteps.join(' ')).toContain('Electron process itself');
    expect(ae.nextSteps.join(' ')).not.toContain('antivirus');
  });

  it('external-lock: outer error keeps the antivirus/indexer guidance for a genuine external lock', async () => {
    mockAtomicWriteSync.mockImplementation(() => {
      throw new ActionableError({
        goal: 'Persist bytes to debate file',
        problem: 'Atomic rename and .tmp2 rename fallback were both denied (rename EPERM, fallback EPERM) — the target is held by MsMpEng.exe (pid 1234) longer than the retry budget allows.',
        location: 'lib/debate/persistence.ts atomicWriteSync',
        nextSteps: [
          'The new content is preserved at the .tmp and was NOT deleted.',
          'Retry the save once the lock clears.',
          'If saves keep failing, exclude the debates directory from antivirus/search-indexer scanning.',
        ],
      });
    });

    const err = await saveDebateSession({ id: 'y', transcript: [] }, 'test').catch(e => e);
    expect(err).toBeInstanceOf(ActionableError);
    const ae = err as ActionableError;
    expect(ae.problem).toContain('MsMpEng.exe (pid 1234)');
    expect(ae.nextSteps.join(' ')).toContain('antivirus');
  });
});
