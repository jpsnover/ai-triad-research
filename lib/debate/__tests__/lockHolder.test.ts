// Tests for lockHolder.ts — io.lock-holder FR event emission (t/2544)
// and execFileSync argv injection guard (t/2549).
//
// lockHolder.ts is Node-only (child_process import). These tests must stay
// in their own file so the child_process mock doesn't leak into renderer-safe
// persistence tests (persistenceRetryBudget.test.ts).

import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { setGlobalRecorder, clearGlobalRecorder, type FlightRecorder } from '../../flight-recorder/index.js';
import type { RecordInput } from '../../flight-recorder/types.js';

vi.mock('child_process', () => {
  const execFileSync = vi.fn();
  return { default: { execFileSync }, execFileSync };
});

import { execFileSync } from 'child_process';
import { recordLockHolder } from '../lockHolder.js';

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

afterEach(() => { vi.restoreAllMocks(); mockExecFileSync.mockClear(); clearGlobalRecorder(); });

// ── t/2544: io.lock-holder FR event emission ─────────────

describe('recordLockHolder — io.lock-holder event (t/2544)', () => {
  it('emits io.lock-holder with processName and pid when handle.exe succeeds', () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    mockExecFileSync.mockReturnValue(
      'Defender.exe  pid: 1234  type: File  8C: C:\\data\\debates\\debate-abc.json\n' as unknown as Buffer,
    );

    const captured = installCaptureRecorder();
    recordLockHolder('C:\\data\\debates\\debate-abc.json');

    const lockEvents = captured.filter(e => e.type === 'io.lock-holder');
    expect(lockEvents).toHaveLength(1);
    expect(lockEvents[0].level).toBe('warn');
    expect(lockEvents[0].data).toMatchObject({ processName: 'Defender.exe', pid: 1234 });
    expect(lockEvents[0].data).not.toHaveProperty('unavailable');
    expect(lockEvents[0].message).toMatch(/Defender\.exe.*1234/);

    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });

  it('emits io.lock-holder with unavailable:true when handle.exe is absent', () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    mockExecFileSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT: handle.exe not found'), { code: 'ENOENT' });
    });

    const captured = installCaptureRecorder();
    recordLockHolder('C:\\data\\debates\\debate-abc.json');

    const lockEvents = captured.filter(e => e.type === 'io.lock-holder');
    expect(lockEvents).toHaveLength(1);
    expect(lockEvents[0].data).toMatchObject({ unavailable: true });
    expect(lockEvents[0].message).toMatch(/unavailable/i);

    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });

  it('emits io.lock-holder with unavailable:true when handle.exe output is not parseable', () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    mockExecFileSync.mockReturnValue('No matching handles found.\n' as unknown as Buffer);

    const captured = installCaptureRecorder();
    recordLockHolder('C:\\data\\debates\\debate-abc.json');

    const lockEvents = captured.filter(e => e.type === 'io.lock-holder');
    expect(lockEvents).toHaveLength(1);
    expect(lockEvents[0].data).toMatchObject({ unavailable: true, reason: 'handle.exe output not parseable' });

    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });

  it('emits io.lock-holder with unavailable:true and reason "non-Windows" on non-Windows platforms', () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    const captured = installCaptureRecorder();
    recordLockHolder('/tmp/debate-abc.json');

    const lockEvents = captured.filter(e => e.type === 'io.lock-holder');
    expect(lockEvents).toHaveLength(1);
    expect(lockEvents[0].data).toMatchObject({ unavailable: true, reason: 'non-Windows' });
    // execFileSync must NOT be called on non-Windows
    expect(mockExecFileSync).not.toHaveBeenCalled();

    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });

  it('records filePath in event data', () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    const captured = installCaptureRecorder();
    recordLockHolder('/some/path/debate-abc.json');

    expect(captured[0].data).toMatchObject({ filePath: '/some/path/debate-abc.json' });

    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });

  it('does not throw when no global recorder is installed', () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    // No recorder installed — clearGlobalRecorder() already called in afterEach
    expect(() => recordLockHolder('/tmp/debate-abc.json')).not.toThrow();

    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });
});

// ── t/2549: execFileSync argv injection guard ─────────────
//
// filePath with shell metacharacters must reach execFileSync as a distinct
// argv element, not as part of a shell command string.
// Previously execSync(`handle.exe "${filePath}"`) allowed injection via
// embedded quotes/metacharacters (CodeQL #5530).

describe('recordLockHolder — execFileSync argv injection guard (t/2549)', () => {
  it('passes filePath with shell metacharacters as a single argv element', () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    const maliciousPath = 'C:\\debates\\file-with-"quotes"&meta$chars.json';

    mockExecFileSync.mockReturnValue(
      'SomeProcess.exe  pid: 9999  type: File  A0: ' + maliciousPath + '\n' as unknown as Buffer,
    );

    installCaptureRecorder();
    recordLockHolder(maliciousPath);

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'handle.exe',
      [maliciousPath],
      expect.objectContaining({ timeout: 2000 }),
    );

    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });
});
