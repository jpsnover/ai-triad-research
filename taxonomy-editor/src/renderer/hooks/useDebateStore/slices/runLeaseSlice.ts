// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ── Run-lease entry points (t/3917) ────────────────────────────────────
// Everything that advances a debate automatically runs under the debate's run lease
// (shared/debateRunLease.ts): the openings + auto-loop (`runOpeningStatements`), a
// Cross-respond batch, and every single cross-respond turn. This slice holds the leased
// `crossRespond` wrapper; the turn body is `_crossRespondLeased` in debatePhaseSlice.

import type { StateCreator } from 'zustand';
import type { DebateStore } from '../types';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { acquireRunLease, getRunLeaseWindowId, type RunLease } from '../shared/debateRunLease';

export interface CrossRespondOpts {
  /** The run lease the caller already holds (the auto-loop, a Cross-respond batch). Without one, the turn takes its own. */
  lease?: RunLease;
  /** Who asked, for the flight recorder when the lease is refused. */
  caller?: string;
}

export interface RunLeaseSlice {
  /** One cross-respond turn. Runs only under the debate's run lease: pass the held lease, or the turn acquires one and is refused if another run owns the debate. */
  crossRespond: (opts?: CrossRespondOpts) => Promise<void>;
  /**
   * Run `fn` holding the active debate's run lease. Returns false, with a user-visible
   * `debateError`, when another run owns the debate; the refusal itself is logged by the
   * lease. `supersedeLocal` replaces this window's own run (model-switch retry).
   */
  runUnderDebateLease: (caller: string, fn: (lease: RunLease) => Promise<void>, opts?: { supersedeLocal?: boolean }) => Promise<boolean>;
}

export const createRunLeaseSlice: StateCreator<DebateStore, [], [], RunLeaseSlice> = (set, get) => ({
  runUnderDebateLease: async (caller, fn, opts) => {
    const debateId = get().activeDebate?.id;
    if (!debateId) {
      getGlobalRecorder()?.record({ type: 'debate.lifecycle', component: 'run-lease', level: 'warn', message: 'runUnderDebateLease called with no activeDebate', data: { caller } });
      return false;
    }
    const acquired = await acquireRunLease(debateId, caller, opts);
    if (!acquired.ok) {
      set({ debateError: acquired.holder.windowId === getRunLeaseWindowId()
        ? 'This debate is already running.'
        : 'This debate is already running in another window.' });
      return false;
    }
    try {
      await fn(acquired.lease);
    } finally {
      acquired.lease.release();
    }
    return true;
  },

  crossRespond: async (opts) => {
    const debateId = get().activeDebate?.id;
    // No debate: let the body log and exit exactly as before.
    if (!debateId) return get()._crossRespondLeased();
    if (opts?.lease) {
      if (opts.lease.debateId === debateId && opts.lease.isValid()) return get()._crossRespondLeased();
      getGlobalRecorder()?.record({ type: 'debate.lifecycle', component: 'run-lease', level: 'warn', debate_id: debateId, message: 'crossRespond refused — the passed run lease is no longer valid', data: { lease_debate_id: opts.lease.debateId, lease_caller: opts.lease.caller, caller: opts.caller } });
      return;
    }
    await get().runUnderDebateLease(`crossRespond:${opts?.caller ?? 'unspecified'}`, () => get()._crossRespondLeased());
  },
});
