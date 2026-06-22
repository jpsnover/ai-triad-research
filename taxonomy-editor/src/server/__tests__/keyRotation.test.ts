// @vitest-environment node

/**
 * t/809 — key-material rotation for the local encrypted file store.
 * Exercises LocalFileKeyStore.rotateKeyMaterial() directly (config.getApiKey has
 * an env-var fallback that would mask the on-disk behavior).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getKeyStore } from '../keyStore.js';

let dataRoot: string;
const store = () => getKeyStore(() => dataRoot);
const U = 'alice';
const materialPath = () => path.join(dataRoot, '.aitriad-key-material');
const encPath = (b: string) => path.join(dataRoot, `.aitriad-key-${b}.enc`);

describe('key material rotation (t/809)', () => {
  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'keyrot-'));
  });
  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it('re-encrypts all stored keys and changes the material + ciphertext', async () => {
    await store().set('gemini', U, 'k-gemini');
    await store().set('claude', U, 'k-claude');

    const materialBefore = fs.readFileSync(materialPath());
    const geminiBefore = fs.readFileSync(encPath('gemini'));

    const result = await store().rotateKeyMaterial();

    expect(result.store).toBe('local');
    expect(result.rotated).toBe(2);
    expect(result.backends.sort()).toEqual(['claude', 'gemini']);

    // Material and on-disk ciphertext both changed...
    expect(fs.readFileSync(materialPath()).equals(materialBefore)).toBe(false);
    expect(fs.readFileSync(encPath('gemini')).equals(geminiBefore)).toBe(false);

    // ...but the plaintext keys still decrypt under the new material.
    expect(await store().get('gemini', U)).toBe('k-gemini');
    expect(await store().get('claude', U)).toBe('k-claude');
  });

  it('seeds material and reports rotated:0 when no keys are stored', async () => {
    const result = await store().rotateKeyMaterial();
    expect(result.rotated).toBe(0);
    expect(result.backends).toEqual([]);
    expect(fs.existsSync(materialPath())).toBe(true);
  });

  it('leaves no temp artifacts behind', async () => {
    await store().set('gemini', U, 'k-gemini');
    await store().rotateKeyMaterial();
    const leftovers = fs.readdirSync(dataRoot).filter(f => f.includes('.rot-') || f.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });
});
