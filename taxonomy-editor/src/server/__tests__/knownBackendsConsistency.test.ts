// @vitest-environment node

/**
 * t/1997 — structural gate for the moonshot-class omission.
 *
 * `KNOWN_BACKENDS` (runtimeConfig.ts) is a hand-maintained array. A backend added
 * to `ai-models.json` + the adapters but NOT to `KNOWN_BACKENDS` is silently dropped
 * by `vBackends()` for every tier — exactly how `moonshot` slipped through (PR #216).
 * Neither the warn-log (t/1995, surfaces only in prod flight recorders) nor the
 * checklist (t/1996, human memory) catches it at merge time. This does.
 *
 * Invariant (one-way subset, NOT equality): every backend id that has models
 * registered in ai-models.json is present in KNOWN_BACKENDS —
 *     aiModelsBackends ⊆ KNOWN_BACKENDS.
 * The reverse is deliberately NOT asserted: KNOWN_BACKENDS may legitimately hold
 * infra/routing backends that enumerate no model family, so asserting equality would
 * false-red on those. Since we only assert the subset direction, no azure/ollama
 * exemption list is needed here (both DO appear in ai-models.json anyway).
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { KNOWN_BACKENDS } from '../runtimeConfig.js';

// ai-models.json lives at the repo root — resolve relative to this test file
// (__tests__ → server → src → taxonomy-editor → repo root). getProjectRoot() is
// NOT used here: in the vitest source context it resolves to taxonomy-editor/, not
// the repo root, so it can't find the file (it works only from the compiled dist).
const AI_MODELS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../ai-models.json');

/** Distinct backend ids that have at least one model registered in ai-models.json. */
function aiModelsBackendIds(): string[] {
  const raw = fs.readFileSync(AI_MODELS_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as { models?: Array<{ backend?: unknown }> };
  const ids = new Set<string>();
  for (const m of parsed.models ?? []) {
    if (typeof m.backend === 'string' && m.backend) ids.add(m.backend);
  }
  return [...ids].sort();
}

describe('KNOWN_BACKENDS consistency (t/1997)', () => {
  it('every backend with models registered in ai-models.json is in KNOWN_BACKENDS', () => {
    const known = new Set<string>(KNOWN_BACKENDS as readonly string[]);
    const modelsBackends = aiModelsBackendIds();

    // Sanity: the source-of-truth read succeeded and is non-empty (guards against a
    // silently-empty ai-models.json turning this gate into a vacuous pass).
    expect(modelsBackends.length).toBeGreaterThan(0);

    const missing = modelsBackends.filter(b => !known.has(b));
    // A non-empty `missing` names the dropped backend(s) — add them to KNOWN_BACKENDS
    // in runtimeConfig.ts so vBackends() stops silently dropping them from every tier.
    expect(missing).toEqual([]);
  });
});
