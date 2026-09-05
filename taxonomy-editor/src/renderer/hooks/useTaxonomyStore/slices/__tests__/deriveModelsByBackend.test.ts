// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment jsdom

// t/3280 Phase 2b: the renderer model picker (MODELS_BY_BACKEND) is DERIVED from ai-models.json's
// per-model `picker:{label,order}` field — the single source of truth — not maintained by hand.
// These gates prove the derive is faithful and lock the SSOT invariant:
//   1. PARITY — deriveModelsByBackend(ai-models.json) is byte-identical to the curated
//      MODELS_BY_BACKEND checked into source (so the pre-load fallback == the runtime derive; no drift).
//   2. DEFAULT_MODEL is present as a selectable picker entry (the global default must be pickable).
//   3. Empty-picker backend (deepseek) derives to [] without crashing, and getStoredModel guards it.
// Wired into `npm run verify:config`.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  deriveModelsByBackend,
  MODELS_BY_BACKEND,
  getStoredModel,
  type AIBackend,
} from '../settingsSlice';
import { DEFAULT_MODEL } from '@lib/ai-client/defaults';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → slices → useTaxonomyStore → hooks → renderer → src → taxonomy-editor → repo root
const aiModels = JSON.parse(
  readFileSync(resolve(here, '../../../../../../../ai-models.json'), 'utf8'),
) as {
  backends: { id: string; label: string }[];
  models: { id: string; label: string; backend: string; picker?: { label: string; order: number } }[];
  defaults: Record<string, string>;
};

describe('deriveModelsByBackend (t/3280 SSOT derive)', () => {
  const derived = deriveModelsByBackend(aiModels);

  it('has a non-empty picker to derive from (guards against a false-green empty read)', () => {
    const withPicker = aiModels.models.filter(m => m.picker);
    expect(withPicker.length).toBeGreaterThan(0);
  });

  it('PARITY: derived picker is byte-identical to the curated MODELS_BY_BACKEND', () => {
    // Deep-equal per backend for a legible diff on failure, then the whole object.
    for (const backend of Object.keys(MODELS_BY_BACKEND) as AIBackend[]) {
      expect(derived[backend], `backend '${backend}' derive != curated`).toEqual(MODELS_BY_BACKEND[backend]);
    }
    expect(derived).toEqual(MODELS_BY_BACKEND);
  });

  it('every derived entry has a real ai-models.json model id (no phantoms)', () => {
    const configIds = new Set(aiModels.models.map(m => m.id));
    const phantoms: string[] = [];
    for (const entries of Object.values(derived)) {
      for (const e of entries) if (!configIds.has(e.value)) phantoms.push(e.value);
    }
    expect(phantoms, `derived picker entries with no config model:\n${phantoms.join('\n')}`).toEqual([]);
  });

  it('entries within a backend are sorted by picker.order', () => {
    for (const backend of Object.keys(derived) as AIBackend[]) {
      const orders = derived[backend].map(
        e => aiModels.models.find(m => m.id === e.value)?.picker?.order ?? Number.NaN,
      );
      const sorted = [...orders].sort((a, b) => a - b);
      expect(orders, `backend '${backend}' not order-sorted`).toEqual(sorted);
    }
  });

  it('DEFAULT_MODEL is a selectable picker entry (the global default must be pickable)', () => {
    const allValues = new Set(Object.values(derived).flat().map(e => e.value));
    expect(allValues.has(DEFAULT_MODEL), `DEFAULT_MODEL '${DEFAULT_MODEL}' absent from the derived picker`).toBe(true);
  });

  it('an empty-picker backend (deepseek) derives to [] without crashing', () => {
    expect(derived.deepseek).toEqual([]);
  });

  it('getStoredModel never returns a non-model id even when its backend has an empty picker', () => {
    // deepseek is the empty-picker case; the phantom-default guard must fall back to DEFAULT_MODEL.
    localStorage.clear();
    localStorage.setItem('taxonomy-editor-backend', 'deepseek');
    const model = getStoredModel();
    const allValues = new Set(Object.values(MODELS_BY_BACKEND).flat().map(e => e.value));
    expect(allValues.has(model) || model === DEFAULT_MODEL).toBe(true);
    localStorage.clear();
  });
});
