// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useEffect, useCallback } from 'react';
import { useChatStore } from '../../hooks/useChatStore';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import { api } from '@bridge';
import { POVER_INFO } from '../../types/debate';
import type { TaxonomyRef } from '../../types/debate';
import type { ChatEntry, ChatMode } from '../../types/chat';
import type { Pov } from '../../types/taxonomy';
import { CHAT_MODE_INFO } from '../../types/chat';
import { nodePovFromId, nodeTypeFromId } from '@lib/debate/nodeIdUtils';
import { NodeDetail } from '../taxonomy/NodeDetail';
import { SituationDetail } from '../debate/SituationDetail';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { useResizableRightPanel } from '../../hooks/useResizablePanel';
import { useUserProfile } from '../../hooks/useAuthStatus';
import { CommunityShareBanner } from '../shared/CommunityShareBanner';

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
  return nodePovFromId(nodeId) ?? 'unknown';
}

// ── Taxonomy ref pills ───────────────────────────────────

function TaxonomyPill({ taxRef, selected, onClick }: { taxRef: TaxonomyRef; selected?: boolean; onClick?: () => void }) {
  const tab = nodeIdToTab(taxRef.node_id);
  return (
    <span
      className={`taxonomy-pill tab-${tab}${selected ? ' selected' : ''}`}
      title={taxRef.relevance || taxRef.node_id}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : undefined }}
    >
      {taxRef.node_id}
    </span>
  );
}

