// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Real-config resolution gate for ai-usages.json (t/3664 — the model-literal lint's third surface).
//
// ai-usages.json is a PURE model-SELECTION surface read at runtime by both stacks (usageRegistry.ts →
// resolveModel, and PowerShell UsageRegistry.ps1). The TS model-literal lint (modelLiteralLint.ts) never
// sees it: the file is at repo root (outside SCAN_ROOTS) and the walker filters `/\.tsx?$/`. So a retired
// model id here would pass every existing gate silently — the exact drift the lint exists to catch, on a
// surface it never looks at. Because every literal on a pure selection surface MUST resolve, resolve-or-
// exempt collapses to resolve-only: no marker grammar, no ratchet, no conformance corpus (TL t/3664#2).
//
// Resolution is via buildModelEntryMap (inside validateUsageConfig), NOT a models[].id Set — the real
// config's server.* usages select `gemini-flash-lite-latest`, a synthesized *-latest alias. A models.find
// check would false-flag it and re-open t/3518; the GREEN arm below would go red if the resolver ever
// regressed to that.

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { loadModelRegistry } from './registry.js';
import { loadUsageRegistry, validateUsageConfig } from './usageTypes.js';

// lib/ai-client → lib → repo root.
const REPO_ROOT = path.resolve(__dirname, '../../');

describe('ai-usages.json model-selection resolution gate (t/3664)', () => {
  const models = loadModelRegistry(REPO_ROOT);
  const usages = loadUsageRegistry(REPO_ROOT);

  it('GREEN: every usage model resolves to an ai-models.json entry or synthesized *-latest alias', () => {
    const modelErrors = validateUsageConfig(usages, models).filter((e) => e.field === 'model');
    expect(modelErrors).toEqual([]);
  });

  it('RED: a usage naming an unregistered model trips the gate', () => {
    const poisoned = {
      ...usages,
      __t3664_probe: { description: 'deliberately-broken probe', model: 'gemini-9.9-nonexistent' },
    };
    const modelErrors = validateUsageConfig(poisoned, models).filter((e) => e.field === 'model');
    expect(modelErrors).toHaveLength(1);
    expect(modelErrors[0].usageId).toBe('__t3664_probe');
    expect(modelErrors[0].message).toContain('gemini-9.9-nonexistent');
  });
});
