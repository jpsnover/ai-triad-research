// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * t/1702: `resolveApiModelId` in embeddings.ts reads ai-models.json and caches
 * the model-id map keyed by file mtime. Two defects fixed here:
 *   A. a UTF-8 BOM (EF BB BF) on ai-models.json made JSON.parse throw; and
 *   B. the catch block never advanced `_modelMapMtime`, so a file that was
 *      statted-but-failed-to-parse was re-read (and re-recorded to the flight
 *      recorder) on EVERY call — 30+ identical errors per session.
 *
 * embeddings.ts imports `electron` (net) and a large dependency graph, so it
 * cannot be imported under vitest (ElectronMain AGENTS.md). This suite MIRRORS
 * the resolveApiModelId caching/BOM/mtime logic against a temp file — keep it in
 * sync with the source function. It asserts the two behaviors above without the
 * heavy import: a BOM-prefixed config still parses, and a parse failure is
 * recorded once and not re-read while the file's mtime is unchanged.
 */

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-model-id-'));
const configPath = path.join(tmpRoot, 'ai-models.json');

// ── Mirror of embeddings.ts resolveApiModelId caching logic ──
let _cache: Record<string, string> | null = null;
let _mtime = 0;
let _reads = 0;      // counts real file reads (proxy for re-read flooding)
let _errors = 0;     // counts recorder.record() calls in the catch

function buildMap(config: { models?: { id: string; apiId?: string }[] }): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of config.models ?? []) if (m.apiId) map[m.id] = m.apiId;
  return map;
}

function resolveMirror(friendlyId: string): string {
  let statMtime = 0;
  let fd: number | undefined;
  try {
    // fd-based read mirrors the embeddings resolveApiModelId fix (js/file-system-race, t/2022).
    fd = fs.openSync(configPath, 'r');
    const stat = fs.fstatSync(fd);
    statMtime = stat.mtimeMs;
    if (!_cache || stat.mtimeMs !== _mtime) {
      _reads++;
      const raw = fs.readFileSync(fd, 'utf-8').replace(/^﻿/, '');
      _cache = buildMap(JSON.parse(raw));
      _mtime = stat.mtimeMs;
    }
  } catch {
    _errors++;
    if (!_cache) _cache = {};
    if (statMtime !== 0) _mtime = statMtime;   // Option B: stop the re-read flood
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return _cache![friendlyId] ?? friendlyId;
}

beforeEach(() => { _cache = null; _mtime = 0; _reads = 0; _errors = 0; });
afterAll(() => { fs.rmSync(tmpRoot, { recursive: true, force: true }); });

describe('resolveApiModelId BOM + mtime-guard (t/1702, mirror)', () => {
  it('parses a config saved with a UTF-8 BOM and maps friendly → API id', () => {
    fs.writeFileSync(configPath, '﻿' + JSON.stringify({ models: [{ id: 'zai-glm-5-2', apiId: 'glm-5.2' }] }), 'utf-8');
    expect(resolveMirror('zai-glm-5-2')).toBe('glm-5.2');   // BOM did not break the parse
    expect(_errors).toBe(0);
  });

  it('reads the file once across many calls when unchanged', () => {
    fs.writeFileSync(configPath, JSON.stringify({ models: [{ id: 'a', apiId: 'A' }] }), 'utf-8');
    for (let i = 0; i < 5; i++) resolveMirror('a');
    expect(_reads).toBe(1);   // mtime guard prevents re-reads
  });

  it('records a parse failure only ONCE and does not re-read at the same mtime', () => {
    fs.writeFileSync(configPath, '{ this is not json', 'utf-8');
    for (let i = 0; i < 5; i++) resolveMirror('x');
    // Without the Option-B mtime advance this would be 5 errors + 5 reads (the
    // observed flood). With it: one read attempt, one recorded error, then the
    // guard suppresses further re-reads until the file's mtime changes.
    expect(_errors).toBe(1);
    expect(_reads).toBe(1);
    expect(resolveMirror('x')).toBe('x');   // unknown id falls through to the friendly id
  });

  it('re-attempts the load after the file is fixed (mtime changes)', () => {
    fs.writeFileSync(configPath, '{ broken', 'utf-8');
    resolveMirror('a');
    expect(_errors).toBe(1);
    // Repair the file with a newer mtime so the guard lets it reload.
    const later = Date.now() / 1000 + 5;
    fs.writeFileSync(configPath, JSON.stringify({ models: [{ id: 'a', apiId: 'A' }] }), 'utf-8');
    fs.utimesSync(configPath, later, later);
    expect(resolveMirror('a')).toBe('A');
  });
});
