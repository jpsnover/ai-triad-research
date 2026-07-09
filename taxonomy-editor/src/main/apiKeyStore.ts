// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';
import type { ApiKeyBackend } from '../../../lib/ai-client/types.js';
import { getGlobalRecorder } from '../../../lib/flight-recorder/index.js';

// Single source of truth for backend ids (lib/ai-client, t/958). Prevents the local
// drift that broke things when 'azure' was added to BackendId — this stays in sync
// automatically. ALL_BACKENDS below is still maintained by hand, but every code path
// typed as Backend follows BackendId without edits here.
type Backend = ApiKeyBackend;

const ALL_BACKENDS: Backend[] = ['gemini', 'claude', 'groq', 'openai', 'azure', 'deepseek', 'tavily', 'ollama'];

function keyFilePath(backend?: Backend): string {
  const suffix = backend && backend !== 'gemini' ? `-${backend}` : '';
  return path.join(app.getPath('userData'), `api-key${suffix}.enc`);
}

// ── Single-key storage (t/1425, reversing t/833/t/834 round-robin) ─────────
// Exactly ONE key per backend. Keys are stored as an encrypted JSON array of
// strings for on-disk compatibility with the previous multi-key format and the
// web key store's export shape, but every write path produces `[key]` — there is
// no code path that appends a second key. Existing multi-key files are truncated
// to their first key by migrateToSingleKey() at startup. Legacy files (pre-t/834)
// holding a single encrypted raw key string are read as `[key]`.

/**
 * Load all stored keys for a backend (RAW). Main-process internal use only — AI
 * calls. Never expose the result to the renderer; use getMaskedKeys()/
 * getApiKeySummary() for anything that crosses the IPC boundary. Returns at most
 * one key going forward; may return more only for a not-yet-migrated legacy file.
 */
export function loadApiKeys(backend?: Backend): string[] {
  const fp = keyFilePath(backend);
  if (!fs.existsSync(fp) || !safeStorage.isEncryptionAvailable()) return [];
  let decrypted: string;
  try {
    decrypted = safeStorage.decryptString(fs.readFileSync(fp));
  } catch {
    /* telemetry — silent by design (corrupt/unreadable key file) */
    return [];
  }
  try {
    const parsed = JSON.parse(decrypted);
    if (Array.isArray(parsed)) return parsed.filter((k): k is string => typeof k === 'string');
  } catch {
    /* telemetry — silent by design; not a JSON array = legacy single-key file, handled below (expected, not an error) */
  }
  // Backward compat: legacy file holds a single raw key string.
  return decrypted ? [decrypted] : [];
}

function saveApiKeys(backend: Backend | undefined, keys: string[]): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption not available on this system');
  }
  if (keys.length === 0) {
    fs.rmSync(keyFilePath(backend), { force: true });
    return;
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(keys));
  fs.writeFileSync(keyFilePath(backend), encrypted);
}

/** Remove a key by index (no-op if out of range), re-encrypting the remainder. */
export function removeApiKey(index: number, backend?: Backend): void {
  const keys = loadApiKeys(backend);
  if (index < 0 || index >= keys.length) return;
  keys.splice(index, 1);
  saveApiKeys(backend, keys);
}

/**
 * Store a key for a backend — REPLACE semantics: sets the backend's keys to `[key]`.
 * The ONLY write path (t/1425: exactly one key per backend, no round-robin append).
 */
export function storeApiKey(key: string, backend?: Backend): void {
  saveApiKeys(backend, [key]);
}

/**
 * One-time migration (t/1425): truncate any backend holding >1 key down to its
 * first (oldest-registered) key. Call once at app startup. Records an info-level
 * flight-recorder event per truncated backend — backend id + counts only, NEVER
 * key values — so a "disappeared" key is traceable. Returns the number of backends
 * truncated.
 */
export function migrateToSingleKey(): number {
  let truncated = 0;
  for (const backend of ALL_BACKENDS) {
    const keys = loadApiKeys(backend);
    if (keys.length > 1) {
      saveApiKeys(backend, [keys[0]]);
      truncated++;
      getGlobalRecorder()?.record({
        type: 'system.info',
        component: 'api-key-store',
        level: 'info',
        message: 'Truncated multi-key backend to single key (t/1425)',
        data: { backend, from: keys.length, to: 1 },
      });
    }
  }
  return truncated;
}

