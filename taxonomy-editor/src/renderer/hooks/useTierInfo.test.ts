// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTierInfo, isFreeTier } from './useTierInfo';
import type { TierInfo } from './useTierInfo';

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));

vi.mock('../bridge/web-bridge', () => ({
  bridgeGet: vi.fn(),
}));

import { bridgeGet } from '../bridge/web-bridge';
const mockBridgeGet = vi.mocked(bridgeGet);

const freeTier: TierInfo = {
  level: 'free',
  limits: { requestsPerMinute: 6, tokensPerDay: 50000 },
  allowedBackends: ['gemini'],
  principalName: null,
  serverProvidedKey: true,
  pinnedModel: 'gemini-flash-lite-latest',
};

const byokTier: TierInfo = {
  level: 'byok',
  limits: { requestsPerMinute: 30, tokensPerDay: 500000 },
  allowedBackends: ['gemini', 'claude', 'groq'],
  principalName: 'user@example.com',
};

describe('isFreeTier', () => {
  it('returns true for free tier', () => {
    expect(isFreeTier(freeTier)).toBe(true);
  });

  it('returns false for byok tier', () => {
    expect(isFreeTier(byokTier)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isFreeTier(null)).toBe(false);
  });
});

describe('useTierInfo', () => {
  const originalEnv = import.meta.env.VITE_TARGET;

  afterEach(() => {
    import.meta.env.VITE_TARGET = originalEnv;
    vi.restoreAllMocks();
    mockBridgeGet.mockReset();
  });

  it('returns null tier in non-web mode', async () => {
    import.meta.env.VITE_TARGET = 'electron';
    const { result } = renderHook(() => useTierInfo());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tier).toBeNull();
    expect(result.current.usage).toBeNull();
  });

  it('fetches tier and usage in web mode', async () => {
    import.meta.env.VITE_TARGET = 'web';
    const usageData = { tier: 'free', limits: { requestsPerMinute: 6, tokensPerDay: 50000 }, usage: { requestsInWindow: 2, tokensToday: 5000 } };
    mockBridgeGet.mockImplementation((url: string) => {
      if (url === '/api/proxy/tier') return Promise.resolve(freeTier);
      if (url === '/api/proxy/usage') return Promise.resolve(usageData);
      return Promise.reject(new Error('Unknown URL'));
    });

    const { result } = renderHook(() => useTierInfo());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tier).toEqual(freeTier);
    expect(result.current.usage).toEqual(usageData);
  });

  it('handles fetch errors gracefully', async () => {
    import.meta.env.VITE_TARGET = 'web';
    mockBridgeGet.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useTierInfo());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tier).toBeNull();
    expect(result.current.usage).toBeNull();
  });
});
