// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Module-level client config cache (t/930). Fetches from GET /api/config/client
 * once at app startup and exposes values synchronously via getClientConfig().
 *
 * Uses bare fetch() intentionally — resilience.ts IS the bridge's retry layer,
 * so it can't depend on itself. Same approved-exception pattern as flightRecorderInit.ts.
 */

export interface ClientConfig {
  resilience: {
    circuitThreshold: number;
    circuitCooldownMs: number;
    retryBaseDelayMs: number;
    retryMaxDelayMs: number;
    retryJitterMaxMs: number;
    maxRetryAfterMs: number;
    throttleWindowSize: number;
    throttleBaselineCount: number;
    throttleEnterFactor: number;
    throttleExitFactor: number;
    throttleDelayMs: number;
  };
  flightRecorder: {
    minDumpIntervalMs: number;
    maxDumpsPerWindow: number;
    dumpWindowMs: number;
  };
  analytics: {
    bufferRequeueLimit: number;
  };
}

const DEFAULTS: ClientConfig = {
  resilience: {
    circuitThreshold: 5,
    circuitCooldownMs: 60_000,
    retryBaseDelayMs: 1_000,
    retryMaxDelayMs: 30_000,
    retryJitterMaxMs: 500,
    maxRetryAfterMs: 30_000,
    throttleWindowSize: 20,
    throttleBaselineCount: 10,
    throttleEnterFactor: 2.0,
    throttleExitFactor: 1.5,
    throttleDelayMs: 2_000,
  },
  flightRecorder: {
    minDumpIntervalMs: 10_000,
    maxDumpsPerWindow: 5,
    dumpWindowMs: 60_000,
  },
  analytics: {
    bufferRequeueLimit: 500,
  },
};

let cached: ClientConfig = DEFAULTS;
let initialized = false;
let refreshListeners: Array<() => void> = [];

export function getClientConfig(): ClientConfig {
  return cached;
}

export function isClientConfigInitialized(): boolean {
  return initialized;
}

export function onClientConfigRefresh(listener: () => void): () => void {
  refreshListeners.push(listener);
  return () => { refreshListeners = refreshListeners.filter(l => l !== listener); };
}

function notifyListeners(): void {
  for (const fn of refreshListeners) {
    try { fn(); } catch { /* listener error — silent by design */ }
  }
}

const isWeb = typeof window !== 'undefined' && !(window as unknown as { electronAPI?: unknown }).electronAPI;

export async function initClientConfig(): Promise<void> {
  if (!isWeb || initialized) return;
  try {
    const resp = await fetch('/api/config/client');
    if (resp.ok) {
      const data = await resp.json() as ClientConfig;
      cached = { ...DEFAULTS, ...data };
    }
  } catch { /* startup config fetch — best-effort, defaults are fine */ }
  initialized = true;
  notifyListeners();
}

export async function refreshClientConfig(): Promise<void> {
  if (!isWeb) return;
  try {
    const resp = await fetch('/api/config/client');
    if (resp.ok) {
      const data = await resp.json() as ClientConfig;
      cached = { ...DEFAULTS, ...data };
      notifyListeners();
    }
  } catch { /* config refresh — best-effort */ }
}
