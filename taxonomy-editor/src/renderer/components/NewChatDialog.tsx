// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState } from 'react';
import { useChatStore } from '../hooks/useChatStore';
import { useTaxonomyStore, MODELS_BY_BACKEND } from '../hooks/useTaxonomyStore';
import { POVER_INFO } from '../types/debate';
import type { PoverId } from '../types/debate';
import type { ChatMode } from '../types/chat';
import { CHAT_MODE_INFO } from '../types/chat';

interface NewChatDialogProps {
  onClose: () => void;
}

const AI_POVERS: Exclude<PoverId, 'user'>[] = ['prometheus', 'sentinel', 'cassandra'];
const MODES: ChatMode[] = ['brainstorm', 'inform', 'decide'];

const MODE_ICONS: Record<ChatMode, string> = {
  brainstorm: '\u2728', // sparkles
  inform: '\u{1F4D6}',  // open book
  decide: '\u2696\uFE0F',  // scales
};

export function NewChatDialog({ onClose }: NewChatDialogProps) {
  const { createChat, loadChat } = useChatStore();
  const [mode, setMode] = useState<ChatMode>('brainstorm');
  const [pover, setPover] = useState<Exclude<PoverId, 'user'>>('prometheus');
  const [topic, setTopic] = useState('');
  const [creating, setCreating] = useState(false);
  const { aiBackend, geminiModel } = useTaxonomyStore();
  const globalModel = geminiModel;
  const availableModels = MODELS_BY_BACKEND[aiBackend] || [];
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [customModel, setCustomModel] = useState<string>(globalModel);

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
                <span className="new-chat-pover-name" style={{ color: info.color }}>
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
            <select
              className="new-chat-model-select"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
            >
              {availableModels.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
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
