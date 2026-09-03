// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node

// t/3181 four-arm proof for the off-thread embedding manager (TL GV condition 2). The failure arms
// use an INJECTED fake worker (no real thread) so queue-shed / crash→respawn / wedge→terminate /
// no-in-thread-fallback are exercised deterministically — vitest's onnxruntime mock does NOT reach a
// real spawned worker_thread, so a fake is the correct CI-portable seam. The real-ONNX same-EP
// bit-exact equivalence test (condition 3) is skip-guarded with a VISIBLE skip when the model/runtime
// is absent (it runs locally to produce the reported finding; wiring it into CI is tracked separately).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const recorded: { level?: string; message?: string; data?: Record<string, unknown> }[] = [];
vi.mock('../flight-recorder/index.js', () => ({
  getGlobalRecorder: () => ({ record: (e: never) => { recorded.push(e); } }),
}));

// Control the core count the pool clamps against (t/3211) without depending on the CI machine's real
// vCPUs — the module reads `availableParallelism()` from node:os. Default high so K=2/3/4 configs in
// the pool tests are NOT clamped unless a test explicitly lowers `osMock.cores`. All other os exports
// pass through untouched (spread the real module).
const osMock = vi.hoisted(() => ({ cores: 8 }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  const patched = { ...actual, availableParallelism: () => osMock.cores };
  return { ...patched, default: patched };
});

import {
  computeEmbeddingsOffThread,
  configureEmbeddingWorkerPool,
  shutdownEmbeddingWorker,
  __setEmbeddingWorkerFactory,
  __resetEmbeddingWorkerForTests,
  __queueDepthForTests,
  __poolSizeForTests,
  type EmbeddingWorkerLike,
} from './offThreadEmbedding.js';
import * as onnx from './onnxEmbedding.js';

// ── Controllable fake worker ──────────────────────────

interface Posted { id: number; texts: string[] }

class FakeWorker implements EmbeddingWorkerLike {
  private handlers: Record<string, ((arg: never) => void)[]> = {};
  posted: Posted[] = [];
  transfers: readonly ArrayBuffer[][] = [];
  terminated = false;
  /** Called on each postMessage — lets a test script the worker's reply behavior. */
  onPost?: (msg: Posted, self: FakeWorker) => void;

  postMessage(value: unknown, transferList?: readonly ArrayBuffer[]): void {
    this.posted.push(value as Posted);
    if (transferList) this.transfers = [...this.transfers, transferList];
    this.onPost?.(value as Posted, this);
  }
  on(event: 'message' | 'error' | 'exit', listener: (arg: never) => void): void {
    (this.handlers[event] ??= []).push(listener);
  }
  terminate(): void { this.terminated = true; }
  emit(event: 'message' | 'error' | 'exit', arg?: unknown): void {
    (this.handlers[event] ?? []).forEach(cb => cb(arg as never));
  }
  lastId(): number { return this.posted[this.posted.length - 1].id; }
}

/** Pack known vectors into the worker's result-message shape (mirrors embeddingWorker.ts). */
function resultFor(id: number, vectors: number[][]) {
  const dim = vectors[0].length;
  const packed = new Float32Array(vectors.length * dim);
  vectors.forEach((v, i) => packed.set(v, i * dim));
  return { type: 'result' as const, id, ok: true as const, buffer: packed.buffer, count: vectors.length, dim };
}

const warns = () => recorded.filter(r => r.level === 'warn');

beforeEach(() => {
  recorded.length = 0;
  osMock.cores = 8; // ample headroom; pool-clamp tests lower this explicitly
  __resetEmbeddingWorkerForTests();
});

afterEach(() => {
  vi.useRealTimers();
  __setEmbeddingWorkerFactory(null);
  shutdownEmbeddingWorker();
});

