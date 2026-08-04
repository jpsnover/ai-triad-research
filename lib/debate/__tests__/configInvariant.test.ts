import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { findDanglingRefs, findChainlessDefaults } from '../../ai-config/validate.js';

// ── Config-invariant gate (t/1628 AC3) ──────────────────────────────
//
// Root cause of t/1628: `zai-glm-5-2` was the zai backend default but had NO
// entry in `ai-models.json` fallbackChains. GLM-5.2 is a slow reasoner and a
// timeout fell through an empty chain — the failover loop was a no-op, so the
// call threw "no response from {model}" with zero output instead of failing
// over. This gate makes that class of misconfiguration a red test at commit
// time: every cloud-backend default MUST have a non-empty fallback chain.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../');

interface ModelEntry {
  id: string;
  backend: string;
  apiModelId?: string;
  label?: string;
}

interface ModelRegistry {
  backends: Array<{ id: string; label?: string; local?: boolean }>;
  models: ModelEntry[];
  defaults: Record<string, string>;
  // debateTiers carries a leading "_comment" string key alongside the tier maps.
  debateTiers: Record<string, string | Record<string, string>>;
  fallbackChains: Record<string, string[]>;
}

// ── Dangling-friendlyId invariant + chainless-default guard ─────────
// (t/1729 / t/1628; TL design t/1706 / t/2038) — implementation extracted
// to lib/ai-config/validate.ts (t/2039); imported above (t/2040 dedup).
// Deviation rationale (orphan chain-KEY not checked), KNOWN_VERBATIM, and
// CHAIN_EXEMPT_BACKENDS rationale all live in validate.ts JSDoc.

describe('ai-models.json config invariants (t/1628)', () => {
  const registry: ModelRegistry = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'ai-models.json'), 'utf-8'),
  );

  it('every non-exempt default model has a non-empty fallbackChain', () => {
    const offenders = findChainlessDefaults(registry);
    expect(offenders, offenders.join('; ')).toEqual([]);
  });

  it('the zai default (regression target) has a non-empty fallbackChain', () => {
    // Direct assertion on the exact model that broke in t/1628 — guards
    // against a future edit that changes the zai default to another
    // chain-less model and still passes the aggregate test by coincidence.
    const zaiDefault = registry.defaults.zai;
    expect(zaiDefault).toBeTruthy();

    const chain = registry.fallbackChains?.[zaiDefault];
    expect(Array.isArray(chain)).toBe(true);
    expect(chain.length).toBeGreaterThan(0);
  });
});

describe('ai-models.json integrity — dangling refs & encoding (t/1729)', () => {
  const AI_MODELS_PATH = path.join(REPO_ROOT, 'ai-models.json');
  const raw = readFileSync(AI_MODELS_PATH, 'utf-8');
  const registry: ModelRegistry = JSON.parse(raw);

  it('has no dangling model references (defaults / debateTiers / fallbackChain values)', () => {
    // GREEN direction: on the committed ai-models.json every referenced
    // friendlyId resolves to a models[] entry, given KNOWN_VERBATIM.
    const dangling = findDanglingRefs(registry);
    expect(dangling, `dangling model references: ${dangling.join(', ')}`).toEqual([]);
  });

  it('detects a dangling default when a referenced model entry is removed', () => {
    // RED direction (in-test fixture, per ticket — no out-of-repo .bak):
    // clone the parsed registry and drop the zai model entry while KEEPING
    // defaults.zai. This reproduces the dangling-default class from t/1628.
    // findDanglingRefs MUST catch it — proving the guard fails on a real break.
    const broken: ModelRegistry = JSON.parse(JSON.stringify(registry));
    const zaiDefault = broken.defaults.zai;
    expect(zaiDefault).toBeTruthy();
    broken.models = broken.models.filter((m) => m.id !== zaiDefault);

    const dangling = findDanglingRefs(broken);
    expect(dangling.length).toBeGreaterThan(0);
    expect(dangling).toContain(zaiDefault);
  });

  it('has no BOM at the start of the file', () => {
    // A leading U+FEFF byte-order mark breaks strict JSON.parse in some tools
    // and diffs noisily. readFileSync('utf-8') preserves a BOM as charCode
    // 0xFEFF at index 0 if present.
    expect(raw.charCodeAt(0)).not.toBe(0xfeff);
  });

  it('every declared backend has at least one model and every model backend is declared', () => {
    // Allowlist / structural guard: dropping a whole backend (or all of a
    // backend's models) fails loudly, and a model can't reference a backend
    // that isn't declared in backends[].
    const declared = new Set(registry.backends.map((b) => b.id));
    const backendsWithModels = new Set(registry.models.map((m) => m.backend));

    const declaredWithoutModels = [...declared].filter((b) => !backendsWithModels.has(b)).sort();
    expect(
      declaredWithoutModels,
      `declared backends with no models: ${declaredWithoutModels.join(', ')}`,
    ).toEqual([]);

    const undeclaredModelBackends = [...backendsWithModels].filter((b) => !declared.has(b)).sort();
    expect(
      undeclaredModelBackends,
      `model backends not in backends[]: ${undeclaredModelBackends.join(', ')}`,
    ).toEqual([]);
  });
});
