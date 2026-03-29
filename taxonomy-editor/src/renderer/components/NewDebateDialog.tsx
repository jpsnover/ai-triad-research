// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState } from 'react';
import { useDebateStore } from '../hooks/useDebateStore';
import { useTaxonomyStore, MODELS_BY_BACKEND } from '../hooks/useTaxonomyStore';
import { POVER_INFO } from '../types/debate';
import type { PoverId, DebateSourceType } from '../types/debate';
import { DEBATE_PROTOCOLS } from '../data/debateProtocols';

interface NewDebateDialogProps {
  onClose: () => void;
}

const AI_POVERS: Exclude<PoverId, 'user'>[] = ['prometheus', 'sentinel', 'cassandra'];

export function NewDebateDialog({ onClose }: NewDebateDialogProps) {
  const { createDebate, loadDebate, updatePhase } = useDebateStore();
  const [topic, setTopic] = useState('');
  const [sourceType, setSourceType] = useState<DebateSourceType>('topic');
  const [sourceRef, setSourceRef] = useState('');
  const [sourceContent, setSourceContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [selected, setSelected] = useState<Set<PoverId>>(new Set(AI_POVERS));
  const [userIsPover, setUserIsPover] = useState(false);
  const [creating, setCreating] = useState(false);
  const { aiBackend, geminiModel } = useTaxonomyStore();
  const globalModel = geminiModel;
  const availableModels = MODELS_BY_BACKEND[aiBackend] || [];
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [customModel, setCustomModel] = useState(globalModel);
  const [protocolId, setProtocolId] = useState('structured');

  const toggle = (id: PoverId) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const handlePickFile = async () => {
    const result = await window.electronAPI.pickDocumentFile();
    if (result.cancelled || !result.filePath || !result.content) return;
    setSourceRef(result.filePath);
    setSourceContent(result.content);
    setFileName(result.filePath.split('/').pop() || result.filePath);
    // Auto-set topic from filename if empty
    if (!topic) {
      const name = result.filePath.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
      setTopic(`Discuss: ${name}`);
    }
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
      // Fetch and extract readable text via main process (strips scripts, styles, tags)
      try {
        const result = await window.electronAPI.fetchUrlContent(sourceRef.trim());
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
    const debateModelOverride = useCustomModel && customModel !== globalModel ? customModel : undefined;
    const id = await createDebate(
      finalTopic,
      povers,
      userIsPover,
      sourceType,
      sourceType === 'topic' ? '' : sourceRef.trim(),
      sourceType === 'topic' ? '' : finalContent,
      debateModelOverride,
      protocolId,
    );
    await loadDebate(id);
    const store = useDebateStore.getState();
    // All source types now go through clarification (document/URL get a specialized prompt)
    store.updatePhase('clarification');
    await store.saveDebate();
    onClose();
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog new-debate-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>New Debate</h2>

        <label className="new-debate-label">Source</label>
        <div className="new-debate-source-types">
          <label className={`new-debate-source-option${sourceType === 'topic' ? ' active' : ''}`}>
            <input type="radio" name="sourceType" value="topic" checked={sourceType === 'topic'} onChange={() => setSourceType('topic')} />
            Topic
          </label>
          <label className={`new-debate-source-option${sourceType === 'document' ? ' active' : ''}`}>
            <input type="radio" name="sourceType" value="document" checked={sourceType === 'document'} onChange={() => setSourceType('document')} />
            Document
          </label>
          <label className={`new-debate-source-option${sourceType === 'url' ? ' active' : ''}`}>
            <input type="radio" name="sourceType" value="url" checked={sourceType === 'url'} onChange={() => setSourceType('url')} />
            URL
          </label>
        </div>

        {sourceType === 'topic' && (
          <>
            <label className="new-debate-label">Topic</label>
            <textarea
              className="new-debate-topic"
              placeholder="What should we debate?"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              rows={3}
              autoFocus
            />
          </>
        )}

        {sourceType === 'document' && (
          <>
            <label className="new-debate-label">Document</label>
            <div className="new-debate-file-picker">
              <button className="btn" onClick={handlePickFile}>
                {fileName ? fileName : 'Choose file...'}
              </button>
              {sourceContent && (
                <span className="new-debate-file-info">{Math.round(sourceContent.length / 1024)}KB loaded</span>
              )}
            </div>
            <label className="new-debate-label">Topic (optional)</label>
            <textarea
              className="new-debate-topic"
              placeholder="Focus the debate on a specific aspect of this document..."
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              rows={2}
            />
          </>
        )}

        {sourceType === 'url' && (
          <>
            <label className="new-debate-label">URL</label>
            <input
              className="new-debate-url-input"
              type="url"
              placeholder="https://example.com/article"
              value={sourceRef}
              onChange={(e) => setSourceRef(e.target.value)}
              autoFocus
            />
            <label className="new-debate-label">Topic (optional)</label>
            <textarea
              className="new-debate-topic"
              placeholder="Focus the debate on a specific aspect of this content..."
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              rows={2}
            />
          </>
        )}

        <label className="new-debate-label">Format</label>
        <div className="new-debate-protocol-row">
          {DEBATE_PROTOCOLS.map(p => (
            <label key={p.id} className={`new-debate-protocol-option${protocolId === p.id ? ' active' : ''}`}>
              <input type="radio" name="protocol" value={p.id} checked={protocolId === p.id} onChange={() => setProtocolId(p.id)} />
              <span className="new-debate-protocol-name">{p.label}</span>
              <span className="new-debate-protocol-desc">{p.description}</span>
            </label>
          ))}
        </div>

        <label className="new-debate-label">AI Model</label>
        <div className="new-debate-model-row">
          <label className="new-debate-model-toggle">
            <input
              type="checkbox"
              checked={useCustomModel}
              onChange={(e) => setUseCustomModel(e.target.checked)}
            />
            Use a different model for this debate
          </label>
          {useCustomModel && (
            <select
              className="new-debate-model-select"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
            >
              {availableModels.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          )}
          {!useCustomModel && (
            <span className="new-debate-model-info">Using global: {globalModel}</span>
          )}
        </div>

        <label className="new-debate-label">Debaters</label>
        <div className="new-debate-povers">
          {AI_POVERS.map((id) => {
            const info = POVER_INFO[id];
            return (
              <label key={id} className="new-debate-pover-option">
                <input
                  type="checkbox"
                  checked={selected.has(id)}
                  onChange={() => toggle(id)}
                />
                <span className="new-debate-pover-name" style={{ color: info.color }}>
                  {info.label}
                </span>
                <span className="new-debate-pover-desc">{info.personality}</span>
              </label>
            );
          })}
          <label className="new-debate-pover-option">
            <input
              type="checkbox"
              checked={userIsPover}
              onChange={() => setUserIsPover(!userIsPover)}
            />
            <span className="new-debate-pover-name">You</span>
            <span className="new-debate-pover-desc">Argue a position yourself</span>
          </label>
        </div>

        {selected.size < 2 && (
          <div className="new-debate-hint">Select at least 2 perspectives</div>
        )}

        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleStart} disabled={!canStart || creating}>
            {creating ? 'Creating...' : 'Start Debate'}
          </button>
        </div>
      </div>
    </div>
  );
}
