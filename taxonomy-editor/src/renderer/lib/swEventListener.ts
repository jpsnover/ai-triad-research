// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { getGlobalRecorder } from '@lib/flight-recorder/index';

let initialized = false;

export function initSwEventListener(): void {
  if (initialized || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  initialized = true;

  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data as Record<string, unknown> | null;
    if (!data || typeof data.type !== 'string') return;

    getGlobalRecorder()?.record({
      type: data.type as string,
      component: 'service-worker',
      level: (data.level as string) || 'info',
      message: (data.message as string) || `SW event: ${data.type}`,
      data: data.data as Record<string, unknown> | undefined,
    });
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    getGlobalRecorder()?.record({
      type: 'sw.controller_change',
      component: 'service-worker',
      level: 'info',
      message: 'Service worker controller changed — new SW activated',
    });
  });

  if (navigator.serviceWorker.controller) {
    getGlobalRecorder()?.record({
      type: 'sw.active',
      component: 'service-worker',
      level: 'info',
      message: 'Service worker active at page load',
      data: { scriptURL: navigator.serviceWorker.controller.scriptURL },
    });
  }

  navigator.serviceWorker.ready.then((reg) => {
    reg.addEventListener('updatefound', () => {
      getGlobalRecorder()?.record({
        type: 'sw.update_found',
        component: 'service-worker',
        level: 'info',
        message: 'Service worker update found',
      });
    });
  }).catch(() => { /* telemetry — silent by design */ });
}
