// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { resolvePoverInfo } from './tagSoulRegistry.js';
import { POVER_INFO } from './poverInfo.js';

describe('resolvePoverInfo (no tagSelection)', () => {
  it('returns POVER_INFO soul for each base speaker', () => {
    for (const speaker of ['accelerationist', 'safetyist', 'skeptic'] as const) {
      const { soul } = resolvePoverInfo(speaker);
      expect(soul).toBe(POVER_INFO[speaker]);
    }
  });

  it('returns soulProvenance with expected file path', () => {
    const { soulProvenance } = resolvePoverInfo('safetyist');
    expect(soulProvenance.file).toBe('soul-docs/safetyist.soul.json');
  });

  it('returns soulProvenance sha as 16 hex chars', () => {
    const { soulProvenance } = resolvePoverInfo('skeptic');
    expect(soulProvenance.sha).toMatch(/^[0-9a-f]{16}$/);
  });

  it('sha is deterministic across calls', () => {
    const { soulProvenance: p1 } = resolvePoverInfo('accelerationist');
    const { soulProvenance: p2 } = resolvePoverInfo('accelerationist');
    expect(p1.sha).toBe(p2.sha);
  });
});

describe('resolvePoverInfo (tagSelection — tag absent from registry)', () => {
  it('throws ActionableError when tag soul is not in the bundle', () => {
    expect(() =>
      resolvePoverInfo('accelerationist', { tag: 'nonexistent-tag', mode: 'scope' }),
    ).toThrow(/nonexistent-tag/i);
  });

  it('throws for prioritize mode too', () => {
    expect(() =>
      resolvePoverInfo('skeptic', { tag: 'missing', mode: 'prioritize' }),
    ).toThrow(/missing/i);
  });
});
