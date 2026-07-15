// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1347 (route extraction, t/1295 follow-up): the /api/keys route cluster,
// moved verbatim out of server.ts behind the registration seam. Handlers are
// unchanged; only their relative import paths gained one `../` (this file is one
// directory deeper than server.ts). The keys handlers depend only on module-level
// imports (no server-local state), so ServerCtx is threaded but unused here.
//
// Note: `GET /api/keys/has` ⟷ `GET /api/keys/:backend` is a unifiable collision
// pair (has-before-:backend must hold); both live in this cluster and register in
// source order, so first-match routing is preserved (see routeTable.test.ts).

import type { Router } from '../httpKit.js';
import type { ServerCtx } from './context.js';
import { json, error, param, query, getClientIp } from '../httpKit.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import * as rateLimiter from '../security/rateLimiter.js';
import { getConfig } from '../runtimeConfig.js';
import {
  hasApiKey, storeApiKey, deleteApiKey, deleteAllApiKeys,
  getStoredApiKeys, addApiKey, removeApiKey, type AIBackend,
} from '../config.js';

// ── Multi-key management (t/835) ──
// Per-backend key lists with masked display. Under the /api/keys prefix, so the
// anon AI-route guard already blocks unauthenticated callers. Keys are never
// returned in full — only a masked suffix.
function maskApiKey(key: string): string {
  const visible = getConfig().server.apiKeyMaskLength; // t/929: runtime-configurable (default 4)
  return key.length <= visible ? '••••' : `••••${key.slice(-visible)}`;
}
function maskedKeyList(keys: string[]): { index: number; masked: string }[] {
  return keys.map((k, index) => ({ index, masked: maskApiKey(k) }));
}

/** Validate one raw key against its provider's auth-gated endpoint.
 *  Shared by POST /api/keys/validate and /api/keys/verify-stored (t/1363) so both
 *  probe identically. Never logs or returns the raw key — only a valid/error
 *  verdict; a provider-unreachable error is a result, not a swallowed failure,
 *  but is still recorded (warn) for network diagnostics. */
// Per-backend key-validation probes: each hits an endpoint that returns 401/403
// on a bad key. For most providers that's the lightweight auth-gated model-list
// endpoint. Gemini is the exception (t/1572): its /v1beta/models list is
// effectively unauthenticated (200 for any key → false-green), so it probes
// generateContent — the real auth surface — with a 1-token body instead.
// Data-driven (not an if/else chain) so it's the single source of truth the
// t/1574: probe configs are the shared single source of truth; this file builds
// the fetch-based probe map from them. The keysValidation test checks both
// KEY_PROBE_CONFIGS (shared) and KEY_VALIDATION_PROBES (local) for completeness.
import { KEY_PROBE_CONFIGS } from '../../shared/keyProbes.js';

type KeyProbe = (key: string) => Promise<Response>;
export const KEY_VALIDATION_PROBES: Record<string, KeyProbe> = Object.fromEntries(
  Object.entries(KEY_PROBE_CONFIGS).map(([id, cfg]) => [id, (key: string) =>
    fetch(cfg.url(key), {
      method: cfg.method ?? 'GET',
      headers: cfg.headers(key),
      ...(cfg.body && { body: cfg.body() }),
    }),
  ]),
);

// Exported for unit testing (t/1572): lets the false-green scenario assert the
// full valid/invalid verdict against a mocked fetch without booting the server.
export async function validateProviderKey(backend: string, key: string): Promise<{ valid: boolean; error?: string }> {
  const probe = KEY_VALIDATION_PROBES[backend];
  if (!probe) return { valid: false, error: `Unsupported backend: ${backend}` };
  try {
    const resp = await probe(key);
    return resp.ok ? { valid: true } : { valid: false, error: 'Invalid API key' };
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'key-validation', level: 'warn',
      message: 'Key validation request failed',
      data: { backend },
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return { valid: false, error: 'Could not reach provider — check your network' };
  }
}

