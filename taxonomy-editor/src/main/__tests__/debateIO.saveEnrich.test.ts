// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ActionableError } from '../../../../lib/debate/errors.js';

/**
 * t/1638: saveDebateSession must enrich the total-loss save failure that
 * atomicWriteSync (t/1627) surfaces. The generic persistence ActionableError
 * names filePath/tmpPath but cannot know WHICH debate or HOW MANY turns are at
 * risk. This suite drives the REAL saveDebateSession (not a mirror) and asserts
 * the re-thrown error carries the debate id, run_id, turn_count, and the
 * preserved .tmp path, with the original error chained as innerError.
 *
 * debateIO transitively pulls in Electron via fileIO, so we mock fileIO's
 * resolveDataPath to a temp dir (no Electron loaded), and mock persistence's
 * atomicWriteSync to fail on demand while keeping the real safeSerialize.
 */

const h = vi.hoisted(() => ({ debatesRoot: '', failWith: null as Error | null }));

vi.mock('../fileIO.js', () => ({
  resolveDataPath: (sub: string) => {
    if (!h.debatesRoot) {
      h.debatesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'debateio-enrich-'));
    }
    return path.join(h.debatesRoot, sub);
  },
}));

vi.mock('../../../../lib/debate/persistence.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/debate/persistence.js')>();
  return {
    ...actual,
    atomicWriteSync: (filePath: string, content: string): void => {
      if (h.failWith) throw h.failWith;
      actual.atomicWriteSync(filePath, content);
    },
  };
});

// Imported AFTER the mocks are registered so debateIO binds the mocked deps.
import { saveDebateSession } from '../debateIO.js';

beforeEach(() => { h.failWith = null; });
afterAll(() => { if (h.debatesRoot) fs.rmSync(h.debatesRoot, { recursive: true, force: true }); });

describe('saveDebateSession enriches total-loss ActionableError (t/1638)', () => {
  it('re-throws with debate id, run_id, turn_count, and the preserved .tmp path', () => {
    // Simulate the exact contract atomicWriteSync throws on total loss (t/1627).
    h.failWith = new ActionableError({
      goal: 'Persist bytes to debate file',
      problem: 'Atomic rename and in-place copy fallback were both denied (rename EPERM, copy EPERM).',
      location: 'lib/debate/persistence.ts atomicWriteSync',
      nextSteps: ['The new content is preserved at the .tmp and was NOT deleted.'],
    });

    const session = {
      id: 'deb-xyz',
      run_id: 'run-789',
      // 1 opening + 2 statements = 3 turns; the 'note' must not be counted.
      transcript: [{ type: 'opening' }, { type: 'statement' }, { type: 'statement' }, { type: 'note' }],
    };

    let caught: unknown;
    try { saveDebateSession(session); } catch (e) { caught = e; }

    expect(caught).toBeInstanceOf(ActionableError);
    const ae = caught as ActionableError;

    // Debate identity is named in goal + problem.
    expect(ae.goal).toContain('deb-xyz');
    expect(ae.problem).toContain('deb-xyz');
    expect(ae.problem).toContain('run-789');
    // turn_count is surfaced (2 statement + 1 opening; the 'note' is excluded).
    expect(ae.goal).toContain('3 turns');
    expect(ae.problem).toContain('3 turns');

    // Recovery steps name the debate AND the preserved .tmp artifact.
    const steps = ae.nextSteps.join('\n');
    expect(steps).toContain('deb-xyz');
    expect(steps).toContain('run-789');
    expect(steps).toContain('3 turns');
    expect(steps).toMatch(/debate-deb-xyz\.json\.tmp/);

    // Location points at this call site, not the generic util.
    expect(ae.location).toContain('debateIO.ts');
    // Original failure is chained for the full diagnostic trail.
    expect(ae.innerError).toBe(h.failWith);
  });

  it('defaults run_id to "unknown" and turn_count to 0 when the session lacks them', () => {
    // Non-lock rename errors rethrow the RAW error (not an ActionableError);
    // the wrapper must still enrich it into an ActionableError.
    h.failWith = new Error('EXDEV: cross-device link not permitted');

    const session = { id: 'deb-min' }; // no run_id, no transcript

    let caught: unknown;
    try { saveDebateSession(session); } catch (e) { caught = e; }

    expect(caught).toBeInstanceOf(ActionableError);
    const ae = caught as ActionableError;
    expect(ae.problem).toContain('deb-min');
    expect(ae.problem).toContain('unknown');   // run_id fallback
    expect(ae.problem).toContain('0 turns');   // turn_count fallback
    expect(ae.innerError).toBe(h.failWith);
  });
});
