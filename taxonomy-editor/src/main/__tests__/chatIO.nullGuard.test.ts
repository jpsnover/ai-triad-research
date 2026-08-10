// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * t/2406 — REGRESSION: listChatSessions threw when updated_at was null/undefined.
 * chatIO imports resolveDataPath from fileIO (static electron dep) — mock fileIO so
 * CHATS_DIR resolves to a real temp dir without touching the electron runtime.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// vi.hoisted runs before ESM imports resolve — use require() for Node builtins inside it.
const tmpDir = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsr = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const osr = require('os') as typeof import('os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pr = require('path') as typeof import('path');
  return fsr.mkdtempSync(pr.join(osr.tmpdir(), 'chatIO-null-guard-'));
});

vi.mock('../fileIO.js', () => ({
  resolveDataPath: (sub: string) => path.join(tmpDir, sub),
}));

import { listChatSessions } from '../chatIO.js';

const CHATS_DIR = path.join(tmpDir, 'chats');

function writeSession(id: string, updatedAt: string | null | undefined): void {
  fs.writeFileSync(
    path.join(CHATS_DIR, `chat-${id}.json`),
    JSON.stringify({ id, title: `Session ${id}`, created_at: '2026-01-01T00:00:00Z', updated_at: updatedAt, mode: 'chat', pover: 'acc' }),
    'utf-8',
  );
}

beforeAll(() => { fs.mkdirSync(CHATS_DIR, { recursive: true }); });
afterAll(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe('listChatSessions — null updated_at guard (t/2406)', () => {
  it('REGRESSION: does not throw and sorts null updated_at last', () => {
    writeSession('sess-recent', '2026-08-09T10:00:00Z');
    writeSession('sess-older', '2026-08-01T00:00:00Z');
    writeSession('sess-null', null);
    const results = listChatSessions();
    const ids = results.map(s => s.id);
    expect(() => listChatSessions()).not.toThrow();
    expect(ids.indexOf('sess-recent')).toBeLessThan(ids.indexOf('sess-older'));
    expect(ids.indexOf('sess-older')).toBeLessThan(ids.indexOf('sess-null'));
  });
});
