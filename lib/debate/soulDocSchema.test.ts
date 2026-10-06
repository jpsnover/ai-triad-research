// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SoulDocumentSchema } from './soulDocSchema.js';

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
