// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';

type Backend = 'gemini' | 'claude' | 'groq' | 'openai' | 'deepseek' | 'tavily' | 'ollama';

const ALL_BACKENDS: Backend[] = ['gemini', 'claude', 'groq', 'openai', 'deepseek', 'tavily', 'ollama'];

function keyFilePath(backend?: Backend): string {
  const suffix = backend && backend !== 'gemini' ? `-${backend}` : '';
  return path.join(app.getPath('userData'), `api-key${suffix}.enc`);
}

// ── Multi-key storage (t/834) ──────────────────────────────────────────────
// Keys are stored per backend as an encrypted JSON array of strings (enables
// round-robin across keys to multiply rate-limit quota — see t/833). Legacy
// files written before t/834 hold a single encrypted raw key string; they are
// read transparently as `[key]` so existing single-key users lose no data.

/**
 * Load all stored keys for a backend (RAW). Main-process internal use only —
 * AI calls and the key rotator. Never expose the result to the renderer; use
 * getMaskedKeys()/getApiKeySummary() for anything that crosses the IPC boundary.
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
    /* not JSON — legacy single raw key, fall through to wrap */
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

/** Append a key for a backend (deduped) and return the new key count. */
export function addApiKey(key: string, backend?: Backend): number {
  const keys = loadApiKeys(backend);
  if (!keys.includes(key)) keys.push(key);
  saveApiKeys(backend, keys);
  return keys.length;
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
 * Preserves the existing "Save Key" button UX (Save = set this key). Use addApiKey()
 * to append additional keys for round-robin (the multi-key UI).
 */
export function storeApiKey(key: string, backend?: Backend): void {
  saveApiKeys(backend, [key]);
}

/** Backward-compat single-key read — returns the first key, or null. */
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
      /* not JSON — legacy single raw key */
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
  hasKey: boolean;            // backward compat (true if any key)
  maskedKey: string | null;  // backward compat — first key masked
  keyCount: number;
  maskedKeys: string[];
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
    for (const k of parseKeys(val)) addApiKey(k, backend as Backend);
    imported.push(backend);
  }
  return imported;
}
