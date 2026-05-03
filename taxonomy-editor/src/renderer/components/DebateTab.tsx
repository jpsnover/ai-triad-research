// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useDebateStore } from '../hooks/useDebateStore';
import { useShallow } from 'zustand/react/shallow';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { useResizablePanel } from '../hooks/useResizablePanel';
import { NewDebateDialog } from './NewDebateDialog';
import { SearchPanel } from './SearchPanel';
import { PromptsPanel, PromptDetailPanel } from './PromptsPanel';
import type { PromptCatalogEntry } from '../data/promptCatalog';
import { PROMPT_CATALOG } from '../data/promptCatalog';
import { FallacyPanel } from './FallacyPanel';
import { EdgeBrowser } from './EdgeBrowser';
import { TerminalPanel } from './TerminalPanel';
import { PolicyAlignmentPanel } from './PolicyAlignmentPanel';
import { PolicyDashboard } from './PolicyDashboard';
import { VocabularyPanel } from './VocabularyPanel';
import type { DebateSession } from '../types/debate';
import { ParameterHistoryPanel } from './ParameterHistoryPanel';
import { api } from '@bridge';

const PHASE_LABELS: Record<string, string> = {
  setup: 'Setup',
  clarification: 'Refining',
  opening: 'Opening',
  debate: 'Active',
  closed: 'Closed',
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  topic: 'Topic',
  document: 'Document',
  url: 'Web URL',
  situations: 'Cross-cutting',
};

