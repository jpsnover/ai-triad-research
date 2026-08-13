// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { resolvePovMeta, resolvePovMetaKey, resolveCampKey } from './povResolve';

// Guards the pov-key drift that crashed the revealed Op-Ed My tab (t/2605 follow-up):
// persisted OpEdMember.pov carries the SHORT camp code ('acc'), but POV_META is keyed by
// the full PovKey ('accelerationist'). These resolvers accept both and never throw.

describe('resolvePovMetaKey', () => {
  it('maps short camp codes to the full POV_META key', () => {
    expect(resolvePovMetaKey('acc')).toBe('accelerationist');
    expect(resolvePovMetaKey('saf')).toBe('safetyist');
    expect(resolvePovMetaKey('skp')).toBe('skeptic');
  });

  it('passes full PovKeys through unchanged', () => {
    expect(resolvePovMetaKey('accelerationist')).toBe('accelerationist');
    expect(resolvePovMetaKey('skeptic')).toBe('skeptic');
  });

  it('returns undefined for an unknown code', () => {
    expect(resolvePovMetaKey('bogus')).toBeUndefined();
  });
});

describe('resolvePovMeta', () => {
  it('resolves a short code to its POV_META entry', () => {
    const meta = resolvePovMeta('acc');
    expect(meta.label).toBe('Accelerationist');
    expect(meta.shortLabel).toBe('Acc');
  });

  it('never throws on an unknown code — returns a neutral fallback', () => {
    const meta = resolvePovMeta('bogus');
    expect(meta.shortLabel).toBe('—');
    expect(meta.label).toBe('Unknown');
  });
});

describe('resolveCampKey', () => {
  it('yields the short camp key for both forms', () => {
    expect(resolveCampKey('acc')).toBe('acc');
    expect(resolveCampKey('accelerationist')).toBe('acc');
  });

  it('returns undefined for an unknown code', () => {
    expect(resolveCampKey('bogus')).toBeUndefined();
  });
});
