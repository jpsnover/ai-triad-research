// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { create } from 'zustand';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

interface FeatureFlagStore {
  flags: Record<string, boolean>;
  loaded: boolean;
  refresh: () => Promise<void>;
}

export const useFeatureFlagStore = create<FeatureFlagStore>((set) => ({
  flags: {},
  loaded: false,

  refresh: async () => {
    try {
      const flags = await api.getFlags();
      set({ flags, loaded: true });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'feature-flag-store',
        level: 'warn',
        message: 'Failed to fetch feature flags',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      set({ loaded: true });
    }
  },
}));

export function useFlag(name: string): boolean {
  return useFeatureFlagStore((s) => s.flags[name] ?? false);
}
