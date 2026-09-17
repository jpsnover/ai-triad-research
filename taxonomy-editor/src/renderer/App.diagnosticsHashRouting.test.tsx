// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression test for t/3508: the diagnostics popout hash route used strict
// equality (`hash === '#diagnostics-window'`), so a shareable deep-link with
// query params (`#diagnostics-window?debateId=xxx`) never matched and the
// window rendered blank. Fixed to `hash.startsWith('#diagnostics-window')`,
// matching the pattern already used by the sibling `#debate-window` route.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// Must be declared before the deferred App import so vitest hoists them.
vi.mock('@bridge', () => ({
  api: { getCliFileArg: vi.fn().mockResolvedValue(null) },
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
// Sentinel component so the test can assert the diagnostics route (not some
// other hash branch) actually rendered, without pulling in the real window's
// deep dependency graph.
vi.mock('./components/debate-diagnostics', () => ({
  DiagnosticsWindow: () => <div data-testid="diagnostics-window-sentinel" />,
}));

// Deferred import — mocks above must be hoisted before App.tsx loads.
const { App } = await import('./App');

describe('App diagnostics hash routing (t/3508)', () => {
  const originalHash = window.location.hash;

  beforeEach(() => {
    // Bridge-ready gate (t/2767): present electronAPI so App doesn't block on it.
    (window as unknown as { electronAPI?: unknown }).electronAPI = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.location.hash = originalHash;
    delete (window as Record<string, unknown>).electronAPI;
  });

  it('renders DiagnosticsWindow for a bare #diagnostics-window hash (AC#2 — no-param regression)', async () => {
    window.location.hash = '#diagnostics-window';
    render(<App />);
    expect(await screen.findByTestId('diagnostics-window-sentinel')).toBeTruthy();
  });

  it('renders DiagnosticsWindow for #diagnostics-window?debateId=xxx (AC#1 — deep link)', async () => {
    window.location.hash = '#diagnostics-window?debateId=abc-123';
    render(<App />);
    expect(await screen.findByTestId('diagnostics-window-sentinel')).toBeTruthy();
  });

  it('reacts to a hashchange into the diagnostics deep-link route', async () => {
    window.location.hash = '';
    render(<App />);
    await act(async () => {
      window.location.hash = '#diagnostics-window?debateId=xyz-789';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(await screen.findByTestId('diagnostics-window-sentinel')).toBeTruthy();
  });
});
