import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

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

// ── Dangling-friendlyId invariant (t/1729; TL design t/1706) ────────────
//
// Self-cert: /add-test (pure test extension of this file — no new public API,
// no production code, no schema change). Scope implemented is the FULL set the
// TL designed MINUS fallbackChain *keys* (see the scope note on
// findDanglingRefs below and the deviation recorded there).
//
// Every friendlyId a model is SELECTED by or FAILED-OVER to must resolve to a
// real `models[]` entry. The friendlyId lives on `models[].id` — ai-models.json
// has no separate `friendlyId` field; `defaults`, `debateTiers`, and
// `fallbackChains` all reference models by that `id`. A reference that resolves
// to nothing is a silent misconfiguration: at runtime the model lookup returns
// undefined and the call fails (or, for a failover target, the failover is a
// no-op — the exact t/1628 failure class this file guards).
//
// KNOWN_VERBATIM — documented exempt friendlyIds (Gate Co-Location, t/1589):
//   - 'deepseek-chat' is the one genuine friendlyId == real-provider-model-id
//     case: it is used verbatim as a DeepSeek API model id and as a failover
//     target/chain, but has no synthetic `models[]` entry of its own. This is
//     intentional, not a dangling ref, so it is the sole exemption.
// NOT exempt: azure (t/1727 gave azure real models[] entries), and
// claude-opus-4-8 / deepseek-reasoner — see the scope note for why they need
// no exemption under this (value-scoped) invariant.
const KNOWN_VERBATIM = new Set<string>(['deepseek-chat']);

/**
 * Return every referenced friendlyId that does NOT resolve to a `models[]`
 * entry, excluding the KNOWN_VERBATIM exempt-set. `[]` means the config is
 * internally consistent. Shared by the real-config test and the broken-fixture
 * test so both exercise identical resolution logic.
 *
 * Scope (value-scoped): references collected from
 *   - `defaults.*`                     (selection values)
 *   - `debateTiers.{tier}.{backend}`   (selection values; the "_comment"
 *                                       string key is skipped — it is not a
 *                                       backend->model map)
 *   - `fallbackChains` string[] VALUES (failover targets)
 *
 * DEVIATION from the t/1706 design, recorded at point of use: the design also
 * named fallbackChain *keys*. On the committed ai-models.json HEAD two keys are
 * legitimately orphan — `claude-opus-4-8` and `deepseek-reasoner` have a chain
 * (and pricing) defined but no `models[]` entry on this commit (opus-4-8's
 * entry lands with the in-flight model-registry migration; reasoner is legacy).
 * An orphan chain KEY is inert — it is never a selection value and never a
 * failover target, so it cannot cause the runtime failure this gate targets.
 * Checking keys would make the gate RED on origin for these two inert entries;
 * checking VALUES keeps it green while still catching every runtime-affecting
 * dangle. Crucially this leaves claude-opus-4-8 / deepseek-reasoner genuinely
 * NOT exempt: if either is ever wired as a default / tier / failover value
 * without a models[] entry, this function still flags it.
 */
export function findDanglingRefs(registry: ModelRegistry): string[] {
  const modelIds = new Set(registry.models.map((m) => m.id));
  const referenced: string[] = [];

  for (const modelId of Object.values(registry.defaults ?? {})) {
    referenced.push(modelId);
  }

  for (const [tier, tierValue] of Object.entries(registry.debateTiers ?? {})) {
    // Skip the "_comment" documentation key (a string, not a backend map).
    if (tier === '_comment' || typeof tierValue !== 'object') continue;
    for (const modelId of Object.values(tierValue)) {
      referenced.push(modelId);
    }
  }

  for (const chain of Object.values(registry.fallbackChains ?? {})) {
    for (const modelId of chain) referenced.push(modelId);
  }

  return [...new Set(referenced)]
    .filter((id) => !modelIds.has(id) && !KNOWN_VERBATIM.has(id))
    .sort();
}

// Backends exempt from the fallback-chain requirement, with the rationale
// co-located at point of use (gate-metadata co-location, t/1589):
//   - ollama runs a LOCAL model. There is no cloud provider to fail over to;
//     a failover chain would point at a backend the user may not have keys
//     for, defeating the "offline / local-only" contract. Local-model outage
//     is surfaced directly, not masked by a remote fallback.
const CHAIN_EXEMPT_BACKENDS = new Set(['ollama']);

describe('ai-models.json config invariants (t/1628)', () => {
  const registry: ModelRegistry = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'ai-models.json'), 'utf-8'),
  );

  it('every non-exempt default model has a non-empty fallbackChain', () => {
    const offenders: string[] = [];

    for (const [backend, modelId] of Object.entries(registry.defaults)) {
      if (CHAIN_EXEMPT_BACKENDS.has(backend)) continue;

      const chain = registry.fallbackChains?.[modelId];
      if (!Array.isArray(chain) || chain.length === 0) {
        offenders.push(`${backend} default "${modelId}" has no fallbackChain`);
      }
    }

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
