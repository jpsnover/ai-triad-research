// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SoulDocumentSchema, compareSoulProvenance } from './soulDocSchema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const soulDocsDir = resolve(__dirname, 'soul-docs');

const CHARACTERS = ['accelerationist', 'safetyist', 'skeptic'] as const;

function loadSoulDoc(pov: string): unknown {
  const raw = readFileSync(resolve(soulDocsDir, `${pov}.soul.json`), 'utf-8');
  return JSON.parse(raw);
}

describe('Soul document schema validation', () => {
  for (const pov of CHARACTERS) {
    it(`${pov}.soul.json validates against schema`, () => {
      const doc = loadSoulDoc(pov);
      const result = SoulDocumentSchema.safeParse(doc);
      if (!result.success) {
        throw new Error(`Schema validation failed for ${pov}:\n${JSON.stringify(result.error.issues, null, 2)}`);
      }
      expect(result.data.pov).toBe(pov);
    });
  }

  for (const pov of CHARACTERS) {
    it(`${pov}.soul.json has both hardcoded and softcoded boundaries`, () => {
      const doc = SoulDocumentSchema.parse(loadSoulDoc(pov));
      expect(doc.boundaries.hardcoded.length).toBeGreaterThanOrEqual(1);
      expect(doc.boundaries.softcoded.length).toBeGreaterThanOrEqual(1);
    });
  }

  for (const pov of CHARACTERS) {
    it(`${pov}.soul.json has all voice spec fields`, () => {
      const doc = SoulDocumentSchema.parse(loadSoulDoc(pov));
      expect(doc.voice.disposition).toBeTruthy();
      expect(doc.voice.style).toBeTruthy();
      expect(doc.voice.reasoning).toBeTruthy();
      expect(doc.voice.evidence).toBeTruthy();
      expect(doc.voice.signature).toBeTruthy();
      expect(doc.voice.prose_style).toBeTruthy();
      expect(doc.voice.voice_hygiene).toBeTruthy();
      expect(doc.voice.prose_style_short).toBeTruthy();
      expect(doc.voice.voice_hygiene_short).toBeTruthy();
    });
  }

  it('all 3 soul documents have distinct pov values', () => {
    const povs = CHARACTERS.map(c => SoulDocumentSchema.parse(loadSoulDoc(c)).pov);
    expect(new Set(povs).size).toBe(3);
  });
});

// Tag souls (<pov>.<tag>.soul.json, t/3956). The registry pair check (lib/schema/povTags.test.ts) only proves
// each file EXISTS; this proves each one is a valid soul whose pov/tag match its filename, and that a base
// soul carries no tag.
describe('Tag soul document schema validation', () => {
  const tagSouls = readdirSync(soulDocsDir).filter(f => /^[a-z]+\.[a-z0-9-]+\.soul\.json$/.test(f));

  it('finds the committed tag souls', () => {
    expect(tagSouls.length).toBeGreaterThan(0);
  });

  for (const file of tagSouls) {
    it(`${file} validates, and its pov/tag match the filename`, () => {
      const [pov, tag] = file.split('.');
      const result = SoulDocumentSchema.safeParse(JSON.parse(readFileSync(resolve(soulDocsDir, file), 'utf-8')));
      if (!result.success) {
        throw new Error(`Schema validation failed for ${file}:\n${JSON.stringify(result.error.issues, null, 2)}`);
      }
      expect(result.data.pov).toBe(pov);
      expect(result.data.tag).toBe(tag);
      expect(result.data.boundaries.hardcoded.length).toBeGreaterThanOrEqual(1);
      expect(result.data.boundaries.softcoded.length).toBeGreaterThanOrEqual(1);
    });
  }

  for (const pov of CHARACTERS) {
    it(`${pov}.soul.json (a base soul) carries no tag`, () => {
      expect(SoulDocumentSchema.parse(loadSoulDoc(pov)).tag).toBeUndefined();
    });
  }
});