/** Backward-compat single-key read — returns the stored key, or null. */
export function loadApiKey(backend?: Backend): string | null {
  return loadApiKeys(backend)[0] ?? null;
}

export function hasApiKey(backend?: Backend): boolean {
  return loadApiKeys(backend).length > 0;
}

/** Delete ALL keys for a backend (no-op if absent). Omit backend for the default (gemini). */
export function deleteApiKey(backend?: Backend): void {
  fs.rmSync(keyFilePath(backend), { force: true });
}

/** Delete every stored API key across all backends. */
export function deleteAllApiKeys(): void {
  for (const backend of ALL_BACKENDS) {
    deleteApiKey(backend);
  }
}

/**
 * Normalize a key-share payload value into a string[]. Matches the web key store's
 * `parseKeys` convention (ServerAPI, t/835) so exports are interchangeable between
 * desktop and web: an actual array is used as-is; a string that is itself a JSON
 * array is parsed; any other string is treated as a single legacy key.
 */
function parseKeys(val: unknown): string[] {
  if (Array.isArray(val)) return val.filter((k): k is string => typeof k === 'string');
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed.filter((k): k is string => typeof k === 'string');
    } catch {
      /* telemetry — silent by design; not JSON = legacy single raw key, wrapped below (expected, not an error) */
    }
    return [val];
  }
  return [];
}

function maskKey(key: string): string {
  return key.length <= 8 ? `${key.slice(0, 2)}***` : `${key.slice(0, 4)}...${key.slice(-4)}`;
}

/** Masked keys for a single backend — safe to send to the renderer (never raw). */
export function getMaskedKeys(backend?: Backend): string[] {
  return loadApiKeys(backend).map(maskKey);
}

export interface ApiKeySummaryEntry {
  backend: Backend;
  hasKey: boolean;            // backward compat (true if a key is set)
  maskedKey: string | null;  // backward compat — the (single) key masked
  keyCount: number;          // 0 or 1 (t/1425 single-key); kept for renderer compat
  maskedKeys: string[];      // 0- or 1-element; kept for renderer compat
}

export function getApiKeySummary(): ApiKeySummaryEntry[] {
  return ALL_BACKENDS.map((backend) => {
    const maskedKeys = getMaskedKeys(backend);
    return {
      backend,
      hasKey: maskedKeys.length > 0,
      maskedKey: maskedKeys[0] ?? null,
      keyCount: maskedKeys.length,
      maskedKeys,
    };
  });
}

export interface KeySharePayload {
  v: 1;
  salt: string;
  iv: string;
  data: string;
  tag: string;
}

export function exportKeysForSharing(passphrase: string): KeySharePayload {
  const keys: Record<string, string[]> = {};
  for (const b of ALL_BACKENDS) {
    const arr = loadApiKeys(b);
    if (arr.length) keys[b] = arr;
  }
  if (Object.keys(keys).length === 0) {
    throw new Error('No API keys to export — save at least one key first');
  }

  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const derivedKey = crypto.pbkdf2Sync(passphrase, salt, 100_000, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);

  const plaintext = JSON.stringify({ keys });
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return { v: 1, salt: salt.toString('hex'), iv: iv.toString('hex'), data: encrypted, tag };
}

export function importKeysFromSharing(payload: KeySharePayload, passphrase: string): string[] {
  const salt = Buffer.from(payload.salt, 'hex');
  const iv = Buffer.from(payload.iv, 'hex');
  const derivedKey = crypto.pbkdf2Sync(passphrase, salt, 100_000, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
  decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));

  let decrypted = decipher.update(payload.data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  // Accept array, JSON-array-string (web key store convention), and legacy single-key.
  const { keys } = JSON.parse(decrypted) as { keys: Record<string, unknown> };
  const imported: string[] = [];
  for (const [backend, val] of Object.entries(keys)) {
    // Single-key (t/1425): import only the first key per backend, even if the
    // payload (possibly exported by an older multi-key build) carries several.
    const first = parseKeys(val)[0];
    if (first) {
      storeApiKey(first, backend as Backend);
      imported.push(backend);
    }
  }
  return imported;
}
