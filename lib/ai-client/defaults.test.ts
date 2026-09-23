// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3573 — DEFAULT_MODEL is a hardcoded const that duplicates ai-models.json
// `debateTiers.basic.gemini`. It MUST stay a const, not a dynamic registry read: defaults.ts is
// consumed at module-load time (e.g. judgeAudit.ts builds a const tier map at import) and its own
// comment warns it is used before the registry finishes loading — a dynamic resolve would read
// `undefined` pre-init and reintroduce the exact t/2687 null-default bug. So instead of removing the
// duplication we GATE it: this test fails CI if the const ever drifts from the SSOT, closing the TS
// half of the PS<->TS tier-default alignment (the PS side resolves via Get-AITierModel, t/3564).
// Mechanism approved by PowerShell (creator) over the ticket's original "dynamic resolve" framing.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { DEFAULT_MODEL } from './defaults.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// lib/ai-client/ -> lib/ -> repo root
const REPO_ROOT = path.resolve(__dirname, '../../');

interface Registry {
  debateTiers: Record<string, string | Record<string, string>>;
}

describe('DEFAULT_MODEL <-> ai-models.json debateTiers.basic.gemini (t/3573)', () => {
  const registry: Registry = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'ai-models.json'), 'utf-8'),
  );
  const basic = registry.debateTiers?.basic;
  // basic carries per-backend id strings; a leading "_comment" string key may sit alongside tier maps
  // at the debateTiers top level, but a tier value itself is the backend->id map.
  const basicGemini = basic && typeof basic === 'object' ? basic.gemini : undefined;

  it('the authority exists (empty-authority guard — prevents a vacuous pass)', () => {
    expect(basicGemini, 'debateTiers.basic.gemini is missing from ai-models.json').toBeTruthy();
  });

  it('DEFAULT_MODEL equals debateTiers.basic.gemini — no silent PS<->TS drift', () => {
    // If this fails: the registry's basic-tier gemini model changed but lib/ai-client/defaults.ts
    // DEFAULT_MODEL did not follow (or vice-versa). Update the const to match the SSOT — do NOT make
    // DEFAULT_MODEL a dynamic registry read (breaks the pre-init path, t/2687).
    expect(DEFAULT_MODEL).toBe(basicGemini);
  });
});
