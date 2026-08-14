// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression guard for t/2641 (prevention for t/2599 + t/2633).
//
// Toolbar and HamburgerMenu used to build `navCtx.flags` from a HARDCODED subset of
// `useFlag()` calls. `getVisibleNavItems` treats an absent flag as falsy, so any nav
// gate referencing a flag missing from that subset silently hid its item even with the
// flag ON — twice (t/2599 env-electron-opeds; t/2633 env-web-opeds, caught by a live
// prod smoke, not a test, because the existing unit tests fed getVisibleNavItems a
// hand-built flag map and never exercised the broken plumbing).
//
// Both components now build navCtx through the single `useNavVisibilityContext` hook,
// which threads the WHOLE flag record. This test drives that hook — the actual navCtx
// constructor — and fails if any nav-gate flag fails to reach navCtx.flags. If a future
// change reintroduces a subset that omits a gate flag, the per-flag assertion below
// turns red.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

let mockFlags: Record<string, boolean> = {};

vi.mock('./useFeatureFlags', () => ({
  useFeatureFlagStore: (selector: (s: { flags: Record<string, boolean> }) => unknown) =>
    selector({ flags: mockFlags }),
  useFlag: (name: string) => mockFlags[name] ?? false,
}));

import { useNavVisibilityContext } from './useNavVisibilityContext';
import { NAV_ITEMS, NAV_GATE_FLAGS, getVisibleNavItems } from '../data/navConfig';

const ctxFor = (flags: Record<string, boolean>) => {
  mockFlags = flags;
  return renderHook(() => useNavVisibilityContext()).result.current;
};

describe('useNavVisibilityContext — whole-record threading (t/2641)', () => {
  beforeEach(() => {
    mockFlags = {};
  });

  it('has at least the two historically-dropped gate flags', () => {
    // Sanity: the flags whose omission caused t/2599 and t/2633 are gate flags.
    expect(NAV_GATE_FLAGS).toContain('env-electron-opeds');
    expect(NAV_GATE_FLAGS).toContain('env-web-opeds');
  });

  it('threads EVERY nav-gate flag into navCtx.flags — the t/2599 + t/2633 class', () => {
    // A subset that forgets any gate flag would leave it absent here (undefined),
    // which getVisibleNavItems reads as falsy → the item is hidden with the flag ON.
    const allOn = Object.fromEntries(NAV_GATE_FLAGS.map(f => [f, true]));
    const ctx = ctxFor(allOn);
    for (const flag of NAV_GATE_FLAGS) {
      expect(ctx.flags[flag], `gate flag "${flag}" was not threaded into navCtx`).toBe(true);
    }
  });

  it('each gate flag, alone, reveals its gated item end-to-end', () => {
    // Drives the full path: hook builds navCtx → getVisibleNavItems filters. Would have
    // caught t/2633: env-web-opeds ON must reveal Op-Eds even with env-electron-opeds off.
    for (const flag of NAV_GATE_FLAGS) {
      const before = getVisibleNavItems(NAV_ITEMS, ctxFor({})).map(i => i.id);
      const after = getVisibleNavItems(NAV_ITEMS, ctxFor({ [flag]: true })).map(i => i.id);
      const revealed = after.filter(id => !before.includes(id));
      expect(revealed.length, `flag "${flag}" revealed no nav item`).toBeGreaterThan(0);
    }
  });

  it('passes the store record through by reference (no per-flag copy to drift)', () => {
    const flags = { 'env-web-opeds': true };
    expect(ctxFor(flags).flags).toBe(flags);
  });

  it('wires isAdmin to the permission-admin-features flag', () => {
    expect(ctxFor({}).isAdmin).toBe(false);
    expect(ctxFor({ 'permission-admin-features': true }).isAdmin).toBe(true);
  });
});
