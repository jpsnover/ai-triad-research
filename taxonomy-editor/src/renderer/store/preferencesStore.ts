// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { create } from 'zustand';
import type { ViewMode, UserPreferences } from '../bridge/types';

interface PreferencesState {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => Promise<void>;
  /** Load persisted preferences from the bridge and hydrate the store. */
  hydrate: () => Promise<void>;
}

export const usePreferencesStore = create<PreferencesState>()((set) => ({
  viewMode: 'simple',

  setViewMode: async (mode: ViewMode) => {
    set({ viewMode: mode });
    try {
      const { api } = await import('../bridge/index');
      await api.setPreferences({ viewMode: mode });
    } catch { /* best-effort — local state already updated */ }
  },

  hydrate: async () => {
    try {
      const { api } = await import('../bridge/index');
      const prefs: UserPreferences | null = await api.getPreferences();
      if (prefs?.viewMode) {
        set({ viewMode: prefs.viewMode });
      }
    } catch { /* default 'simple' stands on error */ }
  },
}));

((window as unknown as { __ZUSTAND_STORES__?: Record<string, unknown> }).__ZUSTAND_STORES__ ??= {} as Record<string, unknown>).preferences = usePreferencesStore;
