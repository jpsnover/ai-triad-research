import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// In-memory ai-models.json backing store for the refreshAIModels merge test.
let fileContent = '';
vi.mock('fs', () => ({
  default: {
    readFileSync: () => fileContent,
    writeFileSync: (_path: string, data: string) => { fileContent = data; },
  },
}));

import { curateGeminiModels, refreshAIModels } from './modelDiscovery.js';

function model(name: string, displayName: string, methods = ['generateContent']) {
  return { name: `models/${name}`, displayName, supportedGenerationMethods: methods };
}

const REPRESENTATIVE_API_RESPONSE = [
  model('gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview'),
  model('gemini-3.1-flash-lite-preview', 'Gemini 3.1 Flash Lite Preview'),
  model('gemini-3-flash-preview', 'Gemini 3 Flash Preview'),
  model('gemini-2.5-pro', 'Gemini 2.5 Pro'),
  model('gemini-2.5-pro-preview-06-05', 'Gemini 2.5 Pro Preview'),
  model('gemini-2.5-flash', 'Gemini 2.5 Flash'),
  model('gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite'),
  model('gemini-2.5-flash-preview-04-17', 'Gemini 2.5 Flash Preview'),
  model('gemini-2.0-flash', 'Gemini 2.0 Flash'),
  model('gemini-1.5-pro', 'Gemini 1.5 Pro'),
  model('gemini-1.5-flash', 'Gemini 1.5 Flash'),
  // Non-Gemini families
  model('gemma-4-26b-it', 'Gemma 4 26B IT'),
  model('gemma-4-31b-it', 'Gemma 4 31B IT'),
  // Image/audio/robotics/agent/TTS
  model('nano-banana-pro', 'Nano Banana Pro'),
  model('nano-banana-pro-001', 'Nano Banana Pro'),
  model('nano-banana-pro-002', 'Nano Banana Pro'),
  model('nano-banana-2', 'Nano Banana 2'),
  model('nano-banana-2-001', 'Nano Banana 2'),
  model('lyria-3-clip-preview', 'Lyria 3 Clip Preview'),
  model('lyria-3-pro-preview', 'Lyria 3 Pro Preview'),
  model('gemini-2.5-flash-preview-tts', 'Gemini 2.5 Flash Preview TTS'),
  model('gemini-2.5-pro-preview-tts', 'Gemini 2.5 Pro Preview TTS'),
  model('gemini-3.1-flash-tts-preview', 'Gemini 3.1 Flash TTS Preview'),
  model('gemini-robotics-er-1.5-preview', 'Gemini Robotics ER 1.5 Preview'),
  model('gemini-robotics-er-1.6-preview', 'Gemini Robotics ER 1.6 Preview'),
  model('antigravity-agent-preview', 'Antigravity Agent Preview'),
  model('deep-research-max', 'Deep Research Max'),
  // Embedding-only (no generateContent)
  model('text-embedding-004', 'Text Embedding 004', ['embedContent']),
];

describe('curateGeminiModels', () => {
  it('returns exactly 3 entries: latest pro, flash, and flash-lite', () => {
    const result = curateGeminiModels(REPRESENTATIVE_API_RESPONSE);
    expect(result).toHaveLength(3);

    const ids = result.map(m => m.id).sort();
    expect(ids).toEqual([
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite-preview',
      'gemini-3.1-pro-preview',
    ]);
  });

  it('selects the highest version for each tier', () => {
    const result = curateGeminiModels(REPRESENTATIVE_API_RESPONSE);
    const pro = result.find(m => m.id.includes('-pro'));
    const flash = result.find(m => m.id.includes('-flash') && !m.id.includes('-flash-lite'));
    const lite = result.find(m => m.id.includes('-flash-lite'));

    expect(pro?.id).toBe('gemini-3.1-pro-preview');
    expect(flash?.id).toBe('gemini-3-flash-preview');
    expect(lite?.id).toBe('gemini-3.1-flash-lite-preview');
  });

  it('prefers shorter ID (stable alias) over dated preview at same version', () => {
    const models = [
      model('gemini-2.5-pro', 'Gemini 2.5 Pro'),
      model('gemini-2.5-pro-preview-06-05', 'Gemini 2.5 Pro Preview'),
      model('gemini-2.5-flash', 'Gemini 2.5 Flash'),
      model('gemini-2.5-flash-preview-04-17', 'Gemini 2.5 Flash Preview'),
      model('gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite'),
    ];
    const result = curateGeminiModels(models);
    const pro = result.find(m => m.id.includes('-pro'));
    const flash = result.find(m => m.id.includes('-flash') && !m.id.includes('-flash-lite'));

    expect(pro?.id).toBe('gemini-2.5-pro');
    expect(flash?.id).toBe('gemini-2.5-flash');
  });

  it('excludes non-Gemini families (gemma, nano-banana, lyria)', () => {
    const result = curateGeminiModels(REPRESENTATIVE_API_RESPONSE);
    for (const m of result) {
      expect(m.id).toMatch(/^gemini-\d/);
    }
  });

  it('excludes TTS, robotics, agent, and audio variants', () => {
    const result = curateGeminiModels(REPRESENTATIVE_API_RESPONSE);
    for (const m of result) {
      expect(m.id).not.toMatch(/tts|robotics|agent|audio/i);
    }
  });

  it('excludes models without generateContent support', () => {
    const models = [
      model('gemini-2.5-pro', 'Gemini 2.5 Pro', ['embedContent']),
      model('gemini-2.5-flash', 'Gemini 2.5 Flash'),
    ];
    const result = curateGeminiModels(models);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('gemini-2.5-flash');
  });

  it('returns fewer than 3 if a tier is absent', () => {
    const models = [
      model('gemini-2.5-flash', 'Gemini 2.5 Flash'),
      model('gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite'),
    ];
    const result = curateGeminiModels(models);
    expect(result).toHaveLength(2);
  });

  it('returns empty array when no models match', () => {
    const models = [
      model('gemma-4-26b-it', 'Gemma 4 26B IT'),
      model('nano-banana-pro', 'Nano Banana Pro'),
    ];
    expect(curateGeminiModels(models)).toEqual([]);
  });

  it('sets backend to gemini on all entries', () => {
    const result = curateGeminiModels(REPRESENTATIVE_API_RESPONSE);
    for (const m of result) {
      expect(m.backend).toBe('gemini');
    }
  });

  it('uses displayName as label', () => {
    const models = [model('gemini-2.5-pro', 'Gemini 2.5 Pro')];
    const result = curateGeminiModels(models);
    expect(result[0].label).toBe('Gemini 2.5 Pro');
  });

  it('eliminates duplicates like Nano Banana Pro x3 (not gemini-* IDs)', () => {
    const models = [
      model('nano-banana-pro', 'Nano Banana Pro'),
      model('nano-banana-pro-001', 'Nano Banana Pro'),
      model('nano-banana-pro-002', 'Nano Banana Pro'),
      model('gemini-2.5-flash', 'Gemini 2.5 Flash'),
    ];
    const result = curateGeminiModels(models);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('gemini-2.5-flash');
  });
});

