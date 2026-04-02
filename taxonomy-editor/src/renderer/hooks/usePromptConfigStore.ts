// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Prompt Inspector Phase B — PromptConfig persistence layer.
 * Flat config storage with dot-notation keys.
 * Merge priority: session overrides > workspace defaults > coded defaults.
 */

import { create } from 'zustand';

// ── Coded defaults (match current behavior — no change on first load) ──

export const PROMPT_CONFIG_DEFAULTS: Record<string, number | boolean | string> = {
  'temperature.debate': 0.3,
  'temperature.factCheck': 0.2,
  'taxonomyNodes.maxTotal': 50,
  'taxonomyNodes.minPerBdi': 3,
  'taxonomyNodes.threshold': 0.3,
  'taxonomyNodes.bdiFilter.Beliefs': true,
  'taxonomyNodes.bdiFilter.Desires': true,
  'taxonomyNodes.bdiFilter.Intentions': true,
  'situationNodes.max': 20,
  'situationNodes.min': 3,
  'situationNodes.threshold': 0.3,
  'vulnerabilities.enabled': true,
  'vulnerabilities.max': 10,
  'fallacies.enabled': true,
  'fallacies.confidenceFilter': 'likely',
  'policyRegistry.enabled': true,
  'policyRegistry.max': 10,
  'sourceDocument.truncationLimit': 50000,
  'commitments.enabled': true,
  'argumentNetwork.enabled': true,
  'establishedPoints.enabled': true,
  'establishedPoints.max': 10,
};

const WORKSPACE_DEFAULTS_KEY = 'prompt-inspector-defaults';

function loadWorkspaceDefaults(): Record<string, number | boolean | string> {
  try {
    const raw = localStorage.getItem(WORKSPACE_DEFAULTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveWorkspaceDefaults(overrides: Record<string, number | boolean | string>): void {
  try {
    localStorage.setItem(WORKSPACE_DEFAULTS_KEY, JSON.stringify(overrides));
  } catch { /* ignore */ }
}

// ── Store ──

interface PromptConfigStore {
  /** Session-level overrides (sparse — only changed values) */
  sessionOverrides: Record<string, number | boolean | string>;
  /** Workspace-level defaults (sparse — loaded from localStorage) */
  workspaceDefaults: Record<string, number | boolean | string>;

  /** Get a resolved config value: session > workspace > coded default */
  get: (key: string) => number | boolean | string;
  /** Get all resolved values as a flat record */
  getAll: () => Record<string, number | boolean | string>;
  /** Set a session-level override */
  setSession: (key: string, value: number | boolean | string) => void;
  /** Set a workspace-level default (persisted to localStorage) */
  setWorkspace: (key: string, value: number | boolean | string) => void;
  /** Reset a specific data source to coded defaults (removes session + workspace overrides for that prefix) */
  resetDataSource: (prefix: string) => void;
  /** Reset all session overrides */
  resetSession: () => void;
  /** Load session overrides from a debate/chat session object */
  loadSessionConfig: (config: Record<string, number | boolean | string> | undefined) => void;
  /** Export session overrides for saving to session JSON */
  exportSessionConfig: () => Record<string, number | boolean | string>;
}

export const usePromptConfigStore = create<PromptConfigStore>((set, getState) => ({
  sessionOverrides: {},
  workspaceDefaults: loadWorkspaceDefaults(),

  get: (key: string) => {
    const state = getState();
    if (key in state.sessionOverrides) return state.sessionOverrides[key];
    if (key in state.workspaceDefaults) return state.workspaceDefaults[key];
    return PROMPT_CONFIG_DEFAULTS[key] ?? 0;
  },

  getAll: () => {
    const state = getState();
    return {
      ...PROMPT_CONFIG_DEFAULTS,
      ...state.workspaceDefaults,
      ...state.sessionOverrides,
    };
  },

  setSession: (key, value) => {
    set(state => ({
      sessionOverrides: { ...state.sessionOverrides, [key]: value },
    }));
  },

  setWorkspace: (key, value) => {
    set(state => {
      const next = { ...state.workspaceDefaults, [key]: value };
      saveWorkspaceDefaults(next);
      return { workspaceDefaults: next };
    });
  },

  resetDataSource: (prefix) => {
    set(state => {
      const sessionNext: Record<string, number | boolean | string> = {};
      for (const [k, v] of Object.entries(state.sessionOverrides)) {
        if (!k.startsWith(prefix + '.')) sessionNext[k] = v;
      }
      const workspaceNext: Record<string, number | boolean | string> = {};
      for (const [k, v] of Object.entries(state.workspaceDefaults)) {
        if (!k.startsWith(prefix + '.')) workspaceNext[k] = v;
      }
      saveWorkspaceDefaults(workspaceNext);
      return { sessionOverrides: sessionNext, workspaceDefaults: workspaceNext };
    });
  },

  resetSession: () => {
    set({ sessionOverrides: {} });
  },

  loadSessionConfig: (config) => {
    set({ sessionOverrides: config ?? {} });
  },

  exportSessionConfig: () => {
    return { ...getState().sessionOverrides };
  },
}));
