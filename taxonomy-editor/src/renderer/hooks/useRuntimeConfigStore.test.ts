// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../bridge/web-bridge', () => ({
  bridgeGet: vi.fn(),
  bridgePut: vi.fn(),
  bridgePost: vi.fn(),
}));

vi.mock('@bridge', () => ({
  isElectronMode: vi.fn(() => false),
}));

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: vi.fn(() => ({ record: vi.fn() })),
}));

import { bridgeGet, bridgePut, bridgePost } from '../bridge/web-bridge';
import { isElectronMode } from '@bridge';
import { useRuntimeConfigStore, getNestedValue, countLeafDiffs } from './useRuntimeConfigStore';
import type { ConfigState, RuntimeConfig } from './useRuntimeConfigStore';

const mockBridgeGet = vi.mocked(bridgeGet);
const mockBridgePut = vi.mocked(bridgePut);
const mockBridgePost = vi.mocked(bridgePost);
const mockIsElectron = vi.mocked(isElectronMode);

function makeConfig(overrides: Record<string, unknown> = {}): RuntimeConfig {
  const base: RuntimeConfig = {
    resilience: {
      circuitThreshold: 5, circuitCooldownMs: 60_000, retryBaseDelayMs: 1_000,
      retryMaxDelayMs: 30_000, retryJitterMaxMs: 500, maxRetryAfterMs: 30_000,
      throttleWindowSize: 20, throttleBaselineCount: 10, throttleEnterFactor: 2.0,
      throttleExitFactor: 1.5, throttleDelayMs: 2_000,
    },
    rateLimiting: { windowMs: 60_000, cleanupCutoffMs: 120_000 },
    tiers: {
      platform: { requestsPerMinute: 60, tokensPerDay: 2_000_000, allowedBackends: ['gemini', 'claude', 'groq'] },
      byok: { requestsPerMinute: 30, tokensPerDay: 500_000, allowedBackends: ['gemini', 'claude', 'groq'] },
      anonymous: { requestsPerMinute: 10, tokensPerDay: 100_000, allowedBackends: ['gemini', 'claude', 'groq'] },
      free: { requestsPerMinute: 6, tokensPerDay: 50_000, allowedBackends: ['gemini'], pinnedModel: 'gemini-flash-lite-latest' },
    },
    quotas: { defaultMaxChats: 25, defaultMaxDebates: 15 },
    sessions: {
      anonymousTtlMs: 14_400_000, anonymousMaxSessions: 100, anonymousMaxSizeBytes: 10_485_760,
      tokenFreshnessThresholdMs: 60_000, lockAcquireTimeoutMs: 10_000, lockHoldTtlMs: 30_000,
    },
    analytics: { retentionDays: 90, bufferRequeueLimit: 500 },
    flightRecorder: {
      minDumpIntervalMs: 10_000, maxDumpsPerWindow: 5, dumpWindowMs: 60_000,
      maxRetainedDumps: 20, maxTotalDumpSizeBytes: 52_428_800,
    },
    community: { maxPendingPerUser: 20, globalPendingCap: 500 },
    feedback: { defaultPageLimit: 50, maxPageLimit: 200 },
    server: {
      conflictsCacheTtlMs: 300_000, gitCloneTimeoutMs: 300_000, gitFetchTimeoutMs: 600_000,
      gitDefaultTimeoutMs: 120_000, gitBufferLimitBytes: 10_485_760, apiKeyMaskLength: 4,
    },
    cache: { defaultTtlMs: 30_000 },
  };
  for (const [k, v] of Object.entries(overrides)) {
    const parts = k.split('.');
    let cur: Record<string, unknown> = base as unknown as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]] as Record<string, unknown>;
    cur[parts[parts.length - 1]] = v;
  }
  return base;
}

function makeState(configOverrides: Record<string, unknown> = {}): ConfigState {
  return {
    config: makeConfig(configOverrides),
    defaults: makeConfig(),
    errors: [],
    fileExists: true,
    lastModified: '2026-06-24T00:00:00.000Z',
  };
}