describe('offThreadEmbedding — arm (a): queue saturation → shed 503 + WARN (requester named)', () => {
  it('sheds past MAX_QUEUE_DEPTH with an ActionableError and a WARN carrying requester + depth', async () => {
    // Worker that never replies → the first task stays in flight, the rest queue up.
    const w = new FakeWorker();
    __setEmbeddingWorkerFactory(() => w);

    // Fill to the bound (1 in-flight + 15 queued = 16). These never settle — swallow their rejections.
    const pending: Promise<unknown>[] = [];
    for (let i = 0; i < 16; i++) pending.push(computeEmbeddingsOffThread(['x'], { requester: `filler-${i}` }).catch(() => {}));
    expect(__queueDepthForTests()).toBe(16);

    // The 17th overflows → shed.
    await expect(computeEmbeddingsOffThread(['x'], { requester: 'overflow-caller' })).rejects.toThrow(/shed|queue full/i);

    const shedWarn = warns().find(warn => /queue full/i.test(warn.message ?? ''));
    expect(shedWarn).toBeDefined();
    expect(shedWarn!.data?.requester).toBe('overflow-caller');
    expect(shedWarn!.data?.queueDepth).toBe(16);
    void pending;
  });
});

describe('offThreadEmbedding — arm (b): crash → reject + respawn with backoff', () => {
  it('rejects the in-flight task on worker error, terminates it, and respawns a fresh worker after backoff', async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    __setEmbeddingWorkerFactory(() => { const w = new FakeWorker(); workers.push(w); return w; });

    const p = computeEmbeddingsOffThread(['x'], { requester: 'crash-caller' });
    const pRejected = expect(p).rejects.toThrow(/worker crash/i); // attach handler before the crash
    expect(workers).toHaveLength(1);

    // Worker crashes mid-task.
    workers[0].emit('error', new Error('boom'));
    await pRejected;
    expect(workers[0].terminated).toBe(true);

    // During the backoff gap, new work is shed (not queued onto a dead worker).
    await expect(computeEmbeddingsOffThread(['y'], { requester: 'gap-caller' })).rejects.toThrow(/respawn/i);
    expect(workers).toHaveLength(1); // no new worker yet — still in the backoff gap

    // Advance past the base backoff (250ms) → gap clears → next task spawns a fresh worker.
    await vi.advanceTimersByTimeAsync(300);
    const p2 = computeEmbeddingsOffThread(['z'], { requester: 'after-gap' }).catch(() => {});
    expect(workers).toHaveLength(2); // respawned
    void p2;
  });
});

describe('offThreadEmbedding — respawn survives a stale event from the superseded worker (identity-guard)', () => {
  it('ignores a late exit/message from the old terminated worker; the fresh worker keeps serving', async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    __setEmbeddingWorkerFactory(() => { const w = new FakeWorker(); workers.push(w); return w; });

    // Task 1 dispatched on worker1, then worker1 crashes → reject + respawn-backoff.
    const p1 = computeEmbeddingsOffThread(['x'], { requester: 'first' });
    const p1Rejected = expect(p1).rejects.toThrow(/worker crash/i);
    workers[0].emit('error', new Error('boom'));
    await p1Rejected;
    const staleId = workers[0].lastId();

    // Clear the backoff gap and dispatch task 2 on a fresh worker2.
    await vi.advanceTimersByTimeAsync(300);
    const p2 = computeEmbeddingsOffThread(['y'], { requester: 'second' });
    expect(workers).toHaveLength(2);
    const liveId = workers[1].lastId();
    const warnsBefore = warns().length;

    // The OLD (terminated) worker fires late events — the identity-guard must DROP them so the
    // healthy new worker is neither torn down nor its in-flight task disturbed.
    workers[0].emit('exit', 137);
    workers[0].emit('message', resultFor(staleId, [[9, 9, 9, 9]]));
    expect(workers[1].terminated).toBe(false);   // new worker untouched
    expect(warns().length).toBe(warnsBefore);    // no crash/wedge WARN from the stale events

    // worker2 completes task 2 normally → resolves cleanly (respawn survived).
    workers[1].emit('message', resultFor(liveId, [[1, 0, 0, 0]]));
    await expect(p2).resolves.toHaveLength(1);
  });
});

