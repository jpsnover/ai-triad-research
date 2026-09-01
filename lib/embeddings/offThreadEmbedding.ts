// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Main-thread manager for the off-thread embedding worker (t/3181, item A).
 *
 * Owns a SINGLE persistent worker (no pool), a bounded FIFO queue, an id↔promise map, a heartbeat
 * watchdog, and respawn-with-backoff. Exposes the shared contract B (ServerAPI) and C (ElectronMain)
 * build against:
 *
 *     computeEmbeddingsOffThread(texts, opts?: { requester?: string }): Promise<Float32Array[]>
 *
 * Cache RESOLVE stays on the caller's main thread — only miss-texts marshal IN (structured-clone of
 * strings), vectors marshal OUT via a TRANSFERRED ArrayBuffer (zero-copy). The worker owns the ONNX
 * session exclusively; this module NEVER computes embeddings in-thread — not even on worker failure.
 * A worker crash/wedge/queue-overflow fails LOUD (ActionableError → the server's t/3078 block-mode
 * 503 load-shed); an in-thread fallback would reintroduce the exact t/3165 starvation it prevents.
 */

import { Worker } from 'node:worker_threads';
import { ActionableError } from '../debate/errors.js';
import { getGlobalRecorder } from '../flight-recorder/index.js';

// ── Tunable constants — Gate Co-Location (each states what it trades off; TL-accepted t/3181#2) ──

/**
 * Watchdog window. ARMED ON DISPATCH (not first heartbeat, TL Q1 refinement — so a hang *before*
 * the first chunk, e.g. a model-load stall, is still caught), RESET on each chunk heartbeat.
 * Must exceed cold model-load (~900ms/spike) + one chunk's compute with margin. Too low →
 * false-kills a healthy large batch mid-load; too high → slow wedge detection. (t/3181 Q2.)
 */
const HEARTBEAT_TIMEOUT_MS = 8000;

/**
 * Max resident tasks (1 in-flight + 15 queued). Enqueue past this → load-shed 503 + WARN. Higher →
 * more memory + longer tail latency under burst; lower → sheds sooner under load. (t/3181 Q2.)
 */
const MAX_QUEUE_DEPTH = 16;

/**
 * Respawn backoff after a worker crash/wedge: doubles per consecutive failure up to the cap, resets
 * on a clean task. Too short → tight crash→respawn spin burning CPU; too long → extended shed gap
 * where every request is rejected. New tasks arriving during the gap are shed. (t/3181 Q2.)
 */
const BACKOFF_BASE_MS = 250;
const BACKOFF_CAP_MS = 5000;

// ── Types ─────────────────────────────────────────────

interface Task {
  id: number;
  texts: string[];
  requester: string;
  resolve: (vectors: Float32Array[]) => void;
  reject: (err: unknown) => void;
}

/**
 * Minimal worker surface the manager depends on. `worker_threads.Worker` satisfies it; tests inject
 * a fake via {@link __setEmbeddingWorkerFactory} to deterministically drive crash/wedge/shed paths
 * without spawning a real thread (the injectable-factory testability pattern, TL-approved).
 */
export interface EmbeddingWorkerLike {
  postMessage(value: unknown, transferList?: readonly ArrayBuffer[]): void;
  on(event: 'message' | 'error' | 'exit', listener: (arg: never) => void): void;
  terminate(): void | Promise<number>;
}
export type EmbeddingWorkerFactory = () => EmbeddingWorkerLike;

type WorkerMessage =
  | { type: 'heartbeat'; id: number; chunk: number }
  | { type: 'result'; id: number; ok: true; buffer: ArrayBuffer; count: number; dim: number }
  | { type: 'result'; id: number; ok: false; error: string };

type DownCause = 'crash' | 'exit' | 'wedge';

// ── State (module-level singleton — one worker, serial dispatch) ──

let _workerFactory: EmbeddingWorkerFactory = defaultWorkerFactory;
let _worker: EmbeddingWorkerLike | null = null;
const _queue: Task[] = [];
let _inFlight: Task | null = null;
let _watchdog: ReturnType<typeof setTimeout> | null = null;
let _lastChunkSeen = -1;
let _nextId = 1;
let _consecutiveFailures = 0;
let _respawnTimer: ReturnType<typeof setTimeout> | null = null;
let _down = false; // true during the respawn-backoff gap → new tasks are shed

function defaultWorkerFactory(): EmbeddingWorkerLike {
  // Node/dev-Electron resolution. Packaged-Electron asar worker-entry resolution is C's exit
  // criterion (t/3184), off A's critical path — A targets Node/server + dev-Electron.
  return new Worker(new URL('./embeddingWorker.js', import.meta.url)) as unknown as EmbeddingWorkerLike;
}

function queueLen(): number {
  return _queue.length + (_inFlight ? 1 : 0);
}

