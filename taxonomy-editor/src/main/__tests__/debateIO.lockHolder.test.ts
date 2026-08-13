// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Integration test: verifies that the debateIO save path wired in t/2556 emits
// io.lock-holder when EPERM exhausts the rename retry budget.
//
// debateIO.ts cannot be imported directly (it transitively pulls in Electron via
// fileIO.ts). Instead, this test mirrors the exact call site added by t/2556:
//   atomicWriteSync(filePath, json + '\n', recordLockHolder)
// and proves both arms of the lock-holder integration:
//   arm 1 — io.lock-holder fires when handle.exe identifies the lock holder
//   arm 2 — io.lock-holder fires (unavailable:true) when handle.exe is absent
//
// child_process is mocked at the lockHolder boundary — no real handle.exe call.
// Atomics.wait is stubbed so the 7-attempt retry budget exhausts instantly.

import { describe, it, expect, vi, afterEach, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  setGlobalRecorder,
  clearGlobalRecorder,
  type FlightRecorder,
} from '../../../../lib/flight-recorder/index.js';
import type { RecordInput } from '../../../../lib/flight-recorder/types.js';

// Mock child_process before importing lockHolder so execFileSync is stubbed
vi.mock('child_process', () => {
  const execFileSync = vi.fn();
  return { default: { execFileSync }, execFileSync };
});

import { execFileSync } from 'child_process';
import { atomicWriteSync } from '../../../../lib/debate/persistence.js';
import { recordLockHolder } from '../../../../lib/debate/lockHolder.js';

const mockExecFileSync = vi.mocked(execFileSync);

beforeAll(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('[test] network blocked')));
});
afterAll(() => { vi.unstubAllGlobals(); });

function installCaptureRecorder(): RecordInput[] {
  const captured: RecordInput[] = [];
  const fake = { record: (e: RecordInput) => { captured.push(e); } } as unknown as FlightRecorder;
  setGlobalRecorder(fake);
  return captured;
}

let dir = '';
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'debate-lockHolder-')); });
afterEach(() => {
  vi.restoreAllMocks();
  mockExecFileSync.mockClear();
  clearGlobalRecorder();
  fs.rmSync(dir, { recursive: true, force: true });
});

const epermErr = (): NodeJS.ErrnoException =>
  Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });

describe('debateIO save path — io.lock-holder on EPERM exhaustion (t/2556)', () => {
  it('emits io.lock-holder with processName/pid when handle.exe identifies the lock holder', () => {
    // Stub Atomics.wait — 7-attempt retry budget exhausts without sleeping
    vi.spyOn(Atomics, 'wait').mockReturnValue('ok' as ReturnType<typeof Atomics.wait>);
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw epermErr(); });

    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    mockExecFileSync.mockImplementation(() =>
      'MsMpEng.exe  pid: 4812  type: File  A4: debate-abc.json\n');

    const filePath = path.join(dir, 'debate-abc.json');
    const captured = installCaptureRecorder();

    // Mirrors debateIO.ts after t/2556: atomicWriteSync(filePath, json + '\n', recordLockHolder)
    expect(() => atomicWriteSync(filePath, '{"id":"abc"}\n', recordLockHolder)).toThrow();

    // Both the primary rename and the .tmp2 fallback pass onLockExhausted, so
    // budget-exhausted EPERM fires io.lock-holder once per renameSyncWithRetry call.
    const lockEvents = captured.filter(e => e.type === 'io.lock-holder');
    expect(lockEvents.length).toBeGreaterThanOrEqual(1);
    expect(lockEvents[0].level).toBe('warn');
    expect(lockEvents[0].data).toMatchObject({ processName: 'MsMpEng.exe', pid: 4812 });
    expect(lockEvents[0].data).not.toHaveProperty('unavailable');

    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });

  it('emits io.lock-holder with unavailable:true when handle.exe is absent', () => {
    vi.spyOn(Atomics, 'wait').mockReturnValue('ok' as ReturnType<typeof Atomics.wait>);
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw epermErr(); });

    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    mockExecFileSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT: handle.exe not found'), { code: 'ENOENT' });
    });

    const filePath = path.join(dir, 'debate-xyz.json');
    const captured = installCaptureRecorder();

    expect(() => atomicWriteSync(filePath, '{"id":"xyz"}\n', recordLockHolder)).toThrow();

    const lockEvents = captured.filter(e => e.type === 'io.lock-holder');
    expect(lockEvents.length).toBeGreaterThanOrEqual(1);
    expect(lockEvents[0].data).toMatchObject({ unavailable: true });

    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });

  it('does not emit io.lock-holder when the rename succeeds (no EPERM)', () => {
    const filePath = path.join(dir, 'debate-ok.json');
    const captured = installCaptureRecorder();

    // No renameSync stub — real write should succeed
    atomicWriteSync(filePath, '{"id":"ok"}\n', recordLockHolder);

    expect(captured.filter(e => e.type === 'io.lock-holder')).toHaveLength(0);
    expect(fs.existsSync(filePath)).toBe(true);
  });
});