describe('offThreadEmbedding — arm (c): wedge (heartbeat stall) → terminate + respawn + WARN', () => {
  it('terminates + respawns + WARNs when no heartbeat arrives within the watchdog window', async () => {
    vi.useFakeTimers();
    const w = new FakeWorker(); // never replies, never heartbeats → wedged
    __setEmbeddingWorkerFactory(() => w);

    const p = computeEmbeddingsOffThread(['x'], { requester: 'wedge-caller' });
    // Attach the rejection handler NOW, before advancing timers — the wedge rejects inside
    // advanceTimersByTimeAsync, so a handler attached afterwards would momentarily read as unhandled.
    const rejected = expect(p).rejects.toThrow(/wedge/i);

    // Not yet timed out.
    await vi.advanceTimersByTimeAsync(7000);
    expect(w.terminated).toBe(false);

    // Cross the 8000ms window → wedge detected.
    await vi.advanceTimersByTimeAsync(1500);
    await rejected;
    expect(w.terminated).toBe(true);

    const wedgeWarn = warns().find(warn => /wedge/i.test(warn.message ?? ''));
    expect(wedgeWarn).toBeDefined();
    expect(wedgeWarn!.data?.requester).toBe('wedge-caller');
    expect(wedgeWarn!.data?.cause).toBe('wedge');
  });

  it('a heartbeat RESETS the watchdog so a healthy-but-slow batch is not false-killed', async () => {
    vi.useFakeTimers();
    const w = new FakeWorker();
    __setEmbeddingWorkerFactory(() => w);

    const p = computeEmbeddingsOffThread(['x'], { requester: 'slow-batch' });
    const id = w.lastId();

    // Heartbeat at 6s (before the 8s window), then advance another 6s (12s total elapsed). Without the
    // reset this would have wedged at 8s; with it, the window restarted at 6s so we're still healthy.
    await vi.advanceTimersByTimeAsync(6000);
    w.emit('message', { type: 'heartbeat', id, chunk: 0 });
    await vi.advanceTimersByTimeAsync(6000);
    expect(w.terminated).toBe(false);

    // Deliver the result → resolves cleanly.
    w.emit('message', resultFor(id, [[1, 0, 0, 0]]));
    await expect(p).resolves.toHaveLength(1);
  });
});

