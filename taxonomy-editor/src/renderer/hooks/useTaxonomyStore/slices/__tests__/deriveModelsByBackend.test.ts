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
//   4. (t/3329) AI_BACKENDS is SSOT-derived — deriveBackends(config) byte-identical to the pre-load list.
//   5. (t/3328) derive keyspace = config.backends ∪ constant keys — a config-only backend still surfaces.
// Wired into `npm run verify:config`.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  deriveModelsByBackend,
  deriveBackends,
  MODELS_BY_BACKEND,
  AI_BACKENDS,
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

  it('no user-selectable backend has an empty picker (would strand the model dropdown)', () => {
    // Pre-load AI_BACKENDS must offer only backends with ≥1 curated model; initAIModels applies the
    // same picker-presence filter at runtime. deepseek is the empty-picker case that must be excluded.
    for (const b of AI_BACKENDS) {
      expect(MODELS_BY_BACKEND[b.value].length, `backend '${b.value}' is selectable but has no picker models`).toBeGreaterThan(0);
    }
    expect(AI_BACKENDS.some(b => b.value === 'deepseek'), 'deepseek (no picker models) must not be selectable').toBe(false);
  });

  it('BACKEND PARITY (t/3329): deriveBackends(config) is byte-identical to pre-load AI_BACKENDS', () => {
    // AI_BACKENDS is now SSOT-derived (membership + order + label from config.backends); the in-source
    // constant is only a pre-load fallback. Full ordered deep-equal (not just set equality) so pre-load
    // and post-load never disagree on order or label.
    expect(deriveBackends(aiModels)).toEqual(AI_BACKENDS);
  });

  it('deriveBackends excludes a zero-picker backend (deepseek)', () => {
    expect(deriveBackends(aiModels).some(b => b.value === 'deepseek')).toBe(false);
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

  it('every config backend with ≥1 picker model has a non-empty derived entry (keyspace coverage)', () => {
    const withPicker = new Set(aiModels.models.filter(m => m.picker).map(m => m.backend));
    for (const backend of withPicker) {
      expect(derived[backend as AIBackend]?.length ?? 0, `config backend '${backend}' has picker models but derived empty`).toBeGreaterThan(0);
    }
  });
});

describe('t/3328: derive keyspace = config.backends ∪ constant keys', () => {
  // A backend added to ai-models.json (with picker models) but ABSENT from the in-source
  // MODELS_BY_BACKEND keys must still surface — the former constant-only keyspace silently dropped it.
  const synthConfig = {
    backends: [
      { id: 'gemini', label: 'Google Gemini' },
      { id: 'newbackend', label: 'New Backend' },
    ],
    models: [
      { id: 'newbackend-model-a', label: 'Model A', backend: 'newbackend', picker: { label: 'Model A', order: 10 } },
      { id: 'newbackend-model-b', label: 'Model B', backend: 'newbackend', picker: { label: 'Model B', order: 20 } },
      // A curated-out model (no picker) on the new backend must NOT appear.
      { id: 'newbackend-hidden', label: 'Hidden', backend: 'newbackend' },
    ],
    defaults: {},
  };

  it('surfaces picker models for a backend not present in the constant keyspace', () => {
    const d = deriveModelsByBackend(synthConfig as never);
    expect(d['newbackend' as AIBackend]).toEqual([
      { value: 'newbackend-model-a', label: 'Model A' },
      { value: 'newbackend-model-b', label: 'Model B' },
    ]);
  });

  it('deriveBackends includes the new config-only backend (membership follows config)', () => {
    const b = deriveBackends(synthConfig as never);
    expect(b).toContainEqual({ value: 'newbackend', label: 'New Backend' });
  });
});
