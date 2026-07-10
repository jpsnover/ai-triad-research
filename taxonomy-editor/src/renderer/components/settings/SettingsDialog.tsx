// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useCallback } from 'react';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import type { ColorScheme, AIBackend, AIModel } from '../../hooks/useTaxonomyStore';
import { AI_BACKENDS, MODELS_BY_BACKEND, initAIModels } from '../../hooks/useTaxonomyStore';
import { KeySharingDialog } from './KeySharingDialog';
import { useDescriptionMode, type DescriptionMode } from '../shared/DescriptionToggle';

interface SettingsDialogProps {
  onClose: () => void;
}

interface RefreshResult {
  gemini: { ok: boolean; count: number; error?: string };
  claude: { ok: boolean; count: number; error?: string };
  groq:   { ok: boolean; count: number; error?: string };
  openai: { ok: boolean; count: number; error?: string };
  azure?: { ok: boolean; count: number; error?: string };
  deepseek: { ok: boolean; count: number; error?: string };
  ollama: { ok: boolean; count: number; error?: string };
  totalModels: number;
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 011.334-1.334h2.666a1.333 1.333 0 011.334 1.334V4M13 4v9.333a1.333 1.333 0 01-1.333 1.334H4.333A1.333 1.333 0 013 13.333V4" />
    </svg>
  );
}