describe('offThreadEmbedding — arm (d): worker failure NEVER computes in-thread (throws instead)', () => {
  it('rejects with an ActionableError naming the no-fallback contract and never calls in-thread compute', async () => {
    const spy = vi.spyOn(onnx, 'computeEmbeddings');
    const w = new FakeWorker();
    // Crash immediately on dispatch.
    w.onPost = (_msg, self) => self.emit('error', new Error('immediate crash'));
    __setEmbeddingWorkerFactory(() => w);

    const p = computeEmbeddingsOffThread(['x'], { requester: 'no-fallback' });
    await expect(p).rejects.toThrow(/no in-thread fallback/i);

    // The load-bearing invariant: on worker failure the manager must NOT run ONNX on the main thread
    // (that silently reintroduces the t/3165 starvation). It structurally never imports the compute
    // for the failure path — assert it was never invoked.
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('offThreadEmbedding — marshaling round-trip preserves vectors exactly (transfer path)', () => {
  it('unpacks the transferred buffer into per-text Float32Array views, bit-identical to what the worker packed', async () => {
    const vectors = [
      [0.1, -0.2, 0.3, 0.4],
      [0.5, 0.6, -0.7, 0.8],
      [-0.9, 1.0, 0.11, -0.12],
    ];
    const w = new FakeWorker();
    w.onPost = (msg, self) => {
      self.emit('message', { type: 'heartbeat', id: msg.id, chunk: 0 });
      self.emit('message', resultFor(msg.id, vectors));
    };
    __setEmbeddingWorkerFactory(() => w);

    const out = await computeEmbeddingsOffThread(['a', 'b', 'c'], { requester: 'marshal-test' });
    expect(out).toHaveLength(3);
    for (let i = 0; i < vectors.length; i++) {
      expect(out[i]).toBeInstanceOf(Float32Array);
      // fp32 round-trip: compare against the fp32-cast expected value (Float32Array quantizes on write).
      expect(Array.from(out[i])).toEqual(Array.from(new Float32Array(vectors[i])));
    }
    // Each output is a 384-analog view sliced from the single packed buffer (contract: one view per text).
    expect(out[0]).toHaveLength(vectors[0].length);
    // The manager's request to the worker carries no transferList — only text strings marshal IN.
    expect(w.transfers.length).toBe(0);
  });
});

// ══ t/3211 K-slot pool ═════════════════════════════════════════════════════════════════════════

describe('offThreadEmbedding — pool: default (unconfigured) is K=1, byte-identical single-worker', () => {
  it('without configure, pool size is 1 and one worker serves a round-trip', async () => {
    // The EXISTING four-arm suite above runs entirely UNCONFIGURED — its green is the default-1 parity
    // proof (TL non-negotiable). This case pins the invariant explicitly: no configure() → K=1.
    expect(__poolSizeForTests()).toBe(1);

    const workers: FakeWorker[] = [];
    __setEmbeddingWorkerFactory(() => { const w = new FakeWorker(); workers.push(w); return w; });

    const a = computeEmbeddingsOffThread(['a'], { requester: 'r1' });
    workers[0].emit('message', resultFor(workers[0].lastId(), [[1, 0, 0, 0]]));
    await expect(a).resolves.toHaveLength(1);
    expect(workers).toHaveLength(1); // exactly one worker ever spawned at K=1
  });
});

describe('offThreadEmbedding — pool: K tasks dispatch in parallel, K+1th queues', () => {
  it('configures K=4 and dispatches up to K workers concurrently; the (K+1)th waits in the shared queue', () => {
    configureEmbeddingWorkerPool(4); // cores=8 → cap 7 → K=4
    expect(__poolSizeForTests()).toBe(4);

    const workers: FakeWorker[] = [];
    __setEmbeddingWorkerFactory(() => { const w = new FakeWorker(); workers.push(w); return w; });

    // 4 tasks that never reply → each lands on its own idle slot, all in flight in parallel.
    const pending: Promise<unknown>[] = [];
    for (let i = 0; i < 4; i++) pending.push(computeEmbeddingsOffThread(['x'], { requester: `p-${i}` }).catch(() => {}));
    expect(workers).toHaveLength(4);              // K workers spawned, one per slot
    expect(__queueDepthForTests()).toBe(4);       // all 4 in flight, none waiting

    // The 5th has no idle slot → it queues (does NOT spawn a 5th worker).
    pending.push(computeEmbeddingsOffThread(['x'], { requester: 'p-5' }).catch(() => {}));
    expect(workers).toHaveLength(4);              // still K — no oversubscription
    expect(__queueDepthForTests()).toBe(5);       // 4 in flight + 1 queued
    void pending;
  });
});

describe('offThreadEmbedding — pool: aggregate shed at MAX_QUEUE_DEPTH × K', () => {
  it('K=2 admits up to 32 resident tasks, sheds the 33rd with the scaled cap in the WARN', async () => {
    configureEmbeddingWorkerPool(2); // cores=8 → K=2; cap = 16 × 2 = 32
    const w = new FakeWorker(); // never replies → tasks stay resident
    __setEmbeddingWorkerFactory(() => w);

    const pending: Promise<unknown>[] = [];
    for (let i = 0; i < 32; i++) pending.push(computeEmbeddingsOffThread(['x'], { requester: `fill-${i}` }).catch(() => {}));
    expect(__queueDepthForTests()).toBe(32);

    await expect(computeEmbeddingsOffThread(['x'], { requester: 'overflow' })).rejects.toThrow(/shed|queue full/i);
    const shedWarn = warns().find(warn => /queue full/i.test(warn.message ?? ''));
    expect(shedWarn).toBeDefined();
    expect(shedWarn!.data?.requester).toBe('overflow');
    expect(shedWarn!.data?.queueDepth).toBe(32);
    expect(shedWarn!.data?.max).toBe(32); // scaled ×K, not the base 16
    void pending;
  });
});

describe('offThreadEmbedding — pool: Condition B backpressure tightens with LIVE slots (dynamic)', () => {
  it('K=2: crashing one slot tightens the cap 32→16 — a depth admitted at 32 now sheds with max:16', () => {
    vi.useFakeTimers(); // crash schedules a respawn timer; fake timers keep the slot cleanly "down"
    configureEmbeddingWorkerPool(2); // K=2 → cap = 16 × 2 = 32 while BOTH slots are live
    const workers: FakeWorker[] = [];
    __setEmbeddingWorkerFactory(() => { const w = new FakeWorker(); workers.push(w); return w; });

    // 17 never-reply tasks: 2 in flight (slot0=worker0, slot1=worker1) + 15 queued → resident depth 17.
    const pending: Promise<unknown>[] = [];
    for (let i = 0; i < 17; i++) pending.push(computeEmbeddingsOffThread(['x'], { requester: `fill-${i}` }).catch(() => {}));
    expect(workers).toHaveLength(2);
    expect(__queueDepthForTests()).toBe(17);
    // All 17 were admitted (none shed) at the full-capacity cap of 32 — the "admissible at 32" half of
    // the discriminator. Under a STATIC single-slot cap of 16 the 17th would already have shed.
    expect(warns().some(warn => /queue full/i.test(warn.message ?? ''))).toBe(false);

    // Crash slot 0 → its in-flight task rejects (depth 17→16) and the slot enters respawn-backoff, so
    // liveSlotCount drops 2→1 and the cap tightens 32→16. Slot 1 stays live (not an all-down shed).
    workers[0].emit('error', new Error('boom'));
    expect(__queueDepthForTests()).toBe(16); // 1 in-flight on slot1 + 15 queued

    // Depth 16 was comfortably admissible at the old cap 32; against the tightened cap 16 it now sheds
    // — and the WARN carries the SCALED-DOWN max (16, not the configured-K 32). This is the dynamic
    // tightening that a static ×K cap would miss (TL GV required assertion, t/3211#8).
    const rejected = expect(computeEmbeddingsOffThread(['x'], { requester: 'tightened' })).rejects.toThrow(/shed|queue full/i);
    const shedWarn = warns().find(warn => /queue full/i.test(warn.message ?? '') && warn.data?.requester === 'tightened');
    expect(shedWarn).toBeDefined();
    expect(shedWarn!.data?.max).toBe(16);        // dynamic: cap followed live slots down from 32 to 16
    expect(shedWarn!.data?.queueDepth).toBe(16);
    return rejected.then(() => { void pending; });
  });
});

describe('offThreadEmbedding — pool: per-slot fault isolation (t/3181 identity-guard, generalized)', () => {
  it('a crash + late-exit on slot 0 never disturbs slot 1; slot 0 respawns independently', async () => {
    vi.useFakeTimers();
    configureEmbeddingWorkerPool(2); // K=2
    const workers: FakeWorker[] = [];
    __setEmbeddingWorkerFactory(() => { const w = new FakeWorker(); workers.push(w); return w; });

    // Dispatch A→slot0(worker0), B→slot1(worker1); both in flight in parallel.
    const pA = computeEmbeddingsOffThread(['a'], { requester: 'slot0-A' });
    const pARejected = expect(pA).rejects.toThrow(/worker crash/i);
    const pB = computeEmbeddingsOffThread(['b'], { requester: 'slot1-B' });
    expect(workers).toHaveLength(2);
    const worker0 = workers[0], worker1 = workers[1];
    const staleId = worker0.lastId();
    const bId = worker1.lastId();

    // Slot 0's worker crashes → A rejects + slot 0 enters respawn-backoff. Slot 1 MUST be untouched.
    worker0.emit('error', new Error('boom'));
    await pARejected;
    expect(worker0.terminated).toBe(true);
    expect(worker1.terminated).toBe(false);   // sibling slot unaffected by slot 0's crash
    const warnsAfterCrash = warns().length;

    // Clear slot 0's backoff and dispatch C → slot 0 respawns a fresh worker2.
    await vi.advanceTimersByTimeAsync(300);
    const pC = computeEmbeddingsOffThread(['c'], { requester: 'slot0-C' });
    expect(workers).toHaveLength(3);          // worker2 for slot 0; slot 1 never respawned
    const worker2 = workers[2];
    const cId = worker2.lastId();

    // The OLD terminated worker0 fires late events — identity-guard (keyed on slot.worker) DROPS them:
    // neither the fresh slot-0 worker nor the healthy slot-1 worker is torn down, no new crash WARN.
    worker0.emit('exit', 137);
    worker0.emit('message', resultFor(staleId, [[9, 9, 9, 9]]));
    expect(worker1.terminated).toBe(false);
    expect(worker2.terminated).toBe(false);
    expect(warns().length).toBe(warnsAfterCrash); // stale events produced no WARN

    // Both live tasks complete normally → resolve cleanly (pool survived the partial failure).
    worker1.emit('message', resultFor(bId, [[1, 0, 0, 0]]));
    worker2.emit('message', resultFor(cId, [[0, 1, 0, 0]]));
    await expect(pB).resolves.toHaveLength(1);
    await expect(pC).resolves.toHaveLength(1);
  });
});

describe('offThreadEmbedding — pool: configure() clamps to cores and WARNs (fallback-logging)', () => {
  it('POOL_SIZE=8 on a 4-core box lands K=3 with a clamp WARN carrying asked-vs-cores', () => {
    osMock.cores = 4; // cap = 4 − 1 = 3
    configureEmbeddingWorkerPool(8);
    expect(__poolSizeForTests()).toBe(3); // min(8, 3)

    const clampWarn = warns().find(warn => /clamped/i.test(warn.message ?? ''));
    expect(clampWarn).toBeDefined();
    expect(clampWarn!.data?.requestedSize).toBe(8);
    expect(clampWarn!.data?.clampedSize).toBe(3);
    expect(clampWarn!.data?.cores).toBe(4);
  });

  it('a size that fits the box is NOT clamped and produces no clamp WARN', () => {
    osMock.cores = 8; // cap 7
    configureEmbeddingWorkerPool(3);
    expect(__poolSizeForTests()).toBe(3);
    expect(warns().find(warn => /clamped/i.test(warn.message ?? ''))).toBeUndefined();
  });
});

describe('offThreadEmbedding — pool: configure() ordering contract (t/3211 TL condition A)', () => {
  it('(b) configure BEFORE any compute → the size is applied', () => {
    configureEmbeddingWorkerPool(3);
    expect(__poolSizeForTests()).toBe(3);
  });

  it('(a) configure AFTER the pool has materialized → no-op + WARN, size stays at the default', async () => {
    // Compute first (no configure) → pool materializes at K=1.
    const w = new FakeWorker();
    w.onPost = (msg, self) => self.emit('message', resultFor(msg.id, [[1, 0, 0, 0]]));
    __setEmbeddingWorkerFactory(() => w);
    await expect(computeEmbeddingsOffThread(['x'], { requester: 'early' })).resolves.toHaveLength(1);
    expect(__poolSizeForTests()).toBe(1);

    // A late configure must NOT resize the live pool.
    configureEmbeddingWorkerPool(4);
    expect(__poolSizeForTests()).toBe(1);
    const lateWarn = warns().find(warn => /already running/i.test(warn.message ?? ''));
    expect(lateWarn).toBeDefined();
    expect(lateWarn!.data?.requestedSize).toBe(4);
  });
});

// ══ t/3275 queued-task age-out (dispatch-time reject) ════════════════════════════════════════════
// QUEUE_AGE_OUT_MS is 40_000 in the module (not exported — same convention as HEARTBEAT_TIMEOUT_MS).
// Tests advance past it and pin the value via the WARN's budgetMs. A slot is kept alive across the
// long wait by heartbeating its in-flight task (each heartbeat resets the 8s watchdog) — that's the
// real shape: slots busy on slow work while a backlog ages behind them.

/** Advance `totalMs` in <8s steps, heartbeating `worker`'s in-flight `id` so its watchdog never fires. */
async function ageWhileServing(worker: FakeWorker, id: number, totalMs: number): Promise<void> {
  for (let elapsed = 0; elapsed < totalMs; elapsed += 5_000) {
    worker.emit('message', { type: 'heartbeat', id, chunk: elapsed / 5_000 });
    await vi.advanceTimersByTimeAsync(5_000);
  }
}

describe('offThreadEmbedding — age-out: reject a task queued past the budget, still serve a fresh one', () => {
  it('drains the stale head-of-queue on dispatch (WARN carries waitedMs≥budgetMs) and dispatches a fresh task', async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    __setEmbeddingWorkerFactory(() => { const w = new FakeWorker(); workers.push(w); return w; });

    // A holds the single slot (in flight, heartbeating); B queues behind it and will age out.
    const pA = computeEmbeddingsOffThread(['A'], { requester: 'A-inflight' });
    const worker = workers[0];
    const aId = worker.lastId();
    const pB = computeEmbeddingsOffThread(['B'], { requester: 'B-stale' });
    const pBRejected = expect(pB).rejects.toThrow(/age-out|queued past/i);
    expect(__queueDepthForTests()).toBe(2); // A in flight + B queued

    // Time passes past the 40s budget while A keeps its slot alive.
    await ageWhileServing(worker, aId, 45_000);

    // A fresh task D is enqueued now (well within budget), then A completes → the freed slot drains B
    // (stale → age-out reject) and dispatches D (fresh → served).
    const pD = computeEmbeddingsOffThread(['D'], { requester: 'D-fresh' }).catch(() => {});
    worker.emit('message', resultFor(aId, [[1, 0, 0, 0]]));
    await pBRejected;
    await expect(pA).resolves.toHaveLength(1);

    const ageWarn = warns().find(warn => /age-out budget/i.test(warn.message ?? ''));
    expect(ageWarn).toBeDefined();
    expect(ageWarn!.data?.requester).toBe('B-stale');
    expect(ageWarn!.data?.budgetMs).toBe(40_000);
    expect(ageWarn!.data?.waitedMs as number).toBeGreaterThanOrEqual(40_000); // payload, not just the message

    // D (fresh) was dispatched onto the freed slot — proof age-out drops only the stale head, not the queue.
    expect(worker.posted[worker.posted.length - 1].texts).toEqual(['D']);
    void pD;
  });

  it('does NOT age-out a task still within budget — it dispatches normally', async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    __setEmbeddingWorkerFactory(() => { const w = new FakeWorker(); workers.push(w); return w; });

    const pA = computeEmbeddingsOffThread(['A'], { requester: 'A' });
    const worker = workers[0];
    const aId = worker.lastId();
    const pB = computeEmbeddingsOffThread(['B'], { requester: 'B-young' });

    await ageWhileServing(worker, aId, 10_000); // only 10s < 40s budget
    worker.emit('message', resultFor(aId, [[1, 0, 0, 0]])); // A done → B dispatched (young, not shed)
    await expect(pA).resolves.toHaveLength(1);

    expect(worker.posted[worker.posted.length - 1].texts).toEqual(['B']); // B was served, not aged out
    const bId = worker.lastId();
    worker.emit('message', resultFor(bId, [[2, 0, 0, 0]]));
    await expect(pB).resolves.toHaveLength(1);
    expect(warns().some(warn => /age-out budget/i.test(warn.message ?? ''))).toBe(false);
  });

  it('drains an ALL-stale queue and leaves the slot idle — nothing dispatched (TL 4th case)', async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    __setEmbeddingWorkerFactory(() => { const w = new FakeWorker(); workers.push(w); return w; });

    // A in flight; B and C both queue behind and both age past the budget.
    const pA = computeEmbeddingsOffThread(['A'], { requester: 'A' });
    const worker = workers[0];
    const aId = worker.lastId();
    const pB = computeEmbeddingsOffThread(['B'], { requester: 'B' });
    const pC = computeEmbeddingsOffThread(['C'], { requester: 'C' });
    const pBRejected = expect(pB).rejects.toThrow(/age-out|queued past/i);
    const pCRejected = expect(pC).rejects.toThrow(/age-out|queued past/i);
    expect(__queueDepthForTests()).toBe(3);

    await ageWhileServing(worker, aId, 45_000);
    const postedBeforeFree = worker.posted.length;

    // A completes → the freed slot pumps: B and C are both stale → both age-out reject, and since no
    // servable task remains the slot stays idle (no dispatch).
    worker.emit('message', resultFor(aId, [[1, 0, 0, 0]]));
    await pBRejected;
    await pCRejected;
    await expect(pA).resolves.toHaveLength(1);

    expect(__queueDepthForTests()).toBe(0);                 // queue fully drained, nothing in flight
    expect(worker.posted.length).toBe(postedBeforeFree);    // slot idle — no new postMessage after A
    expect(warns().filter(warn => /age-out budget/i.test(warn.message ?? '')).length).toBe(2);
  });
});

// ── Equivalence (condition 3): real-ONNX worker intra-op=1 vs in-thread default — skip-guarded ──

function realOnnxAvailable(): boolean {
  try {
    const require = createRequire(import.meta.url);
    require.resolve('onnxruntime-node');
  } catch { return false; }
  const dir = process.env.AI_TRIAD_ONNX_MODEL_DIR;
  return !!(dir && fs.existsSync(`${dir}/model.onnx`));
}

const REAL_ONNX = realOnnxAvailable();
if (!REAL_ONNX) {
  // VISIBLE skip (TL condition, p/342#227): a green CI must never read as "equivalence verified" when
  // it was actually skipped. This vitest case stays skip-guarded for LOCAL use (run with
  // AI_TRIAD_ONNX_MODEL_DIR set + `lib` built). In CI the equivalence is exercised by the
  // `embedding-onnx-equivalence` job (t/3198), which runs lib/embeddings/onnx-equivalence-check.mjs
  // against the BUILT server dist with the fp32 model provisioned — vitest can't spawn the real worker
  // here (no compiled embeddingWorker.js sibling in the source tree). Keep TEXTS/assertion in sync
  // with that harness.
  console.warn('[offThreadEmbedding.test] real-ONNX equivalence test SKIPPED — onnxruntime-node/model absent (local-only path; CI runs it via the embedding-onnx-equivalence job / onnx-equivalence-check.mjs, t/3198)');
}

describe('offThreadEmbedding — real-ONNX same-EP bit-exact equivalence (condition 3, skip-guarded)', () => {
  (REAL_ONNX ? it : it.skip)('worker (intra-op=1) vectors are bit-exact vs in-thread (default) on the same EP', async () => {
    __setEmbeddingWorkerFactory(null); // real worker
    const texts = ['AI policy alignment', 'open-source model release', 'compute governance regime'];
    const [offThread, inThread] = await Promise.all([
      computeEmbeddingsOffThread(texts, { requester: 'equivalence-test' }),
      onnx.computeEmbeddings(texts),
    ]);
    expect(offThread).toHaveLength(inThread.length);
    for (let i = 0; i < inThread.length; i++) {
      // Compare at the fp32 boundary: the worker marshals vectors OUT via a Float32Array transfer
      // buffer (already fp32), while onnx.computeEmbeddings' l2Normalize returns number[] (fp64
      // doubles). A raw fp32-vs-fp64 compare is off by ~fp32 epsilon BY CONSTRUCTION — a comparison
      // artifact, not a divergence — so quantize the in-thread side to fp32 (the precision embeddings
      // are stored/consumed at). Then the contract is genuinely BIT-EXACT (t/3198; CI runs this via
      // lib/embeddings/onnx-equivalence-check.mjs in the embedding-onnx-equivalence job).
      expect(Array.from(offThread[i])).toEqual(Array.from(new Float32Array(inThread[i]))); // fp32, bit-exact
    }
  });
});
