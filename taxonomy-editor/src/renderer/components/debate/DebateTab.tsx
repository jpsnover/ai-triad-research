// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useState, useCallback, useMemo } from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { useDebateStore } from '../../hooks/useDebateStore';
import { useShallow } from 'zustand/react/shallow';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import { useCommunityStore } from '../../hooks/useCommunityStore';
import type { CommunityDebate } from '../../hooks/useCommunityStore';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useMobileNav } from '../../hooks/useMobileNav';
import { NewDebateDialog } from './NewDebateDialog';
import { SearchPreview } from '../edge-browser/SearchPreview';
import { PromptDetailPanel } from '../chat/PromptsPanel';
import type { PromptCatalogEntry } from '../../data/promptCatalog';
import { PROMPT_CATALOG } from '../../data/promptCatalog';
import { ToolbarPaneRenderer, isFullWidthPanel, PhoneToolClose } from '../shared/ToolbarPaneRenderer';
import type { DebateSession } from '../../types/debate';
import { POVER_INFO } from '@lib/debate/types';
import { ParameterHistoryPanel } from '../analysis/ParameterHistoryPanel';
import { api } from '@bridge';

const PHASE_LABELS: Record<string, string> = {
  setup: 'Setup',
  clarification: 'Refining',
  'edit-claims': 'Editing',
  opening: 'Opening',
  debate: 'Active',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  topic: 'Topic',
  document: 'Document',
  url: 'Web URL',
  situations: 'Cross-cutting',
};

