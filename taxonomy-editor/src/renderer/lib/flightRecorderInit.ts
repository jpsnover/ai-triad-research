// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Flight recorder initialization for the renderer process.
 *
 * Creates the global FlightRecorder instance, registers known dictionary
 * entries, wires auto-dump triggers (uncaught errors, unhandled rejections),
 * exposes window.__flightRecorder for dev console access, and registers
 * the Ctrl+Shift+D manual dump shortcut.
 */

import { FlightRecorder, setGlobalRecorder, getGlobalRecorder } from '@lib/flight-recorder/index';
import type { TriggerType } from '@lib/flight-recorder/types';
import { api } from '@bridge';
import { showDumpToast } from './dumpToast';

// ── Dump throttle state ──────────────────────────────────────────────────

let lastDumpTime = 0;
let dumpCountInWindow = 0;
let windowStart = 0;
let autoDumpDisabled = false;

const MIN_DUMP_INTERVAL_MS = 10_000;
const MAX_DUMPS_PER_WINDOW = 5;
const DUMP_WINDOW_MS = 60_000;

function canAutoDump(): boolean {
  if (autoDumpDisabled) return false;
  const now = Date.now();

  // Reset window if expired
  if (now - windowStart > DUMP_WINDOW_MS) {
    windowStart = now;
    dumpCountInWindow = 0;
  }

  // Check min interval
  if (now - lastDumpTime < MIN_DUMP_INTERVAL_MS) return false;

  // Check circuit breaker
  if (dumpCountInWindow >= MAX_DUMPS_PER_WINDOW) {
    autoDumpDisabled = true;
    console.warn('[flight-recorder] Auto-dump disabled: too many dumps in 60s window');
    return false;
  }

  return true;
}

function recordDump(): void {
  lastDumpTime = Date.now();
  dumpCountInWindow++;
}

// ── Dump persistence ─────────────────────────────────────────────────────

const isWeb = typeof window !== 'undefined' && !(window as unknown as { electronAPI?: unknown }).electronAPI;

async function persistDump(
  recorder: FlightRecorder,
  triggerType: TriggerType,
  error?: { name: string; message: string; stack?: string },
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    const { ndjson } = recorder.buildDump(triggerType, error, context);
    const result = await api.dumpFlightRecorder(ndjson);
    console.log(`[flight-recorder] Dump saved: ${result.filePath}`);
    showDumpToast({
      filename: result.filename,
      filePath: result.filePath,
      isWeb,
      onCopy: () => { void api.clipboardWriteText(result.filePath); },
      onOpen: () => { void api.openFile(result.filePath); },
    });
  } catch (err) {
    console.warn('[flight-recorder] Failed to persist dump:', err);
  }
}

// ── Initialization ───────────────────────────────────────────────────────

let initialized = false;

