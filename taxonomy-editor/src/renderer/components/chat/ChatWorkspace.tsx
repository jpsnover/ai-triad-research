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
import { remarkColorizePov } from '../../utils/colorizePovPlugin';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { useResizableRightPanel } from '../../hooks/useResizablePanel';
import { useUserProfile } from '../../hooks/useAuthStatus';
import { CommunityShareBanner } from '../shared/CommunityShareBanner';
import { useGeminiOnboarding } from '../../hooks/useGeminiOnboarding';
import { useTierInfo, isFreeTier } from '../../hooks/useTierInfo';
import { GeminiOnboardingModal } from '../settings/GeminiOnboardingModal';
import { CampGlyph, povToCamp } from '../shared/CampGlyph';
import { EmptyState } from '../shared/EmptyState';
import './ChatWorkspace.css';

// ── Helpers ──────────────────────────────────────────────

function speakerLabel(speaker: string): string {
  if (speaker === 'user') return 'You';
  if (speaker === 'system') return 'System';
  const info = POVER_INFO[speaker as keyof typeof POVER_INFO];
  return info?.label || speaker;
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
      data-clickable={onClick ? '' : undefined}
    >
      {taxRef.node_id}
    </span>
  );
}

function TaxonomyRefsSection({ refs, selectedNodeId, onSelectNode }: { refs: TaxonomyRef[]; selectedNodeId: string | null; onSelectNode: (id: string | null) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);

  if (!refs || refs.length === 0) return null;

  if (!expanded) {
    return (
      <div className="chat-taxonomy-refs">
        <button className="chat-refs-collapsed" onClick={() => setExpanded(true)}>
          {refs.length} {refs.length === 1 ? 'reference' : 'references'}
        </button>
      </div>
    );
  }

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
        <button
          className="chat-taxonomy-toggle"
          onClick={() => { setExpanded(false); setShowReasoning(false); }}
        >
          Collapse
        </button>
      </div>
      {showReasoning && (
        <div className="chat-taxonomy-reasoning">
          {refs.map((r) => (
            <div key={r.node_id} className="chat-taxonomy-reasoning-item">
              <span
                className={`taxonomy-pill tab-${nodeIdToTab(r.node_id)}${r.node_id === selectedNodeId ? ' selected' : ''}`}
                data-clickable=""
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
  const isUser = entry.speaker === 'user';
  const camp = povToCamp(entry.speaker);

  return (
    <div className={`chat-message chat-speaker-${entry.speaker}${isUser ? ' chat-message-user' : ''}`}>
      {camp && (
        <div className={`chat-message-avatar camp-${camp}`}>
          <CampGlyph camp={camp} size={14} />
        </div>
      )}
      <div className="chat-message-body">
        <div className="chat-message-header">
          <span className={`chat-message-speaker${camp ? ` camp-speaker-${camp}` : ''}`}>
            {speakerLabel(entry.speaker)}
          </span>
        </div>
        <div className="chat-message-content markdown-body prose">
          <Markdown remarkPlugins={[remarkGfm, remarkColorizePov]}>{entry.content}</Markdown>
        </div>
        <TaxonomyRefsSection refs={entry.taxonomy_refs} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />
      </div>
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

// ── Export button ────────────────────────────────────────

type ChatExportFormat = 'markdown' | 'text' | 'pdf';
const EXPORT_FORMATS: { id: ChatExportFormat; label: string }[] = [
  { id: 'pdf', label: 'PDF' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'text', label: 'Text' },
];

function ExportButton({ chat }: { chat: { topic: string; mode: ChatMode; pover: string; transcript: ChatEntry[] } }) {
  const [showMenu, setShowMenu] = useState(false);
  const [exportState, setExportState] = useState<'idle' | 'exporting'>('idle');
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isEmpty = chat.transcript.length === 0;

  useEffect(() => {
    if (!showMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMenu]);

  useEffect(() => {
    if (showMenu && menuRef.current) {
      const first = menuRef.current.querySelector<HTMLButtonElement>('[role="menuitem"]');
      first?.focus();
    }
  }, [showMenu]);

  const handleExport = useCallback(async (format: ChatExportFormat) => {
    setShowMenu(false);
    setExportState('exporting');
    try {
      await api.exportChatToFile(
        chat.transcript,
        format,
        { title: chat.topic, mode: chat.mode as 'brainstorm' | 'inform' | 'decide', pov: chat.pover as 'accelerationist' | 'safetyist' | 'skeptic' },
      );
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'chat-export',
        level: 'error',
        message: `Failed to export chat as ${format}`,
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
    } finally {
      setExportState('idle');
      buttonRef.current?.focus();
    }
  }, [chat]);

  const handleMenuKeyDown = useCallback((e: React.KeyboardEvent) => {
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    if (!items?.length) return;
    const currentIdx = Array.from(items).indexOf(document.activeElement as HTMLButtonElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(currentIdx + 1) % items.length].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(currentIdx - 1 + items.length) % items.length].focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowMenu(false);
      buttonRef.current?.focus();
    }
  }, []);

  return (
    <div ref={containerRef} className="chat-export-container">
      <button
        ref={buttonRef}
        className="btn btn-sm chat-export-btn"
        onClick={() => setShowMenu(!showMenu)}
        disabled={isEmpty || exportState === 'exporting'}
        title={isEmpty ? 'Nothing to export yet' : 'Export chat'}
        aria-label="Export chat"
        aria-haspopup="menu"
        aria-expanded={showMenu}
      >
        {exportState === 'exporting' ? (
          <span className="chat-export-spinner" />
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        )}
      </button>
      {showMenu && (
        <div ref={menuRef} className="chat-export-menu" role="menu" onKeyDown={handleMenuKeyDown}>
          {EXPORT_FORMATS.map(f => (
            <button
              key={f.id}
              className="chat-export-menu-item"
              role="menuitem"
              tabIndex={-1}
              onClick={() => void handleExport(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
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
  const { modalProps: geminiModalProps, checkAndShow: checkGeminiOnboarding } = useGeminiOnboarding();
  const { tier: tierInfo } = useTierInfo();
  const freeTier = isFreeTier(tierInfo);

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

  // Sync address bar with active chat ID (web popout only)
  useEffect(() => {
    if (!activeChat?.id) return;
    if (!window.location.hash.startsWith('#chat-window')) return;
    const next = `#chat-window?id=${encodeURIComponent(activeChat.id)}`;
    if (window.location.hash !== next) {
      window.history.replaceState(null, '', next);
    }
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
    await checkGeminiOnboarding({ freeTier });
    const msg = input;
    setInput('');
    getGlobalRecorder()?.record({ type: 'user.action', component: 'chat', level: 'info', message: 'chat.send', data: { chat_id: activeChat?.id, mode: activeChat?.mode, pover: activeChat?.pover, message_length: msg.length } });
    await sendMessage(msg);
  }, [input, chatGenerating, sendMessage, checkGeminiOnboarding, freeTier]);

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
        <EmptyState
          headline="No chat selected"
          direction="Select a chat or start a new one."
        />
      </div>
    );
  }

  const poverInfo = POVER_INFO[activeChat.pover as keyof typeof POVER_INFO];
  const headerCamp = povToCamp(activeChat.pover);

  return (
    <div className={`chat-workspace${selectedNode ? ' has-detail-pane' : ''}`}>
      <div className="chat-main-column">
        {/* Header */}
        <div className="chat-header">
          <div className="chat-header-left">
            <span className={`chat-header-pover${headerCamp ? ` camp-speaker-${headerCamp}` : ''}`}>
              {poverInfo?.label ?? activeChat.pover}
            </span>
            <ModeSelector mode={activeChat.mode} onChange={(m) => { getGlobalRecorder()?.record({ type: 'user.action', component: 'chat', level: 'info', message: 'chat.mode_switch', data: { chat_id: activeChat.id, from: activeChat.mode, to: m } }); void changeMode(m); }} />
          </div>
          <div className="chat-header-topic" title={activeChat.topic}>
            {activeChat.topic}
          </div>
          <ExportButton chat={activeChat} />
          <button
            className="btn btn-sm chat-share-btn"
            onClick={handleShare}
            disabled={shareState !== 'idle'}
            title="Submit this chat for community review"
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
          <div className="chat-share-error">
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
          <button className="chat-detail-close" onClick={() => setSelectedRefNodeId(null)} title="Close detail pane" aria-label="Close">&times;</button>
          {selectedNode.type === 'pov' ? (
            <NodeDetail pov={selectedNode.pov} node={selectedNode.node} readOnly />
          ) : (
            <SituationDetail node={selectedNode.node} readOnly />
          )}
        </div>
        </>
      )}
      <GeminiOnboardingModal {...geminiModalProps} />
    </div>
  );
}
