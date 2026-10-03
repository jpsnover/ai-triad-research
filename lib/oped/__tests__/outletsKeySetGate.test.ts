// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3865 (t/3819 child E) — TS consumer's half of the outlet key-set parity
// gate. Companion to tests/OutletsKeySetGate.Tests.ps1 (PS consumer) and
// tests/OutletKeySetVerdict.Tests.ps1 (the comparator's own both GV arms, on
// synthetic fixtures). Split by language rather than shelling cross-process
// from PowerShell into node/tsx — measured directly that invoking `tsx
// <file>` (any real .ts file) from inside a Pester BeforeAll on this agent
// triggers a spurious Pester crash (pester/Pester#2669); vitest already runs
// real TS natively, so there is nothing to shell out to here.
//
// What this gate does NOT cover (t/3819 route enumeration, stated not
// implied): styleDefaults prose (single-sourced after B/C/D, nothing to
// compare), behavior for an unknown outlet (validation layer —
// resolveOutletBand / t/3854's tests, not this data gate), docs/ux/oped-
// studio.md prose (permanently uncoverable by any key-set gate).

import { describe, it, expect } from 'vitest';
import { OUTLET_BANDS, resolveOutletBand } from '../outletBands.js';
import outletsData from '../outlets.json' with { type: 'json' };

describe('Outlet key-set parity — TS consumer (live, against real repo files)', () => {
  const ssotKeys = Object.keys(outletsData.outlets);
  const tsKeys = Object.keys(OUTLET_BANDS);

  it('reads a non-empty SSOT key set', () => {
    expect(ssotKeys.length).toBeGreaterThan(0);
  });

  it('reads a non-empty TS realized key set (the gate must assert its own output shape, t/3819 Finding 2)', () => {
    expect(tsKeys.length).toBeGreaterThan(0);
  });

  it('SSOT __meta__.outlets_count matches the actual key count', () => {
    expect(outletsData.__meta__.outlets_count).toBe(ssotKeys.length);
  });

  it('arm 1 — TS realized key set equals the SSOT key set exactly', () => {
    expect(tsKeys.slice().sort()).toEqual(ssotKeys.slice().sort());
    expect(tsKeys.length).toBe(ssotKeys.length);
  });

  it('resolveOutletBand resolves every SSOT key (no key present but unreachable)', () => {
    for (const key of ssotKeys) {
      expect(() => resolveOutletBand(key)).not.toThrow();
    }
  });
});
