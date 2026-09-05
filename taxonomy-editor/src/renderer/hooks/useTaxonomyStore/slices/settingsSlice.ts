// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { StateCreator } from 'zustand';
import type { TaxonomyStore } from '../types';
import { api } from '@bridge';
import { DEFAULT_MODEL } from '@lib/ai-client/defaults';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { applyThemeToRoot, getStoredTheme, THEME_STORAGE_KEY } from '../../../utils/theme';

/**
 * Default Community Library server — the Azure Container Apps production deployment.
 * Used as the fallback when no URL is stored, so "Share to Community" works out of
 * the box in the desktop build. Still overridable via Settings → Community Server URL.
 * Only affects Electron; the web build posts same-origin (see getCommunityBaseUrl).
 */
const DEFAULT_COMMUNITY_SERVER_URL = 'https://taxonomy-editor.yellowbush-aeda037d.eastus.azurecontainerapps.io';

// -- Exported types --

export type ColorScheme = 'light' | 'dark' | 'bkc' | 'harvard' | 'system';

export type AIBackend = 'gemini' | 'claude' | 'groq' | 'openai' | 'deepseek' | 'azure' | 'ollama' | 'zai' | 'moonshot' | 'xai';

export type GeminiModel =
  | typeof DEFAULT_MODEL
  | 'gemini-3-flash-preview'
  | 'gemini-3.1-pro-preview'
  | 'gemini-3.8-flash'      // t/3277
  | 'gemini-3.6-flash'      // t/3277
  | 'gemini-3.5-flash'      // t/3277
  | 'gemini-3.1-flash-lite' // t/3277
  | 'gemini-2.5-flash'
  | 'gemini-2.5-flash-lite'
  | 'gemini-2.5-pro';

export type ClaudeModel =
  | 'claude-opus-4-7'
  | 'claude-sonnet-4-6'
  | 'claude-sonnet-4-5'
  | 'claude-haiku-4-5'
  | 'claude-haiku-3.5';

export type GroqModel =
  | 'groq-llama-4-scout'
  | 'groq-llama-4-scout-17b-16e'
  | 'groq-llama-3.3-70b'
  | 'groq-llama-3.3-70b-versatile'
  | 'groq-openai-gpt-oss-120b';

export type OpenAIModel =
  | 'openai-gpt-5.5'
  | 'openai-gpt-5.5-pro';

// t/3286: real config model ids (the old 'deepseek-chat'/'deepseek-reasoner' were phantoms — no
// ai-models.json entry). deepseek-v4-flash is defaults.deepseek.
export type DeepSeekModel =
  | 'deepseek-deepseek-v4-flash'
  | 'deepseek-deepseek-v4-pro';

export type AzureModel =
  | 'azure-gpt-4o'
  | 'azure-gpt-4o-mini'
  | 'azure-gpt-4.1'
  | 'azure-gpt-4.1-mini';

export type OllamaModel =
  | 'ollama-gemma4-e4b-it-q4-k-m';

export type ZAIModel =
  | 'zai-glm-5-2';

export type MoonshotModel =
  | 'moonshot-kimi-k3';

export type XAIModel =
  | 'xai-grok-4-6';

export type AIModel = GeminiModel | ClaudeModel | GroqModel | OpenAIModel | DeepSeekModel | AzureModel | OllamaModel | ZAIModel | MoonshotModel | XAIModel;

export interface AIModelEntry { value: AIModel; label: string }

// -- Exported constants --

// t/3329: pre-load fallback ONLY — at runtime initAIModels replaces this with deriveBackends(config).
// A parity gate keeps it byte-identical to deriveBackends(ai-models.json): membership, order, and labels
// all follow config.backends (SSOT). Order matches config.backends. (t/3286: deepseek re-added once its
// v4 models gained picker entries — deriveBackends now offers it automatically, this fallback mirrors it.)
export const AI_BACKENDS: { value: AIBackend; label: string }[] = [
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'claude', label: 'Anthropic Claude' },
  { value: 'groq', label: 'Groq' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'azure', label: 'Azure OpenAI' },
  { value: 'zai', label: 'Z.AI (GLM)' },
  { value: 'moonshot', label: 'Moonshot (Kimi)' },
  { value: 'xai', label: 'xAI (Grok)' },
  { value: 'ollama', label: 'Ollama (Local)' },
];

