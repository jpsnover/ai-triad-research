// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Per-request user identity, carried via AsyncLocalStorage so that deep call
 * sites (AI backends, key store) can read the authenticated user without
 * every function having to accept a userId parameter.
 *
 * In Azure, the identity comes from Easy Auth headers (X-MS-CLIENT-PRINCIPAL-*).
 * Locally (or when auth is disabled), callers run outside any user context and
 * consumers fall back to a shared "_local" principal.
 */

import { AsyncLocalStorage } from 'async_hooks';

export interface UserContext {
  /** Principal identifier: email, GitHub username, or similar. */
  principalName: string;
  /** Identity provider: 'github', 'google', 'aad', etc. */
  idp: string;
}

const als = new AsyncLocalStorage<UserContext>();

export function runWithUser<T>(ctx: UserContext, fn: () => T): T {
  return als.run(ctx, fn);
}

export function getCurrentUser(): UserContext | null {
  return als.getStore() ?? null;
}

/** Stable id used to partition per-user secrets. '_local' for unauthenticated. */
export function getCurrentUserId(): string {
  return als.getStore()?.principalName || '_local';
}
