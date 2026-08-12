// Fault injection tests for atomicWriteSync retry budget scaling (t/2546)
// and io.lock-holder FR event on exhaustion (t/2544).
//
// Uses vi.mock('child_process') to intercept execSync calls in queryLockHolder.

import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { makeStorageError } from './faultInjection.js';
import { setGlobalRecorder, clearGlobalRecorder, type FlightRecorder } from '../../flight-recorder/index.js';
import type { RecordInput } from '../../flight-recorder/types.js';

vi.mock('child_process', () => {
  const execSync = vi.fn();
  return { default: { execSync }, execSync };
});

import { execSync } from 'child_process';
import { atomicWriteSync, renameSyncWithRetry } from '../persistence.js';

const mockExecSync = vi.mocked(execSync);

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

afterEach(() => { vi.restoreAllMocks(); mockExecSync.mockClear(); clearGlobalRecorder(); });

// ── t/2546: wall-clock budget scales with payload size ───

describe('renameSyncWithRetry — wall-clock budget (t/2546)', () => {
  it('wall-clock budget: continues past 7-attempt limit while deadline not reached', () => {
    // Atomics.wait mocked → no real sleep, Date.now frozen → deadline never expires
    vi.spyOn(Atomics, 'wait').mockReturnValue('ok');
    vi.spyOn(Date, 'now').mockReturnValue(0); // deadline = 30000, 0 < 30000 always true

    let callCount = 0;
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      callCount++;
      if (callCount <= 15) throw makeStorageError('EPERM', 'operation not permitted');
      // 16th call succeeds (void return from mock = success)
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

  it('wall-clock deadline exceeded: single attempt then throws (budget=0ms)', () => {
    vi.spyOn(Atomics, 'wait').mockReturnValue('ok');
    // deadline = Date.now()(call 1=0) + 30000 = 30000
    // budget check = Date.now()(call 2=31000) < 30000 → false immediately
    let nowCall = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => { nowCall++; return nowCall === 1 ? 0 : 31_000; });

    const captured = installCaptureRecorder();
    let callCount = 0;
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      callCount++;
      throw makeStorageError('EPERM', 'operation not permitted');
    });

    expect(() => renameSyncWithRetry('a.tmp', 'a.json', 7, 30_000)).toThrow('EPERM');
    // Budget exhausted after 1 attempt (first Date.now check sees 31000 > 30000)
    expect(callCount).toBe(1);
    // io.lock-holder emitted on budget exhaustion
    expect(captured.some(e => e.type === 'io.lock-holder')).toBe(true);
  });

  it('atomicWriteSync large payload (>200KB): scales to wall-clock budget end-to-end', () => {
    vi.spyOn(Atomics, 'wait').mockReturnValue('ok');
    // Date.now always returns 0 → 0 < 30000 always true → wall-clock never expires
    vi.spyOn(Date, 'now').mockReturnValue(0);

    const target = tmpPath('large-e2e.json');
    const content = 'x'.repeat(210 * 1024); // 210KB > 200KB threshold

    let callCount = 0;
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      callCount++;
      if (callCount <= 10) throw makeStorageError('EPERM', 'operation not permitted');
      // Succeed on call 11 (void = success)
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

    // Small file → fixed budget → eventually throws ActionableError (both rename paths exhausted)
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

// ── t/2544: io.lock-holder FR event on exhaustion ────────

describe('renameSyncWithRetry — io.lock-holder event (t/2544)', () => {
  it('emits io.lock-holder with processName and pid when handle.exe succeeds', () => {
    // Simulate Windows platform for queryLockHolder
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    mockExecSync.mockReturnValue(
      'Defender.exe  pid: 1234  type: File  8C: C:\\data\\debates\\debate-abc.json\n' as unknown as Buffer,
    );

    const captured = installCaptureRecorder();
    vi.spyOn(Atomics, 'wait').mockReturnValue('ok');
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw makeStorageError('EPERM', 'operation not permitted');
    });

    // maxRetries=0 → i=0, withinBudget=0<0=false → budget exhausted immediately
    expect(() => renameSyncWithRetry('a.tmp', 'a.json', 0)).toThrow('EPERM');

    const lockEvents = captured.filter(e => e.type === 'io.lock-holder');
    expect(lockEvents).toHaveLength(1);
    expect(lockEvents[0].data).toMatchObject({ processName: 'Defender.exe', pid: 1234 });
    expect(lockEvents[0].data).not.toHaveProperty('unavailable');

    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });

  it('emits io.lock-holder with unavailable:true when handle.exe absent', () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    mockExecSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT: handle.exe not found'), { code: 'ENOENT' });
    });

    const captured = installCaptureRecorder();
    vi.spyOn(Atomics, 'wait').mockReturnValue('ok');
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw makeStorageError('EPERM', 'operation not permitted');
    });

    expect(() => renameSyncWithRetry('a.tmp', 'a.json', 0)).toThrow('EPERM');

    const lockEvents = captured.filter(e => e.type === 'io.lock-holder');
    expect(lockEvents).toHaveLength(1);
    expect(lockEvents[0].data).toMatchObject({ unavailable: true });

    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });

  it('emits io.lock-holder with unavailable:true on non-Windows', () => {
    const origPlatform = process.platform;
    // Ensure non-Windows platform
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    const captured = installCaptureRecorder();
    vi.spyOn(Atomics, 'wait').mockReturnValue('ok');
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw makeStorageError('EPERM', 'operation not permitted');
    });

    expect(() => renameSyncWithRetry('a.tmp', 'a.json', 0)).toThrow('EPERM');

    const lockEvents = captured.filter(e => e.type === 'io.lock-holder');
    expect(lockEvents).toHaveLength(1);
    expect(lockEvents[0].data).toMatchObject({ unavailable: true, reason: 'non-Windows' });
    // execSync never called on non-Windows
    expect(mockExecSync).not.toHaveBeenCalled();

    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });

  it('does NOT emit io.lock-holder on non-transient errors (EXDEV)', () => {
    const captured = installCaptureRecorder();
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw makeStorageError('EXDEV', 'cross-device link not permitted');
    });

    expect(() => renameSyncWithRetry('a.tmp', 'a.json', 0)).toThrow('EXDEV');
    expect(captured.some(e => e.type === 'io.lock-holder')).toBe(false);
  });
});
