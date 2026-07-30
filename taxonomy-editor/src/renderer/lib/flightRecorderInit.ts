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
import type { RecordInput, TriggerType } from '@lib/flight-recorder/types';
import { api } from '@bridge';
import { getClientConfig } from './clientConfig';
import { getResilienceState } from '../bridge/resilience';
import { showDumpToast, showDumpErrorToast, showDumpPendingToast } from './dumpToast';

declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;
declare const __COMPONENT_VERSIONS__: Record<string, string>;

function getDeploymentMode(): string {
  const target = import.meta.env.VITE_TARGET;
  if (target === 'web') return 'web-container';
  if (import.meta.env.DEV) return 'electron-dev';
  return 'electron-prod';
}

function getElectronAPI(): {
  processVersions?: Record<string, string | undefined>;
  osRelease?: string;
  osPlatform?: string;
  osArch?: string;
  getEmbeddingInfo?: () => Promise<{ backend: string; execution_provider?: string; calibration_version?: number }>;
} | undefined {
  return (window as unknown as { electronAPI?: ReturnType<typeof getElectronAPI> }).electronAPI;
}

// ── Cached embedding info (fetched once, used synchronously in context) ──
let _embeddingInfo: { backend: string; execution_provider?: string; calibration_version?: number } | null = null;
void getElectronAPI()?.getEmbeddingInfo?.().then(info => { _embeddingInfo = info; }).catch(() => {});

// ── Cached auth state (fetched once, used synchronously in context) ──
let _authState: { mode: string; user_type: string } | null = null;
if (getElectronAPI()) {
  _authState = { mode: 'local', user_type: 'authenticated' };
} else {
  void fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(data => {
    if (!data) return;
    const isAnon = !!(data as { anonymous?: boolean }).anonymous;
    _authState = {
      mode: isAnon ? 'optional' : 'required',
      user_type: isAnon ? 'anonymous' : 'authenticated',
    };
  }).catch(() => { /* flight recorder init — silent by design */ });
}

// ── Auth flow redirect tracking (sessionStorage-based) ──────────────────

const AUTH_REDIRECT_KEY = 'auth-redirect-tracking';
const AUTH_LOOP_THRESHOLD = 3;
const AUTH_LOOP_WINDOW_MS = 30_000;

interface AuthRedirectTracking {
  provider: string;
  timestamp: number;
  redirectCount: number;
}

