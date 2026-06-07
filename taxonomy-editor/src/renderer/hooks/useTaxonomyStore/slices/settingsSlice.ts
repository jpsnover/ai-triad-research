// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { StateCreator } from 'zustand';
import type { TaxonomyStore } from '../types';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

// -- Exported types --

export type ColorScheme = 'light' | 'dark' | 'bkc' | 'harvard' | 'system';

export type AIBackend = 'gemini' | 'claude' | 'groq' | 'openai' | 'deepseek' | 'ollama';

export type GeminiModel =
  | 'gemini-flash-lite-latest'
  | 'gemini-2.5-flash'
  | 'gemini-2.5-pro'
  | 'gemini-2.0-flash'
  | 'gemini-2.0-flash-lite'
  | 'gemini-1.5-flash'
  | 'gemini-1.5-pro';

export type ClaudeModel =
  | 'claude-sonnet-4-5'
  | 'claude-haiku-3.5';

export type GroqModel =
  | 'groq-llama-4-scout'
  | 'groq-llama-3.3-70b';

export type OpenAIModel =
  | 'openai-gpt-5.5'
  | 'openai-gpt-5.5-pro';

export type DeepSeekModel =
  | 'deepseek-chat'
  | 'deepseek-reasoner';

export type OllamaModel =
  | 'ollama-gemma4-e4b-it-q4-k-m';

export type AIModel = GeminiModel | ClaudeModel | GroqModel | OpenAIModel | DeepSeekModel | OllamaModel;

export interface AIModelEntry { value: AIModel; label: string }

// -- Exported constants --

export const AI_BACKENDS: { value: AIBackend; label: string }[] = [
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'claude', label: 'Anthropic Claude' },
  { value: 'groq', label: 'Groq' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'ollama', label: 'Ollama (Local)' },
];

export const MODELS_BY_BACKEND: Record<AIBackend, AIModelEntry[]> = {
  gemini: [
    { value: 'gemini-flash-lite-latest', label: '3.1 Flash Lite Preview (default)' },
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
  ollama: [
    { value: 'ollama-gemma4-e4b-it-q4-k-m', label: 'Gemma 4 E4B (default)' },
  ],
};

/** @deprecated Use MODELS_BY_BACKEND.gemini instead */
export const GEMINI_MODELS = MODELS_BY_BACKEND.gemini;

const ALL_MODEL_IDS: Set<string> = new Set(
  Object.values(MODELS_BY_BACKEND).flat().map(m => m.value),
);

const DEFAULT_MODELS: Record<AIBackend, AIModel> = {
  gemini: 'gemini-flash-lite-latest',
  claude: 'claude-sonnet-4-6',
  groq: 'groq-llama-4-scout-17b-16e',
  openai: 'openai-gpt-5.5',
  deepseek: 'deepseek-chat',
  ollama: 'ollama-gemma4-e4b-it-q4-k-m',
};

export let DEBATE_TIERS: Record<string, Record<string, string>> = {};
export let FALLBACK_CHAINS: Record<string, string[]> = {};

// -- Module-level helpers --

function getStoredBackend(): AIBackend {
  try {
    const stored = localStorage.getItem('taxonomy-editor-ai-backend');
    if (stored === 'gemini' || stored === 'claude' || stored === 'groq' || stored === 'openai' || stored === 'deepseek' || stored === 'ollama') return stored;
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to read stored AI backend from localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
  }
  return 'gemini';
}

function getStoredModel(): AIModel {
  try {
    const stored = localStorage.getItem('taxonomy-editor-gemini-model');
    if (stored && ALL_MODEL_IDS.has(stored)) return stored as AIModel;
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to read stored AI model from localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
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
    getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to load ai-models.json config', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
    console.warn('[AI Models] Failed to load ai-models.json, using built-in defaults:', err);
  }
}

export function backendForModel(model: string): AIBackend {
  if (model.startsWith('gemini')) return 'gemini';
  if (model.startsWith('claude')) return 'claude';
  if (model.startsWith('groq')) return 'groq';
  if (model.startsWith('ollama')) return 'ollama';
  return 'gemini';
}

function getStoredTheme(): ColorScheme {
  try {
    const stored = localStorage.getItem('taxonomy-editor-theme');
    if (stored === 'light' || stored === 'dark' || stored === 'bkc' || stored === 'harvard' || stored === 'system') return stored;
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to read stored theme from localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
  }
  return 'light';
}

function applyTheme(scheme: ColorScheme) {
  const root = document.documentElement;
  if (scheme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', scheme);
  }
  try { localStorage.setItem('taxonomy-editor-theme', scheme); } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to persist theme to localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
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

  qbafEnabled: boolean;
  setQbafEnabled: (enabled: boolean) => void;

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
      getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to persist AI backend to localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
    }
    const newModel = DEFAULT_MODELS[backend];
    try { localStorage.setItem('taxonomy-editor-gemini-model', newModel); } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to persist AI model to localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
    }
    set({ aiBackend: backend, geminiModel: newModel });
  },
  geminiModel: getStoredModel(),
  setGeminiModel: (model) => {
    try { localStorage.setItem('taxonomy-editor-gemini-model', model); } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to persist AI model selection to localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
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
      getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to read pane spacing from localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
      return 'normal' as const;
    }
  })(),
  setPaneSpacing: (spacing) => {
    try { localStorage.setItem('taxonomy-editor-pane-spacing', spacing); } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to persist pane spacing to localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
    }
    document.documentElement.setAttribute('data-pane-spacing', spacing);
    set({ paneSpacing: spacing });
  },

  qbafEnabled: (() => {
    try { const v = localStorage.getItem('taxonomy-editor-qbaf'); return v === null ? true : v === 'true'; } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to read QBAF setting from localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
      return true;
    }
  })(),
  setQbafEnabled: (enabled) => {
    try { localStorage.setItem('taxonomy-editor-qbaf', String(enabled)); } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to persist QBAF setting to localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
    }
    set({ qbafEnabled: enabled });
  },

  zoomLevel: (() => {
    try {
      const stored = localStorage.getItem('taxonomy-editor-zoom');
      if (stored) {
        const n = parseInt(stored, 10);
        if (n >= 60 && n <= 200) return n;
      }
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to read zoom level from localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
    }
    return 100;
  })(),

  zoomIn: () => {
    const next = Math.min(200, get().zoomLevel + 10);
    try { localStorage.setItem('taxonomy-editor-zoom', String(next)); } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to persist zoom level to localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
    }
    set({ zoomLevel: next });
  },

  zoomOut: () => {
    const next = Math.max(60, get().zoomLevel - 10);
    try { localStorage.setItem('taxonomy-editor-zoom', String(next)); } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to persist zoom level to localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
    }
    set({ zoomLevel: next });
  },

  zoomReset: () => {
    try { localStorage.setItem('taxonomy-editor-zoom', '100'); } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to persist zoom reset to localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
    }
    set({ zoomLevel: 100 });
  },
});
