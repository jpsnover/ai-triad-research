// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3309 — data-root validation as a /readyz READINESS signal (liveness ≠ readiness).
//
// Path B (TL-endorsed, t/3309#3): move server-side data-root validation off a boot
// `process.exit(1)` and onto the /readyz readiness signal. The process BOOTS (liveness =
// process-up, no smoke↔data-config coupling); /readyz stays not-ready until data validates,
// so a misprovisioned revision never receives traffic (the blue-green warm-gate refuses a
// not-ready rev) instead of crash-looping.
//
// This module is the cache-once readiness state (t/3309#2 cond 2): `validateDataRoot()` runs
// ONCE at startup (its own 3-retry) and the outcome is cached here — /readyz reads the cache,
// it never re-runs GitHub Contents per probe (ACA polls /readyz every few seconds).
//
// Three states (cond 3 — a definitive failure is not masked as a slow warm-up):
//   - 'validating' : startup validation in flight → /readyz 503 'warming'.
//   - 'ready'      : taxonomy/ + dictionary/ present & non-empty → /readyz data-root gate open.
//   - 'failed'     : validation definitively failed (empty/no-creds/transient-exhausted)
//                    → /readyz 503 'failed' (hard, not warming).
//
// Pure state only — no I/O and no logging here. The failure WARN→Log_s signal (cond 4) is
// emitted by the /readyz handler on the transition into 'failed' (throttled), and the boot
// path keeps its own existing WARN/error logs unchanged. During the migration the boot
// exit(1) enforce path is RETAINED as the active protection (t/3309#3 gate 2); this cache is
// populated alongside it and becomes the sole gate only once DevOps confirms /readyz gates
// traffic live and the exit(1) is removed.

export type DataRootReadyState = 'validating' | 'ready' | 'failed';

export interface DataRootReadiness {
  state: DataRootReadyState;
  /** Present only when state === 'failed' — the ActionableError message naming the cause. */
  reason?: string;
}

let _readiness: DataRootReadiness = { state: 'validating' };

/** Pure getter — no I/O. /readyz reads this per probe (cache-once, cond 2). */
export function getDataRootReadyState(): Readonly<DataRootReadiness> {
  return _readiness;
}

/** Startup success → data root validated. Called once from the boot validation block. */
export function setDataRootReady(): void {
  _readiness = { state: 'ready' };
}

/** Startup failure → definitive not-ready with the cause. Called once from the boot catch. */
export function setDataRootFailed(reason: string): void {
  _readiness = { state: 'failed', reason };
}

/** Test-only: reset the module singleton between cases. */
export function __resetDataRootReadinessForTest(): void {
  _readiness = { state: 'validating' };
}
