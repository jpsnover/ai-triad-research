// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, beforeEach } from 'vitest';
import { loadSoulDocuments, getSoulDocument, resolvePoverInfo, clearSoulDocCache } from './soulDocLoader.js';
import { POVER_INFO } from './poverInfo.js';

beforeEach(() => {
  clearSoulDocCache();
});

describe('loadSoulDocuments', () => {
  it('loads exactly 3 base souls', () => {
    const docs = loadSoulDocuments();
    expect(docs.size).toBe(3);
    expect([...docs.keys()].sort()).toEqual(['accelerationist', 'safetyist', 'skeptic']);
  });

  it('each soul has non-empty boundaries', () => {
    const docs = loadSoulDocuments();
    for (const [pov, soul] of docs) {
      expect(soul.boundaries.hardcoded.length, `${pov} hardcoded boundaries`).toBeGreaterThan(0);
      expect(soul.boundaries.softcoded.length, `${pov} softcoded boundaries`).toBeGreaterThan(0);
    }
  });

  it('pov field matches the key', () => {
    const docs = loadSoulDocuments();
    for (const [pov, soul] of docs) {
      expect(soul.pov).toBe(pov);
    }
  });

  it('returns cached instance on second call', () => {
    const first = loadSoulDocuments();
    const second = loadSoulDocuments();
    expect(second).toBe(first);
  });
});

describe('getSoulDocument (base souls)', () => {
  it('returns a soul for each character', () => {
    for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
      const soul = getSoulDocument(pov);
      expect(soul.pov).toBe(pov);
    }
  });
});

describe('resolvePoverInfo (no tagSelection)', () => {
  it('returns POVER_INFO soul for base path', () => {
    const { soul } = resolvePoverInfo('accelerationist');
    expect(soul).toBe(POVER_INFO.accelerationist);
  });

  it('returns soulProvenance with file path and sha', () => {
    const { soulProvenance } = resolvePoverInfo('safetyist');
    expect(soulProvenance.file).toMatch(/safetyist\.soul\.json$/);
    expect(soulProvenance.sha).toMatch(/^[0-9a-f]{16}$/);
  });

  it('provenance sha is consistent across calls', () => {
    const { soulProvenance: p1 } = resolvePoverInfo('skeptic');
    clearSoulDocCache();
    const { soulProvenance: p2 } = resolvePoverInfo('skeptic');
    expect(p1.sha).toBe(p2.sha);
  });
});

describe('resolvePoverInfo (tagSelection — tag file absent)', () => {
  it('throws ActionableError when tag soul file does not exist', () => {
    expect(() =>
      resolvePoverInfo('accelerationist', { tag: 'nonexistent-tag', mode: 'scope' }),
    ).toThrow(/nonexistent-tag/i);
  });
});
