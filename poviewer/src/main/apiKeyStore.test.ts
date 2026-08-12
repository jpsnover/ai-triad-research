// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression tests for t/2534 (M3): the plaintext-on-disk fallback is gone.
// storeApiKey refuses when safeStorage is unavailable (mirroring
// summary-viewer), a legacy plaintext file is migrated to encrypted storage
// exactly once, and the refuse case explains next steps.
// All key material below is placeholder test data.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const state = vi.hoisted(() => ({ encryptionAvailable: true, home: '' }));

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => state.encryptionAvailable,
    encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf-8'),
    decryptString: (b: Buffer) => b.toString('utf-8').replace(/^enc:/, ''),
  },
}));

// Isolate ~/.poviewer to a temp dir — these tests create and DELETE key files.
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  const homedir = () => state.home;
  return { ...actual, homedir, default: { ...(actual as object), homedir } };
});

state.home = fs.mkdtempSync(path.join(process.env.TEMP ?? process.env.TMPDIR ?? '/tmp', 'poviewer-t2534-home-'));

// Loaded in beforeAll (not top-level await — tsconfig.main.json compiles tests
// as CommonJS) so the homedir mock state above is set before module load.
let store: typeof import('./apiKeyStore.js');
beforeAll(async () => {
  store = await import('./apiKeyStore.js');
});

const CONFIG_DIR = path.join(state.home, '.poviewer');
const ENC_PATH = path.join(CONFIG_DIR, 'apikey.enc');
const PLAIN_PATH = path.join(CONFIG_DIR, 'apikey.txt');

beforeEach(() => {
  state.encryptionAvailable = true;
  fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
});

describe('t/2534 M3: storeApiKey', () => {
  it('stores encrypted when safeStorage is available (no plaintext file)', () => {
    store.storeApiKey('placeholder-value-1');
    expect(fs.existsSync(ENC_PATH)).toBe(true);
    expect(fs.existsSync(PLAIN_PATH)).toBe(false);
    // The .enc file holds safeStorage.encryptString output (mocked here as a
    // tagged buffer), proving the encrypt path was taken — not the plain write.
    expect(fs.readFileSync(ENC_PATH, 'utf-8').startsWith('enc:')).toBe(true);
    expect(store.getApiKey()).toBe('placeholder-value-1');
    expect(store.hasApiKey()).toBe(true);
  });

  it('refuses (ActionableError) instead of writing plaintext when safeStorage is unavailable', () => {
    state.encryptionAvailable = false;
    let thrown: unknown;
    try {
      store.storeApiKey('placeholder-value-2');
    } catch (err) {
      /* telemetry — silent by design (test captures the expected throw) */
      thrown = err;
    }
    expect(thrown).toBeDefined();
    expect((thrown as Error).name).toBe('ActionableError');
    expect((thrown as Error).message).toContain('Encryption is not available on this system');
    // Critically: nothing was written to disk in plaintext.
    expect(fs.existsSync(PLAIN_PATH)).toBe(false);
    expect(fs.existsSync(ENC_PATH)).toBe(false);
  });
});

describe('t/2534 M3: legacy plaintext migration', () => {
  it('migrates an existing plaintext file to encrypted storage once, then deletes it', () => {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(PLAIN_PATH, 'legacy-placeholder\n', 'utf-8');

    expect(store.getApiKey()).toBe('legacy-placeholder');
    expect(fs.existsSync(ENC_PATH)).toBe(true);
    expect(fs.existsSync(PLAIN_PATH)).toBe(false);
  });

  it('never overwrites an existing encrypted key with a stale plaintext file', () => {
    store.storeApiKey('newer-placeholder');
    fs.writeFileSync(PLAIN_PATH, 'older-placeholder', 'utf-8');

    expect(store.getApiKey()).toBe('newer-placeholder');
    expect(fs.existsSync(PLAIN_PATH)).toBe(false);
  });

  it('EEXIST on the migration write leaves the existing encrypted key untouched and still removes the plaintext file', () => {
    // Same invariant as above but asserting the on-disk encrypted bytes are
    // byte-identical after migration (the 'wx' write must not have replaced them).
    store.storeApiKey('kept-placeholder');
    const encryptedBefore = fs.readFileSync(ENC_PATH);
    fs.writeFileSync(PLAIN_PATH, 'stale-placeholder', 'utf-8');

    expect(store.getApiKey()).toBe('kept-placeholder');
    expect(fs.readFileSync(ENC_PATH).equals(encryptedBefore)).toBe(true);
    expect(fs.existsSync(PLAIN_PATH)).toBe(false);
  });

  it('deletes an empty legacy plaintext file without creating an encrypted key', () => {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(PLAIN_PATH, '   \n', 'utf-8');

    expect(store.getApiKey()).toBe(null);
    expect(fs.existsSync(ENC_PATH)).toBe(false);
    expect(fs.existsSync(PLAIN_PATH)).toBe(false);
  });

  it('refuses with next steps when a plaintext file exists but safeStorage is unavailable', () => {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(PLAIN_PATH, 'stranded-placeholder', 'utf-8');
    state.encryptionAvailable = false;

    let thrown: unknown;
    try {
      store.getApiKey();
    } catch (err) {
      /* telemetry — silent by design (test captures the expected throw) */
      thrown = err;
    }
    expect(thrown).toBeDefined();
    expect((thrown as Error).name).toBe('ActionableError');
    expect((thrown as Error).message).toContain('safeStorage');
    expect((thrown as { nextSteps?: string[] }).nextSteps?.length).toBeGreaterThan(0);
    // The plaintext file is left in place (user action required), never served.
    expect(fs.existsSync(PLAIN_PATH)).toBe(true);
    expect(store.hasApiKey()).toBe(false);
  });
});

describe('t/2534 M3: getApiKey base cases', () => {
  it('returns null when no key is stored (safeStorage available) — ENOENT handled cleanly, no config dir needed', () => {
    // CONFIG_DIR itself does not exist here (beforeEach removed it): every
    // EAFP read/unlink path must treat ENOENT as "absent", not throw.
    expect(fs.existsSync(CONFIG_DIR)).toBe(false);
    expect(store.getApiKey()).toBe(null);
    expect(store.hasApiKey()).toBe(false);
  });

  it('storeApiKey succeeds when no plaintext file exists (unlink ENOENT tolerated)', () => {
    store.storeApiKey('placeholder-value-3');
    expect(store.getApiKey()).toBe('placeholder-value-3');
  });

  it('returns null when no key is stored (safeStorage unavailable)', () => {
    state.encryptionAvailable = false;
    expect(store.getApiKey()).toBe(null);
    expect(store.hasApiKey()).toBe(false);
  });
});
