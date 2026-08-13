// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Unit tests for opedIO persistence layer (t/2575).
// opedIO cannot be imported directly (pulls in Electron via fileIO).
// This test mirrors the exact write composition in opedIO.ts against real
// lib helpers — same pattern as debateIO.persistence.test.ts.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { atomicWriteSync, renameSyncWithRetry } from '../../../../lib/debate/persistence.js';
import { assertSafeId } from '../../../../lib/electron-shared/safeId.js';
import type { OpEdSet } from '../../../../lib/oped/types.js';

function makeSet(setId: string, memberCount = 1): OpEdSet {
  return {
    schema_version: 1,
    set_id: setId,
    topic: 'Test topic',
    params: { wordCount: 600, model: 'test-model' },
    created_at: new Date().toISOString(),
    opeds: Array.from({ length: memberCount }, (_, i) => ({
      pov: i % 2 === 0 ? 'accelerationist' : 'safetyist' as 'accelerationist' | 'safetyist',
      status: 'complete' as const,
      headline: `Headline ${i}`,
      subtitle: `Subtitle ${i}`,
      body: `Body ${i}`,
      wordCount: 600,
      grounding: [],
    })),
  };
}

// Mirrors opedIO.saveOpEdSetTemp: write to wip.tmp then rename to wip
function saveTempLikeOpedIO(dir: string, set: OpEdSet): void {
  assertSafeId(set.set_id, 'oped set id');
  const wip = path.join(dir, `oped-${set.set_id}-wip.json`);
  const tmp = wip + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(set, null, 2) + '\n', 'utf-8');
  renameSyncWithRetry(tmp, wip);
}

// Mirrors opedIO.finalizeOpEdSet: atomicWriteSync to final, remove wip
function finalizeLikeOpedIO(dir: string, set: OpEdSet): void {
  assertSafeId(set.set_id, 'oped set id');
  const filePath = path.join(dir, `oped-${set.set_id}.json`);
  const wip = path.join(dir, `oped-${set.set_id}-wip.json`);
  atomicWriteSync(filePath, JSON.stringify(set, null, 2) + '\n');
  if (fs.existsSync(wip)) fs.unlinkSync(wip);
}

let dir = '';
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opedio-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('opedIO persistence — saveOpEdSetTemp', () => {
  it('writes wip file atomically; no .tmp left behind', () => {
    const set = makeSet('abc123');
    saveTempLikeOpedIO(dir, set);

    const wip = path.join(dir, 'oped-abc123-wip.json');
    expect(fs.existsSync(wip)).toBe(true);
    expect(fs.existsSync(wip + '.tmp')).toBe(false);
    expect(JSON.parse(fs.readFileSync(wip, 'utf-8'))).toMatchObject({ set_id: 'abc123' });
  });

  it('overwrites an existing wip file on subsequent temp saves', () => {
    const set1 = makeSet('upd999', 1);
    const set2 = makeSet('upd999', 2);
    saveTempLikeOpedIO(dir, set1);
    saveTempLikeOpedIO(dir, set2);

    const wip = path.join(dir, 'oped-upd999-wip.json');
    const parsed = JSON.parse(fs.readFileSync(wip, 'utf-8')) as OpEdSet;
    expect(parsed.opeds).toHaveLength(2);
  });
});

describe('opedIO persistence — finalizeOpEdSet', () => {
  it('writes final file atomically; no .tmp left behind', () => {
    const set = makeSet('fin001');
    finalizeLikeOpedIO(dir, set);

    const filePath = path.join(dir, 'oped-fin001.json');
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.existsSync(filePath + '.tmp')).toBe(false);
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as OpEdSet;
    expect(parsed.schema_version).toBe(1);
    expect(parsed.set_id).toBe('fin001');
  });

  it('removes the wip file after successful finalize', () => {
    const set = makeSet('fin002');
    saveTempLikeOpedIO(dir, set);
    const wip = path.join(dir, 'oped-fin002-wip.json');
    expect(fs.existsSync(wip)).toBe(true);

    finalizeLikeOpedIO(dir, set);
    expect(fs.existsSync(wip)).toBe(false);
  });

  it('partial set (failed + complete members) survives round-trip', () => {
    const set = makeSet('partial1', 3);
    set.opeds[1].status = 'failed';
    set.opeds[1].headline = '';
    finalizeLikeOpedIO(dir, set);

    const filePath = path.join(dir, 'oped-partial1.json');
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as OpEdSet;
    expect(parsed.opeds).toHaveLength(3);
    expect(parsed.opeds[1].status).toBe('failed');
    expect(parsed.opeds[0].status).toBe('complete');
  });

  it('all-failed set (0 complete) finalizes without error', () => {
    const set = makeSet('allfail', 2);
    set.opeds.forEach(m => { m.status = 'failed'; m.headline = ''; m.subtitle = ''; m.body = ''; });
    expect(() => finalizeLikeOpedIO(dir, set)).not.toThrow();

    const filePath = path.join(dir, 'oped-allfail.json');
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as OpEdSet;
    expect(parsed.opeds.every(m => m.status === 'failed')).toBe(true);
  });
});

describe('opedIO — assertSafeId path traversal guard', () => {
  it('rejects a set_id with path traversal characters', () => {
    expect(() => assertSafeId('../evil', 'oped set id')).toThrow();
  });

  it('accepts a UUID-shaped set_id', () => {
    expect(() => assertSafeId('550e8400-e29b-41d4-a716-446655440000', 'oped set id')).not.toThrow();
  });
});
