// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * "Latest-value" buffer for a preload IPC bridge (t/2694 / t/2698).
 *
 * Popup windows receive a one-shot state push from the main process on
 * `did-finish-load`, but the React component registers its `ipcRenderer.on`
 * listener only after it mounts. If the push arrives first it is silently
 * dropped — and for an idle source (no follow-up pushes) the window never
 * populates. This buffers the latest pre-registration value and flushes it when
 * the component subscribes, so delivery no longer depends on IPC-vs-mount timing.
 *
 * A `.cts` (CommonJS) module so the sandboxed CommonJS preload can `require` it
 * under `nodenext`. It is now unit-testable because vite's `esbuild.include` was
 * widened to cover `.cts` (t/2698) — previously a typed `.cts` threw a parse error
 * when imported by vitest. Only the newest value is kept: the diagnostics channel
 * pushes full-state snapshots, so a superseded snapshot has no value.
 */
export interface LatestValueBuffer<T> {
  /** Feed values in from the module-load `ipcRenderer.on` handler. */
  onIpc(value: T): void;
  /** Call when a component subscribes: stop buffering, flush any pending value. */
  onSubscribe(deliver: (value: T) => void): void;
  /** Call on unsubscribe: re-arm buffering for the next mount / reload cycle. */
  onUnsubscribe(): void;
}

export function createLatestValueBuffer<T>(): LatestValueBuffer<T> {
  let buffered: T | null = null;
  let active = true;

  return {
    onIpc(value: T): void {
      if (active) buffered = value;
    },
    onSubscribe(deliver: (value: T) => void): void {
      // The component is now listening directly — stop buffering.
      active = false;
      if (buffered !== null) {
        const value = buffered;
        buffered = null;
        // Deliver asynchronously so subscription setup finishes first, matching
        // the ordering a live IPC push would have.
        queueMicrotask(() => deliver(value));
      }
    },
    onUnsubscribe(): void {
      // Re-arm so a push arriving during the next reload cycle is captured.
      active = true;
    },
  };
}
