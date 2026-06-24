// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { create } from 'zustand';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import {
  type ClientConfig,
  getClientConfig,
  refreshClientConfig,
  onClientConfigRefresh,
} from '../lib/clientConfig';

interface ClientConfigStore {
  config: ClientConfig;
  loaded: boolean;
  refresh: () => Promise<void>;
}

export const useClientConfigStore = create<ClientConfigStore>((set) => {
  onClientConfigRefresh(() => {
    set({ config: getClientConfig(), loaded: true });
  });

  return {
    config: getClientConfig(),
    loaded: false,

    refresh: async () => {
      try {
        await refreshClientConfig();
        set({ config: getClientConfig(), loaded: true });
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'client-config-store',
          level: 'warn',
          message: 'Failed to refresh client config',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
      }
    },
  };
});

export function useClientConfig(): ClientConfig {
  return useClientConfigStore((s) => s.config);
}
