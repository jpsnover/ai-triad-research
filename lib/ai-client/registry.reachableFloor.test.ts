// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Reachable-model timeout-floor gate (t/3555, prevention from t/3551). A user-selectable model must
// declare an EXPLICIT minTimeoutMs; the value may be 0 (fast model, "no floor needed") — the gate checks
// key PRESENCE, not value > 0 (TL t/3555#3). Both arms exercised directly on the pure predicate.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import {
  findReachableModelsMissingTimeoutFloor,
  assertReachableModelsHaveTimeoutFloor,
  type ModelRegistry,
  type ModelEntry,
} from './registry.js';
import { ActionableError } from '../debate/errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// lib/ai-client/ -> lib/ -> repo root
const REPO_ROOT = path.resolve(__dirname, '../../');
const realRegistry: ModelRegistry = JSON.parse(readFileSync(path.join(REPO_ROOT, 'ai-models.json'), 'utf-8'));

function entry(over: Partial<ModelEntry> & { id: string }): ModelEntry {
  return { apiModelId: 'api', label: 'L', backend: 'gemini', ...over };
}
function reg(models: ModelEntry[], extra: Partial<ModelRegistry> = {}): ModelRegistry {
  return { backends: [], models, ...extra };
}
const PICKER = { label: 'X', order: 1 };

describe('findReachableModelsMissingTimeoutFloor (t/3555)', () => {
  it('FLAGS a picker-selectable model missing minTimeoutMs (fail arm)', () => {
    const issues = findReachableModelsMissingTimeoutFloor(reg([entry({ id: 'x-fast-1', picker: PICKER })]));
    expect(issues).toHaveLength(1);
    expect(issues[0].modelId).toBe('x-fast-1');
    expect(issues[0].referenceSite).toContain('picker');
    expect(issues[0].message).toContain('minTimeoutMs');
  });

  it('PRESENCE not value>0: minTimeoutMs:0 PASSES — a fast model explicitly declares "no floor needed"', () => {
    expect(findReachableModelsMissingTimeoutFloor(reg([entry({ id: 'x-fast-1', minTimeoutMs: 0, picker: PICKER })]))).toEqual([]);
  });

  it('a floored model (300000) PASSES', () => {
    expect(findReachableModelsMissingTimeoutFloor(reg([entry({ id: 'x-slow-1', minTimeoutMs: 300000, picker: PICKER })]))).toEqual([]);
  });

  it('IGNORES an UNREACHABLE model missing the floor (not selectable → not this gate\'s concern)', () => {
    // no picker, not referenced anywhere → not reachable
    expect(findReachableModelsMissingTimeoutFloor(reg([entry({ id: 'x-hidden-1' })]))).toEqual([]);
  });

  it('reaches a model via defaults / debateTiers / fallbackChains (key AND value)', () => {
    const models = ['m-def', 'm-tier', 'm-chainkey', 'm-chainval'].map((id) => entry({ id }));
    const r = reg(models, {
      defaults: { gemini: 'm-def' },
      debateTiers: { advanced: { gemini: 'm-tier' } },
      fallbackChains: { 'm-chainkey': ['m-chainval'] },
    });
    expect(findReachableModelsMissingTimeoutFloor(r).map((i) => i.modelId).sort()).toEqual([
      'm-chainkey', 'm-chainval', 'm-def', 'm-tier',
    ]);
  });

  it('skips _comment keys and does not flag unresolved references (validateModelConfig\'s concern)', () => {
    const r = reg([entry({ id: 'real', minTimeoutMs: 0 })], { defaults: { _comment: 'note', gemini: 'not-in-models' } });
    expect(findReachableModelsMissingTimeoutFloor(r)).toEqual([]);
  });

  it('reports each reachable model once even when referenced from multiple sites', () => {
    const r = reg([entry({ id: 'dup', picker: PICKER })], {
      defaults: { gemini: 'dup' },
      fallbackChains: { dup: ['dup'] },
    });
    expect(findReachableModelsMissingTimeoutFloor(r)).toHaveLength(1);
  });

  it('REACHABILITY-SOURCE tripwire (SO e/207#2 cond 4): top-level sections are the known set — a new one forces a predicate review', () => {
    // "Reachable" is exactly as complete as the section list findReachableModelsMissingTimeoutFloor walks
    // (models[].picker + defaults + debateTiers + fallbackChains). If ai-models.json gains a NEW top-level
    // section, this fails loudly so nobody discovers months later that "reachable" silently meant "the
    // sections we thought of in Sept 2026." Pin the set; adding a section is then a deliberate, reviewed act.
    const EXPECTED = [
      'backends', 'models', 'defaults', 'fallbackChains', 'contextWindows',
      'capabilityDefaults', 'modelCapabilities', 'debateTiers', 'pricing', 'lastRefreshed',
    ].sort();
    const actual = Object.keys(realRegistry).filter((k) => !k.startsWith('_')).sort();
    expect(
      actual,
      'ai-models.json top-level sections changed. If the new section references model ids as a SELECTION ' +
        'path (like defaults/debateTiers/fallbackChains/picker), add it to findReachableModelsMissingTimeoutFloor ' +
        'AND this list. If it is metadata keyed by id but not selectable (like contextWindows/pricing/' +
        'modelCapabilities), just add it here. Do not let "reachable" silently narrow.',
    ).toEqual(EXPECTED);
  });

  it('the committed ai-models.json passes CLEAN (t/3555 AC — no reachable model lacks a floor)', () => {
    const issues = findReachableModelsMissingTimeoutFloor(realRegistry);
    expect(issues, issues.map((i) => `${i.referenceSite} -> ${i.modelId}`).join('\n')).toEqual([]);
  });
});

describe('assertReachableModelsHaveTimeoutFloor (t/3555)', () => {
  it('THROWS an ActionableError naming the model and the missing field', () => {
    let thrown: unknown;
    try {
      assertReachableModelsHaveTimeoutFloor(reg([entry({ id: 'x-fast-1', picker: PICKER })]));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ActionableError);
    expect((thrown as ActionableError).problem).toContain('x-fast-1');
    expect((thrown as ActionableError).problem).toMatch(/minTimeoutMs/);
  });

  it('does NOT throw on the clean committed registry', () => {
    expect(() => assertReachableModelsHaveTimeoutFloor(realRegistry)).not.toThrow();
  });
});
