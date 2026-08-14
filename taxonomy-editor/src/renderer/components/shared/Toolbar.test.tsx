// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression tests for t/2142: Zustand inline-object selector caused infinite
// render loop ("Maximum update depth exceeded"). Scalar selectors fix it;
// a successful render() call here proves the fix holds.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Store mocks ──────────────────────────────────────────────────────────────

const mockTaxonomyStore = {
  activeTab: 'accelerationist',
  setActiveTab: vi.fn(),
  toolbarPanel: null as string | null,
  setToolbarPanel: vi.fn(),
  selectedNodeId: null as string | null,
  selectedEdge: null,
  relatedNodeId: null,
};

vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: () => mockTaxonomyStore,
}));

const mockPrefsState = {
  viewMode: 'simple' as 'simple' | 'advanced',
  setViewMode: vi.fn(),
  hydrate: vi.fn(),
};

// Selector-aware mock — each scalar call returns the primitive directly,
// so Zustand's strict-equality check sees a stable value each render.
vi.mock('../../store/preferencesStore', () => ({
  usePreferencesStore: (selector: (s: typeof mockPrefsState) => unknown) =>
    selector(mockPrefsState),
}));

// ── Bridge / flight-recorder mocks ───────────────────────────────────────────

vi.mock('@bridge', () => ({
  isElectronMode: () => true,
  api: {
    adminReviewStats: vi.fn().mockResolvedValue({ total: 0 }),
    adminReviewConfigured: vi.fn().mockResolvedValue(false),
    openChatWindow: vi.fn(),
    openExternal: vi.fn(),
    clipboardWriteText: vi.fn(),
  },
}));

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));

// ── Auth / feature-flag / tier mocks ─────────────────────────────────────────

vi.mock('../../hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({ anonymous: false, user: { name: 'Test' }, loading: false }),
  useUserProfile: () => null,
}));

// Configurable feature flags (t/2641). Both useFlag and the whole-record store selector
// read the same source, so a test can reveal Op-Eds via EITHER build flag and prove the
// component threads it (the drift that hid Op-Eds on web — t/2599, t/2633).
const { mockFlags } = vi.hoisted(() => ({ mockFlags: { value: {} as Record<string, boolean> } }));
vi.mock('../../hooks/useFeatureFlags', () => ({
  useFlag: (name: string) => mockFlags.value[name] ?? false,
  useFeatureFlagStore: (selector: (s: { flags: Record<string, boolean> }) => unknown) => selector({ flags: mockFlags.value }),
}));

vi.mock('../../hooks/useTierInfo', () => ({
  useTierInfo: () => ({ tier: null, usage: null, loading: false, refresh: vi.fn() }),
}));

// ── Heavy child stubs ─────────────────────────────────────────────────────────

vi.mock('../settings/HelpDialog', () => ({ HelpDialog: () => null }));
vi.mock('../settings/SettingsDialog', () => ({ SettingsDialog: () => null }));
vi.mock('./FeedbackPopover', () => ({ FeedbackPopover: () => null }));

// ── Component under test ──────────────────────────────────────────────────────

import { Toolbar } from './Toolbar';

describe('Toolbar — Zustand scalar selector regression (t/2142)', () => {
  beforeEach(() => {
    mockPrefsState.viewMode = 'simple';
    mockPrefsState.setViewMode.mockClear();
  });

  it('renders without infinite loop in simple mode', () => {
    // Pre-fix (db9a67ba): inline object selector created new ref every render
    // → Zustand re-subscribed → re-render → "Maximum update depth exceeded"
    expect(() => render(<Toolbar />)).not.toThrow();
  });

  it('renders without infinite loop in advanced mode', () => {
    mockPrefsState.viewMode = 'advanced';
    expect(() => render(<Toolbar />)).not.toThrow();
  });

  it('shows view-mode toggle button in simple mode', () => {
    render(<Toolbar />);
    expect(
      screen.getByRole('button', { name: /switch to advanced view/i }),
    ).toBeInTheDocument();
  });

  it('shows view-mode toggle button in advanced mode', () => {
    mockPrefsState.viewMode = 'advanced';
    render(<Toolbar />);
    expect(
      screen.getByRole('button', { name: /switch to simple view/i }),
    ).toBeInTheDocument();
  });

  it('calls setViewMode with advanced when toggled from simple', async () => {
    render(<Toolbar />);
    await userEvent.click(
      screen.getByRole('button', { name: /switch to advanced view/i }),
    );
    expect(mockPrefsState.setViewMode).toHaveBeenCalledWith('advanced');
  });

  it('calls setViewMode with simple when toggled from advanced', async () => {
    mockPrefsState.viewMode = 'advanced';
    render(<Toolbar />);
    await userEvent.click(
      screen.getByRole('button', { name: /switch to simple view/i }),
    );
    expect(mockPrefsState.setViewMode).toHaveBeenCalledWith('simple');
  });
});

describe('Toolbar — Op-Eds reveal honors both build flags (t/2641)', () => {
  beforeEach(() => { mockFlags.value = {}; mockPrefsState.viewMode = 'simple'; });

  it('hides the Op-Eds button when neither build flag is set', () => {
    render(<Toolbar />);
    expect(screen.queryByRole('button', { name: 'Op-Eds' })).toBeNull();
  });

  // The web-reveal case that the hardcoded env-electron-opeds gate (Toolbar line 340) missed:
  // env-web-opeds ON, env-electron-opeds absent → the primary Op-Eds button MUST appear.
  it('shows the Op-Eds button when only env-web-opeds is on (web reveal)', () => {
    mockFlags.value = { 'env-web-opeds': true };
    render(<Toolbar />);
    expect(screen.getByRole('button', { name: 'Op-Eds' })).toBeInTheDocument();
  });

  it('shows the Op-Eds button when only env-electron-opeds is on (desktop, unchanged)', () => {
    mockFlags.value = { 'env-electron-opeds': true };
    render(<Toolbar />);
    expect(screen.getByRole('button', { name: 'Op-Eds' })).toBeInTheDocument();
  });
});
