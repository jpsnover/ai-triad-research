// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ── Per-debate run lease (t/3917) ──────────────────────────────────────
//
// One owner per debate for everything that advances it automatically: the opening
// statements, the adaptive / watch-only auto-loop that follows them, and any manual
// cross-respond. The 09-30 dump showed three concurrent `runOpeningStatements` runs for
// one TIGHT debate (one in the main window, two in the pop-out), each falling into its
// own loop: a cap-8 debate ran 12 interleaved rounds and synthesized twice.
//
// The older single-driver lock (guards.ts, t/657) cannot prevent that. It is window-
// scoped rather than debate-scoped, and `runOpeningStatements` releases it before the
// loop starts, so it is open between every round.
//
// Within a window the lease is a synchronous Map entry, so a second caller in the same
// tick is rejected. Across windows it rides a BroadcastChannel:
//   claim → settle window (lower (startedAt, windowId) wins a same-tick race) → held;
//   beat every HEARTBEAT_MS; viewers expire a holder after TTL_MS of silence.
//
// TTL is deliberately long. Electron's backgroundThrottling is on, so an occluded holder
// window can have its timers throttled to once per minute after 5 minutes hidden. A
// short TTL would expire a live holder and hand the debate to a second runner, which is
// exactly this bug. Every broadcast save (`notifyDebateSaved`) also counts as a beat.
//
// Surviving vector (named per t/3666): two separate app *processes* don't share a
// BroadcastChannel, so a debate driven from two app instances is still unguarded.

import { getGlobalRecorder } from '@lib/flight-recorder/index';

export interface LeaseHolder {
  windowId: string;
  caller: string;
  startedAt: number;
  lastBeatAt: number;
}

export interface RunLease {
  readonly debateId: string;
  readonly caller: string;
  /** False once released, lost to a competing claim, or superseded. Loops check this each iteration. */
  isValid(): boolean;
  release(): void;
}

export type AcquireResult = { ok: true; lease: RunLease } | { ok: false; holder: LeaseHolder };

export type RunLeaseEvent =
  | { type: 'remote-held'; debateId: string; holder: LeaseHolder }
  | { type: 'remote-released'; debateId: string; windowId: string }
  | { type: 'remote-expired'; debateId: string; holder: LeaseHolder }
  | { type: 'remote-saved'; debateId: string; windowId: string }
  | { type: 'local-released'; debateId: string };

type LeaseMessage =
  | { type: 'claim' | 'beat'; debateId: string; windowId: string; caller: string; startedAt: number }
  | { type: 'release' | 'saved'; debateId: string; windowId: string }
  | { type: 'query'; windowId: string };

interface LocalEntry {
  caller: string;
  startedAt: number;
  settled: boolean;
  lost: boolean;
}

const timing = { heartbeatMs: 5_000, ttlMs: 90_000, settleMs: 150 };

