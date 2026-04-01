// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useEffect, useCallback } from 'react';
import { useChatStore } from '../hooks/useChatStore';
import { POVER_INFO } from '../types/debate';
import type { TaxonomyRef } from '../types/debate';
import type { ChatEntry, ChatMode } from '../types/chat';
import { CHAT_MODE_INFO } from '../types/chat';
import Markdown from 'react-markdown';

// ── Helpers ──────────────────────────────────────────────

function speakerLabel(speaker: string): string {
  if (speaker === 'user') return 'You';
  if (speaker === 'system') return 'System';
  const info = POVER_INFO[speaker as keyof typeof POVER_INFO];
  return info?.label || speaker;
}

function speakerColor(speaker: string): string | undefined {
  if (speaker === 'user' || speaker === 'system') return undefined;
  return POVER_INFO[speaker as keyof typeof POVER_INFO]?.color;
}

function nodeIdToTab(nodeId: string): string {
  if (nodeId.startsWith('acc-')) return 'accelerationist';
  if (nodeId.startsWith('saf-')) return 'safetyist';
  if (nodeId.startsWith('skp-')) return 'skeptic';
  if (nodeId.startsWith('cc-')) return 'cross-cutting';
  return 'unknown';
}

// ── Taxonomy ref pills ───────────────────────────────────

function TaxonomyPill({ taxRef }: { taxRef: TaxonomyRef }) {
  const tab = nodeIdToTab(taxRef.node_id);
  return (
    <span
      className={`taxonomy-pill tab-${tab}`}
      title={taxRef.relevance || taxRef.node_id}
    >
      {taxRef.node_id}
    </span>
  );
}

function TaxonomyRefsSection({ refs }: { refs: TaxonomyRef[] }) {
  const [showReasoning, setShowReasoning] = useState(false);

  if (!refs || refs.length === 0) return null;

  return (
    <div className="chat-taxonomy-refs">
      <div className="chat-taxonomy-pills">
        {refs.map((r) => (
          <TaxonomyPill key={r.node_id} taxRef={r} />
        ))}
        <button
          className="chat-taxonomy-toggle"
          onClick={() => setShowReasoning(!showReasoning)}
        >
          {showReasoning ? 'Hide reasoning' : 'Show reasoning'}
        </button>
      </div>
      {showReasoning && (
        <div className="chat-taxonomy-reasoning">
          {refs.map((r) => (
            <div key={r.node_id} className="chat-taxonomy-reasoning-item">
              <span className={`taxonomy-pill tab-${nodeIdToTab(r.node_id)}`}>{r.node_id}</span>
              <span className="chat-reasoning-text">{r.relevance}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Chat message ─────────────────────────────────────────

function ChatMessage({ entry }: { entry: ChatEntry }) {
  const color = speakerColor(entry.speaker);
  const isUser = entry.speaker === 'user';

  return (
    <div className={`chat-message chat-speaker-${entry.speaker}${isUser ? ' chat-message-user' : ''}`}>
      <div className="chat-message-header">
        <span className="chat-message-speaker" style={color ? { color } : undefined}>
          {speakerLabel(entry.speaker)}
        </span>
      </div>
      <div className="chat-message-content markdown-body">
        <Markdown>{entry.content}</Markdown>
      </div>
      <TaxonomyRefsSection refs={entry.taxonomy_refs} />
    </div>
  );
}

// ── Progress indicator ───────────────────────────────────

function ProgressIndicator() {
  const { chatProgress, chatActivity } = useChatStore();

  if (!chatActivity) return null;

  return (
    <div className="chat-generating">
      <span className="chat-generating-dots">
        <span>{chatActivity}</span>
        <span className="dot-animation" />
      </span>
      {chatProgress && chatProgress.attempt > 1 && (
        <span className="chat-generating-retry">
          Retry {chatProgress.attempt}/{chatProgress.maxRetries}
          {chatProgress.backoffSeconds ? ` (${chatProgress.backoffSeconds}s)` : ''}
        </span>
      )}
    </div>
  );
}

// ── Mode selector (in header) ────────────────────────────

function ModeSelector({ mode, onChange }: { mode: ChatMode; onChange: (m: ChatMode) => void }) {
  const modes: ChatMode[] = ['brainstorm', 'inform', 'decide'];

  return (
    <div className="chat-mode-selector">
      {modes.map((m) => (
        <button
          key={m}
          className={`chat-mode-pill${mode === m ? ' active' : ''}`}
          data-mode={m}
          onClick={() => onChange(m)}
          title={CHAT_MODE_INFO[m].description}
        >
          {CHAT_MODE_INFO[m].label}
        </button>
      ))}
    </div>
  );
}

// ── Main workspace ───────────────────────────────────────

export function ChatWorkspace() {
  const {
    activeChat, chatLoading, chatError, chatGenerating,
    sendMessage, generateOpening, changeMode,
  } = useChatStore();
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const hasTriggeredOpening = useRef(false);
  const [input, setInput] = useState('');

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeChat?.transcript.length, chatGenerating]);

  // Auto-trigger opening message
  useEffect(() => {
    if (activeChat && activeChat.transcript.length === 0 && !hasTriggeredOpening.current && !chatGenerating) {
      hasTriggeredOpening.current = true;
      generateOpening();
    }
  }, [activeChat, chatGenerating, generateOpening]);

  // Reset opening trigger when chat changes
  useEffect(() => {
    hasTriggeredOpening.current = false;
  }, [activeChat?.id]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || chatGenerating) return;
    const msg = input;
    setInput('');
    await sendMessage(msg);
  }, [input, chatGenerating, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  if (chatLoading) {
    return <div className="chat-workspace"><div className="chat-loading">Loading...</div></div>;
  }

  if (!activeChat) {
    return (
      <div className="chat-workspace">
        <div className="chat-empty">Select a chat or start a new one.</div>
      </div>
    );
  }

  const poverInfo = POVER_INFO[activeChat.pover];

  return (
    <div className="chat-workspace">
      {/* Header */}
      <div className="chat-header">
        <div className="chat-header-left">
          <span className="chat-header-pover" style={{ color: poverInfo.color }}>
            {poverInfo.label}
          </span>
          <ModeSelector mode={activeChat.mode} onChange={changeMode} />
        </div>
        <div className="chat-header-topic" title={activeChat.topic}>
          {activeChat.topic}
        </div>
      </div>

      {/* Error bar */}
      {chatError && (
        <div className="chat-error">{chatError}</div>
      )}

      {/* Transcript */}
      <div className="chat-transcript">
        {activeChat.transcript.map((entry) => (
          <ChatMessage key={entry.id} entry={entry} />
        ))}
        <ProgressIndicator />
        <div ref={transcriptEndRef} />
      </div>

      {/* Input bar */}
      <div className="chat-input-bar">
        <textarea
          className="chat-input"
          placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={chatGenerating}
          rows={2}
        />
        <button
          className="btn btn-primary chat-send-btn"
          onClick={handleSend}
          disabled={!input.trim() || chatGenerating}
        >
          Send
        </button>
      </div>
    </div>
  );
}
