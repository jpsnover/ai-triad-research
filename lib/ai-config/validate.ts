// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * PURE ai-models.json config invariants (t/2039, extracted from
 * lib/debate/__tests__/configInvariant.test.ts per the shared-utility rule,
 * TL t/2038#1). No I/O, no logger — importable by BOTH the Refresh Models write
 * path (lib/electron-shared/modelDiscovery.ts) and the CI invariant test
 * (lib/debate), so the write-path repair/guard and the CI gate are provably the
 * SAME code (they must never drift — the t/2038 corruption class).
 *
 * The registry references models by `id` in three RUNTIME-affecting surfaces:
 * `defaults` values, `debateTiers.{tier}.{backend}` values, and `fallbackChains`
 * string[] VALUES. A reference that resolves to no `models[]` entry is dangling;
 * a non-exempt default with no failover chain is a silent prod-failover no-op
 * (the t/1628 class). id-KEYED maps (contextWindows/pricing/modelCapabilities)
 * are inert when stale and are deliberately NOT checked — same rationale as the
 * orphan chain-KEY deviation below.
 */

/** Minimal structural shape the invariants operate on. The extended
 *  `AIModelsConfig` (modelDiscovery.ts) and the debate test's `ModelRegistry`
 *  are both assignable to this — no shared nominal type, no circular import. */
export interface ValidatableRegistry {
  models: { id: string; backend: string }[];
  defaults: Record<string, string>;
  /** Carries a leading "_comment" STRING key alongside the per-tier backend maps. */
  debateTiers?: Record<string, string | Record<string, string>>;
  fallbackChains?: Record<string, string[]>;
}

// KNOWN_VERBATIM — documented exempt friendlyIds (Gate Co-Location, t/1589):
// 'deepseek-chat' is the one genuine case where friendlyId === real provider
// model-id, so it legitimately has no separate `models[]` entry to resolve to.
export const KNOWN_VERBATIM: ReadonlySet<string> = new Set<string>(['deepseek-chat']);

// Backends exempt from the fallback-chain requirement (rationale co-located,
// t/1589): 'ollama' runs a LOCAL model — there is no cloud provider to fail over
// to, and a chain would point at a backend the user may lack keys for, defeating
// the offline/local-only contract. Local outage is surfaced, not masked.
export const CHAIN_EXEMPT_BACKENDS: ReadonlySet<string> = new Set<string>(['ollama']);

/**
 * Every model-id REFERENCE that resolves to no `models[]` entry, excluding
 * KNOWN_VERBATIM. Scans selection/failover VALUES only:
 *   - `defaults.*`
 *   - `debateTiers.{tier}.{backend}` (skips the "_comment" string key)
 *   - `fallbackChains` string[] VALUES
 * A `fallbackChains` KEY is NOT checked: it is never a selection value and never a
 * failover target, so an orphan key is inert (the documented deviation). Returns
 * sorted unique ids; `[]` means the config is referentially clean.
 */
export function findDanglingRefs(registry: ValidatableRegistry): string[] {
  const modelIds = new Set(registry.models.map((m) => m.id));
  const referenced: string[] = [];

  for (const modelId of Object.values(registry.defaults ?? {})) {
    referenced.push(modelId);
  }

  for (const [tier, tierValue] of Object.entries(registry.debateTiers ?? {})) {
    // Skip the "_comment" documentation key (a string, not a backend map). The
    // `tierValue === null` guard is load-bearing: typeof null === 'object', so a null
    // tier would otherwise fall through to Object.values(null) and throw (t/2039#3).
    if (tier === '_comment' || tierValue === null || typeof tierValue !== 'object') continue;
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

/**
 * Every non-CHAIN_EXEMPT default whose `fallbackChains[defaultId]` is missing or
 * empty — a live default with no failover is the t/1628 prod-failover-no-op class.
 * Returns sorted human-readable offenders (`${backend} default "${id}" has no
 * fallbackChain`), the exact format the CI test's inline loop produces today so
 * the write-path guard and the test share one message. `[]` means clean.
 */
export function findChainlessDefaults(registry: ValidatableRegistry): string[] {
  const offenders: string[] = [];
  for (const [backend, modelId] of Object.entries(registry.defaults ?? {})) {
    if (CHAIN_EXEMPT_BACKENDS.has(backend)) continue;
    const chain = registry.fallbackChains?.[modelId];
    if (!Array.isArray(chain) || chain.length === 0) {
      offenders.push(`${backend} default "${modelId}" has no fallbackChain`);
    }
  }
  return offenders.sort();
}
