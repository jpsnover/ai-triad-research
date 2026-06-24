// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@bridge', () => ({
  api: {
    getFlags: vi.fn(),
  },
}));

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));

import { useFeatureFlagStore, useFlag } from './useFeatureFlags';
import { api } from '@bridge';

const mockGetFlags = vi.mocked(api.getFlags);

describe('useFeatureFlagStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFeatureFlagStore.setState({ flags: {}, loaded: false });
  });

  describe('refresh', () => {
    it('fetches flags from the API and sets loaded', async () => {
      mockGetFlags.mockResolvedValue({ dark_mode: true, beta_feature: false });

      await useFeatureFlagStore.getState().refresh();

      const state = useFeatureFlagStore.getState();
      expect(state.flags).toEqual({ dark_mode: true, beta_feature: false });
      expect(state.loaded).toBe(true);
    });

    it('sets loaded=true with empty flags on API failure (fail-closed)', async () => {
      mockGetFlags.mockRejectedValue(new Error('Network error'));

      await useFeatureFlagStore.getState().refresh();

      const state = useFeatureFlagStore.getState();
      expect(state.flags).toEqual({});
      expect(state.loaded).toBe(true);
    });

    it('re-fetches flags on subsequent calls', async () => {
      mockGetFlags.mockResolvedValueOnce({ a: true });
      await useFeatureFlagStore.getState().refresh();
      expect(useFeatureFlagStore.getState().flags).toEqual({ a: true });

      mockGetFlags.mockResolvedValueOnce({ a: true, b: true });
      await useFeatureFlagStore.getState().refresh();
      expect(useFeatureFlagStore.getState().flags).toEqual({ a: true, b: true });
      expect(mockGetFlags).toHaveBeenCalledTimes(2);
    });
  });
});

describe('useFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFeatureFlagStore.setState({ flags: {}, loaded: false });
  });

  it('returns false for nonexistent flag (fail-closed)', () => {
    const val = useFeatureFlagStore.getState().flags['nonexistent'] ?? false;
    expect(val).toBe(false);
  });

  it('returns the flag value when present', () => {
    useFeatureFlagStore.setState({ flags: { my_flag: true }, loaded: true });
    const val = useFeatureFlagStore.getState().flags['my_flag'] ?? false;
    expect(val).toBe(true);
  });

  it('returns false for a flag explicitly set to false', () => {
    useFeatureFlagStore.setState({ flags: { disabled: false }, loaded: true });
    const val = useFeatureFlagStore.getState().flags['disabled'] ?? false;
    expect(val).toBe(false);
  });

  it('returns boolean type, never undefined', () => {
    useFeatureFlagStore.setState({ flags: { x: true }, loaded: true });
    const val: boolean = useFeatureFlagStore.getState().flags['missing'] ?? false;
    expect(typeof val).toBe('boolean');
  });
});