const _windowId = typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID() : `w-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const _local = new Map<string, LocalEntry>();
const _remote = new Map<string, LeaseHolder>();
const _listeners = new Set<(ev: RunLeaseEvent) => void>();
let _timer: ReturnType<typeof setInterval> | null = null;

const _channel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('aitriad-debate-run-lease') : null;

/** This window's id. guards.ts uses the same id for the driver channel so a lease holder maps to a driver window. */
export function getRunLeaseWindowId(): string {
  return _windowId;
}

export function subscribeRunLease(listener: (ev: RunLeaseEvent) => void): () => void {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

function emit(ev: RunLeaseEvent): void {
  for (const l of _listeners) {
    try { l(ev); } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', component: 'run-lease', level: 'warn', debate_id: ev.debateId, message: 'Run-lease listener threw', error: { name: (e as Error).name ?? 'Error', message: String(e), stack: (e as Error).stack } }); }
  }
}

function post(msg: LeaseMessage): void {
  try { _channel?.postMessage(msg); } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', component: 'run-lease', level: 'warn', message: 'Run-lease broadcast failed', error: { name: (e as Error).name ?? 'Error', message: String(e), stack: (e as Error).stack } }); }
}

/** Lower (startedAt, windowId) wins — both windows evaluate the same comparison, so they agree. */
function precedes(a: { startedAt: number; windowId: string }, b: { startedAt: number; windowId: string }): boolean {
  return a.startedAt !== b.startedAt ? a.startedAt < b.startedAt : a.windowId < b.windowId;
}

function holderOfLocal(entry: LocalEntry): LeaseHolder {
  return { windowId: _windowId, caller: entry.caller, startedAt: entry.startedAt, lastBeatAt: Date.now() };
}

function beatAll(): void {
  for (const [debateId, entry] of _local) {
    if (entry.settled && !entry.lost) post({ type: 'beat', debateId, windowId: _windowId, caller: entry.caller, startedAt: entry.startedAt });
  }
}

/** Drop remote holders that stopped heartbeating. Returns what expired so a caller can log a takeover. */
function sweepExpired(): Array<{ debateId: string; holder: LeaseHolder }> {
  const now = Date.now();
  const expired: Array<{ debateId: string; holder: LeaseHolder }> = [];
  for (const [debateId, holder] of _remote) {
    if (now - holder.lastBeatAt > timing.ttlMs) {
      _remote.delete(debateId);
      expired.push({ debateId, holder });
      getGlobalRecorder()?.record({ type: 'debate.lifecycle', component: 'run-lease', level: 'warn', debate_id: debateId, message: 'Adaptive loop lease expired — holder stopped heartbeating', data: { dead_holder: { window: holder.windowId, caller: holder.caller, started_at: holder.startedAt }, silent_ms: now - holder.lastBeatAt, ttl_ms: timing.ttlMs } });
      emit({ type: 'remote-expired', debateId, holder });
    }
  }
  return expired;
}

function syncTimer(): void {
  const needed = _local.size > 0 || _remote.size > 0;
  if (needed && !_timer) {
    _timer = setInterval(() => { beatAll(); sweepExpired(); syncTimer(); }, timing.heartbeatMs);
  } else if (!needed && _timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

function recordRemote(debateId: string, msg: { windowId: string; caller: string; startedAt: number }): void {
  const holder: LeaseHolder = { windowId: msg.windowId, caller: msg.caller, startedAt: msg.startedAt, lastBeatAt: Date.now() };
  _remote.set(debateId, holder);
  syncTimer();
  emit({ type: 'remote-held', debateId, holder });
}

type ClaimOrBeat = Extract<LeaseMessage, { type: 'claim' | 'beat' }>;

/** A claim or beat for a debate this window also holds (or is acquiring). */
function contestLocal(mine: LocalEntry, msg: ClaimOrBeat): void {
  const theirs = { startedAt: msg.startedAt, windowId: msg.windowId };
  const ours = { startedAt: mine.startedAt, windowId: _windowId };
  if (!mine.settled) {
    // Same-tick race. A beat means they already hold it; a claim loses only to an earlier claim.
    if (msg.type === 'beat' || precedes(theirs, ours)) {
      mine.lost = true;
      recordRemote(msg.debateId, msg);
    }
    return;
  }
  if (msg.type === 'claim') {
    // We already hold it. Answer at once so the claimer backs off inside its settle window.
    post({ type: 'beat', debateId: msg.debateId, windowId: _windowId, caller: mine.caller, startedAt: mine.startedAt });
    return;
  }
  // Two settled holders (a claim missed its settle window). The same ordering picks one.
  getGlobalRecorder()?.record({ type: 'system.error', component: 'run-lease', level: 'error', debate_id: msg.debateId, message: 'Adaptive loop lease split-brain — two windows hold the same debate', data: { ours: { window: _windowId, caller: mine.caller, started_at: mine.startedAt }, theirs: { window: msg.windowId, caller: msg.caller, started_at: msg.startedAt } } });
  if (precedes(theirs, ours)) {
    mine.lost = true;
    recordRemote(msg.debateId, msg);
  }
}

function handleRelease(debateId: string, windowId: string): void {
  if (_remote.get(debateId)?.windowId !== windowId) return;
  _remote.delete(debateId);
  syncTimer();
  emit({ type: 'remote-released', debateId, windowId });
}

function handleSaved(debateId: string, windowId: string): void {
  const held = _remote.get(debateId);
  if (held?.windowId === windowId) held.lastBeatAt = Date.now();
  emit({ type: 'remote-saved', debateId, windowId });
}

function handleMessage(msg: LeaseMessage): void {
  if (!msg || msg.windowId === _windowId) return;
  switch (msg.type) {
    case 'query': beatAll(); return;
    case 'release': handleRelease(msg.debateId, msg.windowId); return;
    case 'saved': handleSaved(msg.debateId, msg.windowId); return;
    default: {
      const mine = _local.get(msg.debateId);
      if (mine && !mine.lost) contestLocal(mine, msg);
      else recordRemote(msg.debateId, msg);
    }
  }
}

if (_channel) {
  _channel.onmessage = (e: MessageEvent) => handleMessage(e.data as LeaseMessage);
  // A window opened mid-debate (the pop-out) has an empty view of who holds what; ask.
  post({ type: 'query', windowId: _windowId });
}

function releaseAllLocal(): void {
  for (const debateId of [..._local.keys()]) {
    _local.delete(debateId);
    post({ type: 'release', debateId, windowId: _windowId });
  }
}
if (typeof window !== 'undefined') window.addEventListener('beforeunload', releaseAllLocal);
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    releaseAllLocal();
    if (_timer) clearInterval(_timer);
    _channel?.close();
    if (typeof window !== 'undefined') window.removeEventListener('beforeunload', releaseAllLocal);
  });
}

function reject(debateId: string, caller: string, holder: LeaseHolder): AcquireResult {
  getGlobalRecorder()?.record({ type: 'debate.lifecycle', component: 'run-lease', level: 'warn', debate_id: debateId, message: 'Adaptive loop re-entry blocked', data: { holder: { window: holder.windowId, caller: holder.caller, started_at: holder.startedAt, remote: holder.windowId !== _windowId }, rejected: { window: _windowId, caller } } });
  return { ok: false, holder };
}

/**
 * Take the run lease for `debateId`, or report who holds it. A rejection is logged here
 * (WARN `Adaptive loop re-entry blocked`, naming both callers); the caller just returns.
 */
export async function acquireRunLease(
  debateId: string,
  caller: string,
  opts?: {
    /** Deliberately replace this window's own run (the brief-timeout model switch aborts
     *  the in-flight openings and restarts). The old run's lease turns invalid, so its loop
     *  exits on the next check; its late release() is a no-op. Never displaces another window. */
    supersedeLocal?: boolean;
  },
): Promise<AcquireResult> {
  const deadHolder = sweepExpired().find(x => x.debateId === debateId)?.holder;
  const existing = existingHolder(debateId, caller, !!opts?.supersedeLocal);
  if (existing) return reject(debateId, caller, existing);

  const entry: LocalEntry = { caller, startedAt: Date.now(), settled: false, lost: false };
  _local.set(debateId, entry);
  syncTimer();
  post({ type: 'claim', debateId, windowId: _windowId, caller, startedAt: entry.startedAt });

  // settleMs 0 (tests) settles on a microtask so fake-timer suites aren't blocked on a timer.
  if (timing.settleMs > 0) await new Promise<void>(resolve => setTimeout(resolve, timing.settleMs));
  else await Promise.resolve();

  if (entry.lost || _local.get(debateId) !== entry) {
    if (_local.get(debateId) === entry) _local.delete(debateId);
    syncTimer();
    return reject(debateId, caller, _remote.get(debateId) ?? { windowId: 'unknown', caller: 'unknown', startedAt: 0, lastBeatAt: 0 });
  }
  entry.settled = true;

  if (deadHolder) {
    getGlobalRecorder()?.record({ type: 'debate.lifecycle', component: 'run-lease', level: 'warn', debate_id: debateId, message: 'Adaptive loop lease taken over from unresponsive holder', data: { dead_holder: { window: deadHolder.windowId, caller: deadHolder.caller, started_at: deadHolder.startedAt }, new_holder: { window: _windowId, caller } } });
  }
  getGlobalRecorder()?.record({ type: 'debate.lifecycle', component: 'run-lease', level: 'info', debate_id: debateId, message: 'Adaptive loop lease acquired', data: { window: _windowId, caller } });
  return { ok: true, lease: makeLease(debateId, entry) };
}

/** Who already holds `debateId` (this window or another), or null if it's free. With
 *  `supersedeLocal`, this window's own lease is invalidated instead of reported. */
function existingHolder(debateId: string, caller: string, supersedeLocal: boolean): LeaseHolder | null {
  const mine = _local.get(debateId);
  if (mine && !mine.lost) {
    if (!supersedeLocal) return holderOfLocal(mine);
    mine.lost = true;
    _local.delete(debateId);
    getGlobalRecorder()?.record({ type: 'debate.lifecycle', component: 'run-lease', level: 'info', debate_id: debateId, message: 'Adaptive loop lease superseded by this window', data: { window: _windowId, superseded_caller: mine.caller, new_caller: caller } });
  }
  return _remote.get(debateId) ?? null;
}

function makeLease(debateId: string, entry: LocalEntry): RunLease {
  return {
    debateId,
    caller: entry.caller,
    isValid: () => _local.get(debateId) === entry && !entry.lost,
    release: () => {
      if (_local.get(debateId) !== entry) return;
      _local.delete(debateId);
      syncTimer();
      post({ type: 'release', debateId, windowId: _windowId });
      getGlobalRecorder()?.record({ type: 'debate.lifecycle', component: 'run-lease', level: 'info', debate_id: debateId, message: 'Adaptive loop lease released', data: { window: _windowId, caller: entry.caller, held_ms: Date.now() - entry.startedAt, lost: entry.lost } });
      emit({ type: 'local-released', debateId });
    },
  };
}

/** True when THIS window holds a live lease for the debate. */
export function isRunLeaseHeldLocally(debateId: string | null | undefined): boolean {
  if (!debateId) return false;
  const entry = _local.get(debateId);
  return !!entry && !entry.lost;
}

/** The live remote holder for the debate, if another window holds it (expired holders are swept first). */
export function getRemoteRunLeaseHolder(debateId: string | null | undefined): LeaseHolder | null {
  if (!debateId) return null;
  sweepExpired();
  return _remote.get(debateId) ?? null;
}

/** Holder → viewers: a save landed. Viewers refresh from it; it also counts as a heartbeat. */
export function notifyDebateSaved(debateId: string): void {
  if (isRunLeaseHeldLocally(debateId)) post({ type: 'saved', debateId, windowId: _windowId });
}

// ── Test hooks ───────────────────────────────────────────────────────

export function __setRunLeaseTimingForTests(t: Partial<typeof timing>): void {
  Object.assign(timing, t);
}

export function __resetRunLeasesForTests(): void {
  _local.clear();
  _remote.clear();
  if (_timer) { clearInterval(_timer); _timer = null; }
  Object.assign(timing, { heartbeatMs: 5_000, ttlMs: 90_000, settleMs: 150 });
}

/** Feed a message as if it arrived from another window (cross-window tests without a real channel). */
export function __deliverRunLeaseMessageForTests(msg: LeaseMessage): void {
  handleMessage(msg);
}