export const MODELS_BY_BACKEND: Record<AIBackend, AIModelEntry[]> = {
  gemini: [
    { value: DEFAULT_MODEL, label: '3.5 Flash Lite (default)' },
    { value: 'gemini-3.1-pro-preview', label: '3.1 Pro Preview (best quality)' },
    { value: 'gemini-3.8-flash', label: '3.8 Flash' },
    { value: 'gemini-3.6-flash', label: '3.6 Flash' },
    { value: 'gemini-3.5-flash', label: '3.5 Flash' },
    { value: 'gemini-3.1-flash-lite', label: '3.1 Flash Lite' },
    { value: 'gemini-2.5-flash', label: '2.5 Flash' },
    { value: 'gemini-2.5-flash-lite', label: '2.5 Flash Lite (fastest)' },
    { value: 'gemini-2.5-pro', label: '2.5 Pro' },
  ],
  claude: [
    { value: 'claude-opus-4-7', label: 'Opus 4.7 (flagship)' },
    { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
    { value: 'claude-haiku-4-5', label: 'Haiku 4.5 (fastest)' },
  ],
  groq: [
    { value: 'groq-llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
    { value: 'groq-openai-gpt-oss-120b', label: 'GPT-OSS 120B' },
  ],
  openai: [
    { value: 'openai-gpt-5.5', label: 'GPT-5.5' },
    { value: 'openai-gpt-5.5-pro', label: 'GPT-5.5 Pro' },
  ],
  // t/3286: deepseek picker restored — its real config models (v4-flash/v4-pro) gained `picker` entries
  // in ai-models.json, replacing the old phantoms (deepseek-chat/reasoner). Kept byte-identical to the
  // derive by the parity gate. v4-flash is defaults.deepseek → its label carries the '(default)' marker.
  deepseek: [
    { value: 'deepseek-deepseek-v4-flash', label: 'V4 Flash (default)' },
    { value: 'deepseek-deepseek-v4-pro', label: 'V4 Pro (reasoning)' },
  ],
  azure: [
    { value: 'azure-gpt-4o', label: 'GPT-4o' },
    { value: 'azure-gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'azure-gpt-4.1', label: 'GPT-4.1' },
    { value: 'azure-gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  ],
  ollama: [
    { value: 'ollama-gemma4-e4b-it-q4-k-m', label: 'Gemma 4 E4B (default)' },
  ],
  zai: [
    { value: 'zai-glm-5-2', label: 'GLM 5.3' },
  ],
  moonshot: [
    { value: 'moonshot-kimi-k3', label: 'Kimi K3' },
  ],
  xai: [
    { value: 'xai-grok-4-6', label: 'Grok 4.6' },
  ],
};

/** @deprecated Use MODELS_BY_BACKEND.gemini instead */
export const GEMINI_MODELS = MODELS_BY_BACKEND.gemini;

const ALL_MODEL_IDS: Set<string> = new Set(
  Object.values(MODELS_BY_BACKEND).flat().map(m => m.value),
);

const DEFAULT_MODELS: Record<AIBackend, AIModel> = {
  gemini: DEFAULT_MODEL,
  claude: 'claude-sonnet-4-6',
  groq: 'groq-llama-4-scout-17b-16e',
  openai: 'openai-gpt-5.5',
  deepseek: 'deepseek-deepseek-v4-flash',
  azure: 'azure-gpt-4o',
  ollama: 'ollama-gemma4-e4b-it-q4-k-m',
  zai: 'zai-glm-5-2',
  moonshot: 'moonshot-kimi-k3',
  xai: 'xai-grok-4-6',
};

export let DEBATE_TIERS: Record<string, Record<string, string>> = {};
export let FALLBACK_CHAINS: Record<string, string[]> = {};

// -- Module-level helpers --

const KNOWN_BACKENDS: ReadonlySet<AIBackend> = new Set(['gemini', 'claude', 'groq', 'openai', 'deepseek', 'azure', 'ollama', 'zai', 'moonshot', 'xai']);

export function isKnownBackend(id: string): id is AIBackend {
  return (KNOWN_BACKENDS as ReadonlySet<string>).has(id);
}

function getStoredBackend(): AIBackend {
  try {
    const stored = localStorage.getItem('taxonomy-editor-ai-backend');
    if (stored && isKnownBackend(stored)) return stored;
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to read stored AI backend from localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
  }
  return 'gemini';
}

export function getStoredModel(): AIModel {
  try {
    const stored = localStorage.getItem('taxonomy-editor-gemini-model');
    if (stored && ALL_MODEL_IDS.has(stored)) return stored as AIModel;
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to read stored AI model from localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
  }
  // t/3280: guard an empty-picker backend (deepseek) / a pre-load phantom default — never strand the
  // UI on a non-model id; fall back to the always-present global DEFAULT_MODEL.
  const backend = getStoredBackend();
  const fallback = DEFAULT_MODELS[backend];
  return ALL_MODEL_IDS.has(fallback) ? fallback : DEFAULT_MODEL;
}

interface AIModelsConfig {
  backends: { id: string; label: string }[];
  models: { id: string; label: string; backend: string; picker?: { label: string; order: number } }[];
  defaults: Record<string, string>;
  debateTiers?: Record<string, Record<string, string>>;
  fallbackChains?: Record<string, string[]>;
}

/**
 * t/3280: DERIVE the renderer model picker from ai-models.json's per-model `picker` field — the single
 * source of truth. A model is selectable iff it carries `picker:{label,order}`; the picker is that
 * curated subset per backend, sorted by `picker.order`, labelled with `picker.label` verbatim (the
 * "(default)" suffix is baked into the config label). Curated-out models (no `picker`) never appear, so
 * phantoms (picker ids with no config entry) are impossible by construction, and a backend with zero
 * selectable models (e.g. deepseek) derives to [] — rendered gracefully; getStoredModel guards the default.
 */
export function deriveModelsByBackend(config: AIModelsConfig): Record<AIBackend, AIModelEntry[]> {
  const buckets: Record<string, { value: AIModel; label: string; order: number }[]> = {};
  for (const m of config.models) {
    if (!m.picker) continue;
    (buckets[m.backend] ??= []).push({ value: m.id as AIModel, label: m.picker.label, order: m.picker.order });
  }
  // t/3328: keyspace = config.backends ∪ constant keys. Iterating only the constant keys would silently
  // drop a backend added to ai-models.json (with picker models) whose key the in-source constant lacks.
  const backends = new Set<AIBackend>([
    ...config.backends.map(b => b.id as AIBackend),
    ...(Object.keys(MODELS_BY_BACKEND) as AIBackend[]),
  ]);
  const out = {} as Record<AIBackend, AIModelEntry[]>;
  for (const backend of backends) {
    out[backend] = (buckets[backend] ?? []).sort((a, b) => a.order - b.order).map(({ value, label }) => ({ value, label }));
  }
  return out;
}

/**
 * t/3329: DERIVE the selectable-backend list (AI_BACKENDS) from ai-models.json — a backend is offered
 * iff it has ≥1 picker model. Membership, order, and label all come from config.backends (SSOT); the
 * in-source AI_BACKENDS constant is only a pre-load fallback, kept byte-identical by a parity gate.
 * Subsumes the t/3280 deepseek exclusion structurally — a zero-picker backend is simply not emitted.
 */
export function deriveBackends(config: AIModelsConfig): { value: AIBackend; label: string }[] {
  const derived = deriveModelsByBackend(config);
  return config.backends
    .filter(b => (derived[b.id as AIBackend]?.length ?? 0) > 0)
    .map(b => ({ value: b.id as AIBackend, label: b.label }));
}

export async function initAIModels(): Promise<void> {
  try {
    const config = await api.loadAIModels() as AIModelsConfig | null;
    if (!config?.models?.length) return;

    // t/3280/t/3328: derive the picker from the curated `picker` entries (SSOT) — not every config
    // model. Assign over the DERIVED keyspace (config.backends ∪ constant keys) so a new config
    // backend's picker models are applied, not just the constant's keys.
    const derived = deriveModelsByBackend(config);
    for (const key of Object.keys(derived) as AIBackend[]) {
      MODELS_BY_BACKEND[key] = derived[key] ?? [];
    }

    // t/3280/t/3329: a backend is selectable iff it has ≥1 picker model. deriveBackends filters the
    // zero-picker ones (e.g. deepseek) so no dead-end backend strands the model dropdown; membership,
    // order, and label all come from config.backends (SSOT — no hardcoded exclusion).
    AI_BACKENDS.length = 0;
    AI_BACKENDS.push(...deriveBackends(config));

    for (const [k, v] of Object.entries(config.defaults)) {
      DEFAULT_MODELS[k as AIBackend] = v as AIModel;
    }

    ALL_MODEL_IDS.clear();
    for (const m of config.models) ALL_MODEL_IDS.add(m.id);

    if (config.debateTiers) {
      DEBATE_TIERS = config.debateTiers;
    }

    if (config.fallbackChains) {
      FALLBACK_CHAINS = config.fallbackChains;
    }

    console.log(`[AI Models] Loaded ${config.models.length} models from ai-models.json`);
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to load ai-models.json config', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    console.warn('[AI Models] Failed to load ai-models.json, using built-in defaults:', err);
  }
}

export function backendForModel(model: string): AIBackend | undefined {
  if (model.startsWith('gemini')) return 'gemini';
  if (model.startsWith('claude')) return 'claude';
  if (model.startsWith('groq')) return 'groq';
  if (model.startsWith('openai')) return 'openai';
  if (model.startsWith('deepseek')) return 'deepseek';
  if (model.startsWith('azure')) return 'azure';
  if (model.startsWith('ollama')) return 'ollama';
  if (model.startsWith('zai')) return 'zai';
  if (model.startsWith('moonshot')) return 'moonshot';
  if (model.startsWith('xai')) return 'xai';
  return undefined;
}

/** Backend for a model, falling back to the stored backend for unknown ids (debate-dialog family picker).
 *  Records a debug FR event when the fallback fires (t/2486). Do NOT use for the urlContext gate — that must
 *  use backendForModel() directly so unknown models never resolve to 'gemini'. */
export function backendForModelWithFallback(model: string): AIBackend {
  const b = backendForModel(model);
  if (b) return b;
  const fallback = getStoredBackend();
  getGlobalRecorder()?.record({ type: 'ai.fallback', component: 'taxonomy-store', level: 'debug', message: `backendForModel: unknown model '${model}' → fallback backend '${fallback}'`, data: { model, fallbackBackend: fallback } });
  return fallback;
}

// Theme resolution core moved to utils/theme.ts (t/2338) so the popout path
// (usePopoutTheme) and this main-window path share one resolver and can't fork.
// applyTheme here = shared applyThemeToRoot + the main-window-only localStorage persist.
function applyTheme(scheme: ColorScheme) {
  applyThemeToRoot(scheme);
  try { localStorage.setItem(THEME_STORAGE_KEY, scheme); } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to persist theme to localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
  }
}

// -- Slice interface --

export interface SettingsSlice {
  aiBackend: AIBackend;
  setAIBackend: (backend: AIBackend) => void;
  geminiModel: AIModel;
  setGeminiModel: (model: AIModel) => void;

  colorScheme: ColorScheme;
  setColorScheme: (scheme: ColorScheme) => void;

  paneSpacing: 'normal' | 'concise';
  setPaneSpacing: (spacing: 'normal' | 'concise') => void;

  communityServerUrl: string;
  setCommunityServerUrl: (url: string) => void;

  zoomLevel: number;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
}

// -- Slice creator --

export const createSettingsSlice: StateCreator<TaxonomyStore, [], [], SettingsSlice> = (set, get) => ({
  aiBackend: getStoredBackend(),
  setAIBackend: (backend) => {
    try { localStorage.setItem('taxonomy-editor-ai-backend', backend); } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to persist AI backend to localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    }
    const newModel = DEFAULT_MODELS[backend];
    try { localStorage.setItem('taxonomy-editor-gemini-model', newModel); } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to persist AI model to localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    }
    set({ aiBackend: backend, geminiModel: newModel });
  },
  geminiModel: getStoredModel(),
  setGeminiModel: (model) => {
    try { localStorage.setItem('taxonomy-editor-gemini-model', model); } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to persist AI model selection to localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    }
    set({ geminiModel: model });
  },

  colorScheme: getStoredTheme(),
  setColorScheme: (scheme) => {
    applyTheme(scheme);
    set({ colorScheme: scheme });
  },

  paneSpacing: (() => {
    try { return (localStorage.getItem('taxonomy-editor-pane-spacing') as 'normal' | 'concise') || 'normal'; } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to read pane spacing from localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      return 'normal' as const;
    }
  })(),
  setPaneSpacing: (spacing) => {
    try { localStorage.setItem('taxonomy-editor-pane-spacing', spacing); } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to persist pane spacing to localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    }
    document.documentElement.setAttribute('data-pane-spacing', spacing);
    set({ paneSpacing: spacing });
  },

  communityServerUrl: (() => {
    try { return localStorage.getItem('taxonomy-editor-community-url') || DEFAULT_COMMUNITY_SERVER_URL; } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to read community server URL from localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      return DEFAULT_COMMUNITY_SERVER_URL;
    }
  })(),
  setCommunityServerUrl: (url) => {
    try { localStorage.setItem('taxonomy-editor-community-url', url); } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to persist community server URL to localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    }
    set({ communityServerUrl: url });
  },

  zoomLevel: (() => {
    try {
      const stored = localStorage.getItem('taxonomy-editor-zoom');
      if (stored) {
        const n = parseInt(stored, 10);
        if (n >= 60 && n <= 200) return n;
      }
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to read zoom level from localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    }
    return 100;
  })(),

  zoomIn: () => {
    const next = Math.min(200, get().zoomLevel + 10);
    try { localStorage.setItem('taxonomy-editor-zoom', String(next)); } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to persist zoom level to localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    }
    set({ zoomLevel: next });
  },

  zoomOut: () => {
    const next = Math.max(60, get().zoomLevel - 10);
    try { localStorage.setItem('taxonomy-editor-zoom', String(next)); } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to persist zoom level to localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    }
    set({ zoomLevel: next });
  },

  zoomReset: () => {
    try { localStorage.setItem('taxonomy-editor-zoom', '100'); } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to persist zoom reset to localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    }
    set({ zoomLevel: 100 });
  },
});
