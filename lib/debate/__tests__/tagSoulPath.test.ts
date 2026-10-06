// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3989 — tag soul path canonicalization.
// Verifies that both loaders and the helper use spec §3: soul-docs/<pov>.<tag>.soul.json.
// These tests would fail on origin/main before t/3989 (tags/ subdir, reversed name order).

import { describe, it, expect, afterEach } from 'vitest';
import { tagSoulFileName, loadPovTagRegistry } from '../../schema/povTags.js';
import { getSoulDocument, clearSoulDocCache } from '../soulDocLoader.js';

afterEach(() => {
  clearSoulDocCache();
});

describe('tagSoulFileName helper', () => {
  it('returns spec path: <pov>.<tag>.soul.json', () => {
    expect(tagSoulFileName('skeptic', 'critical')).toBe('skeptic.critical.soul.json');
  });

  it('does not use tags/ subdirectory (pre-fix regression guard)', () => {
    expect(tagSoulFileName('skeptic', 'critical')).not.toContain('tags/');
  });

  it('does not reverse pov/tag order (pre-fix regression guard)', () => {
    // Old code would produce critical.skeptic.soul.json
    expect(tagSoulFileName('skeptic', 'critical')).not.toMatch(/^critical/);
  });
});

describe('Node loader error path references spec path', () => {
  it('throws with spec-path filename when tag soul file is absent', () => {
    expect(() => getSoulDocument('skeptic', 'nonexistent-tag')).toThrowError(
      /skeptic\.nonexistent-tag\.soul\.json/,
    );
  });

  it('error does not reference tags/ subdirectory', () => {
    let msg = '';
    try { getSoulDocument('skeptic', 'nonexistent-tag'); } catch (e) { msg = String(e); }
    expect(msg).not.toContain('tags/nonexistent-tag.skeptic');
  });
});

describe('registry round-trip: every committed entry resolves via spec path', () => {
  it('Node loader finds soul file for every registered (pov, tag) pair', () => {
    const registry = loadPovTagRegistry();
    const missing: string[] = [];
    for (const [pov, entries] of Object.entries(registry.povs)) {
      for (const entry of entries ?? []) {
        try {
          getSoulDocument(pov as 'accelerationist' | 'safetyist' | 'skeptic', entry.id);
        } catch {
          missing.push(tagSoulFileName(pov, entry.id));
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
