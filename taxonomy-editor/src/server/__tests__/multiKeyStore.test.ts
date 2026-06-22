// @vitest-environment node

/**
 * t/835 — multi-key array storage on the local key store, plus parseKeys.
 * Exercises the store directly (config.getApiKey has an env fallback that would
 * mask file state).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getKeyStore, parseKeys } from '../keyStore.js';

let dataRoot: string;
const store = () => getKeyStore(() => dataRoot);
const U = 'alice';

describe('parseKeys (t/835)', () => {
  it('handles null/blank as empty', () => {
    expect(parseKeys(null)).toEqual([]);
    expect(parseKeys('')).toEqual([]);
    expect(parseKeys('   ')).toEqual([]);
  });
  it('parses a JSON array, dropping blanks and trimming', () => {
    expect(parseKeys('["a","b"]')).toEqual(['a', 'b']);
    expect(parseKeys('[" a ","","b"]')).toEqual(['a', 'b']);
    expect(parseKeys('[]')).toEqual([]);
  });
  it('treats a non-array value as a single legacy key', () => {
    expect(parseKeys('legacy-key')).toEqual(['legacy-key']);
    expect(parseKeys('not-json[')).toEqual(['not-json[']); // malformed JSON → single
  });
});

describe('multi-key local store (t/835)', () => {
  beforeEach(() => { dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'multikey-')); });
  afterEach(() => { fs.rmSync(dataRoot, { recursive: true, force: true }); });

  it('setKeys / getKeys round-trips an array', async () => {
    await store().setKeys('gemini', U, ['k1', 'k2']);
    expect(await store().getKeys('gemini', U)).toEqual(['k1', 'k2']);
  });

  it('addKey appends and dedupes (trimmed)', async () => {
    await store().setKeys('gemini', U, ['k1']);
    expect(await store().addKey('gemini', U, 'k2')).toEqual(['k1', 'k2']);
    expect(await store().addKey('gemini', U, ' k2 ')).toEqual(['k1', 'k2']); // dedupe + trim
  });

  it('removeKey removes by index and is a no-op out of range', async () => {
    await store().setKeys('gemini', U, ['k1', 'k2', 'k3']);
    expect(await store().removeKey('gemini', U, 1)).toEqual(['k1', 'k3']);
    expect(await store().removeKey('gemini', U, 9)).toEqual(['k1', 'k3']);
  });

  it('setKeys([]) deletes the entry', async () => {
    await store().setKeys('gemini', U, ['k1']);
    await store().setKeys('gemini', U, []);
    expect(await store().getKeys('gemini', U)).toEqual([]);
    expect(await store().get('gemini', U)).toBeNull();
  });

  it('backward compat: a legacy single-value file reads as a one-element list (AC#5)', async () => {
    await store().set('gemini', U, 'legacy-single'); // raw single string (old format)
    expect(await store().getKeys('gemini', U)).toEqual(['legacy-single']);
    // adding a second key upgrades to array format transparently
    expect(await store().addKey('gemini', U, 'second')).toEqual(['legacy-single', 'second']);
  });
});
