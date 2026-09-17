// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useUserProfile } from './useAuthStatus';

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));

vi.mock('../bridge/web-bridge', () => ({
  bridgeGet: vi.fn(),
}));

import { bridgeGet } from '../bridge/web-bridge';
const mockBridgeGet = vi.mocked(bridgeGet);

describe('useUserProfile — geminiAllowlisted (t/3500)', () => {
  const originalEnv = import.meta.env.VITE_TARGET;

  afterEach(() => {
    import.meta.env.VITE_TARGET = originalEnv;
    vi.restoreAllMocks();
    mockBridgeGet.mockReset();
  });

  it('passes through geminiAllowlisted:true from the server response', async () => {
    import.meta.env.VITE_TARGET = 'web';
    mockBridgeGet.mockResolvedValue({
      userId: 'u1', displayName: 'User One', idp: 'github', isAnonymous: false, isAdmin: false, quotas: null,
      geminiAllowlisted: true,
    });

    const { result } = renderHook(() => useUserProfile());
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.geminiAllowlisted).toBe(true);
  });

  it('defaults geminiAllowlisted to false when the field is absent (version tolerance — old server)', async () => {
    import.meta.env.VITE_TARGET = 'web';
    mockBridgeGet.mockResolvedValue({
      userId: 'u1', displayName: 'User One', idp: 'github', isAnonymous: false, isAdmin: false, quotas: null,
    });

    const { result } = renderHook(() => useUserProfile());
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.geminiAllowlisted).toBe(false);
  });

  it('defaults geminiAllowlisted to false when the field is explicitly false', async () => {
    import.meta.env.VITE_TARGET = 'web';
    mockBridgeGet.mockResolvedValue({
      userId: 'u1', displayName: 'User One', idp: 'github', isAnonymous: false, isAdmin: false, quotas: null,
      geminiAllowlisted: false,
    });

    const { result } = renderHook(() => useUserProfile());
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.geminiAllowlisted).toBe(false);
  });
});
