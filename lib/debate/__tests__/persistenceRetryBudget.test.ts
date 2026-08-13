// Fault injection tests for atomicWriteSync retry budget scaling (t/2546)
// and onLockExhausted callback contract (t/2544).
//
// child_process is no longer imported by persistence.ts (t/2550 hot-fix);
// the lock-holder diagnostic is in lockHolder.ts and tested in lockHolder.test.ts.

import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { makeStorageError } from './faultInjection.js';
import { setGlobalRecorder, clearGlobalRecorder, type FlightRecorder } from '../../flight-recorder/index.js';
import type { RecordInput } from '../../flight-recorder/types.js';

import { atomicWriteSync, renameSyncWithRetry } from '../persistence.js';

// ── Hermetic isolation ────────────────────────────────────
beforeAll(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('[test] network blocked')));
});
afterAll(() => { vi.unstubAllGlobals(); });

// ── Helpers ───────────────────────────────────────────────

function tmpPath(suffix: string): string {
  return path.join(os.tmpdir(), `retry-budget-${Date.now()}-${suffix}`);
}

function cleanup(...paths: string[]): void {
  for (const p of paths) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
    try { fs.unlinkSync(`${p}.tmp`); } catch { /* ignore */ }
    try { fs.unlinkSync(`${p}.tmp2`); } catch { /* ignore */ }
  }
}

function installCaptureRecorder(): RecordInput[] {
  const captured: RecordInput[] = [];
  const fake = { record: (e: RecordInput) => { captured.push(e); } } as unknown as FlightRecorder;
  setGlobalRecorder(fake);
  return captured;
}

afterEach(() => { vi.restoreAllMocks(); clearGlobalRecorder(); });

// ── t/2546: wall-clock budget scales with payload size ───

describe('renameSyncWithRetry — wall-clock budget (t/2546)', () => {
  it('wall-clock budget: continues past 7-attempt limit while deadline not reached', () => {
    vi.spyOn(Atomics, 'wait').mockReturnValue('ok');
    vi.spyOn(Date, 'now').mockReturnValue(0); // deadline = 30000, 0 < 30000 always true

    let callCount = 0;
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      callCount++;
      if (callCount <= 15) throw makeStorageError('EPERM', 'operation not permitted');
    });

    expect(() => renameSyncWithRetry('a.tmp', 'a.json', 7, 30_000)).not.toThrow();
    // 15 failures then 1 success — well past the 8-attempt fixed-budget limit
    expect(callCount).toBe(16);
  });

  it('fixed budget (no wall-clock): fails after 8 attempts regardless of lock duration', () => {
    vi.spyOn(Atomics, 'wait').mockReturnValue('ok');

    let callCount = 0;
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      callCount++;
      throw makeStorageError('EPERM', 'operation not permitted');
    });

    expect(() => renameSyncWithRetry('a.tmp', 'a.json', 7)).toThrow('EPERM');
    // i=0..7: retries when i<7, throws on i=7 → 8 total attempts
    expect(callCount).toBe(8);
  });

  it('wall-clock deadline exceeded: single attempt then invokes onLockExhausted callback', () => {
    vi.spyOn(Atomics, 'wait').mockReturnValue('ok');
    let nowCall = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => { nowCall++; return nowCall === 1 ? 0 : 31_000; });

    let callCount = 0;
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      callCount++;
      throw makeStorageError('EPERM', 'operation not permitted');
    });

    const onLockExhausted = vi.fn();
    expect(() => renameSyncWithRetry('a.tmp', 'a.json', 7, 30_000, onLockExhausted)).toThrow('EPERM');
    expect(callCount).toBe(1);
    // callback fired with the target path
    expect(onLockExhausted).toHaveBeenCalledOnce();
    expect(onLockExhausted).toHaveBeenCalledWith('a.json');
  });

  it('atomicWriteSync large payload (>200KB): scales to wall-clock budget end-to-end', () => {
    vi.spyOn(Atomics, 'wait').mockReturnValue('ok');
    vi.spyOn(Date, 'now').mockReturnValue(0);

    const target = tmpPath('large-e2e.json');
    const content = 'x'.repeat(210 * 1024); // 210KB > 200KB threshold

    let callCount = 0;
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      callCount++;
      if (callCount <= 10) throw makeStorageError('EPERM', 'operation not permitted');
    });

    expect(() => atomicWriteSync(target, content)).not.toThrow();
    // More than 8 calls confirms wall-clock path (fixed budget would fail at 8)
    expect(callCount).toBeGreaterThan(8);
    cleanup(target);
  });

  it('atomicWriteSync small payload (≤200KB): uses fixed 7-retry budget', () => {
    vi.spyOn(Atomics, 'wait').mockReturnValue('ok');

    const target = tmpPath('small-e2e.json');
    let caught: unknown;

    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw makeStorageError('EPERM', 'operation not permitted');
    });

    try { atomicWriteSync(target, '{"small":true}'); } catch (e) { caught = e; }

    expect(caught).toBeDefined();
    cleanup(target);
  });

  it('io.retry FR events emitted with attempt count on large-payload retry', () => {
    vi.spyOn(Atomics, 'wait').mockReturnValue('ok');
    vi.spyOn(Date, 'now').mockReturnValue(0);

    const captured = installCaptureRecorder();
    let callCount = 0;
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      callCount++;
      if (callCount <= 3) throw makeStorageError('EPERM', 'operation not permitted');
    });

    expect(() => renameSyncWithRetry('a.tmp', 'a.json', 7, 30_000)).not.toThrow();
    const retries = captured.filter(e => e.type === 'io.retry');
    expect(retries).toHaveLength(3);
    expect(retries[0].data).toMatchObject({ attempt: 1, code: 'EPERM' });
    expect(retries[2].data).toMatchObject({ attempt: 3, code: 'EPERM' });
  });
});

