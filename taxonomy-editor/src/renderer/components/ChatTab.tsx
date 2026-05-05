// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useState } from 'react';
import { useChatStore } from '../hooks/useChatStore';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { useResizablePanel } from '../hooks/useResizablePanel';
import { NewChatDialog } from './NewChatDialog';
import { ChatWorkspace } from './ChatWorkspace';
import { SearchPreview } from './SearchPreview';
import { PromptDetailPanel } from './PromptsPanel';
import type { PromptCatalogEntry } from '../data/promptCatalog';
import { PROMPT_CATALOG } from '../data/promptCatalog';
import { ToolbarPaneRenderer, isFullWidthPanel } from './ToolbarPaneRenderer';
import { POVER_INFO } from '../types/debate';
import type { ChatSessionSummary, ChatMode } from '../types/chat';

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
  } = useChatStore();
  const { toolbarPanel } = useTaxonomyStore();
  const { width, onMouseDown } = useResizablePanel();
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [selectedPromptEntry, setSelectedPromptEntry] = useState<PromptCatalogEntry | null>(PROMPT_CATALOG[0]);
  const [promptInspectorActive, setPromptInspectorActive] = useState(false);
  const [searchPreviewId, setSearchPreviewId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [listCollapsed, setListCollapsed] = useState(false);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

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
    <div className="two-column">
      {/* Left pane: Session list OR toolbar panel */}
      {toolbarPanel ? (
        <div className={`list-panel${isFullWidthPanel(toolbarPanel, promptInspectorActive) ? ' list-panel-full' : ''}`}
             style={isFullWidthPanel(toolbarPanel, promptInspectorActive) ? undefined : { width }}>
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
              <button className="btn btn-sm" onClick={() => setShowNewDialog(true)}>
                + New
              </button>
              <button className="pane-collapse-btn" onClick={() => setListCollapsed(true)} title="Collapse">&lsaquo;</button>
            </div>
          </div>
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
                  <span className="chat-session-item-date">{formatDate(s.updated_at)}</span>
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
            <ChatWorkspace />
          </div>
        </>
      )}

      {showNewDialog && <NewChatDialog onClose={() => setShowNewDialog(false)} />}
    </div>
  );
}
