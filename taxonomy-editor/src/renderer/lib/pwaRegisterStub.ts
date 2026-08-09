// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Deterministic stub for `virtual:pwa-register/react` (t/2356).
//
// The `vite-plugin-pwa` virtual module is only provided when the plugin is
// registered, which happens for the WEB build only (VITE_TARGET=web). The
// ELECTRON build imports UpdatePrompt.tsx (which imports the virtual module)
// but never renders it — yet rolldown-vite still resolves the import while
// walking the module graph, and without the plugin that resolution is a race:
// intermittently it fails the whole build with
//   "Rolldown failed to resolve import virtual:pwa-register/react".
//
// vite.config.ts aliases the virtual specifier to this file for electron builds
// so resolution is always deterministic. This stub mirrors the shape of the
// real `useRegisterSW` react hook but does nothing (no service worker in
// Electron). It is never actually invoked because UpdatePrompt is web-only.

import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

interface RegisterSWOptions {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegisteredSW?: (swScriptUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
  onRegisterError?: (error: unknown) => void;
}

export function useRegisterSW(_options: RegisterSWOptions = {}): {
  needRefresh: [boolean, Dispatch<SetStateAction<boolean>>];
  offlineReady: [boolean, Dispatch<SetStateAction<boolean>>];
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
} {
  const needRefresh = useState(false);
  const offlineReady = useState(false);
  return {
    needRefresh,
    offlineReady,
    updateServiceWorker: async (_reloadPage?: boolean) => {
      /* no-op: no service worker in the Electron build */
    },
  };
}
