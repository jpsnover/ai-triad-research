// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/4105 SO e/284#20 (C1): model discovery is a LISTING loop. With only AI_API_KEY set, the summary viewer's key
// loader refuses every non-gemini backend (AIApiKeyGeminiOnlyRefused). Discovery must report those backends as
// not configured and keep going, never abort. Only that refusal kind is softened: a foreign-credential refusal
// from the loader still propagates (control arm).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let fileContent = '';
vi.mock('fs', () => ({
  default: {
    readFileSync: () => fileContent,
    writeFileSync: (_path: string, data: string) => { fileContent = data; },
  },
}));

import { refreshAIModels } from './modelDiscovery.js';
import { resolveGenericFallbackKey, KeyRoutingRefusal, LISTING_WARN } from '../ai-client/apiKeyFallback.js';

const gm = (id: string) => ({ id, apiModelId: id, label: id, backend: 'gemini' });
function baseConfig() {
  return {
    backends: [{ id: 'gemini', label: 'Gemini' }, { id: 'claude', label: 'Claude' }, { id: 'groq', label: 'Groq' }],
    models: [gm('gemini-3.1-pro'), gm('gemini-3.5-flash-lite'),
      { id: 'claude-haiku-4-5', apiModelId: 'claude-haiku-4-5', label: 'Haiku', backend: 'claude' }],
    defaults: { gemini: 'gemini-3.1-pro', claude: 'claude-haiku-4-5' },
    debateTiers: { basic: { gemini: 'gemini-3.5-flash-lite' } },
    fallbackChains: { 'gemini-3.1-pro': ['gemini-3.5-flash-lite'], 'gemini-3.5-flash-lite': ['gemini-3.1-pro'], 'claude-haiku-4-5': ['gemini-3.1-pro'] },
    lastRefreshed: null,
  };
}

const ENV: Record<string, string | undefined> = { AI_API_KEY: 'google-placeholder' };
// The summary viewer's loadApiKey, minus the encrypted store: own variable, else the gemini-only fallback.
const OWN: Record<string, string> = { gemini: 'GEMINI_API_KEY', claude: 'ANTHROPIC_API_KEY', groq: 'GROQ_API_KEY', openai: 'OPENAI_API_KEY', deepseek: 'DEEPSEEK_API_KEY' };
const summaryViewerLoadApiKey = (backend: string): string | null =>
  ENV[OWN[backend] ?? ''] ?? resolveGenericFallbackKey(backend, ENV) ?? null;

let fetched: string[] = [];
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  fileContent = JSON.stringify(baseConfig());
  fetched = [];
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    fetched.push(String(url));
    if (String(url).includes('generativelanguage.googleapis.com')) {
      return new Response(JSON.stringify({ models: [{ name: 'models/gemini-3.1-pro', displayName: 'gemini-3.1-pro', supportedGenerationMethods: ['generateContent'] }] }), { status: 200 });
    }
    throw new Error(`no network in test: ${url}`);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); warn.mockRestore(); });

describe('model discovery with only AI_API_KEY set (t/4105 C1)', () => {
  it('gemini is discovered; claude, groq and deepseek read not configured; nothing throws (openai is manually curated, never discovered)', async () => {
    const result = await refreshAIModels({ loadApiKey: summaryViewerLoadApiKey, repoRoot: '/fake', codeReferencedIds: [] }, { skipBackends: ['ollama'] });
    expect(result.gemini.ok).toBe(true);
    for (const b of ['claude', 'groq', 'deepseek'] as const) {
      expect(result[b].ok, b).toBe(false);
      expect(result[b].error, b).toContain(LISTING_WARN);
      expect(result[b].error, b).not.toContain('google-placeholder');
    }
    expect(fetched.every((u) => u.includes('generativelanguage.googleapis.com'))).toBe(true); // no other provider was sent anything
    expect(warn.mock.calls.some((c) => String(c[0]).includes(LISTING_WARN))).toBe(true);
  });

  it('CONTROL: a foreign-credential refusal from the key loader still propagates', async () => {
    const loadApiKey = (backend: string): string | null => {
      if (backend === 'claude') {
        throw new KeyRoutingRefusal('AIApiKeyForeignCredentialRefused', { goal: 'g', problem: 'the stored key is the value of GROQ_API_KEY', location: 'test', nextSteps: [] });
      }
      return summaryViewerLoadApiKey(backend);
    };
    await expect(refreshAIModels({ loadApiKey, repoRoot: '/fake', codeReferencedIds: [] }, { skipBackends: ['ollama'] }))
      .rejects.toThrow(/value of GROQ_API_KEY/);
  });
});
