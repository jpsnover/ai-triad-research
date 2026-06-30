// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { safeSerialize, atomicWriteSync } from '../../../../lib/debate/persistence.js';

/**
 * Crash-safe debate session persistence (t/1140). `debateIO.saveDebateSession` can't be
 * imported in vitest (it transitively pulls in Electron via fileIO), so this mirrors the
 * exact write composition added to it — safe-serialize + atomic temp+rename — against the
 * REAL lib/debate/persistence helpers (DebateTool's reference). Verifies the two failure
 * modes the ticket targets: serialization failure (circular/non-serializable) and a
 * truncated file from a mid-write crash.
 */

// Mirrors saveDebateSession's persistence tail in debateIO.ts.
function saveLikeDebateIO(filePath: string, session: unknown): boolean {
  const { json, hadError } = safeSerialize(session, 2);
  atomicWriteSync(filePath, json + '\n');
  return hadError;
}

let dir = '';
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'debateio-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('crash-safe debate session persistence (t/1140)', () => {
  it('writes a normal session atomically — valid JSON, no .tmp left behind', () => {
    const file = path.join(dir, 'debate-d1.json');
    const hadError = saveLikeDebateIO(file, { id: 'd1', phase: 'concluding', transcript: [{ type: 'opening' }] });

    expect(hadError).toBe(false);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(file + '.tmp')).toBe(false); // atomic — temp renamed, not left behind
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toMatchObject({ id: 'd1', phase: 'concluding' });
  });

  it('falls back to the sanitizing replacer on a circular reference — no throw, [Circular] marker, session still saved', () => {
    const file = path.join(dir, 'debate-d2.json');
    const session: Record<string, unknown> = { id: 'd2', phase: 'synthesis' };
    const node: Record<string, unknown> = {};
    node.self = node;          // circular ref — JSON.stringify would throw
    session.cycle = node;

    let threw = false;
    let hadError = false;
    try { hadError = saveLikeDebateIO(file, session); } catch { threw = true; }

    expect(threw).toBe(false);            // the GUI debate is NOT lost to a serialization failure
    expect(hadError).toBe(true);          // fallback path was taken (and logged by safeSerialize)
    const text = fs.readFileSync(file, 'utf-8');
    expect(text).toContain('[Circular]');
    expect(JSON.parse(text).id).toBe('d2'); // the rest of the session survives
  });

  it('handles bigint (non-JSON-native) via the replacer fallback', () => {
    const file = path.join(dir, 'debate-d3.json');
    const hadError = saveLikeDebateIO(file, { id: 'd3', big: BigInt(42) });

    expect(hadError).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toMatchObject({ id: 'd3', big: '42' });
  });
});
