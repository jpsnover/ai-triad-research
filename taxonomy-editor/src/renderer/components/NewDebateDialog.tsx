// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo, useEffect } from 'react';
import { useDebateStore } from '../hooks/useDebateStore';
import { useShallow } from 'zustand/react/shallow';
import { useTaxonomyStore, MODELS_BY_BACKEND, AI_BACKENDS, initAIModels } from '../hooks/useTaxonomyStore';
import type { AIBackend } from '../hooks/useTaxonomyStore';
import { POVER_INFO, DEBATE_AUDIENCES } from '../types/debate';
import type { SpeakerId, DebateSourceType, DebateAudience } from '../types/debate';
import { DEBATE_PROTOCOLS } from '../data/debateProtocols';
import { AI_POVERS } from '@lib/debate/types';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { loadProvisionalWeights } from '@lib/debate/phaseTransitions';

export type DialecticalStyle = 'adversarial' | 'deliberative' | 'integrative';

const STYLE_PRESETS: { id: DialecticalStyle; label: string; desc: string }[] = [
  { id: 'adversarial', label: 'Adversarial', desc: 'Direct challenge. Western academic debate norms.' },
  { id: 'deliberative', label: 'Deliberative', desc: 'Consensus-oriented. Longer exploration, faster synthesis.' },
  { id: 'integrative', label: 'Integrative', desc: 'Harmony-seeking. Reframing over rebuttal.' },
];

interface NewDebateDialogProps {
  onClose: () => void;
}

const SOURCE_ICONS: Record<DebateSourceType, string> = {
  topic: '\u270F\uFE0F',     // pencil
  document: '\uD83D\uDCC4',  // page
  url: '\uD83C\uDF10',       // globe
  situations: '\uD83D\uDCCB', // clipboard (unused but typed)
  other: '\uD83D\uDCE6',     // package
};

const FORMAT_ICONS: Record<string, string> = {
  structured: '\u2696\uFE0F',    // scales
  socratic: '\uD83E\uDDD0',      // thinking face
  deliberation: '\uD83E\uDD1D',  // handshake
};

const DEBATER_ICONS: Record<string, string> = {
  accelerationist: '\u26A1',   // lightning
  safetyist: '\uD83D\uDEE1\uFE0F',  // shield
  skeptic: '\uD83D\uDD2E',  // crystal ball
  user: '\uD83D\uDC64',       // silhouette
};

