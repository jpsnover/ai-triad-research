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
  healthProbe: {
    intervalMs: number;
    warmUpCount: number;
    warmUpDiscardCount: number;
    warmUpIntervalMs: number;
    windowSize: number;
    enterFactor: number;
    exitFactor: number;
    gracePeriodMs: number;
    timeoutMs: number;
  };
  debate: {
    defaultConfrontationRounds: number;
    defaultArgumentationRounds: number;
    defaultConcludingRounds: number;
    defaultTemperature: number;
    briefStageTemperature: number;
    planStageTemperature: number;
    draftStageTemperature: number;
    citeStageTemperature: number;
    evaluatorTemperature: number;
    summarizationTemperature: number;
    summarizationMaxTokens: number;
    evaluatorMaxTokens: number;
    defaultTimeoutMs: number;
    maxRegenAttempts: number;
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
  healthProbe: {
    intervalMs: 30_000,
    warmUpCount: 6,
    warmUpDiscardCount: 2,
    warmUpIntervalMs: 5_000,
    windowSize: 10,
    enterFactor: 2.0,
    exitFactor: 1.5,
    gracePeriodMs: 30_000,
    timeoutMs: 10_000,
  },
  debate: {
    defaultConfrontationRounds: 1,
    defaultArgumentationRounds: 2,
    defaultConcludingRounds: 1,
    defaultTemperature: 0.7,
    briefStageTemperature: 0.15,
    planStageTemperature: 0.4,
    draftStageTemperature: 0.7,
    citeStageTemperature: 0.15,
    evaluatorTemperature: 0.2,
    summarizationTemperature: 0.3,
    summarizationMaxTokens: 500,
    evaluatorMaxTokens: 8192,
    defaultTimeoutMs: 120_000,
    maxRegenAttempts: 3,
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
