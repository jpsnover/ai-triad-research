// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3989 — tag soul path canonicalization.
// Verifies that both loaders and the helper use spec §3: soul-docs/<pov>.<tag>.soul.json.
// These tests would fail on origin/main before t/3989 (tags/ subdir, reversed name order).

import { describe, it, expect, afterEach } from 'vitest';
import { tagSoulFileName, loadPovTagRegistry } from '../../schema/povTags.js';
import { getSoulDocument, clearSoulDocCache, applyBaseIdentity } from '../soulDocLoader.js';
import { POVER_INFO } from '../poverInfo.js';
import type { SoulDocument } from '../soulDocSchema.js';

// Minimal valid SoulDocument fixture — label/pov are intentionally wrong
// to verify applyBaseIdentity overrides them with the base soul values (t/3988).
const FAKE_TAG_SOUL: SoulDocument = {
  pov: 'skeptic',
  tag: 'critical',
  label: 'Critical',
  color: '#555555',
  personality: 'critical-wing personality',
  voice: {
    disposition: 'skeptical',
    style: 'analytical',
    reasoning: 'evidence-based',
    evidence: 'empirical',
    signature: 'probing the assumption',
    prose_style: 'clear and measured',
    voice_hygiene: 'avoid jargon and rhetoric',
    prose_style_short: 'measured',
    voice_hygiene_short: 'clear',
  },
  anti_patterns: ['false precision'],
  value_hierarchy: ['accuracy', 'clarity'],
  epistemic_stance: ['falsifiable claims', 'calibrated uncertainty'],
  boundaries: {
    hardcoded: ['no ad hominem'],
    softcoded: ['prefer empirical over speculative'],
  },
};

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

describe('applyBaseIdentity: base identity enforced on tag souls (t/3988 parity)', () => {
  it('returns baseSoul.label, not the tag soul label', () => {
    const soul = applyBaseIdentity(FAKE_TAG_SOUL, 'skeptic');
    expect(soul.label).toBe(POVER_INFO.skeptic.label);
    expect(soul.label).not.toBe('Critical');
  });

  it('returns baseSoul.pov, not the tag soul pov', () => {
    const soul = applyBaseIdentity(FAKE_TAG_SOUL, 'skeptic');
    expect(soul.pov).toBe(POVER_INFO.skeptic.pov);
  });

  it('preserves voice from the tag soul', () => {
    const soul = applyBaseIdentity(FAKE_TAG_SOUL, 'skeptic');
    expect(soul.voice.disposition).toBe('skeptical');
    expect(soul.voice.prose_style).toBe('clear and measured');
  });

  it('mutation guard: the merge overrides label even if tag soul label differs', () => {
    const altered: SoulDocument = { ...FAKE_TAG_SOUL, label: POVER_INFO.skeptic.label };
    const soul = applyBaseIdentity(altered, 'skeptic');
    expect(soul.label).toBe(POVER_INFO.skeptic.label);
  });
});
