// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Parity test: both loaders must return identical { file, hash } for every committed soul (t/4007 condition #3).
// Differences would silently break t/3963 cross-run comparisons.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { resolvePoverInfo as nodeResolve, clearSoulDocCache } from './soulDocLoader.js';
import { resolvePoverInfo as browserResolve } from './tagSoulRegistry.js';
import { buildSoulProvenance } from './soulDocSchema.js';
import type { TagSelection } from './types/session.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOUL_DOCS_DIR = resolve(__dirname, 'soul-docs');

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

// Condition 6: debate path vs op-ed path — same file + same encoding → same hash (t/4007).
// Op-ed generate.ts reads each soul via readFileSync(path, 'utf-8') + buildSoulProvenance, identically
// to soulDocLoader. This arm catches any divergence in encoding, BOM handling, or file path resolution.
describe('soul provenance parity — debate loader vs op-ed read path', () => {
  const ALL_SOULS: { name: string; speaker: typeof BASE_SPEAKERS[number]; tag?: string }[] = [
    ...BASE_SPEAKERS.map(s => ({ name: `${s}.soul.json`, speaker: s })),
    { name: 'skeptic.critical.soul.json', speaker: 'skeptic', tag: 'critical' },
    { name: 'skeptic.institutional.soul.json', speaker: 'skeptic', tag: 'institutional' },
  ];

  beforeEach(() => clearSoulDocCache());

  for (const { name, speaker, tag } of ALL_SOULS) {
    it(`${name}: debate loader and op-ed read path produce identical provenance`, () => {
      // Op-ed path: readFileSync + buildSoulProvenance (mirrors generate.ts:loadSoulDoc)
      const raw = readFileSync(resolve(SOUL_DOCS_DIR, name), 'utf-8');
      const opedProv = buildSoulProvenance(name, raw);

      // Debate path: resolvePoverInfo (Node loader)
      const tagSelection = tag ? ({ tag, mode: 'scope' } as TagSelection) : undefined;
      const { soulProvenance: debateProv } = nodeResolve(speaker, tagSelection);

      expect(debateProv.file).toBe(opedProv.file);
      expect(debateProv.hash).toBe(opedProv.hash);
    });
  }
});