function warn(message: string, data: Record<string, unknown>): void {
  // Fallback-Path Logging: every shed / crash / wedge records WHAT degraded + WHY + WHO (requester).
  getGlobalRecorder()?.record({ type: 'system.error', component: 'offThreadEmbedding', level: 'warn', message, data });
}

/** Terminate a worker, tolerating an already-dead one and voiding the (possibly async) result. */
function safeTerminate(w: EmbeddingWorkerLike | null): void {
  try {
    const r = w?.terminate();
    if (r && typeof (r as Promise<number>).then === 'function') {
      void (r as Promise<number>).catch(() => { /* terminate rejection is not actionable */ });
    }
  } catch { /* already dead */ }
}

// ── Public contract ───────────────────────────────────

/**
 * Compute embeddings off the main thread. Resolves to one 384-dim `Float32Array` per input text
 * (views over a single transferred buffer — do not assume they are independently backed). Rejects
 * with an `ActionableError` when the request is shed (queue full or worker respawning) or the worker
 * crashes/wedges — the server maps that to a 503 load-shed. NEVER falls back to in-thread compute.
 *
 * @param opts.requester short label for the caller (surfaced in the queue-full/shed WARN so a shed
 *   event names who was dropped — fallback-logging rule). Threaded from B/C.
 */
export function computeEmbeddingsOffThread(
  texts: string[],
  opts?: { requester?: string },
): Promise<Float32Array[]> {
  const requester = opts?.requester ?? 'unknown';

  if (texts.length === 0) return Promise.resolve([]); // trivial — no worker round-trip

  // Shed while the worker is down during a respawn-backoff gap (fail loud, no in-thread fallback).
  if (_down) {
    warn('embedding request shed — worker respawning (backoff gap)', { requester, queueDepth: queueLen() });
    return Promise.reject(shedError(requester, 'worker is respawning after a crash/wedge'));
  }

  // Bounded queue: 1 in-flight + (MAX_QUEUE_DEPTH − 1) waiting. Overflow → load-shed 503 + WARN.
  if (queueLen() >= MAX_QUEUE_DEPTH) {
    warn('embedding request shed — queue full', { requester, queueDepth: queueLen(), max: MAX_QUEUE_DEPTH });
    return Promise.reject(shedError(requester, `queue full (max ${MAX_QUEUE_DEPTH})`));
  }

  return new Promise<Float32Array[]>((resolve, reject) => {
    _queue.push({ id: _nextId++, texts, requester, resolve, reject });
    pump();
  });
}

/** Terminate the worker and drop pending work. Call on app shutdown. */
export function shutdownEmbeddingWorker(): void {
  clearWatchdog();
  if (_respawnTimer) { clearTimeout(_respawnTimer); _respawnTimer = null; }
  safeTerminate(_worker);
  _worker = null;
  _inFlight = null;
  _queue.length = 0;
  _down = false;
}

// ── Scheduling ────────────────────────────────────────

function pump(): void {
  if (_inFlight || _queue.length === 0 || _down) return;
  if (!_worker) _worker = spawnWorker();
  const task = _queue.shift()!;
  _inFlight = task;
  _lastChunkSeen = -1;
  armWatchdog(); // ARM ON DISPATCH (TL Q1) — catches a hang before the first heartbeat too
  _worker.postMessage({ id: task.id, texts: task.texts });
}

function spawnWorker(): EmbeddingWorkerLike {
  const w = _workerFactory();
  w.on('message', onWorkerMessage as (arg: never) => void);
  w.on('error', ((err: Error) => onWorkerDown('crash', err instanceof Error ? err.message : String(err))) as (arg: never) => void);
  w.on('exit', ((code: number) => { if (code !== 0) onWorkerDown('exit', `worker exited with code ${code}`); }) as (arg: never) => void);
  return w;
}

function onWorkerMessage(msg: WorkerMessage): void {
  if (msg.type === 'heartbeat') {
    if (_inFlight && msg.id === _inFlight.id) {
      _lastChunkSeen = msg.chunk;
      armWatchdog(); // forward progress → reset the wedge window
    }
    return;
  }

  // result — ignore stale messages from a terminated/superseded worker.
  if (!_inFlight || msg.id !== _inFlight.id) return;
  clearWatchdog();
  const task = _inFlight;
  _inFlight = null;

  if (msg.ok) {
    _consecutiveFailures = 0; // a clean task resets the respawn backoff
    task.resolve(unpack(msg.buffer, msg.count, msg.dim));
  } else {
    // Worker is alive but the compute threw (e.g. model load) — reject this task, keep the worker.
    warn('embedding compute failed in worker', { requester: task.requester, taskId: task.id, error: msg.error });
    task.reject(computeFailedError(task.requester, msg.error));
  }
  pump();
}

function armWatchdog(): void {
  clearWatchdog();
  _watchdog = setTimeout(onWedge, HEARTBEAT_TIMEOUT_MS);
}

