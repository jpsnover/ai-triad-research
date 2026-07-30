// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * t/1998: the `load-greatest-hits` IPC handler is the desktop read for the greatest-hits
 * exclusion list — it reads `calibration/greatest-hits.json` under the data root (the same
 * static file the debate engine reads) and returns `{ node_ids }` or null. Drives the REAL
 * handler by mocking `electron` (to capture the registered handler) and `../fileIO.js`
 * (to point the data root at a per-test temp dir); the file read itself runs for real.
 */

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  dataRoot: '',
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => { h.handlers.set(ch, fn); } },
}));

// Only getDataRootPath is exercised by the load-greatest-hits test; the rest are stubbed so
// the module's named imports resolve (they're called lazily inside handlers we don't drive).
vi.mock('../fileIO.js', () => ({
  getDataRootPath: () => h.dataRoot,
  discoverSources: () => [],
  loadSummary: () => null,
  loadSnapshot: () => null,
  resolveSourceDocument: () => null,
  loadDataConfig: () => ({}),
  PROJECT_ROOT: '/',
}));

// Imported AFTER the mocks so the handler binds the mocked deps.
import { registerSourceHandlers } from '../ipc/sourceHandlers.js';

function invoke(channel: string, ...args: unknown[]): unknown {
  const fn = h.handlers.get(channel);
  if (!fn) throw new Error(`${channel} not registered`);
  return fn({}, ...args);
}

function writeGreatestHits(raw: string): void {
  const dir = path.join(h.dataRoot, 'calibration');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'greatest-hits.json'), raw);
}

beforeEach(() => {
  h.handlers.clear();
  h.dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ghits-'));
  registerSourceHandlers();
});
afterEach(() => {
  fs.rmSync(h.dataRoot, { recursive: true, force: true });
});

describe('load-greatest-hits IPC handler (t/1998)', () => {
  it('returns { node_ids } from calibration/greatest-hits.json', () => {
    writeGreatestHits(JSON.stringify({ version: 1, node_ids: ['acc-beliefs-001', 'saf-desires-002'] }));
    expect(invoke('load-greatest-hits')).toEqual({ node_ids: ['acc-beliefs-001', 'saf-desires-002'] });
  });

  it('returns { node_ids: [] } when the file omits node_ids', () => {
    writeGreatestHits(JSON.stringify({ version: 1 }));
    expect(invoke('load-greatest-hits')).toEqual({ node_ids: [] });
  });

  it('returns null when calibration/greatest-hits.json is absent', () => {
    expect(invoke('load-greatest-hits')).toBeNull();
  });

  it('returns null when the file is malformed JSON (degrades, never throws)', () => {
    writeGreatestHits('{ not valid json');
    expect(invoke('load-greatest-hits')).toBeNull();
  });
});
