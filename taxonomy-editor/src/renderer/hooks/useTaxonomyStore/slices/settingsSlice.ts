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

export type AIBackend = 'gemini' | 'claude' | 'groq' | 'openai' | 'deepseek' | 'azure' | 'ollama' | 'zai';

export type GeminiModel =
  | typeof DEFAULT_MODEL
  | 'gemini-3-flash-preview'
  | 'gemini-3.1-pro-preview'
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

export type DeepSeekModel =
  | 'deepseek-chat'
  | 'deepseek-reasoner';

export type AzureModel =
  | 'azure-gpt-4o'
  | 'azure-gpt-4o-mini'
  | 'azure-gpt-4.1'
  | 'azure-gpt-4.1-mini';

export type OllamaModel =
  | 'ollama-gemma4-e4b-it-q4-k-m';

export type ZAIModel =
  | 'zai-glm-5-2';

export type AIModel = GeminiModel | ClaudeModel | GroqModel | OpenAIModel | DeepSeekModel | AzureModel | OllamaModel | ZAIModel;

export interface AIModelEntry { value: AIModel; label: string }

// -- Exported constants --

export const AI_BACKENDS: { value: AIBackend; label: string }[] = [
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'claude', label: 'Anthropic Claude' },
  { value: 'groq', label: 'Groq' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'azure', label: 'Azure OpenAI' },
  { value: 'ollama', label: 'Ollama (Local)' },
  { value: 'zai', label: 'Z.AI (GLM)' },
];

export const MODELS_BY_BACKEND: Record<AIBackend, AIModelEntry[]> = {
  gemini: [
    { value: DEFAULT_MODEL, label: '3.1 Flash Lite Preview (default)' },
    { value: 'gemini-3-flash-preview', label: '3 Flash Preview' },
    { value: 'gemini-3.1-pro-preview', label: '3.1 Pro Preview (best quality)' },
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
    { value: 'groq-llama-4-scout-17b-16e', label: 'Llama 4 Scout' },
    { value: 'groq-llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
    { value: 'groq-openai-gpt-oss-120b', label: 'GPT-OSS 120B' },
  ],
  openai: [
    { value: 'openai-gpt-5.5', label: 'GPT-5.5' },
    { value: 'openai-gpt-5.5-pro', label: 'GPT-5.5 Pro' },
  ],
  deepseek: [
    { value: 'deepseek-chat', label: 'DeepSeek V3 (default)' },
    { value: 'deepseek-reasoner', label: 'DeepSeek R1 (reasoning)' },
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
    { value: 'zai-glm-5-2', label: 'GLM 5.2' },
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
  deepseek: 'deepseek-chat',
  azure: 'azure-gpt-4o',
  ollama: 'ollama-gemma4-e4b-it-q4-k-m',
  zai: 'zai-glm-5-2',
};

export let DEBATE_TIERS: Record<string, Record<string, string>> = {};
export let FALLBACK_CHAINS: Record<string, string[]> = {};

// -- Module-level helpers --

function getStoredBackend(): AIBackend {
  try {
    const stored = localStorage.getItem('taxonomy-editor-ai-backend');
    if (stored === 'gemini' || stored === 'claude' || stored === 'groq' || stored === 'openai' || stored === 'deepseek' || stored === 'azure' || stored === 'ollama' || stored === 'zai') return stored;
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to read stored AI backend from localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
  }
  return 'gemini';
}

function getStoredModel(): AIModel {
  try {
    const stored = localStorage.getItem('taxonomy-editor-gemini-model');
    if (stored && ALL_MODEL_IDS.has(stored)) return stored as AIModel;
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to read stored AI model from localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
  }
  const backend = getStoredBackend();
  return DEFAULT_MODELS[backend];
}

interface AIModelsConfig {
  backends: { id: string; label: string }[];
  models: { id: string; label: string; backend: string }[];
  defaults: Record<string, string>;
  debateTiers?: Record<string, Record<string, string>>;
  fallbackChains?: Record<string, string[]>;
}

export async function initAIModels(): Promise<void> {
  try {
    const config = await api.loadAIModels() as AIModelsConfig | null;
    if (!config?.models?.length) return;

    AI_BACKENDS.length = 0;
    for (const b of config.backends) {
      AI_BACKENDS.push({ value: b.id as AIBackend, label: b.label });
    }

    for (const key of Object.keys(MODELS_BY_BACKEND) as AIBackend[]) {
      MODELS_BY_BACKEND[key] = [];
    }
    for (const m of config.models) {
      const backend = m.backend as AIBackend;
      if (!MODELS_BY_BACKEND[backend]) MODELS_BY_BACKEND[backend] = [];
      MODELS_BY_BACKEND[backend].push({ value: m.id as AIModel, label: m.label });
    }

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

export function backendForModel(model: string): AIBackend {
  if (model.startsWith('gemini')) return 'gemini';
  if (model.startsWith('claude')) return 'claude';
  if (model.startsWith('groq')) return 'groq';
  if (model.startsWith('openai')) return 'openai';
  if (model.startsWith('deepseek')) return 'deepseek';
  if (model.startsWith('azure')) return 'azure';
  if (model.startsWith('ollama')) return 'ollama';
  if (model.startsWith('zai')) return 'zai';
  return 'gemini';
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
