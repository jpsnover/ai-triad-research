// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Must mock fetch before importing clientConfig
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Simulate web mode (no electronAPI)
vi.stubGlobal('window', { ...globalThis.window });

describe('clientConfig (t/930)', () => {
  beforeEach(async () => {
    mockFetch.mockReset();
    // Re-import fresh for each test to reset module state
    vi.resetModules();
  });

  it('getClientConfig returns defaults before init', async () => {
    const { getClientConfig } = await import('../clientConfig');
    const cfg = getClientConfig();
    expect(cfg.resilience.circuitThreshold).toBe(5);
    expect(cfg.resilience.circuitCooldownMs).toBe(60_000);
    expect(cfg.flightRecorder.minDumpIntervalMs).toBe(10_000);
    expect(cfg.flightRecorder.maxDumpsPerWindow).toBe(5);
    expect(cfg.flightRecorder.dumpWindowMs).toBe(60_000);
    expect(cfg.analytics.bufferRequeueLimit).toBe(500);
  });

  it('initClientConfig fetches and caches server values', async () => {
    const serverConfig = {
      resilience: {
        circuitThreshold: 10,
        circuitCooldownMs: 120_000,
        retryBaseDelayMs: 2_000,
        retryMaxDelayMs: 60_000,
        retryJitterMaxMs: 1_000,
        maxRetryAfterMs: 60_000,
        throttleWindowSize: 30,
        throttleBaselineCount: 15,
        throttleEnterFactor: 3.0,
        throttleExitFactor: 2.0,
        throttleDelayMs: 4_000,
      },
      flightRecorder: { minDumpIntervalMs: 20_000, maxDumpsPerWindow: 3, dumpWindowMs: 120_000 },
      analytics: { bufferRequeueLimit: 1000 },
    };
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(serverConfig) });

    const { initClientConfig, getClientConfig } = await import('../clientConfig');
    await initClientConfig();

    const cfg = getClientConfig();
    expect(cfg.resilience.circuitThreshold).toBe(10);
    expect(cfg.flightRecorder.minDumpIntervalMs).toBe(20_000);
    expect(cfg.analytics.bufferRequeueLimit).toBe(1000);
    expect(mockFetch).toHaveBeenCalledWith('/api/config/client');
  });

  it('falls back to defaults when fetch fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network error'));

    const { initClientConfig, getClientConfig } = await import('../clientConfig');
    await initClientConfig();

    const cfg = getClientConfig();
    expect(cfg.resilience.circuitThreshold).toBe(5);
    expect(cfg.flightRecorder.minDumpIntervalMs).toBe(10_000);
  });

  it('falls back to defaults on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const { initClientConfig, getClientConfig } = await import('../clientConfig');
    await initClientConfig();

    const cfg = getClientConfig();
    expect(cfg.resilience.circuitThreshold).toBe(5);
  });

  it('refreshClientConfig updates cached values', async () => {
    const initial = {
      resilience: {
        circuitThreshold: 5, circuitCooldownMs: 60_000,
        retryBaseDelayMs: 1_000, retryMaxDelayMs: 30_000, retryJitterMaxMs: 500,
        maxRetryAfterMs: 30_000, throttleWindowSize: 20, throttleBaselineCount: 10,
        throttleEnterFactor: 2.0, throttleExitFactor: 1.5, throttleDelayMs: 2_000,
      },
      flightRecorder: { minDumpIntervalMs: 10_000, maxDumpsPerWindow: 5, dumpWindowMs: 60_000 },
      analytics: { bufferRequeueLimit: 500 },
    };
    const updated = {
      ...initial,
      resilience: { ...initial.resilience, circuitThreshold: 20 },
    };
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(initial) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(updated) });

    const { initClientConfig, refreshClientConfig, getClientConfig } = await import('../clientConfig');
    await initClientConfig();
    expect(getClientConfig().resilience.circuitThreshold).toBe(5);

    await refreshClientConfig();
    expect(getClientConfig().resilience.circuitThreshold).toBe(20);
  });

  it('onClientConfigRefresh notifies listeners', async () => {
    const serverConfig = {
      resilience: {
        circuitThreshold: 7, circuitCooldownMs: 60_000,
        retryBaseDelayMs: 1_000, retryMaxDelayMs: 30_000, retryJitterMaxMs: 500,
        maxRetryAfterMs: 30_000, throttleWindowSize: 20, throttleBaselineCount: 10,
        throttleEnterFactor: 2.0, throttleExitFactor: 1.5, throttleDelayMs: 2_000,
      },
      flightRecorder: { minDumpIntervalMs: 10_000, maxDumpsPerWindow: 5, dumpWindowMs: 60_000 },
      analytics: { bufferRequeueLimit: 500 },
    };
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(serverConfig) });

    const { initClientConfig, onClientConfigRefresh } = await import('../clientConfig');
    const listener = vi.fn();
    const unsub = onClientConfigRefresh(listener);

    await initClientConfig();
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    // After unsub, listener should not be called again
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(serverConfig) });
    const { refreshClientConfig } = await import('../clientConfig');
    await refreshClientConfig();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('initClientConfig is idempotent', async () => {
    const serverConfig = {
      resilience: {
        circuitThreshold: 5, circuitCooldownMs: 60_000,
        retryBaseDelayMs: 1_000, retryMaxDelayMs: 30_000, retryJitterMaxMs: 500,
        maxRetryAfterMs: 30_000, throttleWindowSize: 20, throttleBaselineCount: 10,
        throttleEnterFactor: 2.0, throttleExitFactor: 1.5, throttleDelayMs: 2_000,
      },
      flightRecorder: { minDumpIntervalMs: 10_000, maxDumpsPerWindow: 5, dumpWindowMs: 60_000 },
      analytics: { bufferRequeueLimit: 500 },
    };
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(serverConfig) });

    const { initClientConfig } = await import('../clientConfig');
    await initClientConfig();
    await initClientConfig();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
