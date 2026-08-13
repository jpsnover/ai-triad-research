// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Direct unit tests for opedIO.listOpEdSets (t/2591 TL-required).
// Tests the real filter/sort/summary-derive logic against a temp dir —
// guards against .wip/.tmp/.inprogress leaking into the listing.
//
// OPED_DIR is a module-level constant in opedIO.ts, so we reset modules and
// re-import before each test to force re-evaluation with the fresh tempDir.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  safeStorage: { isEncryptionAvailable: vi.fn(() => false) },
}));

// Mutable ref — updated in beforeEach before module re-import.
const dataDirs = { root: '' };

vi.mock('../fileIO.js', () => ({
  PROJECT_ROOT: '/fake/root',
  getDataRootPath: vi.fn(() => dataDirs.root),
  resolveDataPath: vi.fn((p: string) => path.join(dataDirs.root, p)),
}));

vi.mock('../../../../lib/electron-shared/safeId.js', () => ({ assertSafeId: vi.fn() }));
vi.mock('../../../../lib/debate/errors.js', () => ({
  ActionableError: class extends Error {
    constructor(o: { problem: string; goal: string; location: string; nextSteps: string[] }) { super(o.problem); }
  },
}));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: vi.fn(() => null) }));
vi.mock('../../../../lib/debate/persistence.js', () => ({
  atomicWriteSync: vi.fn(),
  renameSyncWithRetry: vi.fn(),
}));
vi.mock('../../../../lib/debate/lockHolder.js', () => ({ recordLockHolder: vi.fn() }));

type ListOpEdSets = () => ReturnType<typeof import('../opedIO.js')['listOpEdSets']>;

let listOpEdSets: ListOpEdSets;

beforeEach(async () => {
  dataDirs.root = fs.mkdtempSync(path.join(os.tmpdir(), 'oped-list-test-'));
  fs.mkdirSync(path.join(dataDirs.root, 'oped-sets'), { recursive: true });
  vi.resetModules();
  const mod = await import('../opedIO.js');
  listOpEdSets = mod.listOpEdSets as ListOpEdSets;
});

afterEach(() => {
  fs.rmSync(dataDirs.root, { recursive: true, force: true });
});

function makeSet(setId: string, topic: string, createdAt: string, povs: string[]): object {
  return {
    schema_version: 1,
    set_id: setId,
    topic,
    params: { wordCount: 600, model: 'test' },
    created_at: createdAt,
    opeds: povs.map(pov => ({ pov, status: 'complete', headline: '', subtitle: '', body: '', wordCount: 0, grounding: [] })),
  };
}

function write(filename: string, content: object): void {
  fs.writeFileSync(path.join(dataDirs.root, 'oped-sets', filename), JSON.stringify(content), 'utf-8');
}

describe('listOpEdSets', () => {
  it('returns empty array when only wip and junk files are present', () => {
    write('oped-aaa-wip.json', makeSet('aaa', 'WIP topic', '2026-08-13T00:00:00.000Z', ['acc']));
    fs.writeFileSync(path.join(dataDirs.root, 'oped-sets', 'oped-bbb.json.tmp'), '{}');
    fs.writeFileSync(path.join(dataDirs.root, 'oped-sets', 'unrelated.txt'), 'noise');
    expect(listOpEdSets()).toEqual([]);
  });

  it('excludes -wip.json, .tmp, and non-oped files; includes only final oped-*.json', () => {
    write('oped-set-a.json', makeSet('set-a', 'Topic A', '2026-08-12T00:00:00.000Z', ['acc', 'saf']));
    write('oped-set-b.json', makeSet('set-b', 'Topic B', '2026-08-13T00:00:00.000Z', ['skp']));
    write('oped-set-c-wip.json', makeSet('set-c', 'WIP', '2026-08-14T00:00:00.000Z', ['acc']));
    fs.writeFileSync(path.join(dataDirs.root, 'oped-sets', 'oped-set-d.json.tmp'), '{}');
    fs.writeFileSync(path.join(dataDirs.root, 'oped-sets', 'debug.inprogress'), 'noise');

    const result = listOpEdSets();
    expect(result).toHaveLength(2);
    // Sorted newest-first
    expect(result[0].set_id).toBe('set-b');
    expect(result[1].set_id).toBe('set-a');
  });

  it('derives summary fields correctly from OpEdSet', () => {
    write('oped-xyz.json', makeSet('xyz', 'AI policy', '2026-08-13T00:00:00.000Z', ['acc', 'saf', 'skp']));
    const [summary] = listOpEdSets();
    expect(summary).toEqual({
      set_id: 'xyz',
      topic: 'AI policy',
      created_at: '2026-08-13T00:00:00.000Z',
      camps: ['acc', 'saf', 'skp'],
      voice_count: 3,
    });
  });

  it('silently skips corrupt/unreadable JSON entries', () => {
    fs.writeFileSync(path.join(dataDirs.root, 'oped-sets', 'oped-corrupt.json'), '{not valid json}');
    write('oped-valid.json', makeSet('valid', 'Good set', '2026-08-13T00:00:00.000Z', ['acc']));
    const result = listOpEdSets();
    expect(result).toHaveLength(1);
    expect(result[0].set_id).toBe('valid');
  });
});