describe('compareSoulProvenance (e/261#3 cond 1)', () => {
  const fnv = (hex: string) => ({ file: 'safetyist.soul.json', hash: `fnv1a64:${hex}` });
  const sha256 = (hex: string) => ({ file: 'safetyist.soul.json', hash: `sha256:${hex}` });
  const legacy = (hex: string) => ({ file: 'safetyist.soul.json', hash: hex });
  const legacySha = (hex: string) => ({ file: 'safetyist.soul.json', sha: hex });

  it('returns same when fnv hash and file match', () => {
    expect(compareSoulProvenance(fnv('abcd1234abcd1234'), fnv('abcd1234abcd1234'))).toBe('same');
  });

  it('returns different when fnv hash differs', () => {
    expect(compareSoulProvenance(fnv('abcd1234abcd1234'), fnv('1111222233334444'))).toBe('different');
  });

  it('returns different when file differs (same hash)', () => {
    expect(compareSoulProvenance(
      { file: 'safetyist.soul.json', hash: 'fnv1a64:abcd1234abcd1234' },
      { file: 'skeptic.soul.json', hash: 'fnv1a64:abcd1234abcd1234' },
    )).toBe('different');
  });

  it('returns unknown when algorithms differ (sha256 vs fnv1a64)', () => {
    expect(compareSoulProvenance(sha256('abcd1234abcd1234'), fnv('abcd1234abcd1234'))).toBe('unknown');
  });

  it('returns unknown when either side is undefined', () => {
    expect(compareSoulProvenance(fnv('abcd1234abcd1234'), undefined)).toBe('unknown');
    expect(compareSoulProvenance(undefined, fnv('abcd1234abcd1234'))).toBe('unknown');
    expect(compareSoulProvenance(undefined, undefined)).toBe('unknown');
  });

  it('normalises legacy unprefixed hash as sha256', () => {
    expect(compareSoulProvenance(legacy('abcd1234abcd1234'), sha256('abcd1234abcd1234'))).toBe('same');
  });

  it('normalises legacy sha field (pre-t/4007 op-ed shape)', () => {
    expect(compareSoulProvenance(legacySha('abcd1234abcd1234'), legacy('abcd1234abcd1234'))).toBe('same');
  });

  it('normalises repo-relative file path to soul-docs-relative', () => {
    const repoRel = { file: 'lib/debate/soul-docs/safetyist.soul.json', hash: 'fnv1a64:abcd1234abcd1234' };
    expect(compareSoulProvenance(repoRel, fnv('abcd1234abcd1234'))).toBe('same');
  });

  // e/261#5/#6/#7: strict hash validation — empty/absent/prefix-only/garbage → unknown
  it('returns unknown when both hashes are empty (absent hash coerced to empty)', () => {
    expect(compareSoulProvenance({ file: 'safetyist.soul.json', hash: '' }, { file: 'safetyist.soul.json', hash: '' })).toBe('unknown');
  });

  it('returns unknown when one hash is empty', () => {
    expect(compareSoulProvenance(fnv('abcd1234abcd1234'), { file: 'safetyist.soul.json', hash: '' })).toBe('unknown');
    expect(compareSoulProvenance({ file: 'safetyist.soul.json', hash: '' }, fnv('abcd1234abcd1234'))).toBe('unknown');
  });

  it('returns unknown for prefix-only hash (empty digest after colon)', () => {
    expect(compareSoulProvenance({ file: 'safetyist.soul.json', hash: 'fnv1a64:' }, { file: 'safetyist.soul.json', hash: 'fnv1a64:' })).toBe('unknown');
    expect(compareSoulProvenance({ file: 'safetyist.soul.json', hash: 'sha256:' }, { file: 'safetyist.soul.json', hash: 'sha256:' })).toBe('unknown');
  });

  it('returns unknown for garbage string without colon', () => {
    expect(compareSoulProvenance({ file: 'safetyist.soul.json', hash: 'garbage' }, { file: 'safetyist.soul.json', hash: 'garbage' })).toBe('unknown');
  });

  it('returns unknown when hash is absent (undefined)', () => {
    expect(compareSoulProvenance({ file: 'safetyist.soul.json' }, { file: 'safetyist.soul.json' })).toBe('unknown');
    expect(compareSoulProvenance(fnv('abcd1234abcd1234'), { file: 'safetyist.soul.json' })).toBe('unknown');
  });
});