function getAuthTracking(): AuthRedirectTracking | null {
  try {
    const raw = sessionStorage.getItem(AUTH_REDIRECT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthRedirectTracking;
  // eslint-disable-next-line local/require-flight-recorder-in-catch -- flight recorder init code cannot record to itself
  } catch { return null; }
}

function setAuthTracking(state: AuthRedirectTracking): void {
  try { sessionStorage.setItem(AUTH_REDIRECT_KEY, JSON.stringify(state)); }
  catch { /* flight recorder init — silent by design */ }
}

function clearAuthTracking(): void {
  try { sessionStorage.removeItem(AUTH_REDIRECT_KEY); }
  catch { /* flight recorder init — silent by design */ }
}

// ── Dump throttle state ──────────────────────────────────────────────────

let lastDumpTime = 0;
let dumpCountInWindow = 0;
let windowStart = 0;
let autoDumpDisabled = false;

function dumpCfg() { return getClientConfig().flightRecorder; }

function canAutoDump(): boolean {
  if (autoDumpDisabled) return false;
  const now = Date.now();

  // Reset window if expired
  if (now - windowStart > dumpCfg().dumpWindowMs) {
    windowStart = now;
    dumpCountInWindow = 0;
  }

  // Check min interval
  if (now - lastDumpTime < dumpCfg().minDumpIntervalMs) return false;

  // Check circuit breaker
  if (dumpCountInWindow >= dumpCfg().maxDumpsPerWindow) {
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
  let ndjson: string;
  try {
    ({ ndjson } = recorder.buildDump(triggerType, error, context));
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'flight-recorder',
      level: 'warn',
      message: 'Failed to build flight recorder dump',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    showDumpErrorToast({
      errorMessage: `Failed to build dump: ${String(err)}`,
      isWeb,
      ndjson: '',
      onRetry: () => { void persistDump(recorder, triggerType, error, context); },
    });
    return;
  }

  const dumpId = crypto.randomUUID();

  try {
    const result = await api.dumpFlightRecorder(ndjson, dumpId);
    console.log(`[flight-recorder] Dump saved: ${result.filePath} (dumpId=${dumpId})`);

    // In web/container mode, also dump the server-side flight recorder
    // so server events (git ops, GitHub API, cache) are captured alongside client events.
    let serverFilename: string | undefined;
    if (isWeb) {
      try {
        const resp = await fetch('/api/flight-recorder/server-dump', { method: 'POST' });
        if (resp.ok) {
          const serverResult = await resp.json() as { filename: string; filePath: string };
          serverFilename = serverResult.filename;
          console.log(`[flight-recorder] Server dump saved: ${serverResult.filePath}`);
        }
      // eslint-disable-next-line local/require-flight-recorder-in-catch -- flight recorder dump code cannot record to itself
      } catch { /* server dump is best-effort */ }

      // Fire-and-forget: trigger admin-level server dump correlated by dumpId.
      // Non-admins/anon get 403 — that's expected and ignored.
      void fetch('/api/admin/flight-recorder/dump', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dumpId }),
      }).catch(() => { /* admin dump is best-effort */ });
    }

    showDumpToast({
      filename: result.filename,
      filePath: result.filePath,
      isWeb,
      onCopy: () => { void api.clipboardWriteText(result.filePath); },
      onOpen: () => { void api.openFlightRecorderViewer(result.filePath); },
      serverFilename,
      dumpId: isWeb ? dumpId : undefined,
    });
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'flight-recorder',
      level: 'error',
      message: 'Failed to persist flight recorder dump',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    showDumpErrorToast({
      errorMessage: String(err),
      isWeb,
      ndjson,
      onRetry: () => { void persistDump(recorder, triggerType, error, context); },
    });
  }
}

// ── Popup shim ──────────────────────────────────────────────────────────

/**
 * Creates a thin flight recorder shim for popup windows.
 * Stamps _origin on each event and forwards to the main window's recorder via IPC.
 * No local ring buffer or dump logic.
 */
function createPopupShim(origin: string): FlightRecorder {
  // Create a minimal recorder (capacity 1 — we don't buffer locally)
  const shim = new FlightRecorder({ capacity: 1, dumpOnError: false });

  const electronAPI = (window as unknown as { electronAPI: { forwardFlightEvent: (event: RecordInput) => void } }).electronAPI;

  // Override record to forward via IPC instead of buffering locally
  shim.record = (input: RecordInput) => {
    const stamped: RecordInput = {
      ...input,
      data: { ...input.data, _origin: origin },
    };
    try {
      electronAPI.forwardFlightEvent(stamped);
    } catch {
      /* flight recorder init — silent by design (main window may have closed) */
    }
  };

  // Forward dictionary registrations to main recorder (deduped to reduce noise)
  const originalIntern = shim.intern.bind(shim);
  const _forwardedDictEntries = new Set<string>();
  shim.intern = (category: string, value: string) => {
    const handle = originalIntern(category, value);
    const key = `${category}/${value}`;
    const verbose = (window as unknown as { __FLIGHT_RECORDER_VERBOSE_DICT__?: boolean }).__FLIGHT_RECORDER_VERBOSE_DICT__;
    if (!verbose && _forwardedDictEntries.has(key)) return handle;
    _forwardedDictEntries.add(key);
    try {
      electronAPI.forwardFlightEvent({
        type: 'lifecycle',
        component: 'flight-recorder',
        level: 'debug',
        message: `Dictionary registration from ${origin}`,
        data: { _origin: origin, _dict_category: category, _dict_value: `${origin}/${value}` },
      });
    } catch { /* flight recorder init — silent by design */ }
    return handle;
  };

  shim.record({
    type: 'lifecycle',
    component: 'flight-recorder',
    level: 'info',
    message: `Popup shim initialized (forwarding to main)`,
    data: { origin },
  });

  return shim;
}

