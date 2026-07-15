// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1573: single source of truth for Electron-side API-key probing, shared by the
// validate-api-key and verify-stored-keys IPC handlers. Extracting it stops the drift
// that caused the bug (the two handlers had inline copies that fell out of sync).
//
// Uses `net.fetch` (Electron's own network stack — correct proxy/certificate handling),
// which is why this can't be shared with the server's global-`fetch` probe in
// server/routes/keys.ts. The BACKEND SET here matches that file's KEY_VALIDATION_PROBES.
//
// Gemini uses generateContent, NOT the list-models endpoint: `GET /models?key=...`
// returns 200 for keys that can't actually generate, so it reports a false-green for
// invalid keys (parent t/1571). A minimal generateContent POST is the real auth check.

import { net } from 'electron';

/** Backends we can probe — kept in sync with KEY_VALIDATION_PROBES (server/routes/keys.ts). */
export const SUPPORTED_PROBE_BACKENDS = ['gemini', 'claude', 'groq', 'openai', 'deepseek', 'zai'] as const;

export function isSupportedProbeBackend(backend: string): boolean {
  return (SUPPORTED_PROBE_BACKENDS as readonly string[]).includes(backend);
}

/**
 * Probe whether `key` authenticates against `backend`'s provider. Returns true only on a
 * 2xx from a real auth-gated endpoint. Throws for an unsupported backend — callers should
 * gate with isSupportedProbeBackend() first to surface the right "Unsupported backend" error.
 */
export async function probeApiKey(backend: string, key: string): Promise<boolean> {
  switch (backend) {
    case 'gemini': {
      // generateContent (not list-models) — the list endpoint 200s for non-generating keys.
      const r = await net.fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }], generationConfig: { maxOutputTokens: 1 } }),
        },
      );
      return r.ok;
    }
    case 'claude':
      return (await net.fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      })).ok;
    case 'groq':
      return (await net.fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      })).ok;
    case 'openai':
      return (await net.fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      })).ok;
    case 'deepseek':
      return (await net.fetch('https://api.deepseek.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      })).ok;
    case 'zai':
      return (await net.fetch('https://api.z.ai/api/paas/v4/models', {
        headers: { Authorization: `Bearer ${key}` },
      })).ok;
    default:
      throw new Error(`Unsupported backend: ${backend}`);
  }
}
