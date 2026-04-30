// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo } from 'react';
import { useDebateStore } from '../hooks/useDebateStore';
import { useTaxonomyStore, MODELS_BY_BACKEND } from '../hooks/useTaxonomyStore';
import { POVER_INFO, DEBATE_AUDIENCES } from '../types/debate';
import type { PoverId, DebateSourceType, DebateAudience } from '../types/debate';
import { DEBATE_PROTOCOLS } from '../data/debateProtocols';
import { api } from '@bridge';

export type DebatePacing = 'tight' | 'moderate' | 'thorough';
export type DialecticalStyle = 'adversarial' | 'deliberative' | 'integrative';

const PACING_PRESETS: { id: DebatePacing; label: string; desc: string; maxRounds: number }[] = [
  { id: 'tight', label: 'Tight', desc: 'Get to the point. Shorter debates, earlier transitions.', maxRounds: 8 },
  { id: 'moderate', label: 'Moderate', desc: 'Balanced depth. Default for most topics.', maxRounds: 12 },
  { id: 'thorough', label: 'Thorough', desc: 'Deep dive. Lets exploration run longer.', maxRounds: 15 },
];

const STYLE_PRESETS: { id: DialecticalStyle; label: string; desc: string }[] = [
  { id: 'adversarial', label: 'Adversarial', desc: 'Direct challenge. Western academic debate norms.' },
  { id: 'deliberative', label: 'Deliberative', desc: 'Consensus-oriented. Longer exploration, faster synthesis.' },
  { id: 'integrative', label: 'Integrative', desc: 'Harmony-seeking. Reframing over rebuttal.' },
];

interface NewDebateDialogProps {
  onClose: () => void;
}

const AI_POVERS: Exclude<PoverId, 'user'>[] = ['prometheus', 'sentinel', 'cassandra'];

const SOURCE_ICONS: Record<DebateSourceType, string> = {
  topic: '\u270F\uFE0F',     // pencil
  document: '\uD83D\uDCC4',  // page
  url: '\uD83C\uDF10',       // globe
  situations: '\uD83D\uDCCB', // clipboard (unused but typed)
};

const FORMAT_ICONS: Record<string, string> = {
  structured: '\u2696\uFE0F',    // scales
  socratic: '\uD83E\uDDD0',      // thinking face
  deliberation: '\uD83E\uDD1D',  // handshake
};

const DEBATER_ICONS: Record<string, string> = {
  prometheus: '\u26A1',   // lightning
  sentinel: '\uD83D\uDEE1\uFE0F',  // shield
  cassandra: '\uD83D\uDD2E',  // crystal ball
  user: '\uD83D\uDC64',       // silhouette
};

export function NewDebateDialog({ onClose }: NewDebateDialogProps) {
  const { createDebate, loadDebate } = useDebateStore();
  const [topic, setTopic] = useState('');
  const [sourceType, setSourceType] = useState<DebateSourceType>('topic');
  const [sourceRef, setSourceRef] = useState('');
  const [sourceContent, setSourceContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [selected, setSelected] = useState<Set<PoverId>>(new Set(AI_POVERS));
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
  const [pacing, setPacing] = useState<DebatePacing>('moderate');
  const [dialecticalStyle, setDialecticalStyle] = useState<DialecticalStyle>('adversarial');
  const [useAdaptiveStaging, setUseAdaptiveStaging] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Get situation nodes for potential topics
  const situationNodes = useMemo(() => {
    if (!situations?.nodes) return [];
    return situations.nodes;
  }, [situations]);

  const toggle = (id: PoverId) => {
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

  const hasSource = sourceType === 'topic'
    ? topic.trim().length > 0
    : sourceType === 'document'
      ? sourceContent.length > 0
      : sourceRef.trim().length > 0;

  const canStart = hasSource && selected.size >= 2;

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
      sourceType,
      sourceType === 'topic' ? '' : sourceRef.trim(),
      sourceType === 'topic' ? '' : finalContent,
      debateModelOverride,
      protocolId,
      temperature,
      audience,
    );
    await loadDebate(id);
    const store = useDebateStore.getState();
    store.updatePhase('clarification');
    await store.saveDebate();
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
              {(['topic', 'document', 'url'] as DebateSourceType[]).map(st => (
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

            {/* Potential Topics — scrollable situation cards */}
            {sourceType === 'topic' && situationNodes.length > 0 && (
              <>
                <label className="ndd-field-label">Potential Topics ({situationNodes.length})</label>
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
              </>
            )}
          </div>

          {/* ─── Right Column: Configuration ─── */}
          <div className="ndd-col-right">
            <h3 className="ndd-section-heading">Configuration</h3>

            {/* Format — large radio cards */}
            <label className="ndd-field-label">Format</label>
            <div className="ndd-format-cards">
              {DEBATE_PROTOCOLS.map(p => (
                <label key={p.id} className={`ndd-format-card${protocolId === p.id ? ' active' : ''}`}>
                  <input type="radio" name="protocol" value={p.id} checked={protocolId === p.id} onChange={() => setProtocolId(p.id)} />
                  <span className="ndd-format-icon">{FORMAT_ICONS[p.id] || '\u2696\uFE0F'}</span>
                  <div className="ndd-format-text">
                    <span className="ndd-format-name">{p.label}</span>
                    <span className="ndd-format-desc">{p.description}</span>
                  </div>
                </label>
              ))}
            </div>

            {/* AI Model */}
            <label className="ndd-field-label">AI Model</label>
            <div className="ndd-model-section">
              <label className="ndd-model-toggle">
                <input
                  type="checkbox"
                  checked={useCustomModel}
                  onChange={(e) => setUseCustomModel(e.target.checked)}
                />
                Use a different model
              </label>
              {!useCustomModel && (
                <span className="ndd-model-current">Current: {globalModel}</span>
              )}
              {useCustomModel && (
                <select
                  className="ndd-model-select"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                >
                  {availableModels.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Pacing */}
            <label className="ndd-field-label">Pacing</label>
            <div className="ndd-pacing-cards">
              {PACING_PRESETS.map(p => (
                <label key={p.id} className={`ndd-pacing-card${pacing === p.id ? ' active' : ''}`}>
                  <input type="radio" name="pacing" value={p.id} checked={pacing === p.id} onChange={() => setPacing(p.id)} />
                  <div className="ndd-pacing-text">
                    <span className="ndd-pacing-name">{p.label}</span>
                    <span className="ndd-pacing-desc">{p.desc}</span>
                  </div>
                  <span className="ndd-pacing-rounds">{p.maxRounds} max</span>
                </label>
              ))}
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

            {selected.size < 2 && (
              <div className="ndd-hint-error">Select at least 2 perspectives</div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="ndd-footer">
          <button className="btn ndd-cancel-btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary ndd-start-btn" onClick={handleStart} disabled={!canStart || creating}>
            {creating ? 'Creating...' : 'Start Debate'}
          </button>
        </div>
      </div>
    </div>
  );
}
