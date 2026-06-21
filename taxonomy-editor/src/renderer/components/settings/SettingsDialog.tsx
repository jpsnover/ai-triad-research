// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useCallback } from 'react';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import type { ColorScheme, AIBackend, AIModel } from '../../hooks/useTaxonomyStore';
import { AI_BACKENDS, MODELS_BY_BACKEND, initAIModels } from '../../hooks/useTaxonomyStore';
import { usePromptConfigStore, PROMPT_CONFIG_DEFAULTS } from '../../hooks/usePromptConfigStore';
import { KeySharingDialog } from './KeySharingDialog';

interface SettingsDialogProps {
  onClose: () => void;
}

interface RefreshResult {
  gemini: { ok: boolean; count: number; error?: string };
  claude: { ok: boolean; count: number; error?: string };
  groq:   { ok: boolean; count: number; error?: string };
  openai: { ok: boolean; count: number; error?: string };
  deepseek: { ok: boolean; count: number; error?: string };
  ollama: { ok: boolean; count: number; error?: string };
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

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 011.334-1.334h2.666a1.333 1.333 0 011.334 1.334V4M13 4v9.333a1.333 1.333 0 01-1.333 1.334H4.333A1.333 1.333 0 013 13.333V4" />
    </svg>
  );
}

function ShowKeysSection({ onKeysChanged }: { onKeysChanged?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [keySummary, setKeySummary] = useState<{ backend: string; hasKey: boolean; maskedKey: string | null }[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const backendLabel: Record<string, string> = Object.fromEntries(
    AI_BACKENDS.map(b => [b.value, b.label]),
  );

  const refreshSummary = useCallback(async () => {
    const summary = await api.getApiKeySummary();
    setKeySummary(summary);
  }, []);

  const handleToggle = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setLoading(true);
    try {
      await refreshSummary();
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'settings-dialog',
        level: 'error',
        message: 'Failed to load API key summary',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      setKeySummary([]);
    } finally {
      setLoading(false);
      setExpanded(true);
    }
  };

  const handleDeleteKey = async (backend: string) => {
    setDeleting(true);
    try {
      await api.deleteApiKey(backend);
      await refreshSummary();
      setConfirmingDelete(null);
      onKeysChanged?.();
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'settings-dialog',
        level: 'error',
        message: `Failed to delete API key for ${backend}`,
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteAll = async () => {
    setDeleting(true);
    try {
      await api.deleteAllApiKeys();
      await refreshSummary();
      setConfirmingDeleteAll(false);
      onKeysChanged?.();
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'settings-dialog',
        level: 'error',
        message: 'Failed to delete all API keys',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setConfirmingDelete(null);
      setConfirmingDeleteAll(false);
    }
  }, []);

  const modelsForBackend = (backend: string) => {
    const models = MODELS_BY_BACKEND[backend as keyof typeof MODELS_BY_BACKEND];
    if (!models || models.length === 0) return 'no models configured';
    return models.map(m => m.label).join(', ');
  };

  const keysWithValues = keySummary.filter(e => e.hasKey && e.backend !== 'ollama');

  return (
    <>
      <button className="btn btn-sm" onClick={handleToggle} disabled={loading}>
        {loading ? '...' : expanded ? 'Hide Keys' : 'Show Keys'}
      </button>
      {expanded && (
        <div className="settings-key-summary" onKeyDown={handleKeyDown}>
          {keySummary.length === 0 ? (
            <div className="settings-hint">No keys found</div>
          ) : (
            <>
              {keySummary.map(entry => {
                const isOllama = entry.backend === 'ollama';
                const isConfirming = confirmingDelete === entry.backend;

                if (isConfirming) {
                  return (
                    <div key={entry.backend} className="settings-key-summary-row" style={{ justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.78rem' }}>
                        {'Delete ' + (backendLabel[entry.backend] ?? entry.backend) + ' key?'}
                      </span>
                      <span style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn btn-sm"
                          onClick={() => setConfirmingDelete(null)}
                          disabled={deleting}
                          autoFocus
                        >
                          Cancel
                        </button>
                        <button
                          className="btn btn-sm"
                          style={{ background: '#ef4444', color: '#fff' }}
                          onClick={() => void handleDeleteKey(entry.backend)}
                          disabled={deleting}
                        >
                          {deleting ? '...' : 'Delete'}
                        </button>
                      </span>
                    </div>
                  );
                }

                return (
                  <div key={entry.backend} className={`settings-key-summary-row${entry.hasKey ? '' : ' no-key'}`}>
                    <span className="settings-key-summary-backend">{backendLabel[entry.backend] ?? entry.backend}</span>
                    <span className="settings-key-summary-masked">
                      {isOllama ? '(local — no key)' : entry.maskedKey ?? '—'}
                    </span>
                    <span className="settings-key-summary-models" title={modelsForBackend(entry.backend)}>
                      {modelsForBackend(entry.backend)}
                    </span>
                    {entry.hasKey && !isOllama && (
                      <button
                        className="settings-key-delete-btn"
                        onClick={() => setConfirmingDelete(entry.backend)}
                        aria-label={`Delete ${backendLabel[entry.backend] ?? entry.backend} API key`}
                        title="Delete key"
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer', padding: '4px 7px',
                          color: 'var(--text-muted)', opacity: 0.5, transition: 'color 0.15s, opacity 0.15s',
                          display: 'flex', alignItems: 'center', flexShrink: 0,
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.opacity = '1'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.opacity = '0.5'; }}
                      >
                        <TrashIcon />
                      </button>
                    )}
                  </div>
                );
              })}

              {keysWithValues.length >= 2 && (
                <div style={{ borderTop: '1px solid var(--border-color)', marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'flex-end' }}>
                  {confirmingDeleteAll ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem' }}>
                      <span>Delete all API keys? This cannot be undone.</span>
                      <button
                        className="btn btn-sm"
                        onClick={() => setConfirmingDeleteAll(false)}
                        disabled={deleting}
                        autoFocus
                      >
                        Cancel
                      </button>
                      <button
                        className="btn btn-sm"
                        style={{ background: '#ef4444', color: '#fff' }}
                        onClick={() => void handleDeleteAll()}
                        disabled={deleting}
                      >
                        {deleting ? '...' : 'Delete All'}
                      </button>
                    </span>
                  ) : (
                    <button
                      className="btn btn-sm"
                      style={{ color: '#ef4444', background: 'none', border: 'none' }}
                      onClick={() => setConfirmingDeleteAll(true)}
                      aria-label="Delete all stored API keys"
                    >
                      Delete All Keys
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

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
  const { colorScheme, setColorScheme, paneSpacing, setPaneSpacing, qbafEnabled, setQbafEnabled, aiBackend, setAIBackend, geminiModel, setGeminiModel, communityServerUrl, setCommunityServerUrl } = useTaxonomyStore();
  const [hasKey, setHasKey] = useState<Record<string, boolean>>({});
  const [keyInput, setKeyInput] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keySuccess, setKeySuccess] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<RefreshResult | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [showKeySharing, setShowKeySharing] = useState(false);
  const [, forceUpdate] = useState(0);
  const [keyRefreshTrigger, setKeyRefreshTrigger] = useState(0);

  const models = MODELS_BY_BACKEND[aiBackend] || [];

  useEffect(() => {
    void Promise.all(
      AI_BACKENDS.map(async (b) => {
        const has = await api.hasApiKey(b.value);
        return [b.value, has] as [string, boolean];
      }),
    ).then((results) => setHasKey(Object.fromEntries(results)));
  }, [keySuccess, keyRefreshTrigger]);

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
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'settings-dialog',
        level: 'error',
        message: 'Failed to save API key',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
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
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'settings-dialog',
        level: 'error',
        message: 'Failed to refresh AI models',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      setRefreshError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  };

  const isLocalBackend = aiBackend === 'ollama';
  const keyPlaceholder: Partial<Record<AIBackend, string>> = {
    gemini: 'AIza...',
    claude: 'sk-ant-...',
    groq: 'gsk_...',
    openai: 'sk-...',
    deepseek: 'sk-...',
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
            {(['gemini', 'claude', 'groq', 'openai', 'deepseek', 'ollama'] as const).map((b) => {
              const r = refreshResult[b];
              if (!r) return null;
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

        {isLocalBackend ? (
          <div className="settings-key-section">
            <span className="settings-label" style={{ fontStyle: 'italic', opacity: 0.7 }}>
              {AI_BACKENDS.find(b => b.value === aiBackend)?.label} runs locally — no API key needed
            </span>
          </div>
        ) : (
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
                placeholder={keyPlaceholder[aiBackend] ?? ''}
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
        )}

        <div className="settings-key-actions-row">
          <button className="btn btn-sm" onClick={() => setShowKeySharing(true)}>
            Share / Import Keys via QR
          </button>
          <ShowKeysSection onKeysChanged={() => setKeyRefreshTrigger(n => n + 1)} />
        </div>

        {showKeySharing && (
          <KeySharingDialog
            onClose={() => setShowKeySharing(false)}
            onKeysImported={() => setKeySuccess('Keys imported via QR')}
          />
        )}

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
            <option value="harvard">Harvard</option>
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

        <div className="settings-row">
          <label className="settings-label">Community Server URL</label>
          <div className="settings-hint" style={{ marginBottom: 4 }}>
            Required for sharing debates from the desktop app. Leave blank when using the web version.
          </div>
          <input
            type="url"
            className="settings-key-input"
            value={communityServerUrl}
            onChange={(e) => setCommunityServerUrl(e.target.value)}
            placeholder="https://your-app.azurewebsites.net"
          />
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
