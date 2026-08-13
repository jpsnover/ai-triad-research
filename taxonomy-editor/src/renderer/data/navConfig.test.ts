// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression for t/2599: the Op-Eds nav item is gated on `env-electron-opeds`. The bug
// was that Toolbar/HamburgerMenu READ the flag but omitted it from the `navCtx.flags`
// passed to getVisibleNavItems — and getVisibleNavItems treats an absent flag as falsy
// (`!ctx.flags[item.gate.flag]`), so the gate could never pass, hiding the tool even
// with the flag ON. These assert the gate BOTH ways plus the omitted-flag case, which
// is the class of miss that hid this (flag read but not threaded into the nav context).

import { describe, it, expect } from 'vitest';
import { NAV_ITEMS, getVisibleNavItems } from './navConfig';

const hasOpeds = (flags: Record<string, boolean>): boolean =>
  getVisibleNavItems(NAV_ITEMS, { flags, isAdmin: false }).some(i => i.id === 'opeds');

describe('navConfig — env-electron-opeds gate (t/2599)', () => {
  it('shows the Op-Eds item when the flag is present and true', () => {
    expect(hasOpeds({ 'env-electron-opeds': true })).toBe(true);
  });

  it('hides the Op-Eds item when the flag is present and false', () => {
    expect(hasOpeds({ 'env-electron-opeds': false })).toBe(false);
  });

  it('hides the Op-Eds item when the flag is OMITTED from navCtx — the t/2599 bug', () => {
    // Toolbar/HamburgerMenu built navCtx.flags without env-electron-opeds; an absent
    // flag is falsy, so the item was always filtered out even with the flag on.
    expect(hasOpeds({ 'env-electron-summaries': true })).toBe(false);
  });

  it('gate is independent — the summaries flag does not reveal Op-Eds', () => {
    expect(hasOpeds({ 'env-electron-summaries': true, 'env-electron-opeds': false })).toBe(false);
  });
});
