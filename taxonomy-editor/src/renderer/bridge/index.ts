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
