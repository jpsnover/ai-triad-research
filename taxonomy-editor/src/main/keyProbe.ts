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
import path from 'path';
import { PROJECT_ROOT } from './fileIO.js';
import { resolveModelEntry, resolveDebateTierModel } from './modelConfigCache.js';

/** Backends we can probe — kept in sync with KEY_VALIDATION_PROBES (server/routes/keys.ts). */
export const SUPPORTED_PROBE_BACKENDS = ['gemini', 'claude', 'groq', 'openai', 'deepseek', 'zai'] as const;

export function isSupportedProbeBackend(backend: string): boolean {
  return (SUPPORTED_PROBE_BACKENDS as readonly string[]).includes(backend);
}

// t/3556: hardcoding a specific Gemini model here caused a false "Invalid API key" the
// moment that model was retired from the provider (valid key, but the retired model
// resolves non-2xx, indistinguishable from a bad key). Resolved from ai-models.json's
// `debateTiers.basic.gemini` instead — the registry's own designated "current, cheap,
// fast" Gemini model — so a future retirement is a registry update, not a second
// hand-maintained literal to remember. Falls back to the last-known-good literal only if
// the registry can't be read at all (missing/corrupt file) — logged, not silent, per the
// root AGENTS.md fallback-path-logging rule; if a future retirement lands there it would
// reproduce this exact bug, but that's a strictly rarer failure than "file is unreadable."
function resolveGeminiProbeModel(): string {
  const configPath = path.join(PROJECT_ROOT, 'ai-models.json');
  const friendlyId = resolveDebateTierModel(configPath, 'basic', 'gemini');
  if (!friendlyId) {
    console.warn('[keyProbe] Could not resolve debateTiers.basic.gemini from ai-models.json — falling back to a hardcoded model id, which can drift the same way t/3556 did.');
    return 'gemini-2.5-flash-lite';
  }
  const entry = resolveModelEntry(configPath, friendlyId);
  return entry?.apiModelId ?? friendlyId;
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
      const model = resolveGeminiProbeModel();
      const r = await net.fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
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
