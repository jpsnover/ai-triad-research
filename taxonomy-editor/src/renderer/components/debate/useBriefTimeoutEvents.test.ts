// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression tests for brief-timeout UX (t/2210).
// Verifies that synthetic bridge events drive toast → dialog state transitions
// without depending on live AI calls or real IPC.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBriefTimeoutEvents } from './useBriefTimeoutEvents';
import { useDebateStore } from '../../hooks/useDebateStore';

// ── Bridge mock ─────────────────────────────────────────────────────────────

type TimeoutCb = (e: { debateId: string; speaker: string; attempt: number; maxAttempts: number; currentModel: string }) => void;
type ExhaustedCb = (e: { debateId: string; speaker: string; totalAttempts: number; currentModel: string }) => void;

let timeoutCb: TimeoutCb | null = null;
let exhaustedCb: ExhaustedCb | null = null;

vi.mock('@bridge', () => ({
  api: {
    onBriefTimeout: (cb: TimeoutCb) => { timeoutCb = cb; return () => { timeoutCb = null; }; },
    onBriefRetriesExhausted: (cb: ExhaustedCb) => { exhaustedCb = cb; return () => { exhaustedCb = null; }; },
  },
}));

const mockRunOpeningStatements = vi.fn();
vi.mock('../../hooks/useDebateStore', () => ({
  useDebateStore: {
    setState: vi.fn(),
    getState: vi.fn(() => ({ runOpeningStatements: mockRunOpeningStatements })),
  },
}));

// retryWithModel aborts the in-flight pipeline (t/2505) — mock the guard so we can assert
// it fires and keep this a hermetic hook test (no real abort-controller/store side effects).
// vi.hoisted so the fn exists before the hoisted vi.mock factory references it.
const mockCancelAndResetAbort = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/useDebateStore/shared/guards', () => ({
  cancelAndResetAbort: mockCancelAndResetAbort,
}));

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => null,
}));

const DEBATE_ID = 'test-debate-abc';

function emitTimeout(attempt = 1, maxAttempts = 3, speaker = 'safetyist', currentModel = 'gemini-flash') {
  timeoutCb?.({ debateId: DEBATE_ID, speaker, attempt, maxAttempts, currentModel });
}

function emitExhausted(totalAttempts = 3, speaker = 'safetyist', currentModel = 'gemini-flash') {
  exhaustedCb?.({ debateId: DEBATE_ID, speaker, totalAttempts, currentModel });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('useBriefTimeoutEvents', () => {
  beforeEach(() => {
    timeoutCb = null;
    exhaustedCb = null;
    vi.clearAllMocks();
  });

  it('shows toast on brief-timeout event', () => {
    const { result } = renderHook(() => useBriefTimeoutEvents(DEBATE_ID));
    expect(result.current.toastData).toBeNull();

    act(() => emitTimeout(1, 3));

    expect(result.current.toastData).not.toBeNull();
    expect(result.current.toastData?.speakerLabel).toBe('Safetyist');
    expect(result.current.toastData?.attempt).toBe(1);
    expect(result.current.toastData?.maxAttempts).toBe(3);
  });

  it('dismisses toast on dismissToast', () => {
    const { result } = renderHook(() => useBriefTimeoutEvents(DEBATE_ID));
    act(() => emitTimeout());
    expect(result.current.toastData).not.toBeNull();

    act(() => result.current.dismissToast());
    expect(result.current.toastData).toBeNull();
  });

  it('clears toast and shows dialog on retries-exhausted event', () => {
    const { result } = renderHook(() => useBriefTimeoutEvents(DEBATE_ID));
    act(() => emitTimeout(3, 3));
    expect(result.current.toastData).not.toBeNull();

    act(() => emitExhausted(3));

    expect(result.current.toastData).toBeNull();
    expect(result.current.dialogData).not.toBeNull();
    expect(result.current.dialogData?.speakerLabel).toBe('Safetyist');
    expect(result.current.dialogData?.totalAttempts).toBe(3);
  });

  it('promoteToDiag moves toast to dialog early (mid-retry switch)', () => {
    const { result } = renderHook(() => useBriefTimeoutEvents(DEBATE_ID));
    act(() => emitTimeout(1, 3));
    expect(result.current.toastData).not.toBeNull();

    act(() => result.current.promoteToDiag());

    expect(result.current.toastData).toBeNull();
    expect(result.current.dialogData).not.toBeNull();
    expect(result.current.dialogData?.currentModel).toBe('gemini-flash');
  });

  it('retryWithModel aborts the in-flight run, clears the guard, and restarts on the new model (t/2505)', () => {
    const { result } = renderHook(() => useBriefTimeoutEvents(DEBATE_ID));
    act(() => emitExhausted());

    act(() => result.current.retryWithModel('claude-sonnet-5'));

    expect(result.current.dialogData).toBeNull();
    // Aborts the superseded pipeline so it stops burning attempts on the old model...
    expect(mockCancelAndResetAbort).toHaveBeenCalledTimes(1);
    // ...sets the new model AND clears debateGenerating so the re-entry guard doesn't
    // block the restart (the original no-op bug)...
    expect(useDebateStore.setState).toHaveBeenCalledWith({ debateModel: 'claude-sonnet-5', debateGenerating: null });
    // ...then kicks off the fresh run.
    expect(mockRunOpeningStatements).toHaveBeenCalledTimes(1);
    // Abort must happen before the restart, else the new run's fresh controller would be
    // torn down. (invocationCallOrder increases with call sequence.)
    expect(mockCancelAndResetAbort.mock.invocationCallOrder[0])
      .toBeLessThan(mockRunOpeningStatements.mock.invocationCallOrder[0]);
  });

  it('ignores events for a different debateId', () => {
    const { result } = renderHook(() => useBriefTimeoutEvents(DEBATE_ID));
    act(() => timeoutCb?.({ debateId: 'other-debate', speaker: 'safetyist', attempt: 1, maxAttempts: 3, currentModel: 'x' }));
    expect(result.current.toastData).toBeNull();
  });

  it('unsubscribes from bridge on unmount', () => {
    const { unmount } = renderHook(() => useBriefTimeoutEvents(DEBATE_ID));
    expect(timeoutCb).not.toBeNull();
    unmount();
    expect(timeoutCb).toBeNull();
  });
});