/**
 * BroadcastChannel-based shim for web-container popup windows.
 * Mirrors createPopupShim but uses BroadcastChannel instead of Electron IPC.
 */
function createWebPopupShim(origin: string): FlightRecorder {
  const shim = new FlightRecorder({ capacity: 1, dumpOnError: false });
  const channel = new BroadcastChannel('aitriad-flight-recorder');

  shim.record = (input: RecordInput) => {
    const stamped: RecordInput = {
      ...input,
      data: { ...input.data, _origin: origin },
    };
    try {
      channel.postMessage({ type: 'event', payload: stamped });
    } catch {
      /* flight recorder init — silent by design (main tab may have closed) */
    }
  };

  const originalIntern = shim.intern.bind(shim);
  const _forwardedDictEntries = new Set<string>();
  shim.intern = (category: string, value: string) => {
    const handle = originalIntern(category, value);
    const key = `${category}/${value}`;
    if (_forwardedDictEntries.has(key)) return handle;
    _forwardedDictEntries.add(key);
    try {
      channel.postMessage({
        type: 'event',
        payload: {
          type: 'lifecycle',
          component: 'flight-recorder',
          level: 'debug',
          message: `Dictionary registration from ${origin}`,
          data: { _origin: origin, _dict_category: category, _dict_value: `${origin}/${value}` },
        } satisfies RecordInput,
      });
    } catch { /* flight recorder init — silent by design */ }
    return handle;
  };

  shim.record({
    type: 'lifecycle',
    component: 'flight-recorder',
    level: 'info',
    message: 'Web popup shim initialized (forwarding via BroadcastChannel)',
    data: { origin },
  });

  return shim;
}

// ── Initialization ───────────────────────────────────────────────────────

let initialized = false;

// Defer store import to avoid circular dependency — resolved on first context/dump call.
// Module-scoped so both initFlightRecorder and dumpOnReactError can access it.
let _stores: { useDebateStore: unknown; useTaxonomyStore: unknown } | null = null;
function getStores() {
  if (!_stores) {
    try {
      const debateMod = (window as unknown as Record<string, unknown>).__ZUSTAND_STORES__ as Record<string, unknown> | undefined;
      const d = debateMod?.debate;
      const t = debateMod?.taxonomy;
      if (d && t) _stores = { useDebateStore: d, useTaxonomyStore: t };
    } catch { /* flight recorder init — silent by design (stores not ready yet) */ }
  }
  return _stores;
}