function clearWatchdog(): void {
  if (_watchdog) { clearTimeout(_watchdog); _watchdog = null; }
}

function onWedge(): void {
  if (!_inFlight) return; // result already handled — spurious fire
  onWorkerDown('wedge', `no heartbeat within ${HEARTBEAT_TIMEOUT_MS}ms (last chunk seen: ${_lastChunkSeen})`);
}

/**
 * Unified crash / exit / wedge handler: terminate the faulted worker, reject the in-flight task
 * (never recompute in-thread), and respawn with backoff. New tasks during the gap are shed.
 */
function onWorkerDown(cause: DownCause, detail: string): void {
  if (_down) return; // already handling this outage (e.g. terminate() → 'exit' re-entry)
  _down = true;
  clearWatchdog();

  safeTerminate(_worker);
  _worker = null;

  if (_inFlight) {
    const task = _inFlight;
    _inFlight = null;
    warn(`embedding worker ${cause} — terminating + respawning`, {
      requester: task.requester, taskId: task.id, cause, detail, lastChunkSeen: _lastChunkSeen,
    });
    task.reject(workerDownError(task.requester, cause, detail));
  } else {
    warn(`embedding worker ${cause} — terminating + respawning (no task in flight)`, { cause, detail });
  }

  // Respawn after backoff; the worker is lazily re-spawned by the next pump() once the gap clears.
  _consecutiveFailures++;
  const delay = Math.min(BACKOFF_BASE_MS * 2 ** (_consecutiveFailures - 1), BACKOFF_CAP_MS);
  _respawnTimer = setTimeout(() => {
    _respawnTimer = null;
    _down = false;
    pump(); // resume any tasks still queued from before the outage
  }, delay);
}

/** Slice the transferred buffer into N zero-copy 384-wide views (cache RESOLVE stays caller-side). */
function unpack(buffer: ArrayBuffer, count: number, dim: number): Float32Array[] {
  const all = new Float32Array(buffer);
  const out: Float32Array[] = new Array(count);
  for (let i = 0; i < count; i++) out[i] = all.subarray(i * dim, (i + 1) * dim);
  return out;
}

// ── ActionableErrors (all fail-loud → server load-shed; NONE fall back to in-thread) ──

function shedError(requester: string, reason: string): ActionableError {
  return new ActionableError({
    goal: 'Compute embeddings off the main thread without starving the event loop',
    problem: `Embedding request from "${requester}" was shed: ${reason}`,
    location: 'lib/embeddings/offThreadEmbedding.ts:computeEmbeddingsOffThread',
    nextSteps: [
      'Retry after backpressure clears — this maps to the existing t/3078 block-mode 503 load-shed',
      'Intentional load-shedding, not a fault: the worker queue is bounded to protect request handling',
    ],
  });
}

function workerDownError(requester: string, cause: DownCause, detail: string): ActionableError {
  return new ActionableError({
    goal: 'Compute embeddings off the main thread',
    problem: `Embedding request from "${requester}" failed — worker ${cause}: ${detail}`,
    location: 'lib/embeddings/offThreadEmbedding.ts:onWorkerDown',
    nextSteps: [
      'The worker was terminated and is respawning with backoff — retry shortly (server maps to a 503)',
      'By design there is NO in-thread fallback: running ONNX on the main thread on failure would '
        + 'reintroduce the t/3165 event-loop starvation. Fail loud → load-shed is the correct behavior.',
    ],
  });
}

function computeFailedError(requester: string, detail: string): ActionableError {
  return new ActionableError({
    goal: 'Compute embeddings off the main thread',
    problem: `Embedding compute failed in the worker for "${requester}": ${detail}`,
    location: 'lib/embeddings/offThreadEmbedding.ts:onWorkerMessage',
    nextSteps: [
      'Inspect the worker error above (commonly a missing/invalid ONNX model or tokenizer)',
      'The worker stays alive for subsequent tasks; this request load-sheds (no in-thread fallback)',
    ],
  });
}

// ── Test hooks (underscore-prefixed — not part of the consumer contract) ──

/** Inject a fake worker factory for tests; pass `null` to restore the real `worker_threads` factory. */
export function __setEmbeddingWorkerFactory(factory: EmbeddingWorkerFactory | null): void {
  _workerFactory = factory ?? defaultWorkerFactory;
}

/** Reset all manager state between tests (timers, queue, worker, counters). */
export function __resetEmbeddingWorkerForTests(): void {
  clearWatchdog();
  if (_respawnTimer) { clearTimeout(_respawnTimer); _respawnTimer = null; }
  safeTerminate(_worker);
  _worker = null;
  _inFlight = null;
  _queue.length = 0;
  _nextId = 1;
  _consecutiveFailures = 0;
  _lastChunkSeen = -1;
  _down = false;
}

/** Introspection for tests: current queue depth (in-flight + waiting). */
export function __queueDepthForTests(): number {
  return queueLen();
}
