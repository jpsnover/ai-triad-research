// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * G8a inline grounding write-hook (t/3171, design: t/3171#2).
 *
 * After a PUT /api/taxonomy/:pov write succeeds, the route enqueues the changed node ids here. This
 * module DEBOUNCES rapid PUTs into a single scoped reconciler run and shells out to CL's reconciler
 * (`reconcile_grounding.py --nodes <ids> --apply`, #1736) — the same `execFile(PYTHON, …)` pattern
 * the server already uses for embeddings/NLI. It is FIRE-AND-FORGET: the route responds 200 before
 * calling in, and a reconciler failure is caught + logged and NEVER propagated (a failed grounding
 * refresh must not fail the taxonomy write — the #1737 masked-error lesson).
 *
 * CONCURRENCY (per the G8 ruling, t/3163#1):
 *  - Debounce: coalesce a burst of PUTs into ONE run carrying the accumulated dirty-set, because the
 *    reconciler pays a fixed dict+embeddings load per invocation regardless of dirty-set size.
 *  - Cross-process serialization is owned by the reconciler's internal `grounding_lock` (t/3194) —
 *    this hook does NOT need its own cross-process mutex. As belt-and-suspenders it runs at most ONE
 *    child at a time in-process (the `running` guard) so overlapping PUT bursts don't spawn children
 *    that all just block on the tool-lock (process churn).
 *
 * ENABLE SEQUENCING: the route gates the call on the `grounding_reconcile_inline` feature flag
 * (default OFF). It must stay OFF until the reconciler tool-lock (t/3194, landed) AND the PS cmdlet
 * lock-honoring (t/3203) are both confirmed — otherwise a concurrent unlocked writer can lost-update
 * the shared file. This module is inert until the route calls it, so flag-OFF = zero behavior.
 */

import { execFile } from 'child_process';
import { RECONCILE_SCRIPT } from './config.js';
import { getGlobalRecorder } from '../../../lib/flight-recorder/index.js';
import { ActionableError } from '../../../lib/debate/errors.js';
import { log } from './logger.js';

// Mirrors aiBackends.ts:63 — the reconciler is a python3 script (win32 dev uses `python`).
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';

// ── Tunable constants (co-located; TL spec t/3171#2) ──────────────────────────
/** Quiet window: flush this long after the LAST enqueue, so a burst of PUTs coalesces into one run. */
export const DEBOUNCE_QUIET_MS = 3000;
/** Freshness cap: a sustained edit stream still flushes within this bound even if it never goes quiet. */
export const DEBOUNCE_MAX_WAIT_MS = 15000;
/** Child-process budget — a scoped reconcile is bounded; matches the embed batch ceiling. */
const RECONCILE_TIMEOUT_MS = 120_000;
const RECONCILE_MAX_BUFFER = 10 * 1024 * 1024;

// ── Injectable runner (testability — tests drive flush/coalesce/failure without spawning python) ──
export interface ReconcilerStats { changed: number | null; skipped: number | null; removed: number | null }
export type ReconcilerRunner = (nodeIds: string[]) => Promise<ReconcilerStats>;

// Node-id charset: `{pov}-{cat}-{NNN}`, `pol-*`, `term:*`, `sei:*`, `summary:*` — word chars, ':',
// '.', '-'. The ids reach a subprocess and are the ONE user-controlled input on this path; execFile
// (array args, no shell) already blocks shell injection, but this allowlist is defense-in-depth AND
// prevents a comma/newline in an id from mis-splitting the reconciler's `--nodes` value.
const SAFE_NODE_ID = /^[A-Za-z0-9:_.-]+$/;

/** Keep only well-formed node ids before they reach the subprocess (exported for unit test). */
export function sanitizeNodeIds(ids: string[]): string[] {
  return ids.filter((id) => SAFE_NODE_ID.test(id));
}

function defaultRunner(nodeIds: string[]): Promise<ReconcilerStats> {
  const safe = sanitizeNodeIds(nodeIds);
  // No well-formed ids → nothing safe to reconcile; resolve as a no-op rather than spawn a child
  // with an empty/degenerate --nodes value.
  if (safe.length === 0) return Promise.resolve({ changed: 0, skipped: 0, removed: 0 });
  return new Promise((resolve, reject) => {
    // Presence of --nodes forces the reconciler's scoped mode; an empty/malformed list is a safe
    // no-op there, never a full apply (CL contract, #1736). --apply persists; the script acquires
    // its own grounding_lock around the read-merge-write.
    execFile(
      PYTHON,
      [RECONCILE_SCRIPT, '--nodes', safe.join(','), '--apply'],
      { timeout: RECONCILE_TIMEOUT_MS, maxBuffer: RECONCILE_MAX_BUFFER },
      (err, stdout, stderr) => {
        if (err) { reject(new Error(`reconcile_grounding.py exited non-zero/timeout: ${err.message}\n${stderr}`)); return; }
        resolve(parseStats(stdout));
      },
    );
  });
}

/** Extract the reconciler's leading `json.dumps(stats)` block ({changed,skipped,removed}, all ints,
 *  indent=2). Observability only — a parse miss yields nulls, never a throw. */
export function parseStats(stdout: string): ReconcilerStats {
  try {
    const m = stdout.match(/\{[\s\S]*?\n\}/); // first top-level object; integer values → no nested braces
    if (m) {
      const s = JSON.parse(m[0]) as Partial<ReconcilerStats>;
      return { changed: s.changed ?? null, skipped: s.skipped ?? null, removed: s.removed ?? null };
    }
  } catch { /* observability only — never throw on a stdout parse */ }
  return { changed: null, skipped: null, removed: null };
}

let _runner: ReconcilerRunner = defaultRunner;

// ── State (module singleton — one debounce window, at most one child) ─────────
const dirty = new Set<string>();
let quietTimer: ReturnType<typeof setTimeout> | null = null;
let maxTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;

function clearTimers(): void {
  if (quietTimer) { clearTimeout(quietTimer); quietTimer = null; }
  if (maxTimer) { clearTimeout(maxTimer); maxTimer = null; }
}

function scheduleFlush(): void {
  // Reset the quiet timer on every enqueue; arm the max timer once per debounce window.
  if (quietTimer) clearTimeout(quietTimer);
  quietTimer = setTimeout(() => { void flush(); }, DEBOUNCE_QUIET_MS);
  quietTimer.unref?.(); // never keep the process alive for a pending grounding refresh
  if (!maxTimer) {
    maxTimer = setTimeout(() => { void flush(); }, DEBOUNCE_MAX_WAIT_MS);
    maxTimer.unref?.();
  }
}

async function flush(): Promise<void> {
  clearTimers();
  if (running) return;        // a child is mid-run; its completion re-checks the dirty-set below
  if (dirty.size === 0) return;

  const ids = Array.from(dirty);
  dirty.clear();
  running = true;
  const startedMs = Date.now();

  try {
    const stats = await _runner(ids);
    getGlobalRecorder()?.record({
      type: 'system.info', component: 'grounding-reconcile', level: 'info',
      message: `grounding_reconcile_inline: reconciled ${ids.length} node(s) — ${stats.changed ?? '?'} changed`,
      data: { node_ids: ids, changed: stats.changed, skipped: stats.skipped, removed: stats.removed, duration_ms: Date.now() - startedMs },
    });
  } catch (err) {
    // Fallback-Path Logging: a failed/skipped reconcile must be visible (silently-stale grounding is
    // invisible degradation) — WARN it — but NEVER propagate: the taxonomy write already succeeded.
    const ae = new ActionableError({
      goal: 'Refresh grounding for the just-written taxonomy nodes',
      problem: `Inline grounding reconcile failed for ${ids.length} node(s): ${(err as Error).message}`,
      location: 'groundingReconcileHook.flush',
      nextSteps: [
        'The taxonomy write itself succeeded — this only affects derived grounding freshness',
        'The scheduled G8b sweep is the backstop; check reconcile_grounding.py availability/deps in this env',
      ],
    });
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'grounding-reconcile', level: 'warn',
      message: `grounding_reconcile_inline: reconcile FAILED for ${ids.length} node(s) — grounding may be stale until the next sweep`,
      data: { node_ids: ids, duration_ms: Date.now() - startedMs },
      error: { name: (err as Error).name ?? 'Error', message: ae.message, stack: (err as Error).stack },
    });
    log.server.warn({ component: 'grounding-reconcile', node_ids: ids, err: (err as Error).message }, 'inline grounding reconcile failed (non-fatal)');
  } finally {
    running = false;
    // ids enqueued while the child ran are still pending → start a fresh debounce window for them.
    if (dirty.size > 0) scheduleFlush();
  }
}

/**
 * Enqueue changed node ids for a debounced, fire-and-forget grounding reconcile. Safe to call on
 * every write; empty/blank ids are ignored (an unchanged PUT diffs to nothing → no run). Never
 * throws. The caller (routes/taxonomy.ts) gates this on the `grounding_reconcile_inline` flag.
 */
export function enqueueGroundingReconcile(nodeIds: string[]): void {
  let added = false;
  for (const id of nodeIds) { if (id) { dirty.add(id); added = true; } }
  if (!added) return; // nothing changed → no reconcile (the unchanged-PUT arm)
  scheduleFlush();
}

// ── Test hooks (underscore-prefixed — not part of the caller contract) ─────────
/** Inject a fake reconciler runner; pass null to restore the real execFile-based runner. */
export function __setReconcilerRunnerForTest(r: ReconcilerRunner | null): void { _runner = r ?? defaultRunner; }
/** Reset all debounce state between tests (timers, dirty-set, running flag). */
export function __resetGroundingHookForTest(): void { clearTimers(); dirty.clear(); running = false; }
/** Introspection for tests. */
export function __stateForTest(): { dirtySize: number; running: boolean; quietArmed: boolean; maxArmed: boolean } {
  return { dirtySize: dirty.size, running, quietArmed: quietTimer !== null, maxArmed: maxTimer !== null };
}