export function initFlightRecorder(): FlightRecorder {
  if (initialized) return getGlobalRecorder()!;
  initialized = true;

  // Identify which window this recorder belongs to
  const hash = window.location.hash;
  const isPopup = hash.startsWith('#debate-window') || hash === '#diagnostics-window' || hash === '#pov-progression-window' || hash === '#chat-window';
  const windowId = hash.startsWith('#debate-window')
    ? `debate:${new URLSearchParams(hash.split('?')[1] || '').get('id')?.slice(0, 8) || 'unknown'}`
    : hash === '#diagnostics-window' ? 'diagnostics'
    : hash === '#pov-progression-window' ? 'pov-progression'
    : hash === '#chat-window' ? 'chat'
    : 'main';

  // Popup windows use a thin shim — no local buffer, forward everything to main.
  // Electron: IPC via electronAPI. Web: BroadcastChannel.
  if (isPopup) {
    const hasElectronIPC = typeof (window as unknown as { electronAPI?: { forwardFlightEvent?: unknown } }).electronAPI?.forwardFlightEvent === 'function';
    const hasBroadcastChannel = typeof BroadcastChannel !== 'undefined';

    if (hasElectronIPC || hasBroadcastChannel) {
      const shim = hasElectronIPC
        ? createPopupShim(windowId)
        : createWebPopupShim(windowId);
      setGlobalRecorder(shim);

      // Set up error boundary hook for popup — forward crash event to main window's recorder
      (globalThis as unknown as { __onErrorBoundaryCatch: (err: Error, stack?: string) => void }).__onErrorBoundaryCatch = (error, componentStack) => {
        shim.record({
          type: 'system.error',
          component: 'react-error-boundary',
          level: 'fatal',
          message: error.message,
          error: { name: error.name, message: error.message, stack: error.stack?.slice(0, 500) },
          data: componentStack ? { component_stack: componentStack.slice(0, 1000) } : undefined,
        });
      };

      // Set up manual dump trigger for popup — request main window to dump
      (globalThis as unknown as { __triggerManualDump: () => Promise<void> | void }).__triggerManualDump = () => {
        shim.record({ type: 'lifecycle', component: 'flight-recorder', level: 'info', message: 'Manual dump requested from popup' });
        if (hasElectronIPC) {
          try {
            const eApi = (window as unknown as { electronAPI: { triggerMainDump?: () => Promise<{ filePath: string }> } }).electronAPI;
            if (eApi.triggerMainDump) {
              void eApi.triggerMainDump().then(result => {
                console.log(`[flight-recorder] Dump saved: ${result.filePath}`);
                void api.clipboardWriteText(result.filePath);
              });
            }
          } catch { /* flight recorder init — silent by design (dump request forwarded as event) */ }
        } else if (hasBroadcastChannel) {
          const ch = new BroadcastChannel('aitriad-flight-recorder');
          ch.postMessage({ type: 'dump-request', origin: windowId });
          ch.close();
        }
      };

      return shim;
    }
  }

  const recorder = new FlightRecorder({ capacity: 5000, dumpOnError: true });
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
  recorder.intern('component', 'hmr');

  recorder.intern('pov', 'accelerationist');
  recorder.intern('pov', 'safetyist');
  recorder.intern('pov', 'skeptic');

  // Wrap record() to stamp _origin on all events
  const originalRecord = recorder.record.bind(recorder);
  recorder.record = (input: RecordInput) => {
    originalRecord({
      ...input,
      data: { ...input.data, _origin: input.data?._origin ?? windowId },
    });
  };

  // Compute load_generation: increments on each page load/HMR within the same window tab
  let loadGeneration = 0;
  try {
    const prev = sessionStorage.getItem('flight-recorder-load-gen');
    loadGeneration = prev ? (parseInt(prev, 10) || 0) + 1 : 0;
    sessionStorage.setItem('flight-recorder-load-gen', String(loadGeneration));
  } catch { /* flight recorder init — silent by design (sessionStorage may be unavailable) */ }

  // Set ambient window identity on all events
  recorder.setEventContext({ window_id: windowId, load_generation: loadGeneration });

  // Record startup event
  recorder.record({
    type: 'lifecycle',
    component: recorder.intern('component', 'flight-recorder') as string | number,
    level: 'info',
    message: 'Flight recorder initialized',
    data: { capacity: 5000, window: windowId, load_generation: loadGeneration },
  });

  // ── HMR lifecycle events (dev-only) ──
  if (import.meta.hot) {
    import.meta.hot.on('vite:beforeUpdate', (payload: { type: string; updates: Array<{ type: string; path: string; acceptedPath: string; timestamp: number }> }) => {
      recorder.record({
        type: 'lifecycle',
        component: 'hmr',
        level: 'info',
        message: `HMR update: ${payload.updates.map(u => u.path).join(', ')}`,
        data: { update_count: payload.updates.length, paths: payload.updates.map(u => u.path), load_generation: loadGeneration },
      });
    });

    import.meta.hot.on('vite:beforeFullReload', () => {
      recorder.record({
        type: 'lifecycle',
        component: 'hmr',
        level: 'warn',
        message: 'Full page reload triggered by HMR',
        data: { load_generation: loadGeneration },
      });
    });

    import.meta.hot.on('vite:error', (payload: { err: { message: string; stack: string } }) => {
      recorder.record({
        type: 'system.error',
        component: 'hmr',
        level: 'error',
        message: `HMR error: ${payload.err.message}`,
        error: { name: 'HMRError', message: payload.err.message, stack: payload.err.stack?.slice(0, 500) },
        data: { load_generation: loadGeneration },
      });
    });
  }

  // ── Auth flow instrumentation (web only, main window only) ──
  if (!isPopup && isWeb) {
    // On init: detect if we just returned from an OAuth redirect
    const tracking = getAuthTracking();
    if (tracking) {
      const elapsed = Date.now() - tracking.timestamp;
      if (elapsed > 60_000) {
        clearAuthTracking();
      } else {
        // NOTE (t/2024, CodeQL js/user-controlled-bypass #5314 — dismissed as false
        // positive, TL-approved p/56#192): this cookie read is DIAGNOSTIC ONLY. It
        // populates the `has_session_cookie` telemetry field below and gates NO security
        // decision — the auth-loop branch keys on redirectCount/elapsed, never on this
        // value. Do not treat `hasSession` as an authorization signal.
        const hasSession = document.cookie.includes('AppServiceAuthSession');
        recorder.record({
          type: 'auth.callback_landing',
          component: 'auth',
          level: 'info',
          message: `OAuth callback: provider=${tracking.provider}, redirects=${tracking.redirectCount}`,
          data: {
            provider: tracking.provider,
            principal: (_authState as { principalName?: string } | null)?.principalName ?? null,
            has_session_cookie: hasSession,
            redirect_count: tracking.redirectCount,
            elapsed_ms: elapsed,
          },
        });

        if (tracking.redirectCount >= AUTH_LOOP_THRESHOLD && elapsed < AUTH_LOOP_WINDOW_MS) {
          recorder.record({
            type: 'auth.loop_detected',
            component: 'auth',
            level: 'error',
            message: `Auth redirect loop detected: ${tracking.redirectCount} redirects in ${elapsed}ms`,
            data: {
              provider: tracking.provider,
              redirect_count: tracking.redirectCount,
              elapsed_ms: elapsed,
              threshold: AUTH_LOOP_THRESHOLD,
              window_ms: AUTH_LOOP_WINDOW_MS,
            },
          });
          clearAuthTracking();
          void persistDump(recorder, 'explicit', undefined, { reason: 'auth_loop_detected', provider: tracking.provider });
        } else {
          clearAuthTracking();
        }
      }
    }

    // Delegated click handler: capture auth login link clicks
    document.addEventListener('click', (e) => {
      const anchor = (e.target as HTMLElement).closest?.('a[href*="/api/auth/fresh-login/"]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href') ?? '';
      const providerMatch = href.match(/\/api\/auth\/fresh-login\/([^/?#]+)/);
      const provider = providerMatch?.[1] ?? 'unknown';

      const existing = getAuthTracking();
      const now = Date.now();
      const count = (existing && existing.provider === provider && (now - existing.timestamp) < AUTH_LOOP_WINDOW_MS)
        ? existing.redirectCount + 1
        : 1;
      setAuthTracking({ provider, timestamp: now, redirectCount: count });

      recorder.record({
        type: 'auth.login_attempt',
        component: 'auth',
        level: 'info',
        message: `Auth login initiated: provider=${provider}`,
        data: { provider, redirect_count: count, href },
      });
    }, true);
  }

  // ── Context provider (full app state snapshot for dump) ──
  // See operations/diagnostics/flight-recorder-context-spec.md for field descriptions.
  // MUST be synchronous, handle uninitialized stores, no secrets, target <2KB.

  recorder.setContextProvider(() => {
    try {
      const stores = getStores();
      if (!stores) return {};
      const useDebateStore = stores.useDebateStore as { getState: () => any };
      const useTaxonomyStore = stores.useTaxonomyStore as { getState: () => any };

      const taxState = useTaxonomyStore.getState();
      const debateState = useDebateStore.getState();
      const debate = debateState.activeDebate;
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
      const eApi = getElectronAPI();
      const pv = eApi?.processVersions;

      return {
        app: {
          version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : undefined,
          build_date: typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : undefined,
          build_fingerprint: `build-${(window as unknown as { __BUILD_FINGERPRINT?: string }).__BUILD_FINGERPRINT ?? 'unknown'}`,
          deployment_mode: getDeploymentMode(),
          vite_target: import.meta.env.VITE_TARGET ?? 'electron',
          platform: eApi?.osPlatform ?? navigator.platform,
          arch: eApi?.osArch ?? (navigator.userAgent.includes('arm64') ? 'arm64' : 'x64'),
          os: eApi?.osPlatform ?? navigator.platform,
          os_version: eApi?.osRelease ?? undefined,
        },
        device: {
          platform: /iPad|Macintosh.*Mobile/i.test(navigator.userAgent) ? 'ipad'
            : /iPhone/i.test(navigator.userAgent) ? 'iphone'
            : /Android/i.test(navigator.userAgent) ? 'android'
            : 'desktop',
          touchPoints: navigator.maxTouchPoints,
          standalone: window.matchMedia('(display-mode: standalone)').matches,
        },
        windows: {
          main: {
            active_tab: taxState.activeTab,
            toolbar_panel: taxState.toolbarPanel ?? null,
            selected_node_id: taxState.selectedNodeId ?? null,
          },
        },
        debate: debate ? {
          id: debate.id,
          phase: debate.phase,
          adaptive_phase: debate.adaptive_staging?.current_phase ?? null,
          transcript_length: debate.transcript?.length ?? 0,
          an_nodes: debate.argument_network?.nodes?.length ?? 0,
          model: debateState.debateModel,
          temperature: debateState.debateTemperature,
          is_generating: !!debateState.debateGenerating,
          convergence_signals_count: debate.convergence_signals?.length ?? 0,
          protocol: debate.protocol ?? null,
          calibration_version: _embeddingInfo?.calibration_version ?? undefined,
        } : null,
        taxonomy: {
          loaded: {
            accelerationist: taxState.accelerationist?.nodes?.length ?? 0,
            safetyist: taxState.safetyist?.nodes?.length ?? 0,
            skeptic: taxState.skeptic?.nodes?.length ?? 0,
            situations: taxState.situations?.nodes?.length ?? 0,
          },
          dirty_files: [...(taxState.dirty ?? [])],
          save_error: taxState.saveError ?? null,
          edges_count: taxState.edgesFile?.edges?.length ?? 0,
        },
        ai: {
          backend: taxState.aiBackend,
          model: taxState.geminiModel,
        },
        embeddings: _embeddingInfo ? {
          backend: _embeddingInfo.backend,
          execution_provider: _embeddingInfo.execution_provider,
        } : undefined,
        diagnostics: {
          enabled: !!debateState.diagnosticsEnabled,
          selected_entry: debateState.selectedDiagEntry ?? null,
        },
        auth: _authState ?? { mode: 'unknown', user_type: 'unknown' },
        network: {
          online: navigator.onLine,
          deployment_mode: getDeploymentMode(),
          resilience: (() => {
            const rs = getResilienceState();
            const out: Record<string, { state: string; failures: number; recent?: string[] }> = {};
            for (const [cat, c] of Object.entries(rs.circuits)) {
              if (c.state !== 'CLOSED' || c.consecutiveFailures > 0) {
                out[cat] = { state: c.state, failures: c.consecutiveFailures, ...(c.recentFailures.length > 0 ? { recent: c.recentFailures } : {}) };
              }
            }
            return Object.keys(out).length > 0 ? out : undefined;
          })(),
        },
        performance: {
          uptime_s: Math.round(performance.now() / 1000),
          heap_used_mb: mem ? Math.round(mem.usedJSHeapSize / 1048576) : undefined,
          heap_total_mb: mem ? Math.round(mem.totalJSHeapSize / 1048576) : undefined,
          ring_buffer_utilization_pct: Math.round((recorder.buffer.retained / recorder.buffer.capacity) * 100),
        },
        sbom: {
          node: pv?.node ?? undefined,
          electron: pv?.electron ?? undefined,
          chrome: pv?.chrome ?? undefined,
          v8: pv?.v8 ?? undefined,
          ...(typeof __COMPONENT_VERSIONS__ !== 'undefined' ? __COMPONENT_VERSIONS__ : {}),
        },
      };
    } catch {
      /* flight recorder init — silent by design (can't log to itself) */
      return {};
    }
  });

  // ── Receive forwarded events from popup windows (main window only) ──

  if (!isPopup) {
    // Electron: receive via IPC
    const electronAPI = (window as unknown as { electronAPI?: { onFlightEventFromPopup?: (cb: (_e: unknown, payload: unknown) => void) => void } }).electronAPI;
    if (electronAPI?.onFlightEventFromPopup) {
      electronAPI.onFlightEventFromPopup((_e, payload) => {
        const event = payload as RecordInput;
        if (event.data?._dict_category && event.data?._dict_value) {
          recorder.intern(event.data._dict_category as string, event.data._dict_value as string);
        }
        recorder.record(event);
      });
    }

    // Web: receive via BroadcastChannel (mirrors IPC path for web-container popups)
    if (typeof BroadcastChannel !== 'undefined') {
      const frChannel = new BroadcastChannel('aitriad-flight-recorder');
      frChannel.onmessage = (msg: MessageEvent<{ type: string; payload?: RecordInput; origin?: string }>) => {
        if (msg.data.type === 'event' && msg.data.payload) {
          const event = msg.data.payload;
          if (event.data?._dict_category && event.data?._dict_value) {
            recorder.intern(event.data._dict_category as string, event.data._dict_value as string);
          }
          recorder.record(event);
        } else if (msg.data.type === 'dump-request') {
          void persistDump(recorder, 'manual');
        }
      };
      if (import.meta.hot) {
        import.meta.hot.dispose(() => frChannel.close());
      }
    }
  }

  // ── HMR timestamp extraction (dev-only) ──
  function extractHmrTimestamps(stack?: string): Record<string, number> | undefined {
    if (!stack || !import.meta.env.DEV) return undefined;
    const matches: Record<string, number> = {};
    for (const m of stack.matchAll(/([^\s(]+)\?t=(\d+)/g)) {
      matches[m[1]] = Number(m[2]);
    }
    return Object.keys(matches).length > 0 ? matches : undefined;
  }

  // ── Auto-dump triggers ──

  window.addEventListener('error', (event) => {
    const err = event.error instanceof Error ? event.error : new Error(String(event.error ?? event.message));
    recorder.record({
      type: 'system.error',
      component: 'unknown',
      level: 'fatal',
      message: err.message,
      error: { name: err.name, message: err.message, stack: err.stack?.slice(0, 500) },
      data: { hmr_timestamps: extractHmrTimestamps(err.stack), load_generation: loadGeneration },
    });
    if (canAutoDump()) {
      recordDump();
      void persistDump(recorder, 'uncaught_error', {
        name: err.name, message: err.message, stack: err.stack?.slice(0, 500),
      });
    }
    api.reportError(
      { name: err.name, message: err.message, stack: err.stack?.slice(0, 2000) },
      { trigger: 'uncaught_error', url: location.href, deploymentMode: getDeploymentMode() },
    ).catch(() => { /* telemetry — silent by design: error reporting failures must not cascade */ });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const err = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    recorder.record({
      type: 'system.error',
      component: 'unknown',
      level: 'fatal',
      message: err.message,
      error: { name: err.name, message: err.message, stack: err.stack?.slice(0, 500) },
      data: { hmr_timestamps: extractHmrTimestamps(err.stack), load_generation: loadGeneration },
    });
    if (canAutoDump()) {
      recordDump();
      void persistDump(recorder, 'unhandled_rejection', {
        name: err.name, message: err.message, stack: err.stack?.slice(0, 500),
      });
    }
    api.reportError(
      { name: err.name, message: err.message, stack: err.stack?.slice(0, 2000) },
      { trigger: 'unhandled_rejection', url: location.href, deploymentMode: getDeploymentMode() },
    ).catch(() => { /* telemetry — silent by design: error reporting failures must not cascade */ });
  });

  // ── Keyboard shortcut: Ctrl+Alt+D for manual dump ──
  // (Ctrl+Shift+D is consumed by Chrome's "Bookmark all tabs")

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.altKey && event.key === 'd') {
      event.preventDefault();
      void triggerManualDump();
      console.log('[flight-recorder] Manual dump triggered via Ctrl+Alt+D');
    }
  });

  // ── Dev console access ──

  (window as unknown as { __flightRecorder: FlightRecorder }).__flightRecorder = recorder;

  // ── ErrorBoundary hook (shared lib uses globalThis to avoid cross-app imports) ──

  (globalThis as unknown as { __onErrorBoundaryCatch: (err: Error, stack?: string) => void }).__onErrorBoundaryCatch = dumpOnReactError;

  // ── ErrorBoundary "Dump Log" button hook ──
  (globalThis as unknown as { __triggerManualDump: () => Promise<void> }).__triggerManualDump = triggerManualDump;

  // ── Listen for dump requests from popup windows (via main process relay) ──
  const eApi = (window as unknown as { electronAPI?: { onTriggerDump?: (cb: () => void) => () => void; sendDumpResult?: (r: { filePath: string }) => void } }).electronAPI;
  if (eApi?.onTriggerDump && eApi?.sendDumpResult) {
    eApi.onTriggerDump(() => {
      const { ndjson } = recorder.buildDump('manual');
      void api.dumpFlightRecorder(ndjson).then(result => {
        eApi.sendDumpResult!({ filePath: result.filePath });
        console.log(`[flight-recorder] Dump triggered by popup, saved: ${result.filePath}`);
      }).catch(err => {
        console.warn('[flight-recorder] Popup-triggered dump failed:', err);
        eApi.sendDumpResult!({ filePath: '' });
      });
    });
  }

  return recorder;
}

let _dumpInFlight = false;

/** Whether a flight recorder dump is currently in progress. */
export function isDumpInProgress(): boolean { return _dumpInFlight; }

/**
 * Trigger a manual flight recorder dump from any UI component.
 * Shows an immediate pending toast, guards against overlapping dumps.
 */
export async function triggerManualDump(): Promise<void> {
  const recorder = getGlobalRecorder();
  if (!recorder || _dumpInFlight) return;
  _dumpInFlight = true;
  const dismissPending = showDumpPendingToast();
  try {
    await persistDump(recorder, 'manual');
  } finally {
    _dumpInFlight = false;
    dismissPending();
  }
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

  // Snapshot store state for crash diagnosis — only runs on error, no perf impact on normal renders
  let stateSnapshot: Record<string, unknown> | undefined;
  try {
    const stores = getStores();
    if (stores) {
      const taxState = (stores.useTaxonomyStore as { getState: () => Record<string, unknown> }).getState();
      const debateState = (stores.useDebateStore as { getState: () => Record<string, unknown> }).getState();
      const debate = debateState.activeDebate as Record<string, unknown> | null;
      stateSnapshot = {
        active_tab: taxState.activeTab ?? null,
        toolbar_panel: taxState.toolbarPanel ?? null,
        selected_node_id: taxState.selectedNodeId ?? null,
        search_mode: taxState.findMode ?? null,
        search_query: (taxState.findQuery as string)?.slice(0, 200) || null,
        debate_phase: debate?.phase ?? null,
        debate_generating: !!debateState.debateGenerating,
        dirty_files: [...((taxState.dirty as Set<string>) ?? [])],
      };
    }
  } catch { /* flight recorder init — silent by design (store may be corrupted) */ }

  const data: Record<string, unknown> = {
    ...(componentStack ? { component_stack: componentStack.slice(0, 1000) } : {}),
    ...(stateSnapshot ? { state_snapshot: stateSnapshot } : {}),
  };

  recorder.record({
    type: 'system.error',
    component: 'react-error-boundary',
    level: 'fatal',
    message: error.message,
    error: { name: error.name, message: error.message, stack: error.stack?.slice(0, 500) },
    data: Object.keys(data).length > 0 ? data : undefined,
  });

  // Error boundary dumps bypass cooldown — highest-priority trigger
  recordDump();
  void persistDump(recorder, 'error_boundary', {
    name: error.name, message: error.message, stack: error.stack?.slice(0, 500),
  }, Object.keys(data).length > 0 ? data : undefined);

  // Report to server for aggregation
  api.reportError(
    { name: error.name, message: error.message, stack: error.stack?.slice(0, 2000), componentStack: componentStack?.slice(0, 1000) },
    { trigger: 'error_boundary', url: location.href, deploymentMode: getDeploymentMode() },
  ).catch(() => { /* telemetry — silent by design: error reporting failures must not cascade */ });
}