function TaxonomyRefsSection({ refs, selectedNodeId, onSelectNode }: { refs: TaxonomyRef[]; selectedNodeId: string | null; onSelectNode: (id: string | null) => void }) {
  const [showReasoning, setShowReasoning] = useState(false);

  if (!refs || refs.length === 0) return null;

  return (
    <div className="chat-taxonomy-refs">
      <div className="chat-taxonomy-pills">
        {refs.map((r) => (
          <TaxonomyPill
            key={r.node_id}
            taxRef={r}
            selected={r.node_id === selectedNodeId}
            onClick={() => onSelectNode(r.node_id === selectedNodeId ? null : r.node_id)}
          />
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
              <span
                className={`taxonomy-pill tab-${nodeIdToTab(r.node_id)}${r.node_id === selectedNodeId ? ' selected' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => onSelectNode(r.node_id === selectedNodeId ? null : r.node_id)}
              >
                {r.node_id}
              </span>
              <span className="chat-reasoning-text">{r.relevance}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Chat message ─────────────────────────────────────────

function ChatMessage({ entry, selectedNodeId, onSelectNode }: { entry: ChatEntry; selectedNodeId: string | null; onSelectNode: (id: string | null) => void }) {
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
        <Markdown remarkPlugins={[remarkGfm]}>{entry.content}</Markdown>
      </div>
      <TaxonomyRefsSection refs={entry.taxonomy_refs} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />
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

function useSelectedNode(nodeId: string | null) {
  const state = useTaxonomyStore();
  if (!nodeId) return null;

  const pov = nodePovFromId(nodeId);
  const type = nodeTypeFromId(nodeId);

  if (type === 'situation') {
    const node = state.situations?.nodes.find(n => n.id === nodeId) ?? null;
    return node ? { type: 'situation' as const, node } : null;
  }

  if (type === 'pov' && pov) {
    const file = state[pov as 'accelerationist' | 'safetyist' | 'skeptic'];
    const node = file?.nodes.find(n => n.id === nodeId) ?? null;
    return node ? { type: 'pov' as const, pov: pov as Pov, node } : null;
  }

  return null;
}

export function ChatWorkspace() {
  const {
    activeChat, chatLoading, chatError, chatGenerating, chatActivity,
    sendMessage, generateOpening, changeMode,
  } = useChatStore();
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const hasTriggeredOpening = useRef(false);
  const [input, setInput] = useState('');
  const [shareState, setShareState] = useState<'idle' | 'sharing' | 'success' | 'error'>('idle');
  const [shareError, setShareError] = useState<string | null>(null);
  const [selectedRefNodeId, setSelectedRefNodeId] = useState<string | null>(null);
  const selectedNode = useSelectedNode(selectedRefNodeId);
  const profile = useUserProfile();
  const { width: detailWidth, onMouseDown: onDetailResize, onTouchStart: onDetailTouchStart } = useResizableRightPanel({
    storageKey: 'taxonomy-editor-chat-detail-width',
    defaultWidth: 380,
    minWidth: 280,
    maxWidth: 600,
  });

  const handleShare = useCallback(async () => {
    if (!activeChat) return;
    try {
      setShareState('sharing');
      setShareError(null);
      await api.submitToCommunity('chat', activeChat);
      setShareState('success');
    } catch (err: unknown) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'chat-workspace',
        level: 'error',
        message: 'Failed to share chat to community',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      const msg = err instanceof Error ? err.message : String(err);
      setShareError(msg);
      setShareState('error');
      setTimeout(() => { setShareState('idle'); setShareError(null); }, 4000);
    }
  }, [activeChat]);

  // Clear selection when chat changes
  useEffect(() => {
    setSelectedRefNodeId(null);
  }, [activeChat?.id]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeChat?.transcript.length, chatGenerating]);

  // Reset opening trigger when chat changes — must precede the trigger effect
  // so the ref is cleared before the trigger check runs in the same render.
  useEffect(() => {
    hasTriggeredOpening.current = false;
  }, [activeChat?.id]);

  // Auto-trigger opening message
  useEffect(() => {
    if (activeChat && activeChat.transcript.length === 0 && !hasTriggeredOpening.current && !chatGenerating) {
      hasTriggeredOpening.current = true;
      void generateOpening();
    }
  }, [activeChat, chatGenerating, generateOpening]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || chatGenerating) return;
    const msg = input;
    setInput('');
    getGlobalRecorder()?.record({ type: 'user.action', component: 'chat', level: 'info', message: 'chat.send', data: { chat_id: activeChat?.id, mode: activeChat?.mode, pover: activeChat?.pover, message_length: msg.length } });
    await sendMessage(msg);
  }, [input, chatGenerating, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
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

  const poverInfo = POVER_INFO[activeChat.pover as keyof typeof POVER_INFO];

  return (
    <div className={`chat-workspace${selectedNode ? ' has-detail-pane' : ''}`}>
      <div className="chat-main-column">
        {/* Header */}
        <div className="chat-header">
          <div className="chat-header-left">
            <span className="chat-header-pover" style={{ color: poverInfo?.color ?? '#888' }}>
              {poverInfo?.label ?? activeChat.pover}
            </span>
            <ModeSelector mode={activeChat.mode} onChange={(m) => { getGlobalRecorder()?.record({ type: 'user.action', component: 'chat', level: 'info', message: 'chat.mode_switch', data: { chat_id: activeChat.id, from: activeChat.mode, to: m } }); void changeMode(m); }} />
          </div>
          <div className="chat-header-topic" title={activeChat.topic}>
            {activeChat.topic}
          </div>
          <button
            className="btn btn-sm"
            onClick={handleShare}
            disabled={shareState !== 'idle'}
            title="Submit this chat for community review"
            style={{ flexShrink: 0, fontSize: '0.72rem' }}
          >
            {shareState === 'sharing' ? 'Sharing...' : 'Share'}
          </button>
        </div>

        {/* Share result banner */}
        {shareState === 'success' && (
          <CommunityShareBanner
            itemType="chat"
            compact
            onDismiss={() => setShareState('idle')}
          />
        )}
        {shareState === 'error' && shareError && (
          <div style={{ color: 'var(--red, #ef4444)', fontSize: '0.75rem', padding: '4px 12px' }}>
            {'Failed: ' + shareError}
          </div>
        )}

        {/* Error bar */}
        {chatError && (
          <div className="chat-error">{chatError}</div>
        )}

        {/* Transcript */}
        <div className="chat-transcript">
          {activeChat.transcript.length === 0 && chatGenerating ? (
            <div className="chat-generating-hero">
              <div className="chat-generating-spinner" />
              <span>{chatActivity || 'Preparing conversation...'}</span>
            </div>
          ) : (
            <>
              {activeChat.transcript.map((entry) => (
                <ChatMessage key={entry.id} entry={entry} selectedNodeId={selectedRefNodeId} onSelectNode={setSelectedRefNodeId} />
              ))}
              <ProgressIndicator />
            </>
          )}
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

      {selectedNode && (
        <>
        <div className="resize-handle" onMouseDown={onDetailResize} onTouchStart={onDetailTouchStart} />
        <div className="chat-detail-pane" style={{ width: detailWidth }}>
          <button className="chat-detail-close" onClick={() => setSelectedRefNodeId(null)} title="Close detail pane">&times;</button>
          {selectedNode.type === 'pov' ? (
            <NodeDetail pov={selectedNode.pov} node={selectedNode.node} readOnly />
          ) : (
            <SituationDetail node={selectedNode.node} readOnly />
          )}
        </div>
        </>
      )}
    </div>
  );
}
