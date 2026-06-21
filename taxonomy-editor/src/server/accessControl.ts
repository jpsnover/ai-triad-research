// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Pure access-control decisions extracted from server.ts so they can be unit
// tested (server.ts calls server.listen() at import time and isn't import-safe).
// See t/720 (L1, L3, L6).

import path from 'path';

/**
 * L1: whether an AUTH_DISABLED=1 setting should be honored. AUTH_DISABLED makes
 * every request an anonymous user with full access — acceptable for local/dev
 * single-operator use, never in production. Honored only outside production.
 */
export function isAuthDisabledAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AUTH_DISABLED === '1' && env.NODE_ENV !== 'production';
}

/**
 * L3: whether `target` resolves to `base` itself or a path nested under it.
 * Used to confine the /api/data/clone target to the configured data directory
 * (an arbitrary path there is an admin-only arbitrary-write primitive).
 */
export function isPathWithinDir(target: string, base: string): boolean {
  const resolvedTarget = path.resolve(target);
  const resolvedBase = path.resolve(base);
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + path.sep);
}

/**
 * L6: whether a caller may open the terminal WebSocket (which spawns a
 * server-side shell). AUTH_DISABLED is single-operator local/dev mode (L1
 * forbids it in production), so the local operator keeps access; every
 * authenticated deployment requires an admin user with a resolved principal.
 */
export function isTerminalAccessAllowed(opts: {
  authDisabled: boolean;
  principalName: string;
  isAdmin: boolean;
}): boolean {
  if (opts.authDisabled) return true;
  if (!opts.principalName) return false;
  return opts.isAdmin;
}