const POVER_LABELS: Record<string, { label: string; color: string }> = {
  prometheus: { label: 'Prometheus', color: 'var(--color-acc)' },
  sentinel: { label: 'Sentinel', color: 'var(--color-saf)' },
  cassandra: { label: 'Cassandra', color: 'var(--color-skp)' },
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
  const [selectedPromptEntry, setSelectedPromptEntry] = useState<PromptCatalogEntry | null>(PROMPT_CATALOG[0]);
  const [promptInspectorActive, setPromptInspectorActive] = useState(false);
  const { toolbarPanel } = useTaxonomyStore();
  const { width, onMouseDown } = useResizablePanel();
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [listCollapsed, setListCollapsed] = useState(false);
  const [searchPreviewId, setSearchPreviewId] = useState<string | null>(null);

  // Custom sort order (persisted to localStorage)
  const [customOrder, setCustomOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('debate-custom-order');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const saveCustomOrder = useCallback((order: string[]) => {
    setCustomOrder(order);
    localStorage.setItem('debate-custom-order', JSON.stringify(order));
  }, []);

  // Apply custom ordering: custom-ordered IDs first (in order), then any new sessions not yet ordered
  const orderedSessions = useMemo(() => {
    if (customOrder.length === 0) return sessions;
    const orderMap = new Map(customOrder.map((id, i) => [id, i]));
    const ordered = [...sessions].sort((a, b) => {
      const ai = orderMap.get(a.id);
      const bi = orderMap.get(b.id);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return 0; // both unordered — keep server order
    });
    return ordered;
  }, [sessions, customOrder]);

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
    loadSessions();
  }, [loadSessions]);

  const handleSelect = (session: { id: string }) => {
    if (session.id !== activeDebateId) {
      loadDebate(session.id);
    }
  };

  const handleExport = async (format: string = 'json') => {
    if (!activeDebate) return;
    try {
      const result = await api.exportDebateToFile(activeDebate, format as 'json' | 'markdown' | 'text' | 'pdf' | 'package');
      if (!result.cancelled && result.filePath) {
        setExportStatus(`Exported to ${result.filePath}`);
        setTimeout(() => setExportStatus(null), 4000);
      }
    } catch (err) {
      setExportStatus(`Export failed: ${err}`);
      setTimeout(() => setExportStatus(null), 4000);
    }
  };

  return (
    <div className="two-column">
      {/* Left pane: Session list OR toolbar panel (Search, Prompts, etc.) */}
      {toolbarPanel ? (
        <div className={`list-panel${(toolbarPanel === 'console' || toolbarPanel === 'edges' || toolbarPanel === 'policyAlignment' || toolbarPanel === 'policyDashboard' || toolbarPanel === 'vocabulary' || (toolbarPanel === 'prompts' && promptInspectorActive)) ? ' list-panel-full' : ''}`} style={(toolbarPanel === 'console' || toolbarPanel === 'edges' || toolbarPanel === 'policyAlignment' || toolbarPanel === 'policyDashboard' || toolbarPanel === 'vocabulary' || (toolbarPanel === 'prompts' && promptInspectorActive)) ? undefined : { width }}>
          {toolbarPanel === 'search' && <SearchPanel onSelectResult={(id) => setSearchPreviewId(id)} />}
          {toolbarPanel === 'prompts' && <PromptsPanel onSelectPrompt={setSelectedPromptEntry} onInspectorToggle={setPromptInspectorActive} />}
          {toolbarPanel === 'fallacy' && <FallacyPanel onSelectFallacy={() => {}} />}
          {toolbarPanel === 'edges' && <EdgeBrowser />}
          {toolbarPanel === 'console' && <TerminalPanel />}
          {toolbarPanel === 'policyAlignment' && <PolicyAlignmentPanel />}
          {toolbarPanel === 'policyDashboard' && <PolicyDashboard />}
          {toolbarPanel === 'vocabulary' && <VocabularyPanel />}
          {!['search', 'prompts', 'fallacy', 'edges', 'console', 'policyAlignment', 'policyDashboard', 'vocabulary'].includes(toolbarPanel) && (
            <div style={{ padding: 16, color: 'var(--text-muted)' }}>Panel: {toolbarPanel}</div>
          )}
        </div>
      ) : listCollapsed ? (
        <div className="pane-collapsed pane-collapsed-list" onClick={() => setListCollapsed(false)} title="Expand list">
          <span className="pane-collapsed-label">Debates</span>
        </div>
      ) : (
        <div className="list-panel debate-session-list" style={{ width }}>
          <div className="list-panel-header">
            <h2>Debates</h2>
            <div className="list-panel-header-actions">
              {editMode ? (
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
              ) : (
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
              )}
            </div>
          </div>
          <div className="list-panel-items">
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
            {orderedSessions.map((s, idx) => (
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
                    onChange={() => {}} // handled by parent onClick
                    onClick={e => e.stopPropagation()}
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
                        renameDebate(s.id, renameValue.trim());
                        setRenamingId(null);
                      } else if (e.key === 'Escape') {
                        setRenamingId(null);
                      }
                    }}
                    onBlur={() => {
                      if (renameValue.trim() && renameValue.trim() !== s.title) {
                        renameDebate(s.id, renameValue.trim());
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
                      disabled={idx === orderedSessions.length - 1}
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
        </div>
      )}

      {toolbarPanel === 'search' && (
        <>
          <div className="resize-handle" onMouseDown={onMouseDown} />
          <div className="detail-panel">
            {!searchPreviewId
              ? <div className="detail-panel-empty">Select a search result to preview</div>
              : <div className="detail-panel-empty">Node preview: {searchPreviewId}</div>
            }
          </div>
        </>
      )}

      {toolbarPanel === 'prompts' && !promptInspectorActive && (
        <>
          <div className="resize-handle" onMouseDown={onMouseDown} />
          <div className="detail-panel">
            <PromptDetailPanel entry={selectedPromptEntry} />
          </div>
        </>
      )}

      {!toolbarPanel && (
        <>
          <div className="resize-handle" onMouseDown={onMouseDown} />
          <div className="detail-panel">
            {activeDebate ? (
              <DebateDetailSummary
                debate={activeDebate}
                onOpenWindow={() => api.openDebateWindow(activeDebate.id).catch(() => {})}
                onExport={handleExport}
                exportStatus={exportStatus}
              />
            ) : (
              <div className="debate-empty-state">
                <h2>POV Debater</h2>
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
  const topic = debate.topic.final || debate.topic.refined || debate.topic.original;
  const turnCount = debate.transcript?.length ?? 0;
  const anNodeCount = debate.argument_network?.nodes?.length ?? 0;
  const anEdgeCount = debate.argument_network?.edges?.length ?? 0;

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
        <button className="btn" onClick={() => setShowCalibration(!showCalibration)}>
          Calibration
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

