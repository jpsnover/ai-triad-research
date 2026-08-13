// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

/**
 * Tests for single-key storage in apiKeyStore (t/1425, reversing the t/834
 * round-robin). `electron` is mocked: `safeStorage` uses identity "encryption"
 * (utf-8 passthrough) so the on-disk array/legacy parsing is exercised for real,
 * and `app.getPath` points at a per-test temp dir. No real Electron / OS keychain.
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
  removeApiKey, loadApiKeys, loadApiKey, storeApiKey, hasApiKey, migrateToSingleKey,
  deleteApiKey, deleteAllApiKeys, getMaskedKeys, getApiKeySummary, exportKeysForSharing, importKeysFromSharing,
} from '../apiKeyStore.js';
import type { ApiKeyBackend } from '../../../../lib/ai-client/types.js';
import { setGlobalRecorder } from '../../../../lib/flight-recorder/index.js';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apikeystore-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  setGlobalRecorder(null as never);
});

// Legacy single-key file (raw encrypted string, pre-t/834 format).
function writeLegacyKey(rawKey: string, fileSuffix = ''): void {
  fs.writeFileSync(path.join(tmpDir, `api-key${fileSuffix}.enc`), Buffer.from(rawKey, 'utf-8'));
}

// Simulate a pre-t/1425 multi-key file on disk (encrypted JSON array). The public
// API can no longer create this — migrateToSingleKey() exists precisely to fix it.
function writeMultiKeyFile(backend: string, keys: string[]): void {
  const suffix = backend === 'gemini' ? '' : `-${backend}`;
  fs.writeFileSync(path.join(tmpDir, `api-key${suffix}.enc`), Buffer.from(JSON.stringify(keys), 'utf-8'));
}

// Build a passphrase-encrypted share payload (mirrors exportKeysForSharing's crypto),
// so we can simulate a foreign export (e.g. the web key store) with arbitrary shapes.
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

describe('apiKeyStore single-key storage (t/1425)', () => {
  it('AC1: storeApiKey REPLACES — a second store never yields two keys', () => {
    storeApiKey('key-aaa', 'claude');
    storeApiKey('key-bbb', 'claude'); // replaces, does not append
    expect(loadApiKeys('claude')).toEqual(['key-bbb']);
  });

  it('reads a legacy single-key file as [key] without data loss', () => {
    writeLegacyKey('AIzaLegacyGeminiKey'); // gemini → api-key.enc (no suffix)
    expect(loadApiKeys('gemini')).toEqual(['AIzaLegacyGeminiKey']);
    expect(loadApiKey('gemini')).toBe('AIzaLegacyGeminiKey');
  });

  it('removeApiKey removes the single key and deletes the file', () => {
    storeApiKey('k0', 'groq');
    removeApiKey(0, 'groq');
    expect(loadApiKeys('groq')).toEqual([]);
    expect(hasApiKey('groq')).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'api-key-groq.enc'))).toBe(false);
    removeApiKey(0, 'groq'); // out of range now → no-op
    expect(loadApiKeys('groq')).toEqual([]);
  });

  it('export/import round-trips the single key per backend', () => {
    storeApiKey('g0', 'gemini');
    storeApiKey('c0', 'claude');
    const payload = exportKeysForSharing('pw');
    deleteApiKey('gemini'); deleteApiKey('claude');
    const imported = importKeysFromSharing(payload, 'pw');
    expect(imported.sort()).toEqual(['claude', 'gemini']);
    expect(loadApiKeys('gemini')).toEqual(['g0']);
    expect(loadApiKeys('claude')).toEqual(['c0']);
  });

  it('import takes only the FIRST key when a payload carries several (old multi-key / web array-string)', () => {
    // gemini as a JSON-array STRING with 2 keys, claude as a legacy single raw string.
    const payload = makeSharePayload({ gemini: '["w0","w1"]', claude: 'legacyRawKey' }, 'pw');
    const imported = importKeysFromSharing(payload, 'pw');
    expect(imported.sort()).toEqual(['claude', 'gemini']);
    expect(loadApiKeys('gemini')).toEqual(['w0']);        // only the first, not w1
    expect(loadApiKeys('claude')).toEqual(['legacyRawKey']);
  });

  it('hasApiKey reflects presence', () => {
    expect(hasApiKey('deepseek')).toBe(false);
    storeApiKey('x', 'deepseek');
    expect(hasApiKey('deepseek')).toBe(true);
  });

  it('getMaskedKeys / getApiKeySummary never expose raw keys and stay backward-compatible', () => {
    storeApiKey('abcd1234efgh', 'claude'); // long → first4...last4
    expect(getMaskedKeys('claude')).toEqual(['abcd...efgh']);

    const summary = getApiKeySummary().find((e) => e.backend === 'claude')!;
    expect(summary.keyCount).toBe(1);
    expect(summary.maskedKeys).toEqual(['abcd...efgh']);
    // Backward-compat fields still present for existing consumers.
    expect(summary.hasKey).toBe(true);
    expect(summary.maskedKey).toBe('abcd...efgh');
    // No raw key leaks into the summary.
    expect(JSON.stringify(summary)).not.toContain('abcd1234efgh');
  });

  describe('migrateToSingleKey (t/1425)', () => {
    it('truncates a multi-key backend to its first key and records an event with NO key material', () => {
      const events: Array<Record<string, unknown>> = [];
      setGlobalRecorder({ record: (e: Record<string, unknown>) => { events.push(e); } } as never);

      writeMultiKeyFile('gemini', ['first-key', 'second-key', 'third-key']);
      expect(loadApiKeys('gemini')).toHaveLength(3); // precondition: a legacy multi-key file

      const truncated = migrateToSingleKey();

      expect(truncated).toBe(1);
      expect(loadApiKeys('gemini')).toEqual(['first-key']); // oldest-registered wins
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        component: 'api-key-store',
        level: 'info',
        data: { backend: 'gemini', from: 3, to: 1 },
      });
      // No key material anywhere in the recorded event.
      const serialized = JSON.stringify(events[0]);
      expect(serialized).not.toContain('first-key');
      expect(serialized).not.toContain('second-key');
    });

    it('is a no-op for single-key and empty backends (returns 0, records nothing)', () => {
      const events: Array<Record<string, unknown>> = [];
      setGlobalRecorder({ record: (e: Record<string, unknown>) => { events.push(e); } } as never);

      storeApiKey('solo', 'claude'); // single key; groq/others have none
      expect(migrateToSingleKey()).toBe(0);
      expect(loadApiKeys('claude')).toEqual(['solo']);
      expect(events).toHaveLength(0);
    });
  });
});

describe('full-backend coverage (t/1957 — zai/moonshot were silently omitted)', () => {
  // Exhaustive BY CONSTRUCTION: Record<ApiKeyBackend, string> fails to compile if a backend
  // is added to the union but omitted here — so this regression can never silently skip a
  // backend the way the old hand-maintained ALL_BACKENDS did (it dropped zai and moonshot,
  // so deleteAllApiKeys left those keys on disk).
  const FAKE_KEYS: Record<ApiKeyBackend, string> = {
    gemini: 'k-gemini', claude: 'k-claude', groq: 'k-groq', openai: 'k-openai', azure: 'k-azure',
    ollama: 'k-ollama', deepseek: 'k-deepseek', zai: 'k-zai', moonshot: 'k-moonshot', xai: 'k-xai', tavily: 'k-tavily',
  };
  const ALL = Object.keys(FAKE_KEYS) as ApiKeyBackend[];

  it('AC: deleteAllApiKeys removes a key stored for EVERY backend — nothing left on disk', () => {
    for (const backend of ALL) storeApiKey(FAKE_KEYS[backend], backend);
    for (const backend of ALL) expect(hasApiKey(backend)).toBe(true); // precondition: all set

    deleteAllApiKeys();

    for (const backend of ALL) {
      expect(hasApiKey(backend)).toBe(false);
      expect(loadApiKeys(backend)).toEqual([]);
    }
    // No api-key*.enc file survives anywhere in the store dir.
    const remaining = fs.readdirSync(tmpDir).filter((f) => f.startsWith('api-key') && f.endsWith('.enc'));
    expect(remaining).toEqual([]);
  });

  it('regression: the specific zai + moonshot keys are deleted (were left behind pre-t/1957)', () => {
    storeApiKey('zzz', 'zai');
    storeApiKey('mmm', 'moonshot');
    deleteAllApiKeys();
    expect(hasApiKey('zai')).toBe(false);
    expect(hasApiKey('moonshot')).toBe(false);
  });

  it('getApiKeySummary lists every backend, including zai and moonshot', () => {
    const backends = getApiKeySummary().map((e) => e.backend);
    for (const backend of ALL) expect(backends).toContain(backend);
    expect(backends).toHaveLength(ALL.length);
  });

  it('exportKeysForSharing includes zai and moonshot keys', () => {
    storeApiKey('zzz', 'zai');
    storeApiKey('mmm', 'moonshot');
    const payload = exportKeysForSharing('pw');
    deleteAllApiKeys(); // wipe, then decrypt-via-import to inspect the payload contents
    expect(importKeysFromSharing(payload, 'pw').sort()).toEqual(['moonshot', 'zai']);
    expect(loadApiKeys('zai')).toEqual(['zzz']);
    expect(loadApiKeys('moonshot')).toEqual(['mmm']);
  });

  it('migrateToSingleKey truncates a zai multi-key file (was skipped pre-t/1957)', () => {
    writeMultiKeyFile('zai', ['z0', 'z1']);
    expect(migrateToSingleKey()).toBe(1);
    expect(loadApiKeys('zai')).toEqual(['z0']);
  });
});
