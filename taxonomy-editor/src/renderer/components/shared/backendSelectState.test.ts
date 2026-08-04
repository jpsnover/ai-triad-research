// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2036 — locks the 3-state de-conflation at the kit boundary. The original bug was
// collapsing "no key" and "tier-forbidden" into one disabled "(not on your tier)"; these
// assertions guarantee no-key stays SELECTABLE (BYOK) and only tier-forbidden is restricted.

import { describe, it, expect } from 'vitest';
import { backendSelectState } from './backendSelectState';

describe('backendSelectState (t/2036)', () => {
  it('#1 has key + tier-ok → selectable, plain label', () => {
    expect(backendSelectState({ available: true }, true)).toEqual({ selectable: true, suffix: '' });
  });

  it('#2 no key but BYOK-permitted → selectable, "(bring your own key)"', () => {
    expect(backendSelectState({ available: false, reason: 'no_key' }, false))
      .toEqual({ selectable: true, suffix: ' (bring your own key)' });
  });

  it('#3 tier forbids BYOK → NOT selectable, "(sign in to use)"', () => {
    expect(backendSelectState({ available: false, reason: 'tier_restricted' }, false))
      .toEqual({ selectable: false, suffix: ' (sign in to use)' });
  });

  it('tier_restricted stays restricted even if a local key is present (server 403s it)', () => {
    // Guards the web-anonymous trap: a stored key must NOT unlock a tier-forbidden backend.
    expect(backendSelectState({ available: false, reason: 'tier_restricted' }, true).selectable).toBe(false);
  });

  it('missing entry (availability not loaded) → never disabled; falls back to key presence', () => {
    // No entry + has key → plain #1; no entry + no key → BYOK prompt #2. Never blocks selection.
    expect(backendSelectState(undefined, true)).toEqual({ selectable: true, suffix: '' });
    expect(backendSelectState(undefined, false)).toEqual({ selectable: true, suffix: ' (bring your own key)' });
  });
});
