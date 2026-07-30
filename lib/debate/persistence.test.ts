// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { safeSerialize, atomicWriteSync } from './persistence.js';

describe('safeSerialize', () => {
  it('serializes a plain object', () => {
    const { json, hadError } = safeSerialize({ a: 1, b: 'hello' });
    expect(hadError).toBe(false);
    expect(JSON.parse(json)).toEqual({ a: 1, b: 'hello' });
  });

  it('handles circular references via fallback replacer', () => {
    const obj: Record<string, unknown> = { name: 'test' };
    obj.self = obj;
    const { json, hadError, errorMessage } = safeSerialize(obj);
    expect(hadError).toBe(true);
    expect(errorMessage).toBeTruthy();
    const parsed = JSON.parse(json);
    expect(parsed.name).toBe('test');
    expect(parsed.self).toBe('[Circular]');
  });

  it('strips functions in fallback mode', () => {
    const obj = { name: 'test', fn: () => 42 };
    // Functions cause JSON.stringify to silently drop the key, not throw,
    // so they go through the normal path. Verify the key is absent.
    const { json, hadError } = safeSerialize(obj);
    expect(hadError).toBe(false);
    const parsed = JSON.parse(json);
    expect(parsed.name).toBe('test');
    expect(parsed.fn).toBeUndefined();
  });

  it('respects indent parameter', () => {
    const { json } = safeSerialize({ a: 1 }, 0);
    expect(json).toBe('{"a":1}');
  });
});

describe('atomicWriteSync', () => {
  const tmpDir = os.tmpdir();
  const testFile = path.join(tmpDir, `persistence-test-${Date.now()}.json`);
  const tmpFile = `${testFile}.tmp`;

  afterEach(() => {
    try { fs.unlinkSync(testFile); } catch { /* ignore */ }
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  });

  it('writes content atomically (no leftover .tmp)', () => {
    atomicWriteSync(testFile, '{"success":true}');
    expect(fs.existsSync(testFile)).toBe(true);
    expect(fs.existsSync(tmpFile)).toBe(false);
    expect(fs.readFileSync(testFile, 'utf-8')).toBe('{"success":true}');
  });

  it('overwrites existing file atomically', () => {
    // codeql[js/insecure-temporary-file] intentional tmpdir usage in test setup
    fs.writeFileSync(testFile, '{"old":true}', 'utf-8');
    atomicWriteSync(testFile, '{"new":true}');
    expect(JSON.parse(fs.readFileSync(testFile, 'utf-8'))).toEqual({ new: true });
  });
});
