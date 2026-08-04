// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { create } from 'zustand';
import type { ViewMode, UserPreferences } from '../bridge/types';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

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
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'preferencesStore', level: 'error', message: 'Failed to persist view mode preference', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    }
  },

  hydrate: async () => {
    try {
      const { api } = await import('../bridge/index');
      const prefs: UserPreferences | null = await api.getPreferences();
      if (prefs?.viewMode) {
        set({ viewMode: prefs.viewMode });
      }
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'preferencesStore', level: 'error', message: 'Failed to hydrate preferences from bridge', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    }
  },
}));

((window as unknown as { __ZUSTAND_STORES__?: Record<string, unknown> }).__ZUSTAND_STORES__ ??= {} as Record<string, unknown>).preferences = usePreferencesStore;
