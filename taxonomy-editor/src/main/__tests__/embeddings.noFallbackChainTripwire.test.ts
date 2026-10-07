// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/4048 (SO e/275#4): servedModel's exemption comment in embeddings.ts's generateText says
// "THIS EXEMPTION LAPSES the moment this function starts walking registry.fallbackChains" — but
// a comment only helps if the person adding chain-walking reads it. This is the tripwire that
// makes the lapse a red build instead of a silently-stale comment: desktop's generateText must
// never reference fallbackChains, getFallbackChain or buildModelsToTry. It's crude (name-matched,
// not behavioral), but it turns "THIS LAPSES" into something that actually fails.
//
// Deliberately reads the REAL file from disk with plain fs (no vi.mock) — the behavioral
// servedModel tests (embeddings.servedModel.test.ts) mock fs for registry loading, which would
// shadow a real disk read if combined here.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMBEDDINGS_SOURCE = fs.readFileSync(path.join(__dirname, '../embeddings.ts'), 'utf-8');

const BANNED = ['fallbackChains', 'getFallbackChain', 'buildModelsToTry'];

describe('servedModel exemption tripwire (t/4048, SO e/275#4)', () => {
  for (const name of BANNED) {
    it(`embeddings.ts does not reference "${name}"`, () => {
      expect(
        EMBEDDINGS_SOURCE.includes(name),
        `servedModel exemption lapsed (e/275): servedModel must become the answering link; add e/268#6 condition 4's forced-fallback test.`,
      ).toBe(false);
    });
  }
});
