// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Cross-provider account collision guard.
 *
 * Records which identity provider (idp) first "claimed" each storageUserId.
 * Subsequent logins with a different idp for the same storageUserId are
 * rejected — preventing a user on provider B from landing in provider A's
 * data directory when both produce the same normalized id.
 *
 * Binding data lives at {dataRoot}/admin/provider_bindings.json, following
 * the same fs-with-mtime-cache pattern as quotas.ts.
 */

import fs from 'fs';
import path from 'path';
import { readFileWithMtime } from './fsCache.js';
import { getDataRoot } from '../config.js';
import { log } from '../logger.js';
import { getConfig } from '../runtimeConfig.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';

interface ProviderBindings {
  [storageUserId: string]: string;
}

// Property names that would reach Object.prototype if used as a dynamic map
// key. A normalized storageUserId must never be one of these — using it as a
// write target is a prototype-pollution vector (CodeQL js/remote-property-injection).
const FORBIDDEN_KEYS = new Set<string>(['__proto__', 'constructor', 'prototype']);
function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_KEYS.has(key);
}

// Bindings are held in a null-prototype object so a user-controlled key can
// never resolve up the prototype chain on read, nor pollute it on write.
function emptyBindings(): ProviderBindings {
  return Object.create(null) as ProviderBindings;
}

let _cache: ProviderBindings | null = null;
let _cacheMtime = 0;
let _lastLoadTime = 0;

function getBindingsPath(): string {
  return path.join(getDataRoot(), 'admin', 'provider_bindings.json');
}

function loadBindings(): ProviderBindings {
  const bindingsPath = getBindingsPath();
  try {
    const { content, mtimeMs } = readFileWithMtime(bindingsPath, _cache ? _cacheMtime : undefined);
    if (content === null) return _cache ?? emptyBindings();
    const parsed = JSON.parse(content) as Record<string, unknown>;
    // Rebuild into a null-prototype map, dropping any prototype-polluting or
    // non-string entries a hand-edited bindings file could contain.
    const clean = emptyBindings();
    for (const [k, v] of Object.entries(parsed)) {
      if (!isForbiddenKey(k) && typeof v === 'string') clean[k] = v;
    }
    _cache = clean;
    _cacheMtime = mtimeMs;
    return _cache;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'providerBinding',
        level: 'warn',
        message: 'Failed to load provider bindings — using empty defaults',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
    }
    return emptyBindings();
  }
}

function getBindings(): ProviderBindings {
  const now = Date.now();
  if (now - _lastLoadTime > getConfig().cache.defaultTtlMs) { // t/929: runtime-configurable (default 30_000)
    _lastLoadTime = now;
    return loadBindings();
  }
  return _cache ?? loadBindings();
}

function saveBindings(bindings: ProviderBindings): void {
  const bindingsPath = getBindingsPath();
  const dir = path.dirname(bindingsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(bindingsPath, JSON.stringify(bindings, null, 2), 'utf-8');
  _cache = Object.assign(emptyBindings(), bindings);
  _cacheMtime = 0;
  _lastLoadTime = Date.now();
}

export interface BindingResult {
  ok: boolean;
  boundTo?: string;
}

/**
 * Verify that the idp is allowed to use this storageUserId.
 *
 * - First login for a storageUserId: binds it to the idp, returns ok.
 * - Matching idp: returns ok.
 * - Mismatched idp: returns { ok: false, boundTo } — the caller should
 *   reject the request (403).
 * - _local / empty: always ok (no binding for anonymous or Electron users).
 */
export function checkProviderBinding(storageUserId: string, idp: string): BindingResult {
  if (!storageUserId || storageUserId === '_local') return { ok: true };
  // Defensive: a normalized storageUserId must never be a prototype-polluting
  // key. Reject rather than let it reach the dynamic write below
  // (CodeQL js/remote-property-injection). Also guards the read that follows.
  if (isForbiddenKey(storageUserId)) {
    log.server.warn({ storageUserId }, 'Provider binding: rejected reserved storageUserId key');
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'providerBinding', level: 'warn',
      message: 'Rejected reserved storageUserId key',
      data: { storageUserId },
    });
    return { ok: false };
  }

  const bindings = getBindings();
  const bound = bindings[storageUserId];

  if (!bound) {
    try {
      bindings[storageUserId] = idp;
      saveBindings(bindings);
      log.server.info({ storageUserId, idp }, 'Provider binding created');
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'providerBinding',
        level: 'warn',
        message: 'Failed to persist provider binding — allowing login',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
    }
    return { ok: true };
  }

  if (bound === idp) return { ok: true };

  log.server.warn({ storageUserId, idp, boundTo: bound }, 'Provider binding mismatch — access denied');
  getGlobalRecorder()?.record({
    type: 'system.error',
    component: 'providerBinding',
    level: 'warn',
    message: `Provider mismatch: ${idp} attempted to access storageUserId bound to ${bound}`,
    data: { storageUserId, attemptedIdp: idp, boundIdp: bound },
  });
  return { ok: false, boundTo: bound };
}

/** Reset module cache — for testing only. */
export function _resetBindingsCache(): void {
  _cache = null;
  _cacheMtime = 0;
  _lastLoadTime = 0;
}