const POVER_LABELS: Record<string, { label: string; color: string }> = {
  accelerationist: { label: POVER_INFO.accelerationist.label, color: POVER_INFO.accelerationist.color },
  safetyist: { label: POVER_INFO.safetyist.label, color: POVER_INFO.safetyist.color },
  skeptic: { label: POVER_INFO.skeptic.label, color: POVER_INFO.skeptic.color },
  user: { label: 'You', color: 'var(--text-muted)' },
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDateLong(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function DebateTab() {
  const {
    sessions, sessionsLoading, loadSessions,
    activeDebateId, activeDebate, loadDebate, deleteDebate, renameDebate,
  } = useDebateStore(
    useShallow(s => ({
      sessions: s.sessions, sessionsLoading: s.sessionsLoading, loadSessions: s.loadSessions,
      activeDebateId: s.activeDebateId, activeDebate: s.activeDebate, loadDebate: s.loadDebate, deleteDebate: s.deleteDebate, renameDebate: s.renameDebate,
    }))
  );
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [pendingExportFormat, setPendingExportFormat] = useState<string | null>(null);
  const [selectedPromptEntry, setSelectedPromptEntry] = useState<PromptCatalogEntry | null>(PROMPT_CATALOG[0]);
  const [promptInspectorActive, setPromptInspectorActive] = useState(false);
  const { toolbarPanel } = useTaxonomyStore();
  const { width, onMouseDown, onTouchStart } = useResizablePanel();
  const breakpoint = useBreakpoint();
  const isPhone = breakpoint === 'phone' || breakpoint === 'phone-lg';
  const isTablet = breakpoint === 'tablet' || breakpoint === 'tablet-lg';
  const nav = useMobileNav();
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [listCollapsed, setListCollapsed] = useState(false);
  const [searchPreviewId, setSearchPreviewId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [listView, setListView] = useState<'my' | 'community' | null>(null);
  const { debates: communityDebates, loading: communityLoading, fetchDebates: fetchCommunityDebates, copyItem } = useCommunityStore();
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [selectedCommunityDebate, setSelectedCommunityDebate] = useState<CommunityDebate | null>(null);

  // Custom sort order (persisted to localStorage)
  const [customOrder, setCustomOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('debate-custom-order');
      return saved ? JSON.parse(saved) : [];
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'debate-tab',
        level: 'warn',
        message: 'Failed to load custom debate order from localStorage',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      return [];
    }
  });

  const saveCustomOrder = useCallback((order: string[]) => {
    setCustomOrder(order);
    localStorage.setItem('debate-custom-order', JSON.stringify(order));
  }, []);

  // Apply custom ordering: sessions not yet in the custom order (e.g. newly
  // created debates) float to the top in server order (newest-first), followed
  // by manually-ordered sessions in their saved order. This keeps a user's
  // drag-arrangement intact while ensuring new debates are immediately visible
  // instead of being buried below a long custom-ordered list.
  const orderedSessions = useMemo(() => {
    if (customOrder.length === 0) return sessions;
    const orderMap = new Map(customOrder.map((id, i) => [id, i]));
    const ordered = [...sessions].sort((a, b) => {
      const ai = orderMap.get(a.id);
      const bi = orderMap.get(b.id);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return 1;  // a is pinned, b is new — new (b) first
      if (bi !== undefined) return -1; // b is pinned, a is new — new (a) first
      return 0; // both unordered — keep server order (newest-first)
    });
    return ordered;
  }, [sessions, customOrder]);

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return orderedSessions;
    return orderedSessions.filter(s =>
      s.title.toLowerCase().includes(q) ||
      (s.topic_text && s.topic_text.toLowerCase().includes(q))
    );
  }, [orderedSessions, searchQuery]);

  const moveSession = useCallback((id: string, direction: 'up' | 'down') => {
    // Build full order array from current display order
    const ids = orderedSessions.map(s => s.id);
    const idx = ids.indexOf(id);
    if (idx < 0) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= ids.length) return;
    [ids[idx], ids[targetIdx]] = [ids[targetIdx], ids[idx]];
    saveCustomOrder(ids);
  }, [orderedSessions, saveCustomOrder]);

  const exitEditMode = useCallback(() => {
    setEditMode(false);
    setSelectedIds(new Set());
    setRenamingId(null);
  }, []);

  useEffect(() => {
    void loadSessions();
    void fetchCommunityDebates();
  }, [loadSessions, fetchCommunityDebates]);

  useEffect(() => {
    if (listView !== null) return;
    if (sessionsLoading) return;
    setListView(sessions.length > 0 ? 'my' : 'community');
  }, [listView, sessionsLoading, sessions.length]);

  const handleSelect = (session: { id: string }) => {
    if (session.id !== activeDebateId) {
      void loadDebate(session.id);
    }
    if (nav.isActive) {
      nav.push({ view: 'debate', id: session.id });
    }
  };

  const runExport = useCallback(async (
    format: string,
    exportOptions?: { includeTaxonomyRefs?: boolean; includeReasoning?: boolean },
  ) => {
    if (!activeDebate) return;
    try {
      const result = await api.exportDebateToFile(
        activeDebate,
        format as 'json' | 'markdown' | 'text' | 'pdf' | 'package',
        exportOptions,
      );
      if (!result.cancelled && result.filePath) {
        setExportStatus(`Exported to ${result.filePath}`);
        setTimeout(() => setExportStatus(null), 4000);
      }
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'debate-tab',
        level: 'error',
        message: 'Debate export failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      setExportStatus(`Export failed: ${err}`);
      setTimeout(() => setExportStatus(null), 4000);
    }
  }, [activeDebate]);

  const handleExport = (format: string = 'json') => {
    if (!activeDebate) return;
    if (format === 'markdown' || format === 'pdf') {
      setPendingExportFormat(format);
      return;
    }
    void runExport(format);
  };

  return (
    <div className={`two-column${isPhone ? ' phone-mode' : ''}${isTablet ? ' tablet-mode' : ''}${(isPhone ? nav.current.view !== 'list' : !!activeDebateId) && !toolbarPanel ? ' has-selection' : ''}`}>
      {/* Left pane: Session list OR toolbar panel (Search, Prompts, etc.) */}
      {toolbarPanel ? (
        <div className={`list-panel${isFullWidthPanel(toolbarPanel, promptInspectorActive) ? ' list-panel-full' : ''}`}
             style={isFullWidthPanel(toolbarPanel, promptInspectorActive) ? undefined : { width }}>
          {isPhone && <PhoneToolClose />}
          <ToolbarPaneRenderer
            panel={toolbarPanel}
            onSelectResult={(id) => setSearchPreviewId(id)}
            onSelectPrompt={setSelectedPromptEntry}
            onInspectorToggle={setPromptInspectorActive}
          />
        </div>
      ) : (listCollapsed && !isPhone) ? (
        <div className="pane-collapsed pane-collapsed-list" onClick={() => setListCollapsed(false)} title="Expand list">
          <span className="pane-collapsed-label">Debates</span>
        </div>
      ) : (
        <div className="list-panel debate-session-list" style={{ width }}>
          <div className="list-panel-header">
            <h2>Debates</h2>
            <div className="list-panel-header-actions">
              {listView === 'my' && editMode ? (
                <>
                  <button className="btn btn-sm" onClick={() => setSelectedIds(new Set(sessions.map(s => s.id)))}>All</button>
                  <button className="btn btn-sm" onClick={() => setSelectedIds(new Set())}>None</button>
                  {selectedIds.size > 0 && (
                    <button className="btn btn-sm btn-danger" onClick={() => setShowBulkDeleteConfirm(true)}>
                      Delete {selectedIds.size}
                    </button>
                  )}
                  {customOrder.length > 0 && (
                    <button className="btn btn-sm btn-ghost" onClick={() => saveCustomOrder([])} title="Reset to default sort order">
                      Reset Order
                    </button>
                  )}
                  <button className="btn btn-sm btn-ghost" onClick={exitEditMode}>Done</button>
                </>
              ) : listView === 'my' ? (
                <>
                  {sessions.length > 0 && (
                    <button className="btn btn-sm btn-ghost" onClick={() => setEditMode(true)} title="Edit, rename, reorder, or delete debates">
                      Edit
                    </button>
                  )}
                  <button className="btn btn-sm" onClick={() => setShowNewDialog(true)}>
                    + New
                  </button>
                  <button className="pane-collapse-btn" onClick={() => setListCollapsed(true)} title="Collapse">&lsaquo;</button>
                </>
              ) : (
                <button className="pane-collapse-btn" onClick={() => setListCollapsed(true)} title="Collapse">&lsaquo;</button>
              )}
            </div>
          </div>
          <div className="list-view-tabs">
            <button className={`list-view-tab${listView === 'my' ? ' active' : ''}`} onClick={() => { setListView('my'); exitEditMode(); }}>My ({sessions.length})</button>
            <button className={`list-view-tab${listView === 'community' ? ' active' : ''}`} onClick={() => { setListView('community'); exitEditMode(); }}>Community ({communityDebates.length})</button>
          </div>
          {listView === 'my' ? (
            <>
              {sessions.length > 0 && !editMode && (
                <div style={{ padding: '4px 10px 2px' }}>
                  <input
                    type="text"
                    placeholder="Search debates..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{
                      width: '100%', padding: '4px 8px', fontSize: '0.8rem',
                      border: '1px solid var(--border-color)', borderRadius: 4,
                      background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                      outline: 'none',
                    }}
                  />
                </div>
              )}
              <div
                className="list-panel-items"
                tabIndex={0}
                style={{ outline: 'none' }}
                onKeyDown={(e) => {
                  if (editMode || filteredSessions.length === 0) return;
                  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                  e.preventDefault();
                  const currentIdx = filteredSessions.findIndex(s => s.id === activeDebateId);
                  const nextIdx = e.key === 'ArrowUp'
                    ? Math.max(0, currentIdx - 1)
                    : Math.min(filteredSessions.length - 1, currentIdx + 1);
                  if (nextIdx !== currentIdx && filteredSessions[nextIdx]) {
                    void loadDebate(filteredSessions[nextIdx].id);
                    const container = e.currentTarget;
                    const items = container.querySelectorAll('.debate-session-item');
                    items[nextIdx]?.scrollIntoView({ block: 'nearest' });
                  }
                }}
              >
                {sessionsLoading && sessions.length === 0 && (
                  <div className="debate-session-empty">Loading...</div>
                )}
                {!sessionsLoading && sessions.length === 0 && (
                  <div className="debate-session-empty">
                    No debates yet.
                    <br />
                    Click <strong>+ New</strong> to start one.
                  </div>
                )}
                {searchQuery && filteredSessions.length === 0 && sessions.length > 0 && (
                  <div className="debate-session-empty">No debates match &ldquo;{searchQuery}&rdquo;</div>
                )}
                {filteredSessions.map((s, idx) => (
                  <div
                    key={s.id}
                    className={`debate-session-item ${s.id === activeDebateId ? 'selected' : ''}${editMode && selectedIds.has(s.id) ? ' bulk-selected' : ''}`}
                    onClick={editMode ? () => setSelectedIds(prev => {
                      const next = new Set(prev);
                      next.has(s.id) ? next.delete(s.id) : next.add(s.id);
                      return next;
                    }) : () => handleSelect(s)}
                  >
                    {editMode && (
                      <input
                        type="checkbox"
                        className="bulk-select-checkbox"
                        checked={selectedIds.has(s.id)}
                        onChange={() => setSelectedIds(prev => {
                          const next = new Set(prev);
                          next.has(s.id) ? next.delete(s.id) : next.add(s.id);
                          return next;
                        })}
                      />
                    )}
                    {renamingId === s.id ? (
                      <input
                        className="debate-session-item-rename"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && renameValue.trim()) {
                            e.stopPropagation();
                            void renameDebate(s.id, renameValue.trim());
                            setRenamingId(null);
                          } else if (e.key === 'Escape') {
                            setRenamingId(null);
                          }
                        }}
                        onBlur={() => {
                          if (renameValue.trim() && renameValue.trim() !== s.title) {
                            void renameDebate(s.id, renameValue.trim());
                          }
                          setRenamingId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                    ) : (
                      <div
                        className="debate-session-item-title"
                        onDoubleClick={editMode ? undefined : (e) => { e.stopPropagation(); setRenamingId(s.id); setRenameValue(s.title); }}
                        title={editMode ? s.title : 'Double-click to rename'}
                      >
                        {s.title}
                      </div>
                    )}
                    <div className="debate-session-item-meta">
                      <span className={`debate-phase-badge phase-${s.phase}`}>
                        {PHASE_LABELS[s.phase] || s.phase}
                      </span>
                      {s.model && <span className="debate-session-item-model">{s.model}</span>}
                    </div>
                    <div className="debate-session-item-meta">
                      {s.turn_count != null && <span className="debate-session-item-turns">{s.turn_count} turn{s.turn_count !== 1 ? 's' : ''}</span>}
                      <span className="debate-session-item-date">{formatDate(s.updated_at)}</span>
                    </div>
                    {editMode ? (
                      <div className="debate-session-item-edit-actions" onClick={e => e.stopPropagation()}>
                        <button
                          className="debate-edit-btn"
                          onClick={() => { setRenamingId(s.id); setRenameValue(s.title); }}
                          title="Rename"
                        >
                          &#9998;
                        </button>
                        <button
                          className="debate-edit-btn"
                          onClick={() => moveSession(s.id, 'up')}
                          disabled={idx === 0}
                          title="Move up"
                        >
                          &#9650;
                        </button>
                        <button
                          className="debate-edit-btn"
                          onClick={() => moveSession(s.id, 'down')}
                          disabled={idx === filteredSessions.length - 1}
                          title="Move down"
                        >
                          &#9660;
                        </button>
                      </div>
                    ) : (
                      <button
                        className="debate-session-item-delete"
                        title="Delete debate"
                        onClick={(e) => { e.stopPropagation(); setEditMode(true); setSelectedIds(new Set([s.id])); }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="list-panel-items">
              {communityLoading && communityDebates.length === 0 && (
                <div className="debate-session-empty">Loading community debates...</div>
              )}
              {!communityLoading && communityDebates.length === 0 && (
                <div className="debate-session-empty">No community debates available yet.</div>
              )}
              {communityDebates.map((cd) => (
                <div
                  key={cd.id}
                  className={`debate-session-item${selectedCommunityDebate?.id === cd.id ? ' selected' : ''}`}
                  onClick={() => setSelectedCommunityDebate(cd)}
                >
                  <div className="debate-session-item-title">{cd.title}</div>
                  <div className="debate-session-item-meta">
                    {cd.phase && (
                      <span className={`debate-phase-badge phase-${cd.phase}`}>
                        {PHASE_LABELS[cd.phase] || cd.phase}
                      </span>
                    )}
                    {cd.community_metadata?.submitted_by_display && (
                      <span className="debate-session-item-model">{cd.community_metadata.submitted_by_display}</span>
                    )}
                  </div>
                  <div className="debate-session-item-meta">
                    <span className="debate-session-item-date">{formatDate(cd.updated_at)}</span>
                    <button
                      className="btn btn-sm"
                      style={{ marginLeft: 'auto', fontSize: '0.7rem', padding: '1px 6px' }}
                      disabled={copyingId === cd.id}
                      onClick={async (e) => {
                        e.stopPropagation();
                        setCopyingId(cd.id);
                        try {
                          await copyItem('debates', cd.id);
                          void loadSessions();
                        } catch (err) {
                          getGlobalRecorder()?.record({
                            type: 'system.error',
                            component: 'debate-tab',
                            level: 'error',
                            message: 'Failed to copy community debate',
                            error: { name: (err as Error).name ?? 'Error', message: String(err) },
                          });
                        } finally {
                          setCopyingId(null);
                        }
                      }}
                    >
                      {copyingId === cd.id ? 'Copying...' : 'Copy to My'}
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
          <div className="resize-handle" onMouseDown={onMouseDown} onTouchStart={onTouchStart} />
          <div className="detail-panel">
            <SearchPreview searchPreviewId={searchPreviewId} onClear={() => setSearchPreviewId(null)} />
          </div>
        </>
      ) : (toolbarPanel === 'prompts' && !promptInspectorActive) ? (
        <>
          <div className="resize-handle" onMouseDown={onMouseDown} onTouchStart={onTouchStart} />
          <div className="detail-panel">
            <PromptDetailPanel entry={selectedPromptEntry} />
          </div>
        </>
      ) : toolbarPanel ? (
        <>
          <div className="resize-handle" onMouseDown={onMouseDown} onTouchStart={onTouchStart} />
          <div className="detail-panel">
            <div className="detail-panel-empty">Select an item in the {toolbarPanel} panel</div>
          </div>
        </>
      ) : (
        <>
          <div className="resize-handle" onMouseDown={onMouseDown} onTouchStart={onTouchStart} />
          <div className="detail-panel">
            {isPhone && activeDebate && (
              <div className="phone-detail-header">
                <button className="phone-detail-back" onClick={() => nav.pop()}>
                  &larr; Debates
                </button>
              </div>
            )}
            {listView === 'community' && selectedCommunityDebate ? (
              <CommunityDebateDetail debate={selectedCommunityDebate} />
            ) : activeDebate ? (
              <DebateDetailSummary
                debate={activeDebate}
                onOpenWindow={() => api.openDebateWindow(activeDebate.id).catch((err) => {
                  getGlobalRecorder()?.record({
                    type: 'system.error',
                    component: 'debate-tab',
                    level: 'warn',
                    message: 'Failed to open debate popout window — debate stays inline',
                    error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
                  });
                })}
                onExport={handleExport}
                exportStatus={exportStatus}
              />
            ) : (
              <div className="debate-empty-state">
                <h2>Perspective Debater</h2>
                <p>Select a debate from the list or create a new one.</p>
                <button className="btn" onClick={() => setShowNewDialog(true)}>
                  + New Debate
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {showNewDialog && (
        <NewDebateDialog onClose={() => setShowNewDialog(false)} />
      )}
      {pendingExportFormat && (
        <ExportOptionsDialog
          format={pendingExportFormat}
          onCancel={() => setPendingExportFormat(null)}
          onConfirm={(opts) => {
            const fmt = pendingExportFormat;
            setPendingExportFormat(null);
            void runExport(fmt, opts);
          }}
        />
      )}
      {showBulkDeleteConfirm && (
        <div className="dialog-overlay" onClick={() => setShowBulkDeleteConfirm(false)}>
          <div className="dialog bulk-delete-dialog" onClick={e => e.stopPropagation()}>
            <h3>Delete {selectedIds.size} debate{selectedIds.size !== 1 ? 's' : ''}?</h3>
            <div className="bulk-delete-list">
              {sessions.filter(s => selectedIds.has(s.id)).map(s => (
                <div key={s.id} className="bulk-delete-item">
                  <span className="bulk-delete-item-title">{s.title}</span>
                  <span className="bulk-delete-item-meta">{s.phase} &middot; {formatDate(s.updated_at)}</span>
                </div>
              ))}
            </div>
            <div className="bulk-delete-note">
              Session files will be permanently deleted. Harvested items (conflicts, steelman refinements, debate refs) are preserved.
            </div>
            <div className="dialog-actions">
              <button className="btn" onClick={() => setShowBulkDeleteConfirm(false)}>Cancel</button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  for (const id of selectedIds) {
                    await deleteDebate(id);
                  }
                  setShowBulkDeleteConfirm(false);
                  setEditMode(false);
                  setSelectedIds(new Set());
                }}
              >
                Delete {selectedIds.size} Debate{selectedIds.size !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Debate Detail Summary ──

function DebateDetailSummary({
  debate,
  onOpenWindow,
  onExport,
  exportStatus,
}: {
  debate: DebateSession;
  onOpenWindow: () => void;
  onExport: (format: string) => void;
  exportStatus: string | null;
}) {
  const [showCalibration, setShowCalibration] = useState(false);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const topic = debate.topic.final || debate.topic.refined || debate.topic.original;
  const turnCount = debate.transcript?.filter(t => t.type === 'statement' || t.type === 'opening').length ?? 0;
  const anNodeCount = debate.argument_network?.nodes?.length ?? 0;
  const anEdgeCount = debate.argument_network?.edges?.length ?? 0;

  const handleShare = useCallback(async () => {
    try {
      setShareStatus('Submitting...');
      const { submissionId } = await api.submitToCommunity('debate', debate);
      setShareStatus(`Shared! (${submissionId.slice(0, 8)})`);
      setTimeout(() => setShareStatus(null), 4000);
    } catch (err: unknown) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'debate-detail-summary',
        level: 'error',
        message: 'Failed to share debate to community',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      const msg = err instanceof Error ? err.message : String(err);
      setShareStatus(`Failed: ${msg}`);
      setTimeout(() => setShareStatus(null), 4000);
    }
  }, [debate]);

  return (
    <div className="debate-detail-summary">
      <div className="debate-detail-header">
        <div>
          <h2 className="debate-detail-title">{debate.title}</h2>
          <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: 'var(--text-muted)', userSelect: 'all' }}>{debate.id}</span>
        </div>
        <span className={`debate-phase-badge phase-${debate.phase}`}>
          {PHASE_LABELS[debate.phase] || debate.phase}
        </span>
      </div>

      <div className="debate-detail-actions">
        <button className="btn btn-primary" onClick={onOpenWindow}>
          Open in Window
        </button>
        <button className="btn" onClick={() => onExport('json')}>Export JSON</button>
        <button className="btn" onClick={() => onExport('markdown')}>Export Markdown</button>
        <button className="btn" onClick={() => onExport('pdf')}>Export PDF</button>
        <button className="btn" onClick={() => setShowCalibration(!showCalibration)}>
          Calibration
        </button>
        <button className="btn" onClick={handleShare} disabled={!!shareStatus}>
          {shareStatus || 'Share to Community'}
        </button>
        {exportStatus && <span className="debate-detail-export-status">{exportStatus}</span>}
      </div>

      {showCalibration && (
        <ParameterHistoryPanel onClose={() => setShowCalibration(false)} />
      )}

      {/* Debaters — full width */}
      <div className="debate-detail-debaters-row">
        <h3>Debaters</h3>
        <div className="debate-detail-povers">
          {debate.active_povers.map(p => {
            const info = POVER_LABELS[p] ?? { label: p, color: 'var(--text-muted)' };
            return (
              <span key={p} className="debate-detail-pover" style={{ borderColor: info.color }}>
                {info.label}
              </span>
            );
          })}
        </div>
      </div>

      {/* Topic — full width, scrollable */}
      <div className="debate-detail-topic-row">
        <h3>Topic</h3>
        <div className="debate-detail-topic-scroll">
          <p className="debate-detail-topic">{topic}</p>
          {debate.topic.refined && debate.topic.refined !== debate.topic.original && (
            <p className="debate-detail-topic-original">
              <span className="debate-detail-label">Original:</span> {debate.topic.original}
            </p>
          )}
        </div>
      </div>

      <div className="debate-detail-grid">
        <div className="debate-detail-section">
          <h3>Source</h3>
          <div className="debate-detail-meta-row">
            <span className="debate-detail-label">Type:</span>
            <span>{SOURCE_TYPE_LABELS[debate.source_type] ?? debate.source_type}</span>
          </div>
          {debate.source_ref && (
            <div className="debate-detail-meta-row">
              <span className="debate-detail-label">Reference:</span>
              <span className="debate-detail-source-ref" title={debate.source_ref}>
                {debate.source_type === 'document'
                  ? debate.source_ref.split('/').pop()
                  : debate.source_ref}
              </span>
            </div>
          )}
        </div>

        <div className="debate-detail-section">
          <h3>Statistics</h3>
          <div className="debate-detail-stats">
            <div className="debate-detail-stat">
              <span className="debate-detail-stat-value">{turnCount}</span>
              <span className="debate-detail-stat-label">Turns</span>
            </div>
            {anNodeCount > 0 && (
              <div className="debate-detail-stat">
                <span className="debate-detail-stat-value">{anNodeCount}</span>
                <span className="debate-detail-stat-label">Arguments</span>
              </div>
            )}
            {anEdgeCount > 0 && (
              <div className="debate-detail-stat">
                <span className="debate-detail-stat-value">{anEdgeCount}</span>
                <span className="debate-detail-stat-label">Relations</span>
              </div>
            )}
            {debate.neutral_evaluations && debate.neutral_evaluations.length > 0 && (
              <div className="debate-detail-stat">
                <span className="debate-detail-stat-value">{debate.neutral_evaluations.length}</span>
                <span className="debate-detail-stat-label">Evaluations</span>
              </div>
            )}
          </div>
        </div>

        {(debate.audience || debate.debate_model || debate.protocol_id || debate.origin) && (
          <div className="debate-detail-section">
            <h3>Configuration</h3>
            {debate.origin && (
              <div className="debate-detail-meta-row">
                <span className="debate-detail-label">Created via:</span>
                <span>{debate.origin.mode === 'cli' ? 'CLI (headless runner)' : 'GUI (Electron app)'}</span>
              </div>
            )}
            {debate.origin?.command && (
              <div className="debate-detail-meta-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                <span className="debate-detail-label">Command:</span>
                <code style={{
                  fontSize: '0.72rem', padding: '6px 10px', borderRadius: 4,
                  background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                  wordBreak: 'break-all', whiteSpace: 'pre-wrap', display: 'block', width: '100%',
                  fontFamily: 'monospace',
                }}>{debate.origin.command}</code>
              </div>
            )}
            {debate.audience && (
              <div className="debate-detail-meta-row">
                <span className="debate-detail-label">Audience:</span>
                <span>{debate.audience.replace(/_/g, ' ')}</span>
              </div>
            )}
            {debate.debate_model && (
              <div className="debate-detail-meta-row">
                <span className="debate-detail-label">Model:</span>
                <span>{debate.debate_model}</span>
              </div>
            )}
            {debate.protocol_id && (
              <div className="debate-detail-meta-row">
                <span className="debate-detail-label">Protocol:</span>
                <span>{debate.protocol_id}</span>
              </div>
            )}
            {debate.model_tier && (
              <div className="debate-detail-meta-row">
                <span className="debate-detail-label">Model Tier:</span>
                <span>{debate.model_tier}</span>
              </div>
            )}
            {debate.speaker_models && Object.keys(debate.speaker_models).length > 0 && (
              <div style={{ marginTop: 8 }}>
                <span className="debate-detail-label" style={{ display: 'block', marginBottom: 4 }}>Speaker Models:</span>
                <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={{ textAlign: 'left', padding: '3px 6px', fontWeight: 500 }}>Speaker</th>
                      <th style={{ textAlign: 'left', padding: '3px 6px', fontWeight: 500 }}>Model</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(debate.speaker_models).map(([speaker, model]) => (
                      <tr key={speaker} style={{ borderBottom: '1px solid var(--border-light, var(--border))' }}>
                        <td style={{ padding: '3px 6px', textTransform: 'capitalize' }}>{speaker}</td>
                        <td style={{ padding: '3px 6px', fontFamily: 'monospace', fontSize: '0.72rem' }}>{model}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div className="debate-detail-section">
          <h3>Timestamps</h3>
          <div className="debate-detail-meta-row">
            <span className="debate-detail-label">Created:</span>
            <span>{formatDateLong(debate.created_at)}</span>
          </div>
          <div className="debate-detail-meta-row">
            <span className="debate-detail-label">Updated:</span>
            <span>{formatDateLong(debate.updated_at)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Community Debate Detail ──

function CommunityDebateDetail({ debate }: { debate: CommunityDebate }) {
  const [full, setFull] = useState<DebateSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFull(null);
    setError(null);
    setLoading(true);
    api.loadCommunityDebateSession(debate.id).then(raw => {
      if (cancelled) return;
      if (raw && typeof raw === 'object' && 'found' in (raw as Record<string, unknown>) && !(raw as Record<string, unknown>).found) {
        setError('Debate not found — it may have been removed.');
        return;
      }
      setFull(raw as DebateSession);
    }).catch(err => {
      if (cancelled) return;
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'community-debate-detail',
        level: 'error',
        message: 'Failed to load community debate detail',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      setError('Could not load debate details.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [debate.id]);

  const handleOpenWindow = useCallback(() => {
    window.open(`${location.origin}/#debate-window?id=${encodeURIComponent(debate.id)}&source=community`, '_blank');
  }, [debate.id]);

  const topic = full?.topic ? (full.topic.final || full.topic.refined || full.topic.original) : null;
  const turnCount = full?.transcript?.filter(t => t.type === 'statement' || t.type === 'opening').length ?? 0;
  const anNodeCount = full?.argument_network?.nodes?.length ?? 0;
  const anEdgeCount = full?.argument_network?.edges?.length ?? 0;

  return (
    <div className="debate-detail-summary">
      <div className="debate-detail-header">
        <div>
          <h2 className="debate-detail-title">{debate.title}</h2>
          <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: 'var(--text-muted)', userSelect: 'all' }}>{debate.id}</span>
        </div>
        {debate.phase && (
          <span className={`debate-phase-badge phase-${debate.phase}`}>
            {PHASE_LABELS[debate.phase] || debate.phase}
          </span>
        )}
      </div>

      <div className="debate-detail-actions">
        <button className="btn btn-primary" onClick={handleOpenWindow} disabled={loading || !!error}>
          Open in Window
        </button>
      </div>

      {loading && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic', padding: '8px 0' }}>Loading debate details...</p>}
      {error && <p style={{ color: 'var(--danger, #ef4444)', fontSize: '0.85rem', padding: '8px 0' }}>{error}</p>}

      {/* Debaters */}
      {full?.active_povers && full.active_povers.length > 0 && (
        <div className="debate-detail-debaters-row">
          <h3>Debaters</h3>
          <div className="debate-detail-povers">
            {full.active_povers.map(p => {
              const info = POVER_LABELS[p] ?? { label: p, color: 'var(--text-muted)' };
              return (
                <span key={p} className="debate-detail-pover" style={{ borderColor: info.color }}>
                  {info.label}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Topic */}
      {topic && (
        <div className="debate-detail-topic-row">
          <h3>Topic</h3>
          <div className="debate-detail-topic-scroll">
            <p className="debate-detail-topic">{topic}</p>
          </div>
        </div>
      )}

      <div className="debate-detail-grid">
        {/* Source */}
        {full?.source_type && (
          <div className="debate-detail-section">
            <h3>Source</h3>
            <div className="debate-detail-meta-row">
              <span className="debate-detail-label">Type:</span>
              <span>{SOURCE_TYPE_LABELS[full.source_type] ?? full.source_type}</span>
            </div>
          </div>
        )}

        {/* Statistics */}
        {full && (
          <div className="debate-detail-section">
            <h3>Statistics</h3>
            <div className="debate-detail-stats">
              <div className="debate-detail-stat">
                <span className="debate-detail-stat-value">{turnCount}</span>
                <span className="debate-detail-stat-label">Turns</span>
              </div>
              {anNodeCount > 0 && (
                <div className="debate-detail-stat">
                  <span className="debate-detail-stat-value">{anNodeCount}</span>
                  <span className="debate-detail-stat-label">Arguments</span>
                </div>
              )}
              {anEdgeCount > 0 && (
                <div className="debate-detail-stat">
                  <span className="debate-detail-stat-value">{anEdgeCount}</span>
                  <span className="debate-detail-stat-label">Relations</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Configuration */}
        {full && (full.audience || full.debate_model) && (
          <div className="debate-detail-section">
            <h3>Configuration</h3>
            {full.audience && (
              <div className="debate-detail-meta-row">
                <span className="debate-detail-label">Audience:</span>
                <span>{full.audience.replace(/_/g, ' ')}</span>
              </div>
            )}
            {full.debate_model && (
              <div className="debate-detail-meta-row">
                <span className="debate-detail-label">Model:</span>
                <span>{full.debate_model}</span>
              </div>
            )}
          </div>
        )}

        {/* Community Info */}
        {debate.community_metadata && (
          <div className="debate-detail-section">
            <h3>Community Info</h3>
            <div className="debate-detail-meta-row">
              <span className="debate-detail-label">Shared by:</span>
              <span>{debate.community_metadata.submitted_by_display}</span>
            </div>
            <div className="debate-detail-meta-row">
              <span className="debate-detail-label">Submitted:</span>
              <span>{formatDateLong(debate.community_metadata.submitted_at)}</span>
            </div>
            <div className="debate-detail-meta-row">
              <span className="debate-detail-label">Approved:</span>
              <span>{formatDateLong(debate.community_metadata.approved_at)}</span>
            </div>
          </div>
        )}

        <div className="debate-detail-section">
          <h3>Timestamps</h3>
          <div className="debate-detail-meta-row">
            <span className="debate-detail-label">Created:</span>
            <span>{formatDateLong(debate.created_at)}</span>
          </div>
          <div className="debate-detail-meta-row">
            <span className="debate-detail-label">Updated:</span>
            <span>{formatDateLong(debate.updated_at)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Export Options Dialog ──

const EXPORT_OPTIONS_STORAGE_KEY = 'debate-export-options';

interface ExportOptions {
  includeTaxonomyRefs: boolean;
  includeReasoning: boolean;
}

function loadExportOptions(): ExportOptions {
  try {
    const raw = localStorage.getItem(EXPORT_OPTIONS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        includeTaxonomyRefs: parsed.includeTaxonomyRefs ?? true,
        includeReasoning: parsed.includeReasoning ?? true,
      };
    }
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'debate-tab',
      level: 'warn',
      message: 'Failed to load export options from localStorage',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
  }
  return { includeTaxonomyRefs: true, includeReasoning: true };
}

function ExportOptionsDialog({
  format,
  onCancel,
  onConfirm,
}: {
  format: string;
  onCancel: () => void;
  onConfirm: (options: ExportOptions) => void;
}) {
  const [options, setOptions] = useState<ExportOptions>(loadExportOptions);
  const formatLabel = format === 'markdown' ? 'Markdown' : format === 'pdf' ? 'PDF' : format;

  const handleConfirm = () => {
    try {
      localStorage.setItem(EXPORT_OPTIONS_STORAGE_KEY, JSON.stringify(options));
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'debate-tab',
        level: 'warn',
        message: 'Failed to save export options to localStorage',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
    }
    onConfirm(options);
  };

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Export {formatLabel} Options</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '12px 0' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={options.includeTaxonomyRefs}
              onChange={(e) => setOptions(o => ({ ...o, includeTaxonomyRefs: e.target.checked }))}
            />
            <span>Include taxonomy references</span>
          </label>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8,
            cursor: options.includeTaxonomyRefs ? 'pointer' : 'not-allowed',
            opacity: options.includeTaxonomyRefs ? 1 : 0.5,
            paddingLeft: 20,
          }}>
            <input
              type="checkbox"
              checked={options.includeReasoning}
              disabled={!options.includeTaxonomyRefs}
              onChange={(e) => setOptions(o => ({ ...o, includeReasoning: e.target.checked }))}
            />
            <span>Include reasoning (relevance text)</span>
          </label>
        </div>
        <div className="dialog-actions">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={handleConfirm}>Export</button>
        </div>
      </div>
    </div>
  );
}