export function registerKeysRoutes(r: Router, _ctx: ServerCtx): void {
  const { get, post, del } = r;

  get('/api/keys/has', async (req, res) => {
    const backend = (query(req, 'backend') || 'gemini') as AIBackend;
    json(res, await hasApiKey(backend));
  });

  post('/api/keys', async (_req, res, body) => {
    const { key, backend } = body as { key: string; backend?: string };
    const target = (backend || 'gemini') as AIBackend;
    try {
      await storeApiKey(key, target);
      json(res, { ok: true });
    } catch (err) {
      // Never log the key material itself — only the backend it was destined for.
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'key-store', level: 'error',
        message: 'Failed to store API key',
        data: { backend: target },
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, String(err), 500, err);
    }
  });

  post('/api/keys/validate', async (req, res, body) => {
    const { key, backend } = (body ?? {}) as { key?: string; backend?: string };
    if (!key || !backend) { error(res, 'key and backend are required', 400); return; }

    const rateCheck = rateLimiter.checkRate(`key-validate:${getClientIp(req)}`, 5, 60_000);
    if (!rateCheck.allowed) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ valid: false, error: 'Rate limit exceeded — try again shortly' }));
      return;
    }

    json(res, await validateProviderKey(backend, key));
  });

  // t/1363: validate the current user's STORED keys for a backend against their
  // providers, returning per-key masked verdicts — the server half of the Settings
  // "Verify" button (client committed in e376c03e, parent t/1349). Raw keys never
  // leave the server: only masked suffixes appear in the response.
  post('/api/keys/verify-stored', async (req, res, body) => {
    const { backend } = (body ?? {}) as { backend?: string };
    if (!backend) { error(res, 'backend is required', 400); return; }

    const rateCheck = rateLimiter.checkRate(`key-verify-stored:${getClientIp(req)}`, 5, 60_000);
    if (!rateCheck.allowed) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rate limit exceeded — try again shortly' }));
      return;
    }

    try {
      const keys = await getStoredApiKeys(backend as AIBackend);
      const results = await Promise.all(keys.map(async (key, index) => {
        const verdict = await validateProviderKey(backend, key);
        return { index, masked: maskApiKey(key), valid: verdict.valid, ...(verdict.error ? { error: verdict.error } : {}) };
      }));
      json(res, { results });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'key-verify-stored', level: 'error',
        message: 'Stored key verification failed',
        data: { backend },
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, String(err), 500, err);
    }
  });

  // Delete the current user's stored key for one backend / all backends. Mirrors
  // the web bridge contract. Anon-blocked by the /api/keys AI-route guard.
  post('/api/keys/delete', async (_req, res, body) => {
    try {
      const { backend } = body as { backend?: string };
      await deleteApiKey((backend || 'gemini') as AIBackend);
      json(res, { ok: true });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'server', level: 'error',
        message: 'Failed to delete API key',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, String(err), 500, err);
    }
  });

  post('/api/keys/delete-all', async (_req, res) => {
    try {
      await deleteAllApiKeys();
      json(res, { ok: true });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'server', level: 'error',
        message: 'Failed to delete all API keys',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, String(err), 500, err);
    }
  });

  get('/api/keys/:backend', async (req, res) => {
    try {
      const backend = param(req, 'backend', '/api/keys/:backend') as AIBackend;
      json(res, { backend, keys: maskedKeyList(await getStoredApiKeys(backend)) });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'server', level: 'error',
        message: 'Failed to list API keys',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, String(err), 500, err);
    }
  });

  post('/api/keys/:backend/add', async (req, res, body) => {
    try {
      const backend = param(req, 'backend', '/api/keys/:backend/add') as AIBackend;
      const { key } = (body ?? {}) as { key?: string };
      if (!key || !key.trim()) { error(res, 'key is required', 400); return; }
      json(res, { backend, keys: maskedKeyList(await addApiKey(key, backend)) });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'server', level: 'error',
        message: 'Failed to add API key',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, String(err), 500, err);
    }
  });

  del('/api/keys/:backend/:index', async (req, res) => {
    try {
      const backend = param(req, 'backend', '/api/keys/:backend/:index') as AIBackend;
      const index = parseInt(param(req, 'index', '/api/keys/:backend/:index'), 10);
      if (Number.isNaN(index)) { error(res, 'index must be a number', 400); return; }
      json(res, { backend, keys: maskedKeyList(await removeApiKey(index, backend)) });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'server', level: 'error',
        message: 'Failed to remove API key',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, String(err), 500, err);
    }
  });
}
