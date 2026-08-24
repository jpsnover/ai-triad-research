// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression test for t/2774 (prevention for t/2772 bug #2):
// When window.electronAPI is absent past TIMEOUT_MS, App must show the
// "Desktop bridge unavailable" error — not a blank screen.
// The inverted if(bridgeError)/if(!bridgeReady) guard order was the original bug.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// Must be declared before the deferred App import so vitest hoists them.
vi.mock('@bridge', () => ({
  api: {},
  isElectronMode: () => false,
  emitBriefTimeout: vi.fn(),
  emitBriefRetriesExhausted: vi.fn(),
  setActiveDebateId: vi.fn(),
}));
vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));
vi.mock('./lib/clientConfig', () => ({ initClientConfig: vi.fn() }));
vi.mock('./lib/flightRecorderInit', () => ({ initFlightRecorder: vi.fn() }));
vi.mock('./lib/swEventListener', () => ({ initSwEventListener: vi.fn() }));
vi.mock('./lib/initAnalyticsSession', () => ({ initAnalyticsSession: vi.fn() }));
vi.mock('./hooks/useFeatureFlags', () => ({
  useFeatureFlagStore: { getState: () => ({ refresh: vi.fn() }) },
  useFlag: () => false,
}));
vi.mock('./hooks/useTheoryLinkHotkey', () => ({ useTheoryLinkHotkey: vi.fn() }));
vi.mock('./utils/recordingLazy', () => ({
  recordingLazy: () => () => null,
}));

// Deferred import — mocks above must be hoisted before App.tsx loads.
const { App } = await import('./App');

describe('App bridge-error fallback (t/2774)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Ensure electronAPI is not present so the bridge poller runs.
    if ('electronAPI' in window) {
      delete (window as Record<string, unknown>).electronAPI;
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('renders "Desktop bridge unavailable" after timeout — not blank', async () => {
    // Spy on performance.now so the elapsed-time check in the bridge poller fires immediately:
    //   start = 0 (first call), subsequent calls = 3000 → 3000 - 0 > TIMEOUT_MS (2000).
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValue(3000);

    render(<App />);

    // Advance by more than the poller interval (5 ms) so the callback fires.
    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    const el = screen.queryByText(/Desktop bridge unavailable/);
    expect(el).not.toBeNull();
  });
});
