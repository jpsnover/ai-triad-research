// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3171 (G8a) — the inline grounding write-hook's DEBOUNCE + single-child + error-isolation core.
// Deterministic unit tests (fake timers + an injected runner), so no python/data-repo is spawned:
//   1. FIRES:        one enqueue → after the quiet window, ONE scoped run for that id.
//   2. UNCHANGED:    enqueue([]) (an unchanged PUT diffs to nothing) → no run, no timers armed.
//   3. COALESCE:     a burst of enqueues → ONE run carrying the UNION dirty-set (not N runs).
//   4. FRESHNESS:    a sustained stream that never goes quiet still flushes within MAX_WAIT.
//   5. ISOLATION:    runner rejects → never throws, FR WARN emitted, state resets (the #1737 lesson).
//   6. SINGLE-CHILD: an enqueue while a child runs does NOT spawn a 2nd; it flushes after completion.
//
// The reconciler's own re-resolution correctness (hash-gate no-op, refs refresh, purge) is covered by
// reconcile_grounding.py's selftest (CL, GREEN) — these tests assert the HOOK's invocation contract.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { recordSpy, mockExecFile } = vi.hoisted(() => ({
  recordSpy: vi.fn(),
  // node-style execFile(file, args, opts, cb) — cb(err, stdout, stderr). Default: success stats.
  mockExecFile: vi.fn((_file: string, _args: string[], _opts: unknown, cb: (e: Error | null, o: string, s: string) => void) =>
    cb(null, '{"changed":1,"skipped":0,"removed":0}\nAPPLIED (scoped): 1 POV file(s), 0 dict file(s)', '')),
}));
vi.mock('child_process', () => ({ execFile: mockExecFile }));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: () => ({ record: recordSpy }) }));
vi.mock('../logger.js', () => ({
  log: { server: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, api: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } },
}));

import {
  enqueueGroundingReconcile,
  __setReconcilerRunnerForTest,
  __resetGroundingHookForTest,
  __stateForTest,
  parseStats,
  sanitizeNodeIds,
  DEBOUNCE_QUIET_MS,
  DEBOUNCE_MAX_WAIT_MS,
  type ReconcilerStats,
} from '../groundingReconcileHook.js';

const okStats = (n = 1): ReconcilerStats => ({ changed: n, skipped: 0, removed: 0 });
const warnRecords = () => recordSpy.mock.calls.map(c => c[0] as { level?: string; message?: string; data?: Record<string, unknown> })
  .filter(r => r?.level === 'warn' && /grounding_reconcile_inline/.test(r.message ?? ''));

