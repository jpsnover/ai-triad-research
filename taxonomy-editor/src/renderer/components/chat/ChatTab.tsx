// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useState } from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { useChatStore } from '../../hooks/useChatStore';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import { useCommunityStore } from '../../hooks/useCommunityStore';
import type { CommunityChat } from '../../hooks/useCommunityStore';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { NewChatDialog } from './NewChatDialog';
import { ChatWorkspace } from './ChatWorkspace';
import { SearchPreview } from '../edge-browser/SearchPreview';
import { PromptDetailPanel } from './PromptsPanel';
import type { PromptCatalogEntry } from '../../data/promptCatalog';
import { PROMPT_CATALOG } from '../../data/promptCatalog';
import { ToolbarPaneRenderer, isFullWidthPanel, PhoneToolClose } from '../shared/ToolbarPaneRenderer';
import { POVER_INFO } from '../../types/debate';
import type { ChatSessionSummary, ChatMode } from '../../types/chat';

const MODE_LABELS: Record<ChatMode, string> = {
  brainstorm: 'Brainstorm',
  inform: 'Inform',
  decide: 'Decide',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ChatTab() {
  const {
    sessions, sessionsLoading, loadSessions,
    activeChatId, loadChat, deleteChat, renameChat,
    chatGenerating, chatActivity, chatError,
  } = useChatStore();
  const { toolbarPanel } = useTaxonomyStore();
  const { width, onMouseDown } = useResizablePanel();
  const breakpoint = useBreakpoint();
  const isPhone = breakpoint === 'phone' || breakpoint === 'phone-lg';
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [selectedPromptEntry, setSelectedPromptEntry] = useState<PromptCatalogEntry | null>(PROMPT_CATALOG[0]);
  const [promptInspectorActive, setPromptInspectorActive] = useState(false);
  const [searchPreviewId, setSearchPreviewId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [listCollapsed, setListCollapsed] = useState(false);
  const [listView, setListView] = useState<'my' | 'community'>('my');
  const { chats: communityChats, loading: communityLoading, fetchChats: fetchCommunityChats, copyItem } = useCommunityStore();
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [selectedCommunityChat, setSelectedCommunityChat] = useState<CommunityChat | null>(null);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (listView === 'community') void fetchCommunityChats();
  }, [listView, fetchCommunityChats]);

  const handleSelect = (session: ChatSessionSummary) => {
    if (session.id !== activeChatId) {
      void loadChat(session.id);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteChat(id);
    setConfirmDeleteId(null);
  };

  return (
    <div className={`two-column${isPhone ? ' phone-mode' : ''}${(isPhone && activeChatId && !toolbarPanel) ? ' has-selection' : ''}`}>
      {/* Left pane: Session list OR toolbar panel */}
      {toolbarPanel ? (
        <div className={`list-panel${isFullWidthPanel(toolbarPanel, promptInspectorActive) ? ' list-panel-full' : ''}`}
             style={isFullWidthPanel(toolbarPanel, promptInspectorActive) ? undefined : { width }}>
          {isPhone && <PhoneToolClose />}
          <ToolbarPaneRenderer
            panel={toolbarPanel}
            onSelectResult={setSearchPreviewId}
            onSelectPrompt={setSelectedPromptEntry}
            onInspectorToggle={setPromptInspectorActive}
          />
        </div>
      ) : listCollapsed ? (
        <div className="pane-collapsed pane-collapsed-list" onClick={() => setListCollapsed(false)} title="Expand list">
          <span className="pane-collapsed-label">Chats</span>
        </div>
      ) : (
        <div className="list-panel chat-session-list" style={{ width }}>
          <div className="list-panel-header">
            <h2>Chats</h2>
            <div className="list-panel-header-actions">
              {listView === 'my' && (
                <button className="btn btn-sm" onClick={() => setShowNewDialog(true)}>
                  + New
                </button>
              )}
              <button className="pane-collapse-btn" onClick={() => setListCollapsed(true)} title="Collapse">&lsaquo;</button>
            </div>
          </div>
          <div className="list-view-tabs">
            <button className={`list-view-tab${listView === 'my' ? ' active' : ''}`} onClick={() => setListView('my')}>My</button>
            <button className={`list-view-tab${listView === 'community' ? ' active' : ''}`} onClick={() => setListView('community')}>Community</button>
          </div>
          {chatError && isPhone && !activeChatId && (
            <div className="chat-error" style={{ margin: '8px', fontSize: '0.8rem' }}>{chatError}</div>
          )}
          {listView === 'my' ? (
            <div className="list-panel-items">
              {sessionsLoading && sessions.length === 0 && (
                <div className="chat-session-empty">Loading...</div>
              )}
              {!sessionsLoading && sessions.length === 0 && (
                <div className="chat-session-empty">
                  No chats yet.
                  <br />
                  Click <strong>+ New</strong> to start one.
                </div>
              )}
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className={`chat-session-item ${s.id === activeChatId ? 'selected' : ''}`}
                  onClick={() => handleSelect(s)}
                >
                  {renamingId === s.id ? (
                    <input
                      className="chat-session-item-rename"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && renameValue.trim()) {
                          e.stopPropagation();
                          void renameChat(s.id, renameValue.trim());
                          setRenamingId(null);
                        } else if (e.key === 'Escape') {
                          setRenamingId(null);
                        }
                      }}
                      onBlur={() => {
                        if (renameValue.trim() && renameValue.trim() !== s.title) {
                          void renameChat(s.id, renameValue.trim());
                        }
                        setRenamingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <div
                      className="chat-session-item-title"
                      onDoubleClick={(e) => { e.stopPropagation(); setRenamingId(s.id); setRenameValue(s.title); }}
                      title="Double-click to rename"
                    >
                      {s.title}
                    </div>
                  )}
                  <div className="chat-session-item-meta">
                    <span className={`chat-mode-badge mode-${s.mode}`}>
                      {MODE_LABELS[s.mode] || s.mode}
                    </span>
                    <span className="chat-session-pover" style={{ color: POVER_INFO[s.pover]?.color }}>
                      {POVER_INFO[s.pover]?.label || s.pover}
                    </span>
                    {s.id === activeChatId && chatGenerating ? (
                      <span className="chat-session-generating">
                        <span className="dot-animation" />
                        {chatActivity || 'Generating...'}
                      </span>
                    ) : (
                      <span className="chat-session-item-date">{formatDate(s.updated_at)}</span>
                    )}
                  </div>
                  {confirmDeleteId === s.id ? (
                    <div className="chat-session-item-confirm">
                      <span>Delete?</span>
                      <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); void handleDelete(s.id); }}>Yes</button>
                      <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}>No</button>
                    </div>
                  ) : (
                    <button
                      className="chat-session-item-delete"
                      title="Delete chat"
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(s.id); }}
                    >
                      &times;
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="list-panel-items">
              {communityLoading && communityChats.length === 0 && (
                <div className="chat-session-empty">Loading community chats...</div>
              )}
              {!communityLoading && communityChats.length === 0 && (
                <div className="chat-session-empty">No community chats available yet.</div>
              )}
              {communityChats.map((cc) => (
                <div
                  key={cc.id}
                  className={`chat-session-item${selectedCommunityChat?.id === cc.id ? ' selected' : ''}`}
                  onClick={() => setSelectedCommunityChat(cc)}
                >
                  <div className="chat-session-item-title">{cc.title}</div>
                  <div className="chat-session-item-meta">
                    {cc.mode && (
                      <span className={`chat-mode-badge mode-${cc.mode}`}>
                        {MODE_LABELS[cc.mode as ChatMode] || cc.mode}
                      </span>
                    )}
                    {cc.community_metadata?.submitted_by_display && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{cc.community_metadata.submitted_by_display}</span>
                    )}
                    <span className="chat-session-item-date">{formatDate(cc.updated_at)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
                    <button
                      className="btn btn-sm"
                      style={{ fontSize: '0.7rem', padding: '1px 6px' }}
                      disabled={copyingId === cc.id}
                      onClick={async (e) => {
                        e.stopPropagation();
                        setCopyingId(cc.id);
                        try {
                          await copyItem('chats', cc.id);
                          void loadSessions();
                        } catch (err) {
                          getGlobalRecorder()?.record({
                            type: 'system.error',
                            component: 'chat-tab',
                            level: 'error',
                            message: 'Failed to copy community chat',
                            error: { name: (err as Error).name ?? 'Error', message: String(err) },
                          });
                        } finally {
                          setCopyingId(null);
                        }
                      }}
                    >
                      {copyingId === cc.id ? 'Copying...' : 'Copy to My'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Right pane: context-dependent */}
      {isFullWidthPanel(toolbarPanel, promptInspectorActive) ? null
        : toolbarPanel === 'search' ? (
        <>
          <div className="resize-handle" onMouseDown={onMouseDown} />
          <div className="detail-panel">
            <SearchPreview searchPreviewId={searchPreviewId} onClear={() => setSearchPreviewId(null)} />
          </div>
        </>
      ) : (toolbarPanel === 'prompts' && !promptInspectorActive) ? (
        <>
          <div className="resize-handle" onMouseDown={onMouseDown} />
          <div className="detail-panel">
            <PromptDetailPanel entry={selectedPromptEntry} />
          </div>
        </>
      ) : toolbarPanel ? (
        <>
          <div className="resize-handle" onMouseDown={onMouseDown} />
          <div className="detail-panel">
            <div className="detail-panel-empty">Select an item in the {toolbarPanel} panel</div>
          </div>
        </>
      ) : (
        <>
          <div className="resize-handle" onMouseDown={onMouseDown} />
          <div className="detail-panel chat-workspace-container">
            {isPhone && activeChatId && (
              <div className="phone-detail-header">
                <button className="phone-detail-back" onClick={() => useChatStore.setState({ activeChatId: null, activeChat: null, chatModel: null })}>
                  &larr; Chats
                </button>
              </div>
            )}
            {listView === 'community' && selectedCommunityChat ? (
              <CommunityChatDetail chat={selectedCommunityChat} />
            ) : (
              <ChatWorkspace />
            )}
          </div>
        </>
      )}

      {showNewDialog && <NewChatDialog onClose={() => setShowNewDialog(false)} />}
    </div>
  );
}

// ── Community Chat Detail ──

function CommunityChatDetail({ chat }: { chat: CommunityChat }) {
  return (
    <div className="debate-detail-summary">
      <div className="debate-detail-header">
        <div>
          <h2 className="debate-detail-title">{chat.title}</h2>
          <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: 'var(--text-muted)', userSelect: 'all' }}>{chat.id}</span>
        </div>
        {chat.mode && (
          <span className={`chat-mode-badge mode-${chat.mode}`}>
            {MODE_LABELS[chat.mode as ChatMode] || chat.mode}
          </span>
        )}
      </div>
      {chat.community_metadata && (
        <div className="debate-detail-grid">
          <div className="debate-detail-section">
            <h3>Community Info</h3>
            <div className="debate-detail-meta-row">
              <span className="debate-detail-label">Shared by:</span>
              <span>{chat.community_metadata.submitted_by_display}</span>
            </div>
            <div className="debate-detail-meta-row">
              <span className="debate-detail-label">Submitted:</span>
              <span>{formatDate(chat.community_metadata.submitted_at)}</span>
            </div>
            <div className="debate-detail-meta-row">
              <span className="debate-detail-label">Approved:</span>
              <span>{formatDate(chat.community_metadata.approved_at)}</span>
            </div>
          </div>
          <div className="debate-detail-section">
            <h3>Timestamps</h3>
            <div className="debate-detail-meta-row">
              <span className="debate-detail-label">Created:</span>
              <span>{formatDate(chat.created_at)}</span>
            </div>
            <div className="debate-detail-meta-row">
              <span className="debate-detail-label">Updated:</span>
              <span>{formatDate(chat.updated_at)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