export function initFlightRecorder(): FlightRecorder {
  if (initialized) return getGlobalRecorder()!;
  initialized = true;

  const recorder = new FlightRecorder({ capacity: 1000, dumpOnError: true });
  setGlobalRecorder(recorder);

  // Register known dictionary entries
  recorder.intern('component', 'debate-engine');
  recorder.intern('component', 'turn-pipeline');
  recorder.intern('component', 'qbaf');
  recorder.intern('component', 'moderator');
  recorder.intern('component', 'ai-adapter');
  recorder.intern('component', 'argument-network-extraction');
  recorder.intern('component', 'debate-store');
  recorder.intern('component', 'convergence-signals');
  recorder.intern('component', 'phase-transitions');
  recorder.intern('component', 'flight-recorder');
  recorder.intern('component', 'bridge');
  recorder.intern('component', 'taxonomy-store');
  recorder.intern('component', 'reflection-edit');

  recorder.intern('pov', 'prometheus');
  recorder.intern('pov', 'sentinel');
  recorder.intern('pov', 'cassandra');

  // Identify which window this recorder belongs to
  const windowId = window.location.hash.startsWith('#debate-window') ? 'debate-popout' : 'main';

  // Record startup event
  recorder.record({
    type: 'lifecycle',
    component: recorder.intern('component', 'flight-recorder') as string | number,
    level: 'info',
    message: 'Flight recorder initialized',
    data: { capacity: 1000, window: windowId },
  });

  // ── Context provider (active debate info for dump header) ──

  recorder.setContextProvider(() => {
    try {
      // Lazy imports to avoid circular dependency at module load time.
      // Zustand stores — getState() is synchronous.
      const { useDebateStore } = require('../hooks/useDebateStore');
      const { useTaxonomyStore } = require('../hooks/useTaxonomyStore');

      const taxState = useTaxonomyStore.getState();
      const ctx: Record<string, unknown> = {
        window: windowId,
        activeTab: taxState.activeTab,
        toolbarPanel: taxState.toolbarPanel,
      };

      const debateState = useDebateStore.getState();
      const debate = debateState.activeDebate;
      if (debate) {
        ctx.active_debate_id = debate.id;
        ctx.active_debate_phase = debate.phase;
        ctx.active_debate_round = debate.transcript?.filter(
          (e: { type: string }) => e.type === 'cross_respond',
        ).length ?? 0;
      }

      return ctx;
    } catch {
      return {};
    }
  });

  // ── Auto-dump triggers ──

  window.addEventListener('error', (event) => {
    const err = event.error instanceof Error ? event.error : new Error(String(event.error ?? event.message));
    recorder.record({
      type: 'system.error',
      component: 'unknown',
      level: 'fatal',
      message: err.message,
      error: { name: err.name, message: err.message, stack: err.stack?.slice(0, 500) },
    });
    if (canAutoDump()) {
      recordDump();
      void persistDump(recorder, 'uncaught_error', {
        name: err.name, message: err.message, stack: err.stack?.slice(0, 500),
      });
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    const err = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    recorder.record({
      type: 'system.error',
      component: 'unknown',
      level: 'fatal',
      message: err.message,
      error: { name: err.name, message: err.message, stack: err.stack?.slice(0, 500) },
    });
    if (canAutoDump()) {
      recordDump();
      void persistDump(recorder, 'unhandled_rejection', {
        name: err.name, message: err.message, stack: err.stack?.slice(0, 500),
      });
    }
  });

  // ── Keyboard shortcut: Ctrl+Alt+D for manual dump ──
  // (Ctrl+Shift+D is consumed by Chrome's "Bookmark all tabs")

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.altKey && event.key === 'd') {
      event.preventDefault();
      void persistDump(recorder, 'manual');
      console.log('[flight-recorder] Manual dump triggered via Ctrl+Alt+D');
    }
  });

  // ── Dev console access ──

  (window as unknown as { __flightRecorder: FlightRecorder }).__flightRecorder = recorder;

  // ── ErrorBoundary hook (shared lib uses globalThis to avoid cross-app imports) ──

  (globalThis as unknown as { __onErrorBoundaryCatch: (err: Error, stack?: string) => void }).__onErrorBoundaryCatch = dumpOnReactError;

  return recorder;
}

/**
 * Trigger a manual flight recorder dump from any UI component.
 */
export function triggerManualDump(): void {
  const recorder = getGlobalRecorder();
  if (!recorder) return;
  void persistDump(recorder, 'manual');
}

/**
 * Called from ErrorBoundary.componentDidCatch to dump on React render errors.
 */
export function dumpOnReactError(
  error: Error,
  componentStack?: string,
): void {
  const recorder = getGlobalRecorder();
  if (!recorder) return;

  recorder.record({
    type: 'system.error',
    component: 'react-error-boundary',
    level: 'fatal',
    message: error.message,
    error: { name: error.name, message: error.message, stack: error.stack?.slice(0, 500) },
    data: componentStack ? { component_stack: componentStack.slice(0, 1000) } : undefined,
  });

  if (canAutoDump()) {
    recordDump();
    void persistDump(recorder, 'error_boundary', {
      name: error.name, message: error.message, stack: error.stack?.slice(0, 500),
    }, componentStack ? { component_stack: componentStack.slice(0, 1000) } : undefined);
  }
}
