import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockHasApiKey = vi.fn<(backend: string) => Promise<boolean>>();

vi.mock('@bridge', () => ({
  api: { hasApiKey: (...args: unknown[]) => mockHasApiKey(args[0] as string) },
}));

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));

let mockShouldShow = true;
vi.mock('../components/settings/GeminiOnboardingModal', () => ({
  shouldShowGeminiOnboarding: () => mockShouldShow,
  clearSessionDismiss: vi.fn(),
}));

import { useGeminiOnboarding } from './useGeminiOnboarding';

describe('useGeminiOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShouldShow = true;
    mockHasApiKey.mockResolvedValue(false);
  });

  it('skips modal and never calls hasApiKey when freeTier is true (AC#1, AC#3)', async () => {
    const { result } = renderHook(() => useGeminiOnboarding());
    let resolved: boolean | undefined;
    await act(async () => {
      resolved = await result.current.checkAndShow({ freeTier: true });
    });
    expect(resolved).toBe(true);
    expect(mockHasApiKey).not.toHaveBeenCalled();
    expect(result.current.showModal).toBe(false);
  });

  it('checks hasApiKey when freeTier is false (AC#2)', async () => {
    mockHasApiKey.mockResolvedValue(true);
    const { result } = renderHook(() => useGeminiOnboarding());
    let resolved: boolean | undefined;
    await act(async () => {
      resolved = await result.current.checkAndShow({ freeTier: false });
    });
    expect(resolved).toBe(true);
    expect(mockHasApiKey).toHaveBeenCalledWith('gemini');
  });

  it('checks hasApiKey when no opts provided (backward compat)', async () => {
    mockHasApiKey.mockResolvedValue(true);
    const { result } = renderHook(() => useGeminiOnboarding());
    let resolved: boolean | undefined;
    await act(async () => {
      resolved = await result.current.checkAndShow();
    });
    expect(resolved).toBe(true);
    expect(mockHasApiKey).toHaveBeenCalledWith('gemini');
  });

  it('shows modal when not freeTier and no key present', async () => {
    mockHasApiKey.mockResolvedValue(false);
    const { result } = renderHook(() => useGeminiOnboarding());
    const promise = act(async () => {
      result.current.checkAndShow();
    });
    await promise;
    expect(result.current.showModal).toBe(true);
  });
});
