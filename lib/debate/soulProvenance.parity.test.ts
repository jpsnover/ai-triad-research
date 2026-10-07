// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Parity test: both loaders must return identical { file, hash } for every committed soul (t/4007 condition #3).
// Differences would silently break t/3963 cross-run comparisons.

import { describe, it, expect, beforeEach } from 'vitest';
import { resolvePoverInfo as nodeResolve, clearSoulDocCache } from './soulDocLoader.js';
import { resolvePoverInfo as browserResolve } from './tagSoulRegistry.js';
import { opedSoulProvenance } from '../oped/generate.js';
import type { TagSelection } from './types/session.js';

const BASE_SPEAKERS = ['accelerationist', 'safetyist', 'skeptic'] as const;
const TAG_CASES: { speaker: typeof BASE_SPEAKERS[number]; tag: string }[] = [
  { speaker: 'skeptic', tag: 'critical' },
  { speaker: 'skeptic', tag: 'institutional' },
];

describe('soul provenance parity — Node loader vs browser registry', () => {
  beforeEach(() => clearSoulDocCache());

  for (const speaker of BASE_SPEAKERS) {
    it(`base soul ${speaker}: file and hash match`, () => {
      const node = nodeResolve(speaker);
      const browser = browserResolve(speaker);
      expect(browser.soulProvenance.file).toBe(node.soulProvenance.file);
      expect(browser.soulProvenance.hash).toBe(node.soulProvenance.hash);
    });
  }

  for (const { speaker, tag } of TAG_CASES) {
    const tagSelection: TagSelection = { tag, mode: 'scope' };
    it(`tag soul ${speaker}/${tag}: file and hash match`, () => {
      const node = nodeResolve(speaker, tagSelection);
      const browser = browserResolve(speaker, tagSelection);
      expect(browser.soulProvenance.file).toBe(node.soulProvenance.file);
      expect(browser.soulProvenance.hash).toBe(node.soulProvenance.hash);
    });
  }

  it('all file fields are soul-docs-relative (no absolute paths, no directory prefix)', () => {
    for (const speaker of BASE_SPEAKERS) {
      const { soulProvenance } = nodeResolve(speaker);
      // file is relative to soul-docs/ — just a basename, no directory prefix
      expect(soulProvenance.file).toMatch(/\.soul\.json$/);
      expect(soulProvenance.file).not.toMatch(/^soul-docs\//);
      expect(soulProvenance.file).not.toMatch(/^[A-Za-z]:\\/);
      expect(soulProvenance.file).not.toMatch(/^\//);
    }
  });
});

// Condition 6: debate path vs op-ed path (t/4007).
// generate.ts calls getSoulDocument + resolvePoverInfo for base souls (one reader — parity by
// construction). opedSoulProvenance is the exported API boundary; this suite is a regression guard:
// if a future change gives generate.ts its own readFileSync, its hash will diverge from nodeResolve's.
// Tag souls call resolvePoverInfo directly (pre-t/4007), so also covered by construction.
describe('soul provenance parity — debate loader vs op-ed read path', () => {
  beforeEach(() => clearSoulDocCache());

  for (const speaker of BASE_SPEAKERS) {
    it(`base soul ${speaker}: opedSoulProvenance equals nodeResolve provenance`, () => {
      const opedProv = opedSoulProvenance(speaker);
      const { soulProvenance: debateProv } = nodeResolve(speaker);
      expect(opedProv).toEqual(debateProv);
    });
  }
});
