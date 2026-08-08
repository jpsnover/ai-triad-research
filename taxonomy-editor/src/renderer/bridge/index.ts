// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Bridge entry point.
 *
 * Vite resolves '@bridge' to this file via the alias in vite.config.ts.
 * Currently re-exports the Electron bridge. When a web/container build is
 * added, the Vite alias will point '@bridge' at web-bridge.ts instead.
 */
import { api as rawApi } from './electron-bridge';
import { instrumentBridge } from './instrumentBridge';

export const api = instrumentBridge(rawApi);
export type { AppAPI } from './types';

// Brief-timeout emit surface (t/2307) — routed through @bridge so each build feeds
// its own renderer-local bus. Web resolves @bridge → web-bridge (its own emitters);
// Electron resolves @bridge → this file (electron-bridge's emitters).
export { emitBriefTimeout, emitBriefRetriesExhausted } from './electron-bridge';

export function setActiveDebateId(_id: string | null): void { /* no-op in Electron — no server logs to correlate */ }

export function isElectronMode(): boolean {
  return typeof window !== 'undefined' && 'electronAPI' in window;
}
