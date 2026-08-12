// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression tests for the captured-abort-controller fix (t/2505). A Switch-model restart
// aborts the in-flight run and then starts a fresh one, which reassigns the module-global
// `_abortController` via newAbortController(). A guard that reads the live global would then
// see the *new* (un-aborted) controller and wrongly report the superseded run as still valid
// — so the abandoned pipeline would keep writing (duplicate/mixed transcript entries).
// createDebateGuard captures its own controller so the superseded run reliably self-discards.

import { describe, it, expect, beforeEach } from 'vitest';
import { createDebateGuard, newAbortController, cancelAndResetAbort } from './guards';

const getD = (id: string | null) => () => ({ activeDebateId: id });

describe('createDebateGuard — captured abort controller (t/2505)', () => {
  beforeEach(() => { cancelAndResetAbort(); });

  it('is valid while its run is active', () => {
    newAbortController();
    expect(createDebateGuard(getD('d1'))()).toBe(true);
  });

  it('bails once its own controller is aborted', () => {
    newAbortController();
    const guard = createDebateGuard(getD('d1'));
    cancelAndResetAbort();
    expect(guard()).toBe(false);
  });

  it('a superseded run self-discards even after a NEW controller is installed (the regression)', () => {
    newAbortController();                       // old run's controller (AC_old)
    const oldGuard = createDebateGuard(getD('d1'));
    // Switch-model restart: abort AC_old, then the fresh run installs AC_new (un-aborted).
    cancelAndResetAbort();
    newAbortController();                        // AC_new — NOT aborted
    const newGuard = createDebateGuard(getD('d1'));
    // Pre-fix this read the live global (AC_new) and returned true → old pipeline kept writing.
    expect(oldGuard()).toBe(false);
    // The fresh run is unaffected.
    expect(newGuard()).toBe(true);
  });

  it('still bails when the active debate changes (existing behavior preserved)', () => {
    newAbortController();
    let id: string | null = 'd1';
    const guard = createDebateGuard(() => ({ activeDebateId: id }));
    id = 'd2';
    expect(guard()).toBe(false);
  });
});
