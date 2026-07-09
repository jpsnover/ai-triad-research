// @vitest-environment node

/**
 * t/1426 — single-key-per-backend store semantics.
 * Replaces the t/835 multi-key tests. Verifies that the store enforces exactly
 * one key per backend, truncates legacy multi-key values, and logs FR events.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const mockRecord = vi.fn();
vi.mock('../../../../lib/flight-recorder/index.js', () => ({
  getGlobalRecorder: () => ({ record: mockRecord }),
}));

import { getKeyStore, parseKeys } from '../security/keyStore.js';

let dataRoot: string;
const store = () => getKeyStore(() => dataRoot);
const U = 'alice';

describe('parseKeys (legacy compat)', () => {
  it('handles null/blank as empty', () => {
    expect(parseKeys(null)).toEqual([]);
    expect(parseKeys('')).toEqual([]);
    expect(parseKeys('   ')).toEqual([]);
  });
  it('parses a JSON array (needed for migration reads)', () => {
    expect(parseKeys('["a","b"]')).toEqual(['a', 'b']);
    expect(parseKeys('[" a ","","b"]')).toEqual(['a', 'b']);
    expect(parseKeys('[]')).toEqual([]);
  });
  it('treats a non-array value as a single key', () => {
    expect(parseKeys('legacy-key')).toEqual(['legacy-key']);
    expect(parseKeys('not-json[')).toEqual(['not-json[']);
  });
});

describe('single-key store (t/1426)', () => {
  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'singlekey-'));
    mockRecord.mockClear();
  });
  afterEach(() => { fs.rmSync(dataRoot, { recursive: true, force: true }); });

  it('set / get round-trips a single key', async () => {
    await store().set('gemini', U, 'k1');
    expect(await store().get('gemini', U)).toBe('k1');
    expect(await store().getKeys('gemini', U)).toEqual(['k1']);
  });

  it('addKey replaces the existing key (does not append)', async () => {
    await store().set('gemini', U, 'k1');
    const result = await store().addKey('gemini', U, 'k2');
    expect(result).toEqual(['k2']);
    expect(await store().get('gemini', U)).toBe('k2');
  });

  it('addKey with blank key is a no-op', async () => {
    await store().set('gemini', U, 'k1');
    const result = await store().addKey('gemini', U, '   ');
    expect(result).toEqual(['k1']);
  });

  it('setKeys stores only the first key', async () => {
    await store().setKeys('gemini', U, ['k1', 'k2', 'k3']);
    expect(await store().getKeys('gemini', U)).toEqual(['k1']);
  });

  it('setKeys with multiple keys logs FR truncation event', async () => {
    await store().setKeys('gemini', U, ['k1', 'k2']);
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        component: 'key-store',
        level: 'info',
        data: expect.objectContaining({ truncatedCount: 1 }),
      }),
    );
  });

  it('setKeys([]) deletes the entry', async () => {
    await store().set('gemini', U, 'k1');
    await store().setKeys('gemini', U, []);
    expect(await store().getKeys('gemini', U)).toEqual([]);
    expect(await store().get('gemini', U)).toBeNull();
  });

  it('removeKey(0) deletes the single key', async () => {
    await store().set('gemini', U, 'k1');
    const result = await store().removeKey('gemini', U, 0);
    expect(result).toEqual([]);
    expect(await store().get('gemini', U)).toBeNull();
  });

  it('removeKey with out-of-range index is a no-op', async () => {
    await store().set('gemini', U, 'k1');
    const result = await store().removeKey('gemini', U, 5);
    expect(result).toEqual(['k1']);
  });

  it('backward compat: a legacy single-value file reads as a one-element list', async () => {
    await store().set('gemini', U, 'legacy-single');
    expect(await store().getKeys('gemini', U)).toEqual(['legacy-single']);
  });
});

describe('multi-key migration (t/1426)', () => {
  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-'));
    mockRecord.mockClear();
  });
  afterEach(() => { fs.rmSync(dataRoot, { recursive: true, force: true }); });

  it('getKeys truncates legacy multi-key value to first key', async () => {
    await store().set('gemini', U, JSON.stringify(['first', 'second', 'third']));
    const keys = await store().getKeys('gemini', U);
    expect(keys).toEqual(['first']);
  });

  it('migration logs FR event with backend and truncated count (never key values)', async () => {
    await store().set('gemini', U, JSON.stringify(['first', 'second']));
    await store().getKeys('gemini', U);

    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        component: 'key-store',
        level: 'info',
        message: expect.stringContaining('Truncated 2 stored keys to 1'),
        data: expect.objectContaining({ backend: 'gemini', truncatedCount: 1 }),
      }),
    );
    const call = mockRecord.mock.calls.find(
      (c: unknown[]) => (c[0] as { message: string }).message.includes('Truncated'),
    );
    expect(JSON.stringify(call)).not.toContain('first');
    expect(JSON.stringify(call)).not.toContain('second');
  });

  it('subsequent reads return single key without re-triggering migration', async () => {
    await store().set('gemini', U, JSON.stringify(['first', 'second']));
    await store().getKeys('gemini', U);
    mockRecord.mockClear();

    const keys = await store().getKeys('gemini', U);
    expect(keys).toEqual(['first']);
    const truncationCalls = mockRecord.mock.calls.filter(
      (c: unknown[]) => (c[0] as { message: string }).message?.includes('Truncated'),
    );
    expect(truncationCalls).toHaveLength(0);
  });
});