// ── t/2544: onLockExhausted callback contract ────────────
//
// queryLockHolder and the io.lock-holder FR event are in lockHolder.ts;
// tested in lockHolder.test.ts. Here we verify persistence.ts's callback contract:
// the callback is invoked on transient-EPERM budget exhaustion, not on success
// or non-transient errors.

describe('renameSyncWithRetry — onLockExhausted callback (t/2544)', () => {
  it('invokes onLockExhausted with target path on EPERM budget exhaustion', () => {
    vi.spyOn(Atomics, 'wait').mockReturnValue('ok');
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw makeStorageError('EPERM', 'operation not permitted');
    });

    const onLockExhausted = vi.fn();
    expect(() => renameSyncWithRetry('a.tmp', 'a.json', 0, undefined, onLockExhausted)).toThrow('EPERM');
    expect(onLockExhausted).toHaveBeenCalledOnce();
    expect(onLockExhausted).toHaveBeenCalledWith('a.json');
  });

  it('invokes onLockExhausted on EACCES budget exhaustion', () => {
    vi.spyOn(Atomics, 'wait').mockReturnValue('ok');
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw makeStorageError('EACCES', 'permission denied');
    });

    const onLockExhausted = vi.fn();
    expect(() => renameSyncWithRetry('a.tmp', 'a.json', 0, undefined, onLockExhausted)).toThrow('EACCES');
    expect(onLockExhausted).toHaveBeenCalledOnce();
  });

  it('does NOT invoke onLockExhausted on non-transient errors (EXDEV)', () => {
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw makeStorageError('EXDEV', 'cross-device link not permitted');
    });

    const onLockExhausted = vi.fn();
    expect(() => renameSyncWithRetry('a.tmp', 'a.json', 0, undefined, onLockExhausted)).toThrow('EXDEV');
    expect(onLockExhausted).not.toHaveBeenCalled();
  });

  it('does NOT invoke onLockExhausted on success', () => {
    vi.spyOn(fs, 'renameSync').mockReturnValue(undefined);

    const onLockExhausted = vi.fn();
    expect(() => renameSyncWithRetry('a.tmp', 'a.json', 0, undefined, onLockExhausted)).not.toThrow();
    expect(onLockExhausted).not.toHaveBeenCalled();
  });

  it('atomicWriteSync threads onLockExhausted callback to renameSyncWithRetry', () => {
    vi.spyOn(Atomics, 'wait').mockReturnValue('ok');
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw makeStorageError('EPERM', 'operation not permitted');
    });

    const target = tmpPath('callback-thread.json');
    const onLockExhausted = vi.fn();

    let caught: unknown;
    try { atomicWriteSync(target, '{"x":1}', onLockExhausted); } catch (e) { caught = e; }

    expect(caught).toBeDefined();
    // Callback fired at least once (primary rename + .tmp2 fallback may both exhaust)
    expect(onLockExhausted).toHaveBeenCalled();
    cleanup(target);
  });
});
