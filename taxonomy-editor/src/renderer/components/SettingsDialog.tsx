// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect } from 'react';
import { api } from '@bridge';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import type { ColorScheme, AIBackend, AIModel } from '../hooks/useTaxonomyStore';
import { AI_BACKENDS, MODELS_BY_BACKEND, initAIModels } from '../hooks/useTaxonomyStore';
import { usePromptConfigStore, PROMPT_CONFIG_DEFAULTS } from '../hooks/usePromptConfigStore';

interface SettingsDialogProps {
  onClose: () => void;
}

interface RefreshResult {
  gemini: { ok: boolean; count: number; error?: string };
  claude: { ok: boolean; count: number; error?: string };
  groq:   { ok: boolean; count: number; error?: string };
  totalModels: number;
}

const PROMPT_DEFAULT_ROWS: { label: string; key: string; type: 'number' | 'select'; min?: number; max?: number; step?: number; options?: { value: string; label: string }[] }[] = [
  { label: 'Default Temperature', key: 'temperature.debate', type: 'number', min: 0, max: 2, step: 0.1 },
  { label: 'Taxonomy: Max Nodes', key: 'taxonomyNodes.maxTotal', type: 'number', min: 5, max: 100 },
  { label: 'Taxonomy: Min per BDI', key: 'taxonomyNodes.minPerBdi', type: 'number', min: 1, max: 10 },
  { label: 'Taxonomy: Threshold', key: 'taxonomyNodes.threshold', type: 'number', min: 0, max: 1, step: 0.05 },
  { label: 'Situations: Max', key: 'situationNodes.max', type: 'number', min: 3, max: 50 },
  { label: 'Vulnerabilities: Max', key: 'vulnerabilities.max', type: 'number', min: 1, max: 20 },
  { label: 'Fallacy Filter', key: 'fallacies.confidenceFilter', type: 'select', options: [{ value: 'likely', label: 'Likely only' }, { value: 'all', label: 'All' }] },
  { label: 'Policies: Max', key: 'policyRegistry.max', type: 'number', min: 1, max: 30 },
  { label: 'Source Truncation', key: 'sourceDocument.truncationLimit', type: 'number', min: 10000, max: 100000, step: 5000 },
  { label: 'Established Points: Max', key: 'establishedPoints.max', type: 'number', min: 5, max: 20 },
];

