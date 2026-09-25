// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Tests for the mobile hamburger drawer's hash-route nav buttons (t/3678). Community Library was
// reachable on desktop (Toolbar's account popover) but absent here entirely; Admin Review already
// worked both places. Covers: the new Community Library button's flag gating, and that Admin
// Review is unaffected by the HashNavButton extraction.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockTaxonomyStore = {
  activeTab: 'accelerationist',
  setActiveTab: vi.fn(),
  toolbarPanel: null as string | null,
  setToolbarPanel: vi.fn(),
  selectedNodeId: null as string | null,
  clearSimilarSearch: vi.fn(),
  showRelatedEdges: vi.fn(),
  attributeFilter: null,
  runAttributeFilter: vi.fn(),
  clearAttributeFilter: vi.fn(),
  attributeInfo: null,
  showAttributeInfo: vi.fn(),
  clearAttributeInfo: vi.fn(),
  loadAll: vi.fn(),
  loading: false,
};
vi.mock('../../hooks/useTaxonomyStore', () => ({ useTaxonomyStore: () => mockTaxonomyStore }));

vi.mock('@bridge', () => ({ isElectronMode: () => false }));
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));

vi.mock('../../hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({ anonymous: false, user: 'test-user', loading: false }),
}));
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => 'desktop' }));

const { mockFlags } = vi.hoisted(() => ({ mockFlags: { value: {} as Record<string, boolean> } }));
vi.mock('../../hooks/useFeatureFlags', () => ({
  useFlag: (name: string) => mockFlags.value[name] ?? false,
  useFeatureFlagStore: (selector: (s: { flags: Record<string, boolean> }) => unknown) =>
    selector({ flags: mockFlags.value }),
}));

vi.mock('../settings/HelpDialog', () => ({ HelpDialog: () => null }));
vi.mock('../settings/SettingsDialog', () => ({ SettingsDialog: () => null }));
vi.mock('./FeedbackPopover', () => ({ FeedbackPopover: () => null }));

const { HamburgerMenu } = await import('./HamburgerMenu');

describe('HamburgerMenu — Community Library + Admin Review hash-nav buttons (t/3678)', () => {
  beforeEach(() => { mockFlags.value = {}; window.location.hash = ''; });

  it('hides Community Library when env-web-community-library is off', () => {
    render(<HamburgerMenu isOpen onClose={vi.fn()} />);
    expect(screen.queryByText('Community Library')).not.toBeInTheDocument();
  });

  it('shows Community Library when env-web-community-library is on', () => {
    mockFlags.value = { 'env-web-community-library': true };
    render(<HamburgerMenu isOpen onClose={vi.fn()} />);
    expect(screen.getByText('Community Library')).toBeInTheDocument();
  });

  it('hides Admin Review for a non-admin, non-Electron session', () => {
    render(<HamburgerMenu isOpen onClose={vi.fn()} />);
    expect(screen.queryByText('Admin Review')).not.toBeInTheDocument();
  });

  it('shows Admin Review when permission-admin-features is on — unaffected by the HashNavButton extraction', () => {
    mockFlags.value = { 'permission-admin-features': true };
    render(<HamburgerMenu isOpen onClose={vi.fn()} />);
    expect(screen.getByText('Admin Review')).toBeInTheDocument();
  });

  it('shows both when both are enabled, in Community-then-Admin order', () => {
    mockFlags.value = { 'env-web-community-library': true, 'permission-admin-features': true };
    render(<HamburgerMenu isOpen onClose={vi.fn()} />);
    const items = screen.getAllByText(/Community Library|Admin Review/);
    expect(items.map(el => el.textContent)).toEqual(['Community Library', 'Admin Review']);
  });
});
