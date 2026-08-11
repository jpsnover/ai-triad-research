// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * DwellTracker — engagement/dwell-time tracking (t/2466).
 * Web-only, no-op in Electron. See docs/ux/usage-analytics-instrumentation.md §2-§3.
 *
 * A "visit" is a contiguous span during which one subject (a taxonomy node,
 * a toolbar panel, or a tab) is the active focus. On visit close we emit a
 * `view.dwell` event via analyticsEmitter carrying both `wall_ms` (raw span)
 * and `engaged_ms` (time actually engaged — visible + recently interacted).
 *
 * Ordering requirement: `initDwellTracker()` must be called BEFORE
 * `initAnalytics()` in App.tsx so that this module's `beforeunload` listener
 * (which pushes the final `view.dwell` event into the emitter's buffer) runs
 * before the emitter's own `beforeunload` handler flushes that buffer via
 * `sendBeacon`. Browsers invoke same-type listeners in registration order.
 */

import { getClientConfig } from './clientConfig';
import { trackViewDwell } from './analyticsEmitter';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

const isWeb = import.meta.env.VITE_TARGET === 'web';

export type SubjectType = 'node' | 'tab' | 'panel';
export type CloseReason = 'subject_change' | 'idle' | 'hidden' | 'unload';

export interface EngagementThresholds {
  IDLE_TIMEOUT_MS: number;
  MAX_ENGAGED_MS: number;
  ENGAGED_MIN_MS: number;
  MIN_VISIT_MS: number;
  PULSE_THROTTLE_MS: number;
}

export interface Subject {
  subject_type: SubjectType;
  subject_id: string;
  pov: string | null;
  cat: string | null;
  tab: string;
}

export interface DwellDetail {
  subject_type: SubjectType;
  subject_id: string;
  pov: string | null;
  cat: string | null;
  tab: string;
  engaged_ms: number;
  wall_ms: number;
  engaged: boolean;
  capped: boolean;
  close_reason: CloseReason;
}

/** Camp tabs map 1:1 to a pov code; used when a camp tab is the subject with no node selected. */
const CAMP_TAB_TO_POV: Record<string, string> = {
  accelerationist: 'acc',
  safetyist: 'saf',
  skeptic: 'skp',
};

/** Parse `{pov}-{cat}-{NNN}` node IDs into their camp/category parts. */
export function parseNodeId(nodeId: string): { pov: string | null; cat: string | null } {
  const parts = nodeId.split('-');
  return { pov: parts[0] ?? null, cat: parts[1] ?? null };
}

/** Derive the current dwell subject from the taxonomy store's navigation fields. */
export function deriveSubject(
  activeTab: string,
  selectedNodeId: string | null,
  toolbarPanel: string | null,
): Subject {
  if (selectedNodeId) {
    const { pov, cat } = parseNodeId(selectedNodeId);
    return { subject_type: 'node', subject_id: selectedNodeId, pov, cat, tab: activeTab };
  }
  if (toolbarPanel) {
    return { subject_type: 'panel', subject_id: toolbarPanel, pov: null, cat: null, tab: activeTab };
  }
  const campPov = CAMP_TAB_TO_POV[activeTab] ?? null;
  return {
    subject_type: 'tab',
    subject_id: campPov ?? activeTab,
    pov: campPov,
    cat: null,
    tab: activeTab,
  };
}

/** Event `category` per §2.3: "taxonomy", or the tab id for non-taxonomy subjects. */
export function categoryForSubject(subject: Subject): string {
  if (subject.subject_type === 'node') return 'taxonomy';
  if (subject.subject_type === 'tab' && subject.pov) return 'taxonomy';
  return subject.tab;
}

/**
 * Pure engaged-time accumulator (§3.1-3.2). Tracks spans where the subject was
 * both visible and recently interacted with, clamped to `maxEngagedMs`. No
 * busy polling — accrual happens only on explicit state-transition calls.
 */
export class EngagementAccumulator {
  private engagedSince: number | null = null;
  private engagedMs = 0;
  private capped = false;

  constructor(private readonly maxEngagedMs: number) {}

  get isEngaged(): boolean {
    return this.engagedSince !== null;
  }

  get currentEngagedMs(): number {
    return this.engagedMs;
  }

  get isCapped(): boolean {
    return this.capped;
  }

  /** Start (or continue, idempotently) an engaged span at time t. */
  startEngaged(t: number): void {
    if (this.engagedSince === null) this.engagedSince = t;
  }

  /** Stop the current engaged span at time t, accruing its duration (clamped). */
  stopEngaged(t: number): void {
    if (this.engagedSince === null) return;
    this.accrue(t - this.engagedSince);
    this.engagedSince = null;
  }

  private accrue(deltaMs: number): void {
    if (deltaMs <= 0) return;
    const remaining = this.maxEngagedMs - this.engagedMs;
    if (remaining <= 0) {
      this.capped = true;
      return;
    }
    if (deltaMs >= remaining) {
      this.engagedMs += remaining;
      this.capped = true;
    } else {
      this.engagedMs += deltaMs;
    }
  }

  /** Close any open span at time t and return the final accumulated result. */
  finish(t: number): { engagedMs: number; capped: boolean } {
    this.stopEngaged(t);
    return { engagedMs: this.engagedMs, capped: this.capped };
  }
}

/** One open "visit" — a subject plus its engagement accumulator and wall-clock start. */
export class DwellVisit {
  private readonly accumulator: EngagementAccumulator;
  private readonly startWall: number;

  constructor(
    private readonly subject: Subject,
    startWall: number,
    thresholds: EngagementThresholds,
    initiallyEngaged: boolean,
  ) {
    this.startWall = startWall;
    this.accumulator = new EngagementAccumulator(thresholds.MAX_ENGAGED_MS);
    if (initiallyEngaged) this.accumulator.startEngaged(startWall);
  }

  pulse(t: number): void {
    this.accumulator.startEngaged(t);
  }

  pause(t: number): void {
    this.accumulator.stopEngaged(t);
  }

  get isEngaged(): boolean {
    return this.accumulator.isEngaged;
  }

  /**
   * Close the visit at time t. Returns the dwell detail to emit, or null if
   * the visit is below MIN_VISIT_MS (debounced per §3.3) and should be dropped.
   */
  close(t: number, reason: CloseReason, thresholds: EngagementThresholds): DwellDetail | null {
    const wallMs = t - this.startWall;
    const { engagedMs, capped } = this.accumulator.finish(t);
    if (wallMs < thresholds.MIN_VISIT_MS) return null;
    return {
      subject_type: this.subject.subject_type,
      subject_id: this.subject.subject_id,
      pov: this.subject.pov,
      cat: this.subject.cat,
      tab: this.subject.tab,
      engaged_ms: engagedMs,
      wall_ms: wallMs,
      engaged: engagedMs >= thresholds.ENGAGED_MIN_MS,
      capped,
      close_reason: reason,
    };
  }
}

/** Same-key check: is this a genuinely different subject (should the visit close)? */
function sameSubject(a: Subject, b: Subject): boolean {
  return a.subject_type === b.subject_type && a.subject_id === b.subject_id;
}

/**
 * Orchestrates visit open/close + engagement transitions. DOM/timer wiring is
 * kept thin (`initDwellTracker`); this class is the testable core — all its
 * methods take an explicit timestamp so tests can drive it deterministically.
 */
export class DwellTracker {
  private currentVisit: DwellVisit | null = null;
  private currentSubject: Subject | null = null;
  private visible = true;
  private lastPulseTime = 0;

  constructor(private readonly getThresholds: () => EngagementThresholds) {}

  private emitClose(t: number, reason: CloseReason): void {
    if (!this.currentVisit) return;
    const thresholds = this.getThresholds();
    const detail = this.currentVisit.close(t, reason, thresholds);
    if (detail) {
      trackViewDwell(categoryForSubject(this.currentSubject as Subject), detail);
    }
    this.currentVisit = null;
    this.currentSubject = null;
  }

  private recentlyActive(t: number): boolean {
    return t - this.lastPulseTime < this.getThresholds().IDLE_TIMEOUT_MS;
  }

  /** Open a new visit for `subject` at time t (does not close any prior visit). */
  private openVisit(subject: Subject, t: number): void {
    const thresholds = this.getThresholds();
    const initiallyEngaged = this.visible && this.recentlyActive(t);
    this.currentVisit = new DwellVisit(subject, t, thresholds, initiallyEngaged);
    this.currentSubject = subject;
  }

  /** Called when the taxonomy store's navigation fields change. */
  onSubjectChange(subject: Subject, t: number): void {
    if (this.currentSubject && sameSubject(this.currentSubject, subject)) return;
    if (this.currentVisit) this.emitClose(t, 'subject_change');
    this.openVisit(subject, t);
  }

  /** Called on a (throttled) interaction pulse. */
  onPulse(t: number): void {
    this.lastPulseTime = t;
    if (this.visible) this.currentVisit?.pulse(t);
  }

  /** Called when the idle timer fires (no pulse for IDLE_TIMEOUT_MS). */
  onIdleTimeout(t: number): void {
    if (!this.recentlyActive(t)) this.emitClose(t, 'idle');
  }

  /** Called on `visibilitychange`. */
  onVisibilityChange(hidden: boolean, t: number): void {
    this.visible = !hidden;
    if (hidden) {
      this.currentVisit?.pause(t);
    } else if (this.recentlyActive(t)) {
      this.currentVisit?.pulse(t);
    }
  }

  /** Called when the tab has been hidden for IDLE_TIMEOUT_MS+ (from a scheduled timer). */
  onHiddenTimeout(t: number): void {
    if (!this.visible) this.emitClose(t, 'hidden');
  }

  /** Called on `beforeunload`. */
  onUnload(t: number): void {
    this.emitClose(t, 'unload');
  }

  hasOpenVisit(): boolean {
    return this.currentVisit !== null;
  }
}

let tracker: DwellTracker | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
let lastPulseProcessed = 0;
let initialized = false;
let unsubscribeStore: (() => void) | null = null;

function scheduleIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  const { IDLE_TIMEOUT_MS } = getClientConfig().analytics;
  idleTimer = setTimeout(() => {
    tracker?.onIdleTimeout(Date.now());
  }, IDLE_TIMEOUT_MS);
}

