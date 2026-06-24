// @vitest-environment node

/**
 * t/908 — paired flight-recorder dump storage + retention.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  isValidDumpId, selectExpiredDumps, writeDump, dumpsDir, type DumpFileInfo,
} from '../flightRecorderDumps.js';

describe('isValidDumpId (t/908)', () => {
  it('accepts UUID-safe ids, rejects traversal/empty/oversized', () => {
    expect(isValidDumpId('3f9a-aaaa-bbbb')).toBe(true);
    expect(isValidDumpId('a'.repeat(128))).toBe(true);
    expect(isValidDumpId('../etc/passwd')).toBe(false);
    expect(isValidDumpId('a/b')).toBe(false);
    expect(isValidDumpId('')).toBe(false);
    expect(isValidDumpId('a'.repeat(129))).toBe(false);
    expect(isValidDumpId(42)).toBe(false);
  });
});

function f(dumpId: string, kind: 'client' | 'server', mtime: number, size = 10): DumpFileInfo {
  return { name: `${kind}-${dumpId}.jsonl`, dumpId, mtime, size };
}

describe('selectExpiredDumps (t/908 AC#7)', () => {
  it('keeps everything when under both caps', () => {
    expect(selectExpiredDumps([f('a', 'client', 2), f('a', 'server', 2), f('b', 'client', 1)])).toEqual([]);
  });

  it('drops oldest dumpId pairs beyond the group cap — whole pairs together', () => {
    const files: DumpFileInfo[] = [];
    for (let i = 0; i < 22; i++) { files.push(f(`d${i}`, 'client', i), f(`d${i}`, 'server', i)); }
    const del = selectExpiredDumps(files, 20);
    // The 2 oldest groups (d0, d1) → both halves of each deleted.
    expect(del.sort()).toEqual(['client-d0.jsonl', 'client-d1.jsonl', 'server-d0.jsonl', 'server-d1.jsonl'].sort());
  });

  it('enforces the byte cap by dropping oldest survivors', () => {
    const files = [f('new', 'server', 3, 40), f('mid', 'server', 2, 40), f('old', 'server', 1, 40)];
    const del = selectExpiredDumps(files, 20, 100); // total 120 > 100 → drop oldest (old)
    expect(del).toEqual(['server-old.jsonl']);
  });
});

describe('writeDump (t/908)', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'frdump-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('writes a paired client + server dump joinable by dumpId', () => {
    writeDump(root, 'client', 'abc', '{"seq":1}\n');
    writeDump(root, 'server', 'abc', '{"seq":2}\n');
    const dir = dumpsDir(root);
    expect(fs.existsSync(path.join(dir, 'client-abc.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'server-abc.jsonl'))).toBe(true);
  });
});
