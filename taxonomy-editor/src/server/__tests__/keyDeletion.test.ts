// @vitest-environment node

/**
 * API key deletion — backs POST /api/keys/delete and /api/keys/delete-all.
 * Tests KeyStore.delete on the local file store directly (config.getApiKey has an
 * env-var fallback that would mask file-level deletion), plus config.deleteAllApiKeys
 * verified through the store.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getKeyStore } from '../security/keyStore.js';
import { deleteAllApiKeys } from '../config.js';
import * as userContext from '../security/userContext.js';

let dataRoot: string;
const store = () => getKeyStore(() => dataRoot);
const U = 'alice';
const ctx = { principalName: U, idp: 'github', storageUserId: U, isAnonymous: false };

describe('API key deletion', () => {
  beforeAll(() => {
    process.env.AI_TRIAD_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'keydel-'));
    dataRoot = process.env.AI_TRIAD_DATA_ROOT;
  });
  afterAll(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
    delete process.env.AI_TRIAD_DATA_ROOT;
  });

  it('KeyStore.delete removes a single backend key', async () => {
    await store().set('gemini', U, 'k-gemini');
    expect(await store().get('gemini', U)).toBe('k-gemini');
    await store().delete('gemini', U);
    expect(await store().get('gemini', U)).toBeNull();
  });

  it('delete is idempotent when no key exists', async () => {
    await expect(store().delete('groq', U)).resolves.toBeUndefined();
    expect(await store().get('groq', U)).toBeNull();
  });

  it('config.deleteAllApiKeys clears every configured backend', async () => {
    await store().set('gemini', U, 'k1');
    await store().set('groq', U, 'k2');
    expect(await store().get('gemini', U)).toBe('k1');
    expect(await store().get('groq', U)).toBe('k2');

    await userContext.runWithUser(ctx, () => deleteAllApiKeys());

    expect(await store().get('gemini', U)).toBeNull();
    expect(await store().get('groq', U)).toBeNull();
  });

  // Drift tripwire (t/1954): ALL_AI_BACKENDS was a hand-maintained literal that
  // excluded these three BYOK backends, so delete-all silently left their keys
  // behind. Deriving it from ENV_KEY_NAMES fixes that; this asserts the behavior
  // so a future revert to a literal goes red.
  it('deleteAllApiKeys clears the previously-drifted backends (moonshot, azure, zai)', async () => {
    const u2 = 'carol';
    const ctx2 = { principalName: u2, idp: 'github', storageUserId: u2, isAnonymous: false };
    await store().set('moonshot', u2, 'k-moon');
    await store().set('azure', u2, 'k-azure');
    await store().set('zai', u2, 'k-zai');

    await userContext.runWithUser(ctx2, () => deleteAllApiKeys());

    expect(await store().get('moonshot', u2)).toBeNull();
    expect(await store().get('azure', u2)).toBeNull();
    expect(await store().get('zai', u2)).toBeNull();
  });
});