function ShowKeysSection({ onKeysChanged }: { onKeysChanged?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [keysByBackend, setKeysByBackend] = useState<Record<string, { index: number; masked: string }[]>>({});
  const [loading, setLoading] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState<{ backend: string; index: number } | null>(null);
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<Record<string, { index: number; valid: boolean; error?: string }[]>>({});
  const [verifying, setVerifying] = useState<string | null>(null);

  const backendLabel: Record<string, string> = Object.fromEntries(
    AI_BACKENDS.map(b => [b.value, b.label]),
  );

  const refreshKeys = useCallback(async () => {
    const result: Record<string, { index: number; masked: string }[]> = {};
    for (const b of AI_BACKENDS) {
      if (b.value === 'ollama') continue;
      try {
        result[b.value] = await api.getApiKeys(b.value);
      } catch { /* telemetry — silent by design */ }
    }
    setKeysByBackend(result);
  }, []);

  const handleToggle = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setLoading(true);
    try {
      await refreshKeys();
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'settings-dialog',
        level: 'error',
        message: 'Failed to load API keys',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      setKeysByBackend({});
    } finally {
      setLoading(false);
      setExpanded(true);
    }
  };

  const handleRemoveKey = async (backend: string, index: number) => {
    setDeleting(true);
    try {
      await api.removeApiKey(index, backend);
      await refreshKeys();
      setConfirmingRemove(null);
      onKeysChanged?.();
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'settings-dialog',
        level: 'error',
        message: `Failed to remove API key ${index} for ${backend}`,
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
      await refreshKeys();
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
      setConfirmingRemove(null);
      setConfirmingDeleteAll(false);
    }
  }, []);

  const handleVerifyKeys = useCallback(async (backend: string) => {
    setVerifying(backend);
    try {
      const { results } = await api.verifyStoredKeys(backend);
      setVerifyStatus(prev => ({ ...prev, [backend]: results }));
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'settings-dialog', level: 'error',
        message: `Failed to verify API keys for ${backend}`,
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      setVerifyStatus(prev => ({ ...prev, [backend]: [{ index: 0, valid: false, error: 'Verification failed — check network' }] }));
    } finally {
      setVerifying(null);
    }
  }, []);

  const modelsForBackend = (backend: string) => {
    const models = MODELS_BY_BACKEND[backend as keyof typeof MODELS_BY_BACKEND];
    if (!models || models.length === 0) return 'no models configured';
    return models.map(m => m.label).join(', ');
  };

  const totalKeys = Object.values(keysByBackend).reduce((sum, keys) => sum + keys.length, 0);

  return (
    <>
      <button className="btn btn-sm" onClick={handleToggle} disabled={loading}>
        {loading ? '...' : expanded ? 'Hide Keys' : 'Show Keys'}
      </button>
      {expanded && (
        <div className="settings-key-summary" onKeyDown={handleKeyDown}>
          {AI_BACKENDS.filter(b => b.value !== 'ollama').map(b => {
            const keys = keysByBackend[b.value] ?? [];
            return (
              <div key={b.value} className="settings-key-backend-group">
                <div className={`settings-key-summary-row${keys.length === 0 ? ' no-key' : ''}`}>
                  <span className="settings-key-summary-backend">
                    {b.label}
                  </span>
                  {keys.length === 0 && (
                    <span className="settings-key-summary-masked">—</span>
                  )}
                  <span className="settings-key-summary-models" title={modelsForBackend(b.value)}>
                    {modelsForBackend(b.value)}
                  </span>
                  {keys.length > 0 && (
                    <button
                      className="btn btn-sm"
                      style={{ marginLeft: 'auto', fontSize: '0.72rem', padding: '2px 8px' }}
                      onClick={() => void handleVerifyKeys(b.value)}
                      disabled={verifying === b.value}
                      title="Verify keys against provider"
                    >
                      {verifying === b.value ? 'Verifying...' : 'Verify'}
                    </button>
                  )}
                </div>
                {keys.map(k => {
                  const isConfirming = confirmingRemove?.backend === b.value && confirmingRemove?.index === k.index;
                  if (isConfirming) {
                    return (
                      <div key={k.index} className="settings-key-summary-row" style={{ justifyContent: 'space-between', paddingLeft: 16 }}>
                        <span style={{ fontSize: '0.78rem' }}>Remove this key?</span>
                        <span style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-sm" onClick={() => setConfirmingRemove(null)} disabled={deleting} autoFocus>
                            Cancel
                          </button>
                          <button
                            className="btn btn-sm"
                            style={{ background: '#ef4444', color: '#fff' }}
                            onClick={() => void handleRemoveKey(b.value, k.index)}
                            disabled={deleting}
                          >
                            {deleting ? '...' : 'Remove'}
                          </button>
                        </span>
                      </div>
                    );
                  }
                  const keyResult = verifyStatus[b.value]?.find(r => r.index === k.index);
                  return (
                    <div key={k.index} className="settings-key-summary-row" style={{ paddingLeft: 16 }}>
                      <span className="settings-key-summary-masked" style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>
                        {k.masked}
                      </span>
                      {keyResult && (
                        <span
                          title={keyResult.valid ? 'Key is valid' : keyResult.error ?? 'Invalid key'}
                          style={{ fontSize: '0.75rem', marginLeft: 4, color: keyResult.valid ? 'var(--success-text, #16a34a)' : 'var(--error-text, #dc2626)' }}
                        >
                          {keyResult.valid ? '✓' : '✗'}
                          {!keyResult.valid && keyResult.error && (
                            <span style={{ marginLeft: 4, fontSize: '0.7rem', opacity: 0.8 }}>{keyResult.error}</span>
                          )}
                        </span>
                      )}
                      <button
                        className="settings-key-delete-btn"
                        onClick={() => setConfirmingRemove({ backend: b.value, index: k.index })}
                        aria-label={`Remove key ${k.masked}`}
                        title="Remove key"
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
                    </div>
                  );
                })}
              </div>
            );
          })}

          {totalKeys >= 2 && (
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
        </div>
      )}
    </>
  );
}

function TestKeysButton({ hasKey }: { hasKey: Record<string, boolean> }) {
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<Record<string, { valid: boolean; error?: string } | null>>({});
  const [tested, setTested] = useState(false);

  const backendLabel = Object.fromEntries(AI_BACKENDS.map(b => [b.value, b.label]));

  const handleTestAll = useCallback(async () => {
    const backendsWithKeys = AI_BACKENDS.filter(b => b.value !== 'ollama' && hasKey[b.value]);
    if (backendsWithKeys.length === 0) return;
    setTesting(true);
    setResults({});
    setTested(false);
    for (const b of backendsWithKeys) {
      try {
        const { results: r } = await api.verifyStoredKeys(b.value);
        const allValid = r.every((k: { valid: boolean }) => k.valid);
        const firstError = r.find((k: { valid: boolean }) => !k.valid);
        setResults(prev => ({ ...prev, [b.value]: { valid: allValid, error: firstError?.error } }));
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error', component: 'settings-dialog', level: 'error',
          message: `Failed to verify keys for ${b.value}`,
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        setResults(prev => ({ ...prev, [b.value]: { valid: false, error: 'Verification failed' } }));
      }
    }
    setTesting(false);
    setTested(true);
  }, [hasKey]);

  const backendsWithKeys = AI_BACKENDS.filter(b => b.value !== 'ollama' && hasKey[b.value]);
  const hasAnyKeys = backendsWithKeys.length > 0;

  return (
    <>
      <button
        className="btn btn-sm"
        onClick={() => void handleTestAll()}
        disabled={testing || !hasAnyKeys}
        title={hasAnyKeys ? 'Verify all configured API keys' : 'No API keys configured'}
      >
        {testing ? 'Testing...' : 'Test Keys'}
      </button>
      {tested && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', fontSize: '0.78rem', marginTop: 4 }}>
          {backendsWithKeys.map(b => {
            const r = results[b.value];
            if (!r) return null;
            return (
              <span key={b.value} style={{ whiteSpace: 'nowrap' }} title={r.valid ? 'Key is valid' : r.error ?? 'Invalid key'}>
                <span style={{ color: r.valid ? 'var(--success-text, #16a34a)' : 'var(--error-text, #dc2626)' }}>
                  {r.valid ? '✓' : '✗'}
                </span>
                {' '}{backendLabel[b.value] ?? b.value}
                {!r.valid && r.error && (
                  <span style={{ fontSize: '0.68rem', color: 'var(--error-text, #dc2626)', marginLeft: 4, opacity: 0.8 }}>{r.error}</span>
                )}
              </span>
            );
          })}
        </div>
      )}
    </>
  );
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const { colorScheme, setColorScheme, paneSpacing, setPaneSpacing, aiBackend, setAIBackend, geminiModel, setGeminiModel } = useTaxonomyStore();
  const [descMode, setDescMode] = useDescriptionMode();
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
  const [endpointInput, setEndpointInput] = useState('');

  const models = MODELS_BY_BACKEND[aiBackend] || [];
  const [tierAvailable, setTierAvailable] = useState<Set<string> | null>(null);

  useEffect(() => {
    void Promise.all(
      AI_BACKENDS.map(async (b) => {
        const has = await api.hasApiKey(b.value);
        return [b.value, has] as [string, boolean];
      }),
    ).then((results) => setHasKey(Object.fromEntries(results)))
      .catch((err) => { getGlobalRecorder()?.record({ type: 'system.error', component: 'settings-dialog', level: 'warn', message: 'hasApiKey check failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); });
    void api.getAvailableBackends()
      .then(backends => setTierAvailable(new Set(backends.filter(b => b.available).map(b => b.id))))
      .catch((err) => { getGlobalRecorder()?.record({ type: 'system.error', component: 'settings-dialog', level: 'warn', message: 'Failed to load available backends', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); });
  }, [keySuccess, keyRefreshTrigger]);

  const handleSaveKey = async () => {
    if (!keyInput.trim()) return;
    if (aiBackend === 'azure') {
      if (!endpointInput.trim()) {
        setKeyError('Azure OpenAI requires an endpoint URL');
        setKeySuccess(null);
        return;
      }
      try {
        const parsed = new URL(endpointInput.trim());
        if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.openai.azure.com')) {
          setKeyError('Endpoint must be https://{resource}.openai.azure.com');
          setKeySuccess(null);
          return;
        }
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error', component: 'settings-dialog', level: 'warn',
          message: 'Invalid Azure endpoint URL',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        setKeyError('Invalid endpoint URL format');
        setKeySuccess(null);
        return;
      }
    }
    setSavingKey(true);
    setKeyError(null);
    setKeySuccess(null);
    try {
      const value = aiBackend === 'azure' ? `${endpointInput.trim()}|${keyInput.trim()}` : keyInput.trim();
      await api.addApiKey(value, aiBackend);
      setKeyInput('');
      if (aiBackend === 'azure') setEndpointInput('');
      const label = AI_BACKENDS.find(b => b.value === aiBackend)?.label;
      setKeySuccess(`${label} key saved`);
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
    azure: 'your-api-key',
  };

  const keyProvisionUrl: Partial<Record<AIBackend, { url: string; label: string }>> = {
    gemini:   { url: 'https://aistudio.google.com/apikey', label: 'Google AI Studio' },
    claude:   { url: 'https://console.anthropic.com/settings/keys', label: 'Anthropic Console' },
    groq:     { url: 'https://console.groq.com/keys', label: 'Groq Console' },
    openai:   { url: 'https://platform.openai.com/api-keys', label: 'OpenAI Platform' },
    deepseek: { url: 'https://platform.deepseek.com/api_keys', label: 'DeepSeek Platform' },
    azure:    { url: 'https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/OpenAI', label: 'Azure Portal' },
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
            {AI_BACKENDS.map((b) => {
              const blocked = tierAvailable && !tierAvailable.has(b.value);
              return (
                <option key={b.value} value={b.value} disabled={!!blocked}>
                  {b.label}{blocked ? ' (not on your tier)' : hasKey[b.value] ? '' : ' (no key)'}
                </option>
              );
            })}
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
            {(['gemini', 'claude', 'groq', 'openai', 'azure', 'deepseek', 'ollama'] as const).map((b) => {
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
            {aiBackend === 'azure' && (
              <>
                <label className="settings-label">Endpoint URL</label>
                <div className="settings-key-row" style={{ marginBottom: 8 }}>
                  <input
                    type="text"
                    className="settings-key-input"
                    value={endpointInput}
                    onChange={(e) => setEndpointInput(e.target.value)}
                    placeholder="https://your-resource.openai.azure.com"
                  />
                </div>
              </>
            )}
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
                disabled={!keyInput.trim() || (aiBackend === 'azure' && !endpointInput.trim()) || savingKey}
              >
                {savingKey ? '...' : 'Save'}
              </button>
            </div>
            {keyError && <div className="settings-key-error">{keyError}</div>}
            {keySuccess && <div className="settings-key-success">{keySuccess}</div>}
            {keyProvisionUrl[aiBackend] && (
              <div style={{ marginTop: 4 }}>
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); void api.openExternal(keyProvisionUrl[aiBackend]!.url); }}
                  style={{ fontSize: '0.8rem', color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer' }}
                >
                  Get a {AI_BACKENDS.find(b => b.value === aiBackend)?.label} API key &#8594; {keyProvisionUrl[aiBackend]!.label}
                </a>
              </div>
            )}
          </div>
        )}

        <div className="settings-key-actions-row">
          <TestKeysButton hasKey={hasKey} />
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

        <div className="settings-divider" />

        <div className="settings-row">
          <label className="settings-label">Description Display</label>
          <div className="settings-radio-group" role="radiogroup" aria-label="Default description view">
            <label className="settings-radio-label">
              <input type="radio" name="descMode" value="formal" checked={descMode === 'formal'} onChange={() => setDescMode('formal')} />
              Formal
            </label>
            <label className="settings-radio-label">
              <input type="radio" name="descMode" value="plain" checked={descMode === 'plain'} onChange={() => setDescMode('plain')} />
              Plain
            </label>
          </div>
        </div>

        <div className="dialog-actions">
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