function handleRawPulse(): void {
  if (!tracker) return;
  const t = Date.now();
  if (t - lastPulseProcessed < getClientConfig().analytics.PULSE_THROTTLE_MS) return;
  lastPulseProcessed = t;
  tracker.onPulse(t);
  scheduleIdleTimer();
}

function handleVisibilityChange(): void {
  if (!tracker) return;
  const hidden = document.hidden;
  const t = Date.now();
  tracker.onVisibilityChange(hidden, t);
  if (hidden) {
    const { IDLE_TIMEOUT_MS } = getClientConfig().analytics;
    if (hiddenTimer) clearTimeout(hiddenTimer);
    hiddenTimer = setTimeout(() => {
      tracker?.onHiddenTimeout(Date.now());
    }, IDLE_TIMEOUT_MS);
  } else if (hiddenTimer) {
    clearTimeout(hiddenTimer);
    hiddenTimer = null;
  }
}

const PULSE_EVENTS = ['pointermove', 'keydown', 'scroll', 'wheel', 'click'] as const;

/** Initialize dwell tracking. Call once, before `initAnalytics()`. No-op in Electron. */
export async function initDwellTracker(): Promise<void> {
  if (!isWeb || initialized) return;
  initialized = true;
  tracker = new DwellTracker(() => getClientConfig().analytics);

  for (const evt of PULSE_EVENTS) {
    window.addEventListener(evt, handleRawPulse, { passive: true });
  }
  document.addEventListener('visibilitychange', handleVisibilityChange);

  try {
    const { useTaxonomyStore } = await import('../hooks/useTaxonomyStore');
    const seed = useTaxonomyStore.getState();
    tracker.onSubjectChange(
      deriveSubject(seed.activeTab, seed.selectedNodeId, seed.toolbarPanel),
      Date.now(),
    );
    unsubscribeStore = useTaxonomyStore.subscribe((state, prev) => {
      if (
        state.activeTab === prev.activeTab &&
        state.selectedNodeId === prev.selectedNodeId &&
        state.toolbarPanel === prev.toolbarPanel
      ) {
        return;
      }
      try {
        tracker?.onSubjectChange(
          deriveSubject(state.activeTab, state.selectedNodeId, state.toolbarPanel),
          Date.now(),
        );
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'dwellTracker',
          level: 'error',
          message: 'onSubjectChange failed',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
      }
    });
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'dwellTracker',
      level: 'error',
      message: 'store subscription failed (store not available yet)',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
  }

  window.addEventListener('beforeunload', () => {
    tracker?.onUnload(Date.now());
  });
}

/** Stop dwell tracking and tear down listeners (test/teardown use). */
export function stopDwellTracker(): void {
  if (!initialized) return;
  for (const evt of PULSE_EVENTS) {
    window.removeEventListener(evt, handleRawPulse);
  }
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (hiddenTimer) { clearTimeout(hiddenTimer); hiddenTimer = null; }
  unsubscribeStore?.();
  unsubscribeStore = null;
  tracker = null;
  initialized = false;
}