describe('groundingReconcileHook (t/3171 G8a)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    recordSpy.mockReset();
    __resetGroundingHookForTest();
  });
  afterEach(() => {
    __setReconcilerRunnerForTest(null);
    __resetGroundingHookForTest();
    vi.useRealTimers();
  });

  it('FIRES: one enqueue flushes after the quiet window as a single scoped run', async () => {
    const runner = vi.fn(async () => okStats());
    __setReconcilerRunnerForTest(runner);

    enqueueGroundingReconcile(['acc-beliefs-003']);
    expect(runner).not.toHaveBeenCalled();              // debounced, not immediate

    await vi.advanceTimersByTimeAsync(DEBOUNCE_QUIET_MS + 10);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith(['acc-beliefs-003']);
    const info = recordSpy.mock.calls.map(c => c[0] as { message?: string; data?: Record<string, unknown> })
      .find(r => /grounding_reconcile_inline: reconciled/.test(r.message ?? ''));
    expect(info?.data).toMatchObject({ node_ids: ['acc-beliefs-003'], changed: 1 });
  });

  it('UNCHANGED: an empty/blank dirty-set is a no-op — no run, no timers', async () => {
    const runner = vi.fn(async () => okStats());
    __setReconcilerRunnerForTest(runner);

    enqueueGroundingReconcile([]);        // unchanged PUT → diffNodes returns nothing
    enqueueGroundingReconcile(['', '']);  // blank ids ignored
    expect(__stateForTest()).toMatchObject({ dirtySize: 0, quietArmed: false, maxArmed: false });

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MAX_WAIT_MS + 10);
    expect(runner).not.toHaveBeenCalled();
  });

  it('COALESCE: a burst within the quiet window becomes ONE run carrying the union set', async () => {
    const runner = vi.fn(async (ids: string[]) => okStats(ids.length));
    __setReconcilerRunnerForTest(runner);

    enqueueGroundingReconcile(['a']);
    await vi.advanceTimersByTimeAsync(1000);          // < QUIET → resets the quiet timer
    enqueueGroundingReconcile(['b', 'c']);
    await vi.advanceTimersByTimeAsync(1000);
    enqueueGroundingReconcile(['a']);                 // duplicate collapses in the Set
    await vi.advanceTimersByTimeAsync(DEBOUNCE_QUIET_MS + 10);

    expect(runner).toHaveBeenCalledTimes(1);
    expect(new Set(runner.mock.calls[0][0])).toEqual(new Set(['a', 'b', 'c']));
  });

  it('FRESHNESS: a stream that never goes quiet still flushes within MAX_WAIT', async () => {
    const runner = vi.fn(async (ids: string[]) => okStats(ids.length));
    __setReconcilerRunnerForTest(runner);

    // enqueue every 2s (< QUIET=3s) so the quiet timer never elapses; MAX=15s must force the flush.
    for (let t = 0; t <= 14_000; t += 2000) {
      enqueueGroundingReconcile([`x${t}`]);
      await vi.advanceTimersByTimeAsync(2000);
    }
    expect(runner).toHaveBeenCalledTimes(1);          // forced by MAX_WAIT despite never going quiet
    expect(runner.mock.calls[0][0].length).toBeGreaterThanOrEqual(7);
  });

  it('ISOLATION: a runner failure never throws, emits a WARN, and resets state', async () => {
    const runner = vi.fn(async () => { throw new Error('reconciler boom'); });
    __setReconcilerRunnerForTest(runner);

    expect(() => enqueueGroundingReconcile(['a'])).not.toThrow();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_QUIET_MS + 10); // flush must swallow the rejection

    expect(runner).toHaveBeenCalledTimes(1);
    expect(warnRecords()).toHaveLength(1);
    expect(warnRecords()[0].data).toMatchObject({ node_ids: ['a'] });
    expect(__stateForTest().running).toBe(false);            // reset for the next window
  });

  it('SINGLE-CHILD: an enqueue while a child runs does not spawn a 2nd; pending ids flush after', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const runner = vi.fn(async (ids: string[]) => { await gate; return okStats(ids.length); });
    __setReconcilerRunnerForTest(runner);

    enqueueGroundingReconcile(['a']);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_QUIET_MS + 10); // first flush starts; child awaits the gate
    expect(runner).toHaveBeenCalledTimes(1);
    expect(__stateForTest().running).toBe(true);

    enqueueGroundingReconcile(['b']);                          // arrives mid-run
    await vi.advanceTimersByTimeAsync(DEBOUNCE_QUIET_MS + 10); // quiet fires, but running → no 2nd child
    expect(runner).toHaveBeenCalledTimes(1);

    release();                                                 // child completes → finally re-schedules 'b'
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_QUIET_MS + 10);
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls[1][0]).toEqual(['b']);
  });

  it('defaultRunner spawns execFile with the scoped --nodes/--apply args (child_process mock)', async () => {
    __setReconcilerRunnerForTest(null); // use the REAL defaultRunner (execFile) path
    mockExecFile.mockClear();

    enqueueGroundingReconcile(['acc-beliefs-003', 'pol-004']);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_QUIET_MS + 10);

    expect(mockExecFile).toHaveBeenCalledTimes(1);
    const [file, args, opts] = mockExecFile.mock.calls[0];
    expect(String(file)).toMatch(/python3?$/);                         // hardcoded PYTHON, not user-supplied
    expect(args[0]).toMatch(/reconcile_grounding\.py$/);
    expect(args.slice(1)).toEqual(['--nodes', 'acc-beliefs-003,pol-004', '--apply']);
    expect(opts).toMatchObject({ timeout: expect.any(Number), maxBuffer: expect.any(Number) });
  });

  it('sanitizeNodeIds drops anything outside the node-id charset before the subprocess', () => {
    const dirty = ['acc-beliefs-003', 'pol-004', 'term:acceleration', 'sei:x.y', 'x,y', 'a b', 'a;rm -rf', 'a\nb', '$(whoami)', ''];
    expect(sanitizeNodeIds(dirty)).toEqual(['acc-beliefs-003', 'pol-004', 'term:acceleration', 'sei:x.y']);
  });

  it('parseStats extracts the reconciler leading JSON, nulls on a miss (never throws)', () => {
    const stdout = '{\n  "changed": 3,\n  "skipped": 1,\n  "removed": 0\n}\nscoped nodes: 4  touched POVs: [\'accelerationist\']\nAPPLIED (scoped): 1 POV file(s), 2 dict file(s)';
    expect(parseStats(stdout)).toEqual({ changed: 3, skipped: 1, removed: 0 });
    expect(parseStats('no json here')).toEqual({ changed: null, skipped: null, removed: null });
  });
});