describe('useRuntimeConfigStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsElectron.mockReturnValue(false);
    useRuntimeConfigStore.setState({
      serverState: null, draft: null, loading: false, saving: false,
      saveErrors: [], fetchError: null,
    });
  });

  it('fetch loads config and sets draft', async () => {
    const state = makeState({ 'resilience.circuitThreshold': 10 });
    mockBridgeGet.mockResolvedValueOnce(state);

    await useRuntimeConfigStore.getState().fetch();

    const s = useRuntimeConfigStore.getState();
    expect(s.serverState).toEqual(state);
    expect(s.draft?.resilience.circuitThreshold).toBe(10);
    expect(s.loading).toBe(false);
    expect(mockBridgeGet).toHaveBeenCalledWith('/api/admin/config');
  });

  it('fetch is a no-op in Electron mode', async () => {
    mockIsElectron.mockReturnValue(true);
    await useRuntimeConfigStore.getState().fetch();
    expect(mockBridgeGet).not.toHaveBeenCalled();
  });

  it('fetch handles errors', async () => {
    mockBridgeGet.mockRejectedValueOnce(new Error('network fail'));
    await useRuntimeConfigStore.getState().fetch();
    const s = useRuntimeConfigStore.getState();
    expect(s.fetchError).toContain('network fail');
    expect(s.loading).toBe(false);
  });

  it('setField updates draft without changing serverState', async () => {
    const state = makeState();
    mockBridgeGet.mockResolvedValueOnce(state);
    await useRuntimeConfigStore.getState().fetch();

    useRuntimeConfigStore.getState().setField('resilience.circuitThreshold', 20);

    const s = useRuntimeConfigStore.getState();
    expect(s.draft?.resilience.circuitThreshold).toBe(20);
    expect(s.serverState?.config.resilience.circuitThreshold).toBe(5);
  });

  it('resetField sets draft field to default value', async () => {
    const state = makeState({ 'resilience.circuitThreshold': 10 });
    mockBridgeGet.mockResolvedValueOnce(state);
    await useRuntimeConfigStore.getState().fetch();

    useRuntimeConfigStore.getState().setField('resilience.circuitThreshold', 99);
    expect(useRuntimeConfigStore.getState().draft?.resilience.circuitThreshold).toBe(99);

    useRuntimeConfigStore.getState().resetField('resilience.circuitThreshold');
    expect(useRuntimeConfigStore.getState().draft?.resilience.circuitThreshold).toBe(5);
  });

  it('resetAll reverts draft to serverState config', async () => {
    const state = makeState({ 'resilience.circuitThreshold': 10 });
    mockBridgeGet.mockResolvedValueOnce(state);
    await useRuntimeConfigStore.getState().fetch();

    useRuntimeConfigStore.getState().setField('resilience.circuitThreshold', 99);
    useRuntimeConfigStore.getState().setField('quotas.defaultMaxChats', 100);

    useRuntimeConfigStore.getState().resetAll();
    const s = useRuntimeConfigStore.getState();
    expect(s.draft?.resilience.circuitThreshold).toBe(10);
    expect(s.draft?.quotas.defaultMaxChats).toBe(25);
  });

  it('save sends draft via PUT and re-fetches', async () => {
    const state = makeState();
    mockBridgeGet.mockResolvedValue(state);
    await useRuntimeConfigStore.getState().fetch();

    useRuntimeConfigStore.getState().setField('resilience.circuitThreshold', 15);

    mockBridgePut.mockResolvedValueOnce({ ok: true, errors: [] });
    const ok = await useRuntimeConfigStore.getState().save();

    expect(ok).toBe(true);
    expect(mockBridgePut).toHaveBeenCalledWith('/api/admin/config', expect.objectContaining({
      resilience: expect.objectContaining({ circuitThreshold: 15 }),
    }));
    expect(useRuntimeConfigStore.getState().saving).toBe(false);
    expect(useRuntimeConfigStore.getState().saveErrors).toEqual([]);
  });

  it('save extracts validation errors from 400 response', async () => {
    const state = makeState();
    mockBridgeGet.mockResolvedValueOnce(state);
    await useRuntimeConfigStore.getState().fetch();

    const err = new Error('PUT /api/admin/config failed');
    (err as Record<string, unknown>).problem =
      'PUT /api/admin/config failed with HTTP 400: {"ok":false,"errors":["resilience.circuitThreshold: 200 above max 100"]}';
    mockBridgePut.mockRejectedValueOnce(err);

    const ok = await useRuntimeConfigStore.getState().save();
    expect(ok).toBe(false);
    expect(useRuntimeConfigStore.getState().saveErrors).toEqual([
      'resilience.circuitThreshold: 200 above max 100',
    ]);
  });

  it('reload calls POST then re-fetches', async () => {
    const state = makeState();
    mockBridgePost.mockResolvedValueOnce({ ok: true });
    mockBridgeGet.mockResolvedValueOnce(state);

    await useRuntimeConfigStore.getState().reload();

    expect(mockBridgePost).toHaveBeenCalledWith('/api/admin/config/reload');
    expect(mockBridgeGet).toHaveBeenCalledWith('/api/admin/config');
    expect(useRuntimeConfigStore.getState().serverState).toEqual(state);
  });
});

describe('getNestedValue', () => {
  it('reads nested paths', () => {
    const obj = { a: { b: { c: 42 } } };
    expect(getNestedValue(obj, 'a.b.c')).toBe(42);
    expect(getNestedValue(obj, 'a.b')).toEqual({ c: 42 });
    expect(getNestedValue(obj, 'x.y')).toBeUndefined();
  });
});

describe('countLeafDiffs', () => {
  it('counts differing leaves', () => {
    const a = { x: 1, y: { z: 2, w: 3 } };
    const b = { x: 1, y: { z: 9, w: 3 } };
    expect(countLeafDiffs(a, b)).toBe(1);
  });

  it('counts array differences as one leaf', () => {
    const a = { backends: ['a', 'b'] };
    const b = { backends: ['a'] };
    expect(countLeafDiffs(a, b)).toBe(1);
  });

  it('returns 0 for identical objects', () => {
    const a = { x: 1, y: { z: 2 } };
    expect(countLeafDiffs(a, structuredClone(a))).toBe(0);
  });
});
