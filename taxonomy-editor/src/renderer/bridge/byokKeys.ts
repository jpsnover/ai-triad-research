// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// BYOK (bring-your-own-key) helpers for the web bridge, moved out of web-bridge.ts unchanged to keep that
// file under its max-lines budget (ADR-007).

import { getGlobalRecorder } from '@lib/flight-recorder/index';

/** Read BYOK keys from sessionStorage, backward-compatible with legacy single-key strings. */
export function readByokKeys(backend: string): string[] {
  const raw = sessionStorage.getItem(`byok-${backend}`);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((k: unknown) => typeof k === 'string' && k);
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'web-bridge',
      level: 'warn',
      message: `BYOK key JSON parse fallback for backend '${backend}'`,
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
  }
  return [raw];
}

export function maskByokKey(key: string): string {
  const sep = key.indexOf('|');
  if (sep > 0) {
    const endpoint = key.slice(0, sep);
    const k = key.slice(sep + 1);
    const masked = k.length <= 4 ? k.slice(0, 2) + '***' : k.slice(0, 4) + '...' + k.slice(-4);
    return `${endpoint} | ${masked}`;
  }
  if (key.length <= 4) return key.slice(0, 2) + '***';
  return key.slice(0, 4) + '...' + key.slice(-4);
}
