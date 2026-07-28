// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect } from 'react';
import { useChatStore } from '../../hooks/useChatStore';
import { useTaxonomyStore, MODELS_BY_BACKEND, AI_BACKENDS } from '../../hooks/useTaxonomyStore';
import type { AIBackend } from '../../hooks/useTaxonomyStore/slices/settingsSlice';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { useTierInfo, isFreeTier } from '../../hooks/useTierInfo';
import { POVER_INFO } from '../../types/debate';
import type { SpeakerId } from '../../types/debate';
import type { ChatMode } from '../../types/chat';
import { CHAT_MODE_INFO } from '../../types/chat';
import { AI_POVERS } from '@lib/debate/types';
import './NewChatDialog.css';

interface NewChatDialogProps {
  onClose: () => void;
}
const MODES: ChatMode[] = ['brainstorm', 'inform', 'decide'];

const MODE_ICONS: Record<ChatMode, string> = {
  brainstorm: '\u2728', // sparkles
  inform: '\u{1F4D6}',  // open book
  decide: '\u2696\uFE0F',  // scales
};

export function NewChatDialog({ onClose }: NewChatDialogProps) {
  const { createChat, loadChat } = useChatStore();
  const [mode, setMode] = useState<ChatMode>('brainstorm');
  const [pover, setPover] = useState<Exclude<SpeakerId, 'user'>>('accelerationist');
  const [topic, setTopic] = useState('');
  const [creating, setCreating] = useState(false);
  const { aiBackend, geminiModel } = useTaxonomyStore();
  const globalModel = geminiModel;
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [selectedBackend, setSelectedBackend] = useState<AIBackend>(aiBackend);
  const availableModels = MODELS_BY_BACKEND[selectedBackend] || [];
  const [customModel, setCustomModel] = useState<string>(globalModel);
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({});
  const [tierAvailable, setTierAvailable] = useState<Set<string> | null>(null);
  const { tier: tierInfo } = useTierInfo();
  const freeTier = isFreeTier(tierInfo);

  useEffect(() => {
    const check = async () => {
      const status: Record<string, boolean> = {};
      for (const b of AI_BACKENDS) {
        try { status[b.value] = await api.hasApiKey(b.value); }
        catch (err) { status[b.value] = false; getGlobalRecorder()?.record({ type: 'system.error', component: 'new-chat-dialog', level: 'warn', message: `Failed to check API key for ${b.value}`, error: { name: (err as Error).name ?? 'Error', message: String(err) } }); }
      }
      setKeyStatus(status);
    };
    void check();
    void api.getAvailableBackends()
      .then(backends => setTierAvailable(new Set(backends.filter(b => b.available).map(b => b.id))))
      .catch((err) => { getGlobalRecorder()?.record({ type: 'system.error', component: 'new-chat-dialog', level: 'warn', message: 'Failed to load available backends', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); });
  }, []);

  const canStart = topic.trim().length > 0;

  const handleStart = async () => {
    if (!canStart || creating) return;
    setCreating(true);
    const chatModelOverride = useCustomModel && customModel !== globalModel ? customModel : undefined;
    const id = await createChat(mode, pover, topic.trim(), chatModelOverride);
    await loadChat(id);
    onClose();
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog new-chat-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>New Chat</h2>

        <label className="new-chat-label">Mode</label>
        <div className="new-chat-modes">
          {MODES.map((m) => {
            const info = CHAT_MODE_INFO[m];
            return (
              <button
                key={m}
                className={`new-chat-mode-card${mode === m ? ' selected' : ''}`}
                data-mode={m}
                onClick={() => setMode(m)}
              >
                <span className="new-chat-mode-icon">{MODE_ICONS[m]}</span>
                <span className="new-chat-mode-label">{info.label}</span>
                <span className="new-chat-mode-desc">{info.description}</span>
              </button>
            );
          })}
        </div>

        <label className="new-chat-label">Talk to</label>
        <div className="new-chat-povers">
          {AI_POVERS.map((id) => {
            const info = POVER_INFO[id];
            return (
              <label
                key={id}
                className={`new-chat-pover-option${pover === id ? ' selected' : ''}`}
              >
                <input
                  type="radio"
                  name="chatPover"
                  checked={pover === id}
                  onChange={() => setPover(id)}
                />
                <span
                  className="new-chat-pover-name"
                  // eslint-disable-next-line local/no-inline-style -- dynamic POVer color
                  style={{ color: info.color }}
                >
                  {info.label}
                </span>
                <span className="new-chat-pover-desc">{info.personality}</span>
              </label>
            );
          })}
        </div>

        <label className="new-chat-label">Topic</label>
        <textarea
          className="new-chat-topic"
          placeholder={CHAT_MODE_INFO[mode].placeholder}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          rows={3}
          autoFocus
        />

        <label className="new-chat-label">AI Model</label>
        <div className="new-chat-model-row">
          <label className="new-chat-model-toggle">
            <input
              type="checkbox"
              checked={useCustomModel}
              onChange={(e) => setUseCustomModel(e.target.checked)}
            />
            Use a different model for this chat
          </label>
          {useCustomModel && (
            <div className="new-chat-model-fields">
              <select
                className="new-chat-model-select"
                value={selectedBackend}
                onChange={(e) => {
                  const backend = e.target.value as AIBackend;
                  setSelectedBackend(backend);
                  const models = MODELS_BY_BACKEND[backend] || [];
                  if (models.length > 0) setCustomModel(models[0].value);
                }}
              >
                {AI_BACKENDS.filter(b => !tierAvailable || tierAvailable.has(b.value)).map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}{keyStatus[b.value] === false && !(freeTier && tierInfo?.allowedBackends.includes(b.value)) ? ' (no key)' : ''}
                  </option>
                ))}
              </select>
              <select
                className="new-chat-model-select"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
              >
                {availableModels.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          )}
          {!useCustomModel && (
            <span className="new-chat-model-info">Using global: {globalModel}</span>
          )}
        </div>

        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleStart} disabled={!canStart || creating}>
            {creating ? 'Creating...' : 'Start Chat'}
          </button>
        </div>
      </div>
    </div>
  );
}
