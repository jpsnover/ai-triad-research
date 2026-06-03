// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
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
