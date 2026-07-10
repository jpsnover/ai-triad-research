// @vitest-environment node

/**
 * t/1458 — key-validation probe completeness.
 *
 * The Test Keys feature reported "Unsupported backend" for openai/deepseek/zai
 * because validateProviderKey() was never updated when those backends were added
 * (the gap recurred 3×). This test is the guard that catches the *next* backend
 * addition: it asserts every backend registered in ai-models.json (except the
 * local-only ones) has an entry in KEY_VALIDATION_PROBES, so a new backend can't
 * ship without a validation probe.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { KEY_VALIDATION_PROBES } from '../routes/keys.js';

// ai-models.json is the canonical backend registry at the repo root. Resolve it
// relative to this test file (deterministic) rather than via getProjectRoot(),
// which is cwd-sensitive under vitest. __tests__ → server → src → taxonomy-editor
// → repo root.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

// Local-only backends have no hosted key to validate against a provider endpoint
// (per t/1458 AC) — intentionally excluded from the completeness requirement.
const LOCAL_ONLY = new Set(['ollama', 'azure']);

describe('key-validation probe completeness (t/1458)', () => {
  it('every registered backend except local-only has a validation probe', () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'ai-models.json'), 'utf-8'),
    ) as { backends?: { id: string }[] };

    const registered = (config.backends ?? []).map(b => b.id).filter(id => !LOCAL_ONLY.has(id));
    expect(registered.length).toBeGreaterThan(0); // guard: config actually loaded

    const missing = registered.filter(id => !KEY_VALIDATION_PROBES[id]);
    expect(
      missing,
      `Backend(s) [${missing.join(', ')}] have no key-validation probe in routes/keys.ts — ` +
      `Test Keys will report "Unsupported backend" for them. Add each to KEY_VALIDATION_PROBES.`,
    ).toEqual([]);
  });

  it('does not carry probes for local-only backends (they have no hosted key)', () => {
    for (const id of LOCAL_ONLY) {
      expect(KEY_VALIDATION_PROBES[id]).toBeUndefined();
    }
  });
});
