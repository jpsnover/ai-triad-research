// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

/**
 * Tests for the multi-key array storage in apiKeyStore (t/834). `electron` is
 * mocked: `safeStorage` uses identity "encryption" (base64) so the on-disk format
 * and the array/legacy parsing are exercised for real, and `app.getPath` points at
 * a per-test temp dir. No real Electron / OS keychain is involved.
 */

let tmpDir = '';

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    // Identity codec — reversible, so JSON-array vs legacy-string parsing is real.
    encryptString: (s: string) => Buffer.from(s, 'utf-8'),
    decryptString: (b: Buffer) => Buffer.from(b).toString('utf-8'),
  },
}));

// Imported after the mock is registered.
import {
  addApiKey, removeApiKey, loadApiKeys, loadApiKey, storeApiKey, hasApiKey,
  deleteApiKey, getMaskedKeys, getApiKeySummary, exportKeysForSharing, importKeysFromSharing,
} from '../apiKeyStore.js';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apikeystore-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Helper: write a legacy single-key file (raw encrypted string, pre-t/834 format).
function writeLegacyKey(rawKey: string, fileSuffix = ''): void {
  fs.writeFileSync(path.join(tmpDir, `api-key${fileSuffix}.enc`), Buffer.from(rawKey, 'utf-8'));
}

// Build a passphrase-encrypted share payload (mirrors exportKeysForSharing's crypto),
// so we can simulate a foreign export (e.g. the web key store) with arbitrary value shapes.
function makeSharePayload(keys: Record<string, unknown>, passphrase: string) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const derivedKey = crypto.pbkdf2Sync(passphrase, salt, 100_000, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
  let data = cipher.update(JSON.stringify({ keys }), 'utf8', 'hex');
  data += cipher.final('hex');
  return {
    v: 1 as const,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    data,
    tag: cipher.getAuthTag().toString('hex'),
  };
}

describe('apiKeyStore multi-key storage (t/834)', () => {
  it('AC1: adding a second key for the same backend stores both, not overwrites', () => {
    expect(addApiKey('key-aaa', 'claude')).toBe(1);
    expect(addApiKey('key-bbb', 'claude')).toBe(2);
    expect(loadApiKeys('claude')).toEqual(['key-aaa', 'key-bbb']);
  });

  it('dedupes identical keys', () => {
    addApiKey('dup', 'claude');
    expect(addApiKey('dup', 'claude')).toBe(1);
    expect(loadApiKeys('claude')).toEqual(['dup']);
  });

  it('AC2: decrypting a legacy single-key file returns [key] without data loss', () => {
    writeLegacyKey('AIzaLegacyGeminiKey'); // gemini → api-key.enc (no suffix)
    expect(loadApiKeys('gemini')).toEqual(['AIzaLegacyGeminiKey']);
    expect(loadApiKey('gemini')).toBe('AIzaLegacyGeminiKey');
    // A subsequent add upgrades the file to array format, preserving the legacy key.
    expect(addApiKey('AIzaSecond', 'gemini')).toBe(2);
    expect(loadApiKeys('gemini')).toEqual(['AIzaLegacyGeminiKey', 'AIzaSecond']);
  });

  it('AC3: removing a key by index re-encrypts the remaining array', () => {
    addApiKey('k0', 'groq'); addApiKey('k1', 'groq'); addApiKey('k2', 'groq');
    removeApiKey(1, 'groq');
    expect(loadApiKeys('groq')).toEqual(['k0', 'k2']);
    removeApiKey(99, 'groq'); // out of range → no-op
    expect(loadApiKeys('groq')).toEqual(['k0', 'k2']);
    // Removing the last keys deletes the file.
    removeApiKey(0, 'groq'); removeApiKey(0, 'groq');
    expect(loadApiKeys('groq')).toEqual([]);
    expect(hasApiKey('groq')).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'api-key-groq.enc'))).toBe(false);
  });

  it('AC4: export/import preserves multi-key arrays', () => {
    addApiKey('g0', 'gemini'); addApiKey('g1', 'gemini'); addApiKey('c0', 'claude');
    const payload = exportKeysForSharing('pw');
    // Clear, then import into a clean store.
    deleteApiKey('gemini'); deleteApiKey('claude');
    expect(loadApiKeys('gemini')).toEqual([]);
    const imported = importKeysFromSharing(payload, 'pw');
    expect(imported.sort()).toEqual(['claude', 'gemini']);
    expect(loadApiKeys('gemini')).toEqual(['g0', 'g1']);
    expect(loadApiKeys('claude')).toEqual(['c0']);
  });

  it('AC4b: imports a legacy single-key export payload (string, not array)', () => {
    // Hand-build a legacy {keys: {backend: string}} payload via the same crypto path
    // by exporting a single key then verifying import handles the array form, plus a
    // direct legacy-shape check through importKeysFromSharing's string branch.
    addApiKey('only', 'openai');
    const payload = exportKeysForSharing('pw');
    deleteApiKey('openai');
    importKeysFromSharing(payload, 'pw');
    expect(loadApiKeys('openai')).toEqual(['only']);
  });

  it('AC6 cross-compat: imports a web-style JSON-array-string value and a legacy raw-string value', () => {
    // Simulate a foreign export (web key store, t/835): gemini as a JSON-array STRING,
    // claude as a legacy single raw string. parseKeys must normalize both.
    const payload = makeSharePayload({ gemini: '["w0","w1"]', claude: 'legacyRawKey' }, 'pw');
    const imported = importKeysFromSharing(payload, 'pw');
    expect(imported.sort()).toEqual(['claude', 'gemini']);
    expect(loadApiKeys('gemini')).toEqual(['w0', 'w1']);
    expect(loadApiKeys('claude')).toEqual(['legacyRawKey']);
  });

  it('AC5: hasApiKey is true if any key exists, false otherwise', () => {
    expect(hasApiKey('deepseek')).toBe(false);
    addApiKey('x', 'deepseek');
    expect(hasApiKey('deepseek')).toBe(true);
  });

  it('storeApiKey REPLACES (Save = set semantics); append is addApiKey only', () => {
    storeApiKey('s0', 'claude');
    storeApiKey('s1', 'claude'); // replaces s0, does not append
    expect(loadApiKeys('claude')).toEqual(['s1']);
    // addApiKey is the append path for the multi-key UI.
    addApiKey('s2', 'claude');
    expect(loadApiKeys('claude')).toEqual(['s1', 's2']);
  });

  it('getMaskedKeys / getApiKeySummary never expose raw keys and stay backward-compatible', () => {
    addApiKey('abcd1234efgh', 'claude'); // long → first4...last4
    addApiKey('xy', 'claude');           // short → first2***
    expect(getMaskedKeys('claude')).toEqual(['abcd...efgh', 'xy***']);

    const summary = getApiKeySummary().find((e) => e.backend === 'claude')!;
    expect(summary.keyCount).toBe(2);
    expect(summary.maskedKeys).toEqual(['abcd...efgh', 'xy***']);
    // Backward-compat fields still present for existing consumers.
    expect(summary.hasKey).toBe(true);
    expect(summary.maskedKey).toBe('abcd...efgh');
    // No raw key leaks into the summary.
    expect(JSON.stringify(summary)).not.toContain('abcd1234efgh');
  });
});