function PromptDefaultsSection() {
  const workspaceDefaults = usePromptConfigStore(s => s.workspaceDefaults);
  const setWorkspace = usePromptConfigStore(s => s.setWorkspace);
  const getResolved = usePromptConfigStore(s => s.get);

  return (
    <details className="settings-prompt-defaults">
      <summary className="settings-label" style={{ cursor: 'pointer' }}>Prompt Defaults</summary>
      <p className="settings-hint">These apply to all new debates/chats. Existing sessions keep their per-session overrides.</p>
      <div className="settings-defaults-grid">
        {PROMPT_DEFAULT_ROWS.map(row => {
          const value = getResolved(row.key);
          const isOverridden = row.key in workspaceDefaults;
          return (
            <div key={row.key} className="settings-default-row">
              <span className="settings-default-label">{row.label}</span>
              {row.type === 'number' ? (
                <div className="settings-default-control">
                  <input
                    type="range"
                    min={row.min}
                    max={row.max}
                    step={row.step ?? 1}
                    value={value as number}
                    onChange={e => setWorkspace(row.key, Number(e.target.value))}
                    className="pi-slider"
                  />
                  <span className="settings-default-value">{typeof value === 'number' && row.step && row.step < 1 ? (value as number).toFixed(2) : String(value)}</span>
                </div>
              ) : (
                <select
                  className="settings-select settings-select-sm"
                  value={value as string}
                  onChange={e => setWorkspace(row.key, e.target.value)}
                >
                  {row.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
              {isOverridden && (
                <button
                  className="settings-default-reset"
                  onClick={() => {
                    const next = { ...workspaceDefaults };
                    delete next[row.key];
                    // Reset by setting to coded default
                    setWorkspace(row.key, PROMPT_CONFIG_DEFAULTS[row.key]);
                  }}
                  title={`Reset to ${PROMPT_CONFIG_DEFAULTS[row.key]}`}
                >
                  reset
                </button>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const { colorScheme, setColorScheme, paneSpacing, setPaneSpacing, qbafEnabled, setQbafEnabled, aiBackend, setAIBackend, geminiModel, setGeminiModel } = useTaxonomyStore();
  const [hasKey, setHasKey] = useState<Record<string, boolean>>({});
  const [keyInput, setKeyInput] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keySuccess, setKeySuccess] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<RefreshResult | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [, forceUpdate] = useState(0);

  const models = MODELS_BY_BACKEND[aiBackend] || [];

  useEffect(() => {
    void Promise.all(
      AI_BACKENDS.map(async (b) => {
        const has = await api.hasApiKey(b.value);
        return [b.value, has] as [string, boolean];
      }),
    ).then((results) => setHasKey(Object.fromEntries(results)));
  }, [keySuccess]);

  const handleSaveKey = async () => {
    if (!keyInput.trim()) return;
    setSavingKey(true);
    setKeyError(null);
    setKeySuccess(null);
    try {
      await api.setApiKey(keyInput.trim(), aiBackend);
      setKeyInput('');
      setKeySuccess(`${AI_BACKENDS.find(b => b.value === aiBackend)?.label} key saved`);
    } catch (err) {
      setKeyError(String(err));
    } finally {
      setSavingKey(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshResult(null);
    setRefreshError(null);
    try {
      const result = await api.refreshAIModels() as RefreshResult;
      // Reload the in-memory model catalog from the updated file
      await initAIModels();
      setRefreshResult(result);
      // Force re-render so dropdowns pick up new model lists
      forceUpdate(n => n + 1);
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  };

  const keyPlaceholder: Record<AIBackend, string> = {
    gemini: 'AIza...',
    claude: 'sk-ant-...',
    groq: 'gsk_...',
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog settings-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Settings</h3>

        <div className="settings-row">
          <label className="settings-label">AI Backend</label>
          <select
            className="settings-select"
            value={aiBackend}
            onChange={(e) => setAIBackend(e.target.value as AIBackend)}
          >
            {AI_BACKENDS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}{hasKey[b.value] ? '' : ' (no key)'}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-row">
          <label className="settings-label">Model</label>
          <div className="settings-model-row">
            <select
              className="settings-select"
              value={geminiModel}
              onChange={(e) => setGeminiModel(e.target.value as AIModel)}
            >
              {models.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <button
              className="btn btn-sm settings-refresh-btn"
              onClick={handleRefresh}
              disabled={refreshing}
              title="Query provider APIs for available models and update ai-models.json"
            >
              {refreshing ? 'Refreshing...' : 'Refresh Models'}
            </button>
          </div>
        </div>

        {refreshResult && (
          <div className="settings-refresh-result">
            {(['gemini', 'claude', 'groq', 'openai'] as const).map((b) => {
              const r = refreshResult[b];
              return (
                <div key={b} className={`settings-refresh-line ${r.ok ? '' : 'settings-refresh-warn'}`}>
                  <span className="settings-refresh-backend">{b}</span>
                  <span>{r.ok ? `${r.count} models` : r.error || 'failed'}</span>
                </div>
              );
            })}
            <div className="settings-refresh-total">
              Total: {refreshResult.totalModels} models saved to ai-models.json
            </div>
          </div>
        )}
        {refreshError && <div className="settings-key-error">{refreshError}</div>}

        <div className="settings-divider" />

        <div className="settings-key-section">
          <label className="settings-label">
            {AI_BACKENDS.find(b => b.value === aiBackend)?.label} API Key
            {hasKey[aiBackend] && <span className="settings-key-status"> (set)</span>}
          </label>
          <div className="settings-key-row">
            <input
              type="password"
              className="settings-key-input"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder={keyPlaceholder[aiBackend]}
            />
            <button
              className="btn btn-sm"
              onClick={handleSaveKey}
              disabled={!keyInput.trim() || savingKey}
            >
              {savingKey ? '...' : 'Save'}
            </button>
          </div>
          {keyError && <div className="settings-key-error">{keyError}</div>}
          {keySuccess && <div className="settings-key-success">{keySuccess}</div>}
        </div>

        <div className="settings-divider" />

        <div className="settings-row">
          <label className="settings-label">Theme</label>
          <select
            className="settings-select"
            value={colorScheme}
            onChange={(e) => setColorScheme(e.target.value as ColorScheme)}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="bkc">BKC</option>
            <option value="system">System</option>
          </select>
        </div>

        <div className="settings-row">
          <label className="settings-label">Pane 2 Item Spacing</label>
          <select
            className="settings-select"
            value={paneSpacing}
            onChange={(e) => setPaneSpacing(e.target.value as 'normal' | 'concise')}
          >
            <option value="normal">Normal</option>
            <option value="concise">Concise</option>
          </select>
        </div>

        <div className="settings-row">
          <label className="settings-label">QBAF Visualization</label>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={qbafEnabled}
              onChange={(e) => setQbafEnabled(e.target.checked)}
            />
            <span>Show argument strength scores in debates</span>
          </label>
        </div>

        <div className="settings-divider" />
        <PromptDefaultsSection />

        <div className="dialog-actions">
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
