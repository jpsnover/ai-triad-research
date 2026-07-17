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

interface ModelRegistry {
  defaults: Record<string, string>;
  fallbackChains: Record<string, string[]>;
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
