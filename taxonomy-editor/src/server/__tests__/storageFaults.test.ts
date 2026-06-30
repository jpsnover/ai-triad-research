// @vitest-environment node
//
// Storage fault injection tests for AnonymousSessionStore (t/1084, Phase 2a).
// Pattern: named fault profiles + vi.spyOn on fs.promises, following Phase 1
// harness conventions (lib/debate/__tests__/faultInjection.ts).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';

vi.mock('../logger.js', () => ({
  log: { server: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const mockRecorder = { record: vi.fn() };
vi.mock('../../../../lib/flight-recorder/index.js', () => ({
  getGlobalRecorder: () => mockRecorder,
}));

import { AnonymousSessionStore } from '../storage/anonymousSessionStore.js';

// ── Storage fault profiles ──────────────────────────────────

const STORAGE_FAULT_PROFILES = {
  firstWriteEnoent: { name: 'firstWriteEnoent', description: 'mkdir throws ENOENT (t/1060 regression anchor)' },
  diskFull: { name: 'diskFull', description: 'writeFile ENOSPC after 2 successful writes' },
  permissionDenied: { name: 'permissionDenied', description: 'mkdir EACCES on every call' },
  corruptJson: { name: 'corruptJson', description: 'readFile returns invalid JSON' },
  sharedMountUnavailable: { name: 'sharedMountUnavailable', description: 'SHARED_MOUNT not present — fallback to temp' },
  evictionFailure: { name: 'evictionFailure', description: 'rm throws during LRU eviction' },
  noStateCorruption: { name: 'noStateCorruption', description: 'writeFile throws — no partial file left' },
} as const;

// ── Helpers ─────────────────────────────────────────────────

function setAccessTime(base: string, sessionId: string, msAgo: number) {
  const t = new Date(Date.now() - msAgo);
  fs.utimesSync(path.join(base, sessionId), t, t);
}

function fsError(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}

// ── Tests ───────────────────────────────────────────────────

describe('AnonymousSessionStore fault injection (t/1084)', () => {
  let store: AnonymousSessionStore;
  let baseDir: string;

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anon-fault-'));
    store = new AnonymousSessionStore({
      baseDir,
      maxSessions: 3,
      sessionTtlMs: 1000,
      maxSessionSizeBytes: 2048,
      cleanupIntervalMs: 60_000,
    });
    mockRecorder.record.mockClear();
  });

  afterEach(() => {
    store.stop();
    vi.restoreAllMocks();
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  // 1. First write ENOENT (t/1060 regression anchor)
  it(`${STORAGE_FAULT_PROFILES.firstWriteEnoent.name}: mkdir ENOENT propagates cleanly, not as false 429`, async () => {
    const realMkdir = fsp.mkdir.bind(fsp);
    vi.spyOn(fsp, 'mkdir')
      .mockImplementationOnce(async () => { throw fsError('ENOENT', 'no such file or directory, mkdir'); })
      .mockImplementation(realMkdir as typeof fsp.mkdir);

    try {
      await store.saveDebate('fresh-session', { id: 'd1', title: 'Test' });
      expect.fail('Expected mkdir ENOENT to propagate');
    } catch (err) {
      expect((err as { statusCode?: number }).statusCode).not.toBe(429);
      expect((err as { code?: string }).code).toBe('ENOENT');
    }

    expect(fs.existsSync(path.join(baseDir, 'fresh-session'))).toBe(false);
  });

  // 2. Disk full mid-session
  it(`${STORAGE_FAULT_PROFILES.diskFull.name}: ENOSPC after 2 writes — first 2 intact, 3rd fails`, async () => {
    await store.saveChat('s1', { id: 'c1', data: 'first' });
    await store.saveChat('s1', { id: 'c2', data: 'second' });

    const realWriteFile = fsp.writeFile.bind(fsp);
    vi.spyOn(fsp, 'writeFile')
      .mockImplementationOnce(async () => { throw fsError('ENOSPC', 'no space left on device'); })
      .mockImplementation(realWriteFile as typeof fsp.writeFile);

    await expect(store.saveChat('s1', { id: 'c3', data: 'third' })).rejects.toThrow(/ENOSPC/);

    expect(await store.loadChat('s1', 'c1')).toEqual({ id: 'c1', data: 'first' });
    expect(await store.loadChat('s1', 'c2')).toEqual({ id: 'c2', data: 'second' });
  });

  // 3. Permission denied
  it(`${STORAGE_FAULT_PROFILES.permissionDenied.name}: EACCES on mkdir — clear error, no partial state`, async () => {
    vi.spyOn(fsp, 'mkdir').mockRejectedValue(fsError('EACCES', 'permission denied'));

    await expect(store.saveChat('s1', { id: 'c1' })).rejects.toThrow(/EACCES/);

    expect(fs.existsSync(path.join(baseDir, 's1'))).toBe(false);
  });

  // 4. Corrupt JSON read
  it(`${STORAGE_FAULT_PROFILES.corruptJson.name}: returns null, does not throw, logs to flight recorder`, async () => {
    await store.saveChat('s1', { id: 'c1', title: 'Valid' });

    vi.spyOn(fsp, 'readFile').mockResolvedValueOnce('{broken json!!!' as never);

    const result = await store.loadChat('s1', 'c1');
    expect(result).toBeNull();

    expect(mockRecorder.record).toHaveBeenCalledWith(
      expect.objectContaining({
        component: 'anonymous-session-store',
        level: 'warn',
        message: expect.stringContaining('read/parse'),
      }),
    );
  });

  // 5. Shared mount unavailable — fallback to temp dir
  it(`${STORAGE_FAULT_PROFILES.sharedMountUnavailable.name}: falls back to OS temp dir, sessions work`, async () => {
    store.stop();

    const realExistsSync = fs.existsSync.bind(fs);
    vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
      if (String(p) === '/mnt/shared') throw new Error('mount not available');
      return realExistsSync(p);
    });

    const origEnv = process.env.ANON_SESSION_DIR;
    delete process.env.ANON_SESSION_DIR;
    const tempBase = path.join(os.tmpdir(), 'aitriad-anon-sessions');

    const fallbackStore = new AnonymousSessionStore({ cleanupIntervalMs: 60_000 });
    try {
      await fallbackStore.saveChat('s1', { id: 'c1', data: 'fallback works' });
      expect(await fallbackStore.loadChat('s1', 'c1')).toEqual({ id: 'c1', data: 'fallback works' });

      expect(mockRecorder.record).toHaveBeenCalledWith(
        expect.objectContaining({
          component: 'anonymous-session-store',
          message: expect.stringContaining('shared mount'),
        }),
      );
    } finally {
      fallbackStore.stop();
      try { fs.rmSync(tempBase, { recursive: true, force: true }); } catch { /* may not exist */ }
      if (origEnv !== undefined) process.env.ANON_SESSION_DIR = origEnv;
      else delete process.env.ANON_SESSION_DIR;
    }
  });

  // 6. LRU eviction failure — new session still created (best-effort)
  it(`${STORAGE_FAULT_PROFILES.evictionFailure.name}: eviction error doesn't block new session`, async () => {
    await store.saveChat('s1', { id: 'c1' });
    await store.saveChat('s2', { id: 'c1' });
    await store.saveChat('s3', { id: 'c1' });

    setAccessTime(baseDir, 's1', 3000);
    setAccessTime(baseDir, 's2', 2000);
    setAccessTime(baseDir, 's3', 1000);

    const realRm = fsp.rm.bind(fsp);
    vi.spyOn(fsp, 'rm')
      .mockImplementationOnce(async () => { throw fsError('EACCES', 'permission denied on eviction'); })
      .mockImplementation(realRm as typeof fsp.rm);

    await expect(store.saveChat('s4', { id: 'c1', data: 'new' })).resolves.toBeUndefined();
    expect(await store.loadChat('s4', 'c1')).toEqual({ id: 'c1', data: 'new' });

    expect(mockRecorder.record).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('evict LRU session'),
      }),
    );
  });

  // 7. No state corruption — failed write leaves no partial file
  it(`${STORAGE_FAULT_PROFILES.noStateCorruption.name}: failed writeFile leaves no partial .json`, async () => {
    await store.saveChat('s1', { id: 'c1', data: 'safe' });

    const realWriteFile = fsp.writeFile.bind(fsp);
    vi.spyOn(fsp, 'writeFile')
      .mockImplementationOnce(async () => { throw fsError('EIO', 'i/o error'); })
      .mockImplementation(realWriteFile as typeof fsp.writeFile);

    await expect(store.saveChat('s1', { id: 'c2', data: 'corrupt' })).rejects.toThrow(/EIO/);

    const chatDir = path.join(baseDir, 's1', 'chats');
    const files = fs.readdirSync(chatDir);
    expect(files).toEqual(['c1.json']);

    expect(await store.loadChat('s1', 'c1')).toEqual({ id: 'c1', data: 'safe' });
  });
});
