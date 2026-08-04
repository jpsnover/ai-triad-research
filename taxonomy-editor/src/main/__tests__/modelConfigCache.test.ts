// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Guards the three real defects fixed in t/1702 and t/2022:
 *   A. UTF-8 BOM on ai-models.json causes JSON.parse to throw (t/1702A)
 *   B. A parse failure without mtime-advance floods the flight recorder on every call (t/1702B)
 *   C. A single fd is opened for both fstat and readFile — TOCTOU-free (t/2022, structural)
 *
 * modelConfigCache.ts has no electron dependency, so this suite imports the real
 * module instead of mirroring its logic — the prior resolveApiModelId.test.ts mirror
 * drifted after t/2104 renamed the function and changed the return type (t/2111).
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const mockRecord = vi.hoisted(() => vi.fn());
vi.mock('../../../../lib/flight-recorder/index.js', () => ({
  getGlobalRecorder: () => ({ record: mockRecord }),
}));

// lib/ai-client/registry.js is NOT mocked — buildModelEntryMap is a pure function
// with no electron or network dependencies.

import { resolveModelEntry, resetModelMapCache } from '../modelConfigCache.js';

// ── minimal valid config helpers ──
function makeConfig(models: Array<{ id: string; apiModelId: string; label?: string; backend?: string; fixedTemperature?: number }>) {
  return JSON.stringify({
    backends: [],
    models: models.map(m => ({ label: 'Test', backend: 'test', ...m })),
  });
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'model-config-cache-'));
const configPath = path.join(tmpRoot, 'ai-models.json');

beforeEach(() => {
  mockRecord.mockClear();
  resetModelMapCache();
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(() => { fs.rmSync(tmpRoot, { recursive: true, force: true }); });

describe('modelConfigCache — BOM + mtime-guard (t/1702, t/2022)', () => {
  it('parses a config saved with a UTF-8 BOM and returns the correct ModelEntry (t/1702A)', () => {
    fs.writeFileSync(configPath, '﻿' + makeConfig([{ id: 'zai-glm-5-2', apiModelId: 'glm-5.2' }]), 'utf-8');
    const entry = resolveModelEntry(configPath, 'zai-glm-5-2');
    expect(entry?.apiModelId).toBe('glm-5.2');
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('reads the file only once across many calls when mtime is unchanged', () => {
    fs.writeFileSync(configPath, makeConfig([{ id: 'a', apiModelId: 'A' }]), 'utf-8');
    const readSpy = vi.spyOn(fs, 'readFileSync');
    for (let i = 0; i < 5; i++) resolveModelEntry(configPath, 'a');
    // readFileSync(fd) is guarded by the mtime check; only the first call reads the file.
    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(resolveModelEntry(configPath, 'a')?.apiModelId).toBe('A');
  });

  it('records a parse failure only ONCE and does not re-read at the same mtime (t/1702B)', () => {
    fs.writeFileSync(configPath, '{ this is not json', 'utf-8');
    for (let i = 0; i < 5; i++) resolveModelEntry(configPath, 'x');
    expect(mockRecord).toHaveBeenCalledTimes(1);
    // unknown id returns undefined (ModelEntry | undefined, not a string fallback)
    expect(resolveModelEntry(configPath, 'x')).toBeUndefined();
  });

  it('re-attempts the load after the file is fixed (mtime changes)', () => {
    fs.writeFileSync(configPath, '{ broken', 'utf-8');
    resolveModelEntry(configPath, 'a');
    expect(mockRecord).toHaveBeenCalledTimes(1);

    const later = Date.now() / 1000 + 5;
    fs.writeFileSync(configPath, makeConfig([{ id: 'a', apiModelId: 'A', fixedTemperature: 1 }]), 'utf-8');
    fs.utimesSync(configPath, later, later);

    const entry = resolveModelEntry(configPath, 'a');
    expect(entry?.apiModelId).toBe('A');
    expect(entry?.fixedTemperature).toBe(1);
  });
});
