// @vitest-environment node

/**
 * t/772 — GET /api/backends/available returns only backends with BOTH a key and
 * tier authorization, so the multi-provider UI stops assigning models to backends
 * that 403 at generation time.
 */

import { describe, it, expect } from 'vitest';
import { computeAvailableBackends } from '../ai/aiBackends.js';
import { isBackendAllowed, type ResolvedTier } from '../ai/proxyTiers.js';

const registry = {
  backends: [{ id: 'gemini' }, { id: 'claude' }, { id: 'groq' }, { id: 'openai' }],
  models: [
    { id: 'gemini-2.5-flash', backend: 'gemini' },
    { id: 'gemini-2.5-pro', backend: 'gemini' },
    { id: 'claude-haiku-4-5', backend: 'claude' },
    { id: 'groq-llama-3.1-8b-instant', backend: 'groq' },
    { id: 'openai-gpt-4.1-mini', backend: 'openai' },
  ],
};
const TIER = ['gemini', 'claude', 'groq']; // openai not on tier

describe('computeAvailableBackends (t/772)', () => {
  it('marks key+tier-authorized backends available with their model list', () => {
    const out = computeAvailableBackends(registry, TIER, { gemini: true, claude: true, groq: true, openai: true });
    const gemini = out.find(b => b.id === 'gemini')!;
    expect(gemini).toEqual({ id: 'gemini', available: true, models: ['gemini-2.5-flash', 'gemini-2.5-pro'] });
    expect(out.find(b => b.id === 'groq')!.models).toEqual(['groq-llama-3.1-8b-instant']);
  });

  it('reports no_key when tier-allowed but no key', () => {
    const out = computeAvailableBackends(registry, TIER, { gemini: true, claude: false, groq: true });
    expect(out.find(b => b.id === 'claude')).toEqual({ id: 'claude', available: false, reason: 'no_key' });
  });

  it('reports tier_restricted regardless of key (takes precedence over no_key)', () => {
    const out = computeAvailableBackends(registry, TIER, { openai: true });
    expect(out.find(b => b.id === 'openai')).toEqual({ id: 'openai', available: false, reason: 'tier_restricted' });
    const out2 = computeAvailableBackends(registry, TIER, { openai: false });
    expect(out2.find(b => b.id === 'openai')!.reason).toBe('tier_restricted');
  });

  it('reproduces the t/772 bug scenario: only key+tier backends are available', () => {
    // basic tier (gemini/groq only), keys for all three the UI tried.
    const basicTier = ['gemini', 'groq'];
    const out = computeAvailableBackends(registry, basicTier, { gemini: true, groq: true, claude: true, openai: true });
    const available = out.filter(b => b.available).map(b => b.id);
    expect(available).toEqual(['gemini', 'groq']); // claude (no tier) + openai (no tier) excluded
  });

  it('handles an empty/malformed registry', () => {
    expect(computeAvailableBackends({}, TIER, {})).toEqual([]);
  });
});

describe('isBackendAllowed (t/772)', () => {
  const tier = { level: 'byok', limits: { requestsPerMinute: 30, tokensPerDay: 1 }, allowedBackends: ['gemini', 'groq'] } as ResolvedTier;
  it('reflects the tier allowlist', () => {
    expect(isBackendAllowed(tier, 'gemini')).toBe(true);
    expect(isBackendAllowed(tier, 'openai')).toBe(false);
  });
});