// ── refreshAIModels: merge, don't replace (t/1711) ──────────────────────────────
// Regression for the recurring Z.AI outage: a refresh probes only gemini/claude/groq/
// openai/deepseek/ollama, so replacing config.models wholesale deleted the zai (and
// azure) backend, leaving defaults.zai -> zai-glm-5-2 dangling -> HTTP 1211. This test
// is RED on the old `config.models = newModels` and GREEN after the merge fix.

const BASE_CONFIG = {
  backends: [
    { id: 'gemini', label: 'Gemini' },
    { id: 'azure', label: 'Azure' },
    { id: 'zai', label: 'Z.AI' },
  ],
  models: [
    { id: 'gemini-2.5-flash', apiModelId: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', backend: 'gemini' },
    { id: 'zai-glm-5-2', apiModelId: 'glm-5-2', label: 'GLM-5.2', backend: 'zai' },
  ],
  defaults: { gemini: 'gemini-2.5-flash', zai: 'zai-glm-5-2', azure: 'azure-gpt-5' },
  debateTiers: { premium: { zai: 'zai-glm-5-2' } },
  fallbackChains: { zai: ['zai-glm-5-2', 'gemini-2.5-flash'] },
  lastRefreshed: null,
};

describe('refreshAIModels — merge, not replace (t/1711)', () => {
  beforeEach(() => {
    fileContent = JSON.stringify(BASE_CONFIG);
    // No key for any backend + no network: probed backends fall back to existing entries,
    // and ollama's localhost probe fails fast — no real IO. The bug reproduces regardless.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in test'); }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves non-probed backends (zai/azure) — models, defaults, tiers, chains survive a refresh', async () => {
    await refreshAIModels({ loadApiKey: () => null, repoRoot: '/fake' });
    const saved = JSON.parse(fileContent);

    // The exact failure: the zai model entry must survive (was deleted by replace).
    expect(saved.models.some((m: { id: string }) => m.id === 'zai-glm-5-2')).toBe(true);
    // defaults.zai must remain non-dangling (points at a model that still exists).
    expect(saved.defaults.zai).toBe('zai-glm-5-2');
    expect(saved.models.some((m: { id: string }) => m.id === saved.defaults.zai)).toBe(true);
    // Non-probed backend registry + its curated references round-trip untouched.
    expect(saved.backends.some((b: { id: string }) => b.id === 'zai')).toBe(true);
    expect(saved.backends.some((b: { id: string }) => b.id === 'azure')).toBe(true);
    expect(saved.debateTiers.premium.zai).toBe('zai-glm-5-2');
    expect(saved.fallbackChains.zai).toContain('zai-glm-5-2');
  });

  it('does not reduce the models[] count for backends not probed', async () => {
    const before = JSON.parse(fileContent).models.filter((m: { backend: string }) => m.backend === 'zai').length;
    await refreshAIModels({ loadApiKey: () => null, repoRoot: '/fake' });
    const after = JSON.parse(fileContent).models.filter((m: { backend: string }) => m.backend === 'zai').length;
    expect(after).toBe(before);
    expect(after).toBeGreaterThan(0);
  });
});
