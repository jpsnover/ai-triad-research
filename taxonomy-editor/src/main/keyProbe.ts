// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1574: probe configs come from the shared module (single source of truth);
// this file wraps them with Electron's net.fetch. The switch statement from
// t/1573 is replaced by a config-driven loop — adding a new backend means
// adding one entry in src/shared/keyProbes.ts, not touching two files.

import { net } from 'electron';
import { KEY_PROBE_CONFIGS, SUPPORTED_PROBE_BACKENDS as _BACKENDS } from '../shared/keyProbes.js';

export const SUPPORTED_PROBE_BACKENDS = _BACKENDS;

export function isSupportedProbeBackend(backend: string): boolean {
  return SUPPORTED_PROBE_BACKENDS.includes(backend);
}

export async function probeApiKey(backend: string, key: string): Promise<boolean> {
  const cfg = KEY_PROBE_CONFIGS[backend];
  if (!cfg) throw new Error(`Unsupported backend: ${backend}`);

  const r = await net.fetch(cfg.url(key), {
    method: cfg.method ?? 'GET',
    headers: cfg.headers(key),
    ...(cfg.body && { body: cfg.body() }),
  });
  return r.ok;
}