export function NewDebateDialog({ onClose }: NewDebateDialogProps) {
  const { createDebate, loadDebate } = useDebateStore(
    useShallow(s => ({ createDebate: s.createDebate, loadDebate: s.loadDebate }))
  );
  const [topic, setTopic] = useState('');
  const [sourceType, setSourceType] = useState<DebateSourceType>('topic');
  const [sourceRef, setSourceRef] = useState('');
  const [sourceContent, setSourceContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [selected, setSelected] = useState<Set<SpeakerId>>(new Set(AI_POVERS));
  const [userIsPover, setUserIsPover] = useState(false);
  const [creating, setCreating] = useState(false);
  const { aiBackend, geminiModel, situations } = useTaxonomyStore();
  const globalModel = geminiModel;
  const availableModels = Object.entries(MODELS_BY_BACKEND)
    .flatMap(([backend, models]) =>
      models.map(m => ({ ...m, label: `${m.label} (${backend})` }))
    );
  const [useCustomModel, setUseCustomModel] = useState(() => {
    const saved = localStorage.getItem('taxonomy-editor-last-debate-model');
    return saved ? saved !== globalModel : false;
  });
  const [customModel, setCustomModel] = useState(() => {
    return localStorage.getItem('taxonomy-editor-last-debate-model') || globalModel;
  });
  const [protocolId, setProtocolId] = useState('structured');
  const [temperature, setTemperature] = useState(0.7);
  const [audience, setAudience] = useState<DebateAudience>('policymakers');
  const [dialecticalStyle, setDialecticalStyle] = useState<DialecticalStyle>('adversarial');
  const [useAdaptiveStaging, setUseAdaptiveStaging] = useState(false);
  const [evaluatorModel, setEvaluatorModel] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showModelModal, setShowModelModal] = useState(false);
  const [modalBackend, setModalBackend] = useState<AIBackend>(aiBackend);
  const [hasApiKey, setHasApiKey] = useState<Record<string, boolean>>({});
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [otherTab, setOtherTab] = useState<'canned' | 'queued'>('canned');
  const [queuedTopics, setQueuedTopics] = useState<{ text: string; sourceType: DebateSourceType; sourceRef: string; timestamp: string }[]>(() => {
    try {
      const raw = localStorage.getItem('taxonomy-editor-topic-queue');
      return raw ? JSON.parse(raw) : [];
    } catch { /* localStorage parse — silent by design */ return []; }
  });

  const persistQueue = (next: typeof queuedTopics) => {
    setQueuedTopics(next);
    localStorage.setItem('taxonomy-editor-topic-queue', JSON.stringify(next));
  };

  const handleQueueTopic = () => {
    if (!topic.trim()) return;
    const entry = { text: topic.trim(), sourceType, sourceRef: sourceRef.trim(), timestamp: new Date().toISOString() };
    persistQueue([...queuedTopics, entry]);
    onClose();
  };

  const handleRemoveQueued = (idx: number) => {
    persistQueue(queuedTopics.filter((_, i) => i !== idx));
  };

  useEffect(() => {
    if (!showModelModal) return;
    void Promise.all(
      AI_BACKENDS.map(async (b) => {
        const has = await api.hasApiKey(b.value);
        return [b.value, has] as [string, boolean];
      }),
    ).then(results => setHasApiKey(Object.fromEntries(results)));
  }, [showModelModal]);

  const openModelModal = () => {
    const model = useCustomModel ? customModel : globalModel;
    for (const [backend, models] of Object.entries(MODELS_BY_BACKEND)) {
      if (models.some(m => m.value === model)) {
        setModalBackend(backend as AIBackend);
        break;
      }
    }
    setShowModelModal(true);
  };

  const handleRefreshModels = async () => {
    setRefreshingModels(true);
    try {
      await api.refreshAIModels();
      await initAIModels();
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'new-debate-dialog',
        level: 'error',
        message: 'Failed to refresh AI models',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
    } finally {
      setRefreshingModels(false);
    }
  };

  // Get situation nodes for potential topics
  const situationNodes = useMemo(() => {
    if (!situations?.nodes) return [];
    return situations.nodes;
  }, [situations]);

  const toggle = (id: SpeakerId) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const handlePickFile = async () => {
    const result = await api.pickDocumentFile();
    if (result.cancelled || !result.filePath || !result.content) return;
    setSourceRef(result.filePath);
    setSourceContent(result.content);
    setFileName(result.filePath.split('/').pop() || result.filePath);
    if (!topic) {
      const name = result.filePath.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
      setTopic(`Discuss: ${name}`);
    }
  };

  const handleTopicCardClick = (label: string, description: string) => {
    setTopic(`${label}: ${description}`);
  };

  const hasSource = sourceType === 'topic' || sourceType === 'other'
    ? topic.trim().length > 0
    : sourceType === 'document'
      ? sourceContent.length > 0
      : sourceRef.trim().length > 0;

  const canStart = hasSource && selected.size >= 1;

  const handleStart = async () => {
    if (!canStart || creating) return;
    setCreating(true);

    let finalTopic = topic.trim();
    let finalContent = sourceContent;

    if (sourceType === 'url') {
      if (!finalTopic) finalTopic = `Discuss: ${sourceRef.trim()}`;
      try {
        const result = await api.fetchUrlContent(sourceRef.trim());
        if (result.error) {
          finalContent = `[Failed to fetch URL content: ${result.error}]`;
        } else {
          finalContent = result.content;
          if (finalContent.length > 100000) {
            finalContent = finalContent.slice(0, 100000) + '\n\n[Content truncated at 100,000 characters]';
          }
        }
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'new-debate-dialog',
          level: 'error',
          message: 'failed to fetch URL content for debate source',
          error: { name: (err as Error).name ?? 'Error', message: String(err) },
        });
        finalContent = `[Failed to fetch URL content: ${err}]`;
      }
    }

    if (sourceType === 'document' && !finalTopic) {
      finalTopic = `Discuss: ${fileName}`;
    }

    const povers = Array.from(selected);
    if (userIsPover && !povers.includes('user')) povers.push('user');
    const effectiveModel = useCustomModel ? customModel : globalModel;
    localStorage.setItem('taxonomy-editor-last-debate-model', effectiveModel);
    const debateModelOverride = useCustomModel ? customModel : undefined;
    const id = await createDebate(
      finalTopic,
      povers,
      userIsPover,
      sourceType === 'other' ? 'topic' : sourceType,
      sourceType === 'topic' || sourceType === 'other' ? '' : sourceRef.trim(),
      sourceType === 'topic' || sourceType === 'other' ? '' : finalContent,
      debateModelOverride,
      protocolId,
      temperature,
      audience,
      {
        evaluatorModel: evaluatorModel || undefined,
        useAdaptiveStaging: useAdaptiveStaging || undefined,
      },
    );
    await loadDebate(id);
    const _creationWeights = useAdaptiveStaging ? (() => { try { const w = loadProvisionalWeights(); const p = w.pacing_presets?.moderate; return { pacing: 'moderate', maxTotalRounds: p?.maxTotalRounds, argumentationExit: p?.argumentationExit, concludingExit: p?.concludingExit, phase_bounds: w.phase_bounds }; } catch { return null; } })() : null;
    getGlobalRecorder()?.record({ type: 'user.action', component: 'new-debate', level: 'info', message: 'debate.created', data: { debate_id: id, source_type: sourceType, povers, user_is_pover: userIsPover, model: effectiveModel, protocol: protocolId, temperature, audience: audience || null, adaptive_staging: useAdaptiveStaging, ..._creationWeights && { adaptive_config: _creationWeights } } });
    const store = useDebateStore.getState();
    store.updatePhase('clarification');
    await store.saveDebate();
    // Open debate in popout window
    api.openDebateWindow(id).catch(() => { /* fallback: stays inline */ });
    onClose();
  };

  const temperatureLabel =
    temperature <= 0.3 ? 'Focused' : temperature <= 0.7 ? 'Balanced' : temperature <= 1.0 ? 'Creative' : 'Wild';

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="ndd-fullpage" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="ndd-header">
          <h2 className="ndd-title">New Debate</h2>
          <button className="ndd-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        {/* Two-column body */}
        <div className="ndd-body">
          {/* ─── Left Column: Debate Details ─── */}
          <div className="ndd-col-left">
            <h3 className="ndd-section-heading">Debate Details</h3>

            {/* Source type radios */}
            <label className="ndd-field-label">Source</label>
            <div className="ndd-source-types">
              {(['topic', 'document', 'url', 'other'] as DebateSourceType[]).map(st => (
                <label key={st} className={`ndd-source-option${sourceType === st ? ' active' : ''}`}>
                  <input type="radio" name="sourceType" value={st} checked={sourceType === st} onChange={() => setSourceType(st)} />
                  <span className="ndd-source-icon">{SOURCE_ICONS[st]}</span>
                  <span className="ndd-source-text">{st === 'url' ? 'URL' : st.charAt(0).toUpperCase() + st.slice(1)}</span>
                </label>
              ))}
            </div>

            {/* Topic textarea (always shown for topic; conditional for doc/url) */}
            {sourceType === 'topic' && (
              <>
                <label className="ndd-field-label">Topic</label>
                <textarea
                  className="ndd-topic-input"
                  placeholder="What should we debate? Type your own or pick from Potential Topics below."
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  rows={3}
                  autoFocus
                />
              </>
            )}

            {sourceType === 'document' && (
              <>
                <label className="ndd-field-label">Document</label>
                <div className="ndd-file-picker">
                  <button className="btn" onClick={handlePickFile}>
                    {fileName ? fileName : 'Choose file...'}
                  </button>
                  {sourceContent && (
                    <span className="ndd-file-info">{Math.round(sourceContent.length / 1024)}KB loaded</span>
                  )}
                </div>
                <label className="ndd-field-label">Topic (optional)</label>
                <textarea
                  className="ndd-topic-input"
                  placeholder="Focus the debate on a specific aspect of this document..."
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  rows={2}
                />
              </>
            )}

            {sourceType === 'url' && (
              <>
                <label className="ndd-field-label">URL</label>
                <input
                  className="ndd-url-input"
                  type="url"
                  placeholder="https://example.com/article"
                  value={sourceRef}
                  onChange={(e) => setSourceRef(e.target.value)}
                  autoFocus
                />
                <label className="ndd-field-label">Topic (optional)</label>
                <textarea
                  className="ndd-topic-input"
                  placeholder="Focus the debate on a specific aspect of this content..."
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  rows={2}
                />
              </>
            )}

            {/* "Other" source: tabbed Canned / Queued topics */}
            {sourceType === 'other' && (
              <>
                <label className="ndd-field-label">Topic</label>
                <textarea
                  className="ndd-topic-input"
                  placeholder="Type a custom topic or pick from Canned / Queued below."
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  rows={3}
                  autoFocus
                />
                <div className="ndd-other-tabs">
                  <button
                    className={`ndd-other-tab${otherTab === 'canned' ? ' active' : ''}`}
                    onClick={() => setOtherTab('canned')}
                  >
                    Canned Topics ({situationNodes.length})
                  </button>
                  <button
                    className={`ndd-other-tab${otherTab === 'queued' ? ' active' : ''}`}
                    onClick={() => setOtherTab('queued')}
                  >
                    Queued Topics ({queuedTopics.length})
                  </button>
                </div>
                {otherTab === 'canned' && situationNodes.length > 0 && (
                  <div className="ndd-potential-topics">
                    {situationNodes.map(node => (
                      <button
                        key={node.id}
                        className={`ndd-topic-card${topic.startsWith(node.label) ? ' selected' : ''}`}
                        onClick={() => handleTopicCardClick(node.label, node.description)}
                      >
                        <div className="ndd-topic-card-header">
                          <span className="ndd-topic-card-icon">{'\uD83D\uDCA1'}</span>
                          <span className="ndd-topic-card-title">{node.label}</span>
                        </div>
                        <p className="ndd-topic-card-desc">{node.description}</p>
                      </button>
                    ))}
                  </div>
                )}
                {otherTab === 'queued' && (
                  <div className="ndd-potential-topics">
                    {queuedTopics.length === 0 && (
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', padding: '12px 0' }}>
                        No queued topics yet. Use "Queue Topic" to save topics for later.
                      </p>
                    )}
                    {queuedTopics.map((qt, idx) => (
                      <button
                        key={idx}
                        className={`ndd-topic-card${topic === qt.text ? ' selected' : ''}`}
                        onClick={() => setTopic(qt.text)}
                      >
                        <div className="ndd-topic-card-header">
                          <span className="ndd-topic-card-icon">{'\uD83D\uDCCB'}</span>
                          <span className="ndd-topic-card-title" style={{ flex: 1 }}>{qt.text.slice(0, 80)}{qt.text.length > 80 ? '…' : ''}</span>
                          <span
                            className="ndd-queued-remove"
                            title="Remove from queue"
                            onClick={(e) => { e.stopPropagation(); handleRemoveQueued(idx); }}
                          >
                            &times;
                          </span>
                        </div>
                        <p className="ndd-topic-card-desc" style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                          Queued {new Date(qt.timestamp).toLocaleDateString()}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* ─── Right Column: Configuration ─── */}
          <div className="ndd-col-right">
            <h3 className="ndd-section-heading">Configuration</h3>

            {/* Format */}
            <label className="ndd-field-label">Format</label>
            <select
              className="ndd-format-select"
              value={protocolId}
              onChange={(e) => setProtocolId(e.target.value)}
            >
              {DEBATE_PROTOCOLS.map(p => (
                <option key={p.id} value={p.id}>
                  {p.label} — {p.description}
                </option>
              ))}
            </select>

            {/* AI Model */}
            <label className="ndd-field-label">AI Model</label>
            <div className="ndd-model-section">
              <div className="ndd-model-display">
                <span className="ndd-model-badge" title={useCustomModel ? customModel : globalModel}>
                  {(() => {
                    const modelId = useCustomModel ? customModel : globalModel;
                    const entry = availableModels.find(m => m.value === modelId);
                    return entry ? entry.label : modelId;
                  })()}
                </span>
                {useCustomModel && <span className="ndd-model-override-tag">override</span>}
                <button
                  className="btn btn-sm ndd-models-btn"
                  onClick={openModelModal}
                  type="button"
                >
                  Models
                </button>
              </div>
            </div>

            {/* Dialectical Style */}
            <label className="ndd-field-label">Dialectical Style</label>
            <div className="ndd-style-cards">
              {STYLE_PRESETS.map(s => (
                <label key={s.id} className={`ndd-style-card${dialecticalStyle === s.id ? ' active' : ''}`}>
                  <input type="radio" name="dialecticalStyle" value={s.id} checked={dialecticalStyle === s.id} onChange={() => setDialecticalStyle(s.id)} />
                  <div className="ndd-style-text">
                    <span className="ndd-style-name">{s.label}</span>
                    <span className="ndd-style-desc">{s.desc}</span>
                  </div>
                </label>
              ))}
            </div>

            {/* Adaptive Staging toggle */}
            <label className="ndd-adaptive-toggle">
              <input
                type="checkbox"
                checked={useAdaptiveStaging}
                onChange={(e) => setUseAdaptiveStaging(e.target.checked)}
              />
              <span className="ndd-adaptive-label">
                Adaptive staging
                <span className="ndd-adaptive-desc">Signal-driven phase transitions instead of fixed rounds</span>
              </span>
              {useAdaptiveStaging && <span className="ndd-adaptive-badge">Experimental</span>}
            </label>

            {/* Advanced toggle */}
            <button className="ndd-advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
              {showAdvanced ? 'Hide advanced' : 'Advanced options'} {showAdvanced ? '▲' : '▼'}
            </button>

            {showAdvanced && (
              <div className="ndd-advanced-section">
                {/* Temperature */}
                <label className="ndd-field-label">Temperature</label>
                <div className="ndd-temperature-row">
                  <span className="ndd-temperature-value">{temperature.toFixed(1)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.1}
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    className="ndd-temperature-slider"
                  />
                  <span className="ndd-temperature-label">{temperatureLabel}</span>
                </div>

                {/* Evaluator Model (cross-vendor split) */}
                <label className="ndd-field-label" style={{ marginTop: 8 }}>Evaluator Model</label>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Separate model for claim extraction. Cross-vendor split reduces self-preference bias.
                </div>
                <select
                  className="ndd-model-select"
                  value={evaluatorModel}
                  onChange={(e) => setEvaluatorModel(e.target.value)}
                >
                  <option value="">Same as debate model</option>
                  {availableModels.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Audience */}
            <label className="ndd-field-label">Target Audience</label>
            <div className="ndd-audience-cards">
              {DEBATE_AUDIENCES.map(a => (
                <label key={a.id} className={`ndd-audience-card${audience === a.id ? ' active' : ''}`}>
                  <input type="radio" name="audience" value={a.id} checked={audience === a.id} onChange={() => setAudience(a.id)} />
                  <span className="ndd-audience-name">{a.label}</span>
                </label>
              ))}
            </div>

            {/* Debaters */}
            <label className="ndd-field-label">Debaters</label>
            <div className="ndd-debaters">
              {AI_POVERS.map((id) => {
                const info = POVER_INFO[id];
                return (
                  <label key={id} className={`ndd-debater-row${selected.has(id) ? ' checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selected.has(id)}
                      onChange={() => toggle(id)}
                    />
                    <span className="ndd-debater-badge" style={{ background: info.color }}>
                      <span className="ndd-debater-icon">{DEBATER_ICONS[id]}</span>
                      {info.label}
                    </span>
                    <span className="ndd-debater-desc">{info.personality}</span>
                  </label>
                );
              })}
              <label className={`ndd-debater-row${userIsPover ? ' checked' : ''}`}>
                <input
                  type="checkbox"
                  checked={userIsPover}
                  onChange={() => setUserIsPover(!userIsPover)}
                />
                <span className="ndd-debater-badge ndd-debater-badge-user">
                  <span className="ndd-debater-icon">{DEBATER_ICONS.user}</span>
                  You
                </span>
                <span className="ndd-debater-desc">Argue a position yourself</span>
              </label>
            </div>

            {selected.size < 1 && (
              <div className="ndd-hint-error">Select at least 1 perspective</div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="ndd-footer">
          <button className="btn ndd-cancel-btn" onClick={onClose}>Cancel</button>
          <button
            className="btn ndd-queue-btn"
            onClick={handleQueueTopic}
            disabled={!topic.trim() || creating}
            title="Save this topic to the queue for later"
          >
            Queue Topic
          </button>
          <button className="btn btn-primary ndd-start-btn" onClick={handleStart} disabled={!canStart || creating}>
            {creating ? 'Creating...' : 'Start Debate'}
          </button>
        </div>

        {/* Model Configuration Modal */}
        {showModelModal && (
          <div className="ndd-model-overlay" onClick={() => setShowModelModal(false)}>
            <div className="ndd-model-dialog" onClick={e => e.stopPropagation()}>
              <div className="ndd-model-dialog-header">
                <h3>Model Configuration</h3>
                <button className="ndd-close-btn" onClick={() => setShowModelModal(false)} aria-label="Close">&times;</button>
              </div>

              <div className="ndd-model-dialog-body">
                <label className="ndd-model-toggle">
                  <input
                    type="checkbox"
                    checked={!useCustomModel}
                    onChange={() => {
                      if (!useCustomModel) {
                        setUseCustomModel(true);
                        setCustomModel(globalModel);
                      } else {
                        setUseCustomModel(false);
                      }
                    }}
                  />
                  Use global default
                </label>
                {!useCustomModel && (
                  <span className="ndd-model-current">Global: {globalModel}</span>
                )}

                {useCustomModel && (
                  <>
                    <div className="ndd-model-row">
                      <label className="ndd-model-row-label">Backend</label>
                      <select
                        className="ndd-model-select"
                        value={modalBackend}
                        onChange={(e) => {
                          const backend = e.target.value as AIBackend;
                          setModalBackend(backend);
                          const models = MODELS_BY_BACKEND[backend];
                          if (models?.length) setCustomModel(models[0].value);
                        }}
                      >
                        {AI_BACKENDS.map(b => (
                          <option key={b.value} value={b.value}>
                            {b.label}{hasApiKey[b.value] === false ? ' (no key)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="ndd-model-row">
                      <label className="ndd-model-row-label">Model</label>
                      <select
                        className="ndd-model-select"
                        value={customModel}
                        onChange={(e) => setCustomModel(e.target.value)}
                      >
                        {(MODELS_BY_BACKEND[modalBackend] || []).map(m => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                <div className="ndd-model-actions">
                  <button
                    className="btn btn-sm"
                    onClick={handleRefreshModels}
                    disabled={refreshingModels}
                  >
                    {refreshingModels ? 'Refreshing...' : 'Refresh Models'}
                  </button>
                </div>
              </div>

              <div className="ndd-model-dialog-footer">
                <button
                  className="btn btn-primary"
                  onClick={() => setShowModelModal(false)}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
