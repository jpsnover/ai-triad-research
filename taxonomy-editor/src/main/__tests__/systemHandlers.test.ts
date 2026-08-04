// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * t/2022 (#5401, js/file-system-race): the `read-research-file` IPC handler dropped its
 * existsSync-then-read TOCTOU guard — it now stats/reads directly and treats a missing file
 * as a quiet null in the catch (ENOENT). This drives the REAL handler by mocking `electron`
 * (capture the registered handler) and `../fileIO.js` (PROJECT_ROOT → a temp dir so
 * RESEARCH_DIR resolves under it). The path-traversal guard is unchanged.
 */
const h = vi.hoisted(() => {
  const base = process.env.TEMP || process.env.TMPDIR || '/tmp';
  return {
    handlers: new Map<string, (...a: unknown[]) => unknown>(),
    root: `${base}/sysh-${process.pid}-${Date.now()}`,
  };
});

vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => { h.handlers.set(ch, fn); } },
  shell: {}, clipboard: {}, BrowserWindow: {}, dialog: {},
}));

vi.mock('../fileIO.js', () => ({
  PROJECT_ROOT: h.root,
  getDataRootPath: () => h.root,
  writeJsonFileAtomic: () => {},
}));

import { registerSystemHandlers } from '../ipc/systemHandlers.js';
import { ActionableError } from '../../../../lib/debate/errors.js';

function invoke(channel: string, ...args: unknown[]): unknown {
  const fn = h.handlers.get(channel);
  if (!fn) throw new Error(`${channel} not registered`);
  return fn({}, ...args);
}

const researchDir = (): string => path.join(h.root, 'research');

beforeEach(() => {
  h.handlers.clear();
  fs.rmSync(h.root, { recursive: true, force: true });
  fs.mkdirSync(researchDir(), { recursive: true });
  registerSystemHandlers();
});

describe('read-research-file IPC handler (t/2022 #5401 — no existsSync-then-read race)', () => {
  it('reads and parses an existing research file', () => {
    fs.writeFileSync(path.join(researchDir(), 'foo.json'), JSON.stringify({ ok: 1 }));
    expect(invoke('read-research-file', 'foo.json')).toEqual({ ok: 1 });
  });

  it('returns null for a missing file (statSync ENOENT → quiet null, no error record)', () => {
    expect(invoke('read-research-file', 'nope.json')).toBeNull();
  });

  it('throws on a path-traversal attempt (guard runs before the read)', () => {
    expect(() => invoke('read-research-file', '../../etc/passwd')).toThrow(ActionableError);
  });
});
