// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useState } from 'react';
import { useDebateStore } from '../hooks/useDebateStore';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { useResizablePanel, useResizableRightPanel } from '../hooks/useResizablePanel';
import { NewDebateDialog } from './NewDebateDialog';
import { DebateWorkspace } from './DebateWorkspace';
import { NodeDetail } from './NodeDetail';
import { SituationDetail } from './SituationDetail';
import { AttributeInfoPanel } from './AttributeInfoPanel';
import { AttributeFilterPanel } from './AttributeFilterPanel';
import { DebateSourceViewer } from './DebateSourceViewer';
import { SearchPanel } from './SearchPanel';
import { PromptsPanel, PromptDetailPanel } from './PromptsPanel';
import type { PromptCatalogEntry } from '../data/promptCatalog';
import { PROMPT_CATALOG } from '../data/promptCatalog';
import { FallacyPanel } from './FallacyPanel';
import { EdgeBrowser } from './EdgeBrowser';
import { TerminalPanel } from './TerminalPanel';
import { PolicyAlignmentPanel } from './PolicyAlignmentPanel';
import { PolicyDashboard } from './PolicyDashboard';
import type { DebateSessionSummary } from '../types/debate';
import type { Pov } from '../types/taxonomy';
import { nodeTypeFromId } from '@lib/debate';
import { api } from '@bridge';

const PHASE_LABELS: Record<string, string> = {
  setup: 'Setup',
  clarification: 'Refining',
  opening: 'Opening',
  debate: 'Active',
  closed: 'Closed',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Resolve a node_id to its POV + node data from the taxonomy store */
function resolveNode(nodeId: string) {
  const state = useTaxonomyStore.getState();

  if (nodeTypeFromId(nodeId) === 'situation') {
    const node = state.situations?.nodes?.find((n: { id: string }) => n.id === nodeId);
    return node ? { kind: 'situation' as const, node } : null;
  }

  if (nodeId.startsWith('pol-')) {
    const entry = state.policyRegistry?.find(p => p.id === nodeId);
    if (entry) return { kind: 'policy' as const, node: { id: entry.id, label: entry.action, description: entry.action, source_povs: entry.source_povs, member_count: entry.member_count } };
    return null;
  }

  const povMap: Record<string, Pov> = { 'acc-': 'accelerationist', 'saf-': 'safetyist', 'skp-': 'skeptic' };
  for (const [prefix, pov] of Object.entries(povMap)) {
    if (nodeId.startsWith(prefix)) {
      const povFile = state[pov];
      const node = povFile?.nodes?.find((n: { id: string }) => n.id === nodeId);
      return node ? { kind: 'pov' as const, pov, node } : null;
    }
  }
  return null;
}

export function DebateTab() {
  const {
    sessions, sessionsLoading, loadSessions,
    activeDebateId, activeDebate, loadDebate, deleteDebate, renameDebate,
    inspectedNodeId, inspectNode,
  } = useDebateStore();
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [selectedPromptEntry, setSelectedPromptEntry] = useState<PromptCatalogEntry | null>(PROMPT_CATALOG[0]);
  const [promptInspectorActive, setPromptInspectorActive] = useState(false);
  const { attributeInfo, attributeFilter, toolbarPanel } = useTaxonomyStore();
  const { width, onMouseDown } = useResizablePanel();
  const { width: pane3Width, onMouseDown: onPane3MouseDown } = useResizableRightPanel({
    storageKey: 'debate-inspect-panel-width',
    defaultWidth: 360,
    minWidth: 260,
    maxWidth: 600,
  });
  const { width: pane4Width, onMouseDown: onPane4MouseDown } = useResizableRightPanel({
    storageKey: 'debate-pane4-width',
    defaultWidth: 400,
    minWidth: 300,
    maxWidth: 700,
  });
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Bulk delete selection mode (BD-1)
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [listCollapsed, setListCollapsed] = useState(false);
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [sourceCollapsed, setSourceCollapsed] = useState(false);
  const [inspectCollapsed, setInspectCollapsed] = useState(false);
  const [pane4Collapsed, setPane4Collapsed] = useState(false);
  const [searchPreviewId, setSearchPreviewId] = useState<string | null>(null);

  const renderSearchPreview = () => {
    if (!searchPreviewId) return <div className="detail-panel-empty">Select a search result to preview</div>;
    const resolved = resolveNode(searchPreviewId);
    if (!resolved) return <div className="detail-panel-empty">Node not found</div>;
    if (resolved.kind === 'situation') {
      return <SituationDetail node={resolved.node} readOnly chipDepth={0} />;
    }
    return <NodeDetail pov={resolved.pov} node={resolved.node} readOnly chipDepth={0} />;
  };

  const showInfoPanel = attributeInfo !== null;
  const showAttrFilterPanel = attributeFilter !== null;
  const showPane4 = inspectedNodeId && (showInfoPanel || showAttrFilterPanel);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleSelect = (session: DebateSessionSummary) => {
    if (session.id !== activeDebateId) {
      loadDebate(session.id);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteDebate(id);
    setConfirmDeleteId(null);
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
        <div className={`list-panel${(toolbarPanel === 'console' || toolbarPanel === 'edges' || toolbarPanel === 'policyAlignment' || toolbarPanel === 'policyDashboard' || (toolbarPanel === 'prompts' && promptInspectorActive)) ? ' list-panel-full' : ''}`} style={(toolbarPanel === 'console' || toolbarPanel === 'edges' || toolbarPanel === 'policyAlignment' || toolbarPanel === 'policyDashboard' || (toolbarPanel === 'prompts' && promptInspectorActive)) ? undefined : { width }}>
          {toolbarPanel === 'search' && <SearchPanel onSelectResult={(id) => setSearchPreviewId(id)} />}
          {toolbarPanel === 'prompts' && <PromptsPanel onSelectPrompt={setSelectedPromptEntry} onInspectorToggle={setPromptInspectorActive} />}
          {toolbarPanel === 'fallacy' && <FallacyPanel onSelectFallacy={() => {}} />}
          {toolbarPanel === 'edges' && <EdgeBrowser />}
          {toolbarPanel === 'console' && <TerminalPanel />}
          {toolbarPanel === 'policyAlignment' && <PolicyAlignmentPanel />}
          {toolbarPanel === 'policyDashboard' && <PolicyDashboard />}
          {!['search', 'prompts', 'fallacy', 'edges', 'console', 'policyAlignment', 'policyDashboard'].includes(toolbarPanel) && (
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
              {selectMode ? (
                <>
                  <button className="btn btn-sm" onClick={() => setSelectedIds(new Set(sessions.map(s => s.id)))}>All</button>
                  <button className="btn btn-sm" onClick={() => setSelectedIds(new Set())}>None</button>
                  {selectedIds.size > 0 && (
                    <button className="btn btn-sm btn-danger" onClick={() => setShowBulkDeleteConfirm(true)}>
                      Delete {selectedIds.size}
                    </button>
                  )}
                  <button className="btn btn-sm btn-ghost" onClick={() => { setSelectMode(false); setSelectedIds(new Set()); }}>Done</button>
                </>
              ) : (
                <>
                  {sessions.length > 0 && (
                    <button className="btn btn-sm btn-ghost" onClick={() => setSelectMode(true)} title="Select debates for bulk delete">
                      Select
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
            {sessions.map((s) => (
              <div
                key={s.id}
                className={`debate-session-item ${s.id === activeDebateId ? 'selected' : ''}${selectMode && selectedIds.has(s.id) ? ' bulk-selected' : ''}`}
                onClick={selectMode ? () => setSelectedIds(prev => {
                  const next = new Set(prev);
                  next.has(s.id) ? next.delete(s.id) : next.add(s.id);
                  return next;
                }) : () => handleSelect(s)}
              >
                {selectMode && (
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
                    onDoubleClick={(e) => { e.stopPropagation(); setRenamingId(s.id); setRenameValue(s.title); }}
                    title="Double-click to rename"
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
                {confirmDeleteId === s.id ? (
                  <div className="debate-session-item-confirm">
                    <span>Delete?</span>
                    <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}>Yes</button>
                    <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}>No</button>
                  </div>
                ) : (
                  <button
                    className="debate-session-item-delete"
                    title="Delete debate"
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(s.id); }}
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
            {renderSearchPreview()}
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

          {/* Pane 2 / 3: Debate workspace (layout depends on source type) */}
          {activeDebate && activeDebate.source_type !== 'topic' && activeDebate.source_type !== 'situations' ? (
            <>
              {/* Pane 2: Document/URL content (collapsible) */}
              {sourceCollapsed ? (
                <div className="pane-collapsed pane-collapsed-detail" onClick={() => setSourceCollapsed(false)} title="Expand source document">
                  <span className="pane-collapsed-label">
                    {activeDebate.source_type === 'document' ? 'Document' : 'Web Content'}
                  </span>
                </div>
              ) : (
                <div className="detail-panel debate-source-panel">
                  <div className="debate-source-header">
                    <span className="debate-source-title">
                      {activeDebate.source_type === 'document' ? 'Document' : 'Web Content'}
                    </span>
                    {activeDebate.source_ref && (
                      <span className="debate-source-ref" title={activeDebate.source_ref}>
                        {activeDebate.source_type === 'document'
                          ? activeDebate.source_ref.split('/').pop()
                          : activeDebate.source_ref}
                      </span>
                    )}
                    <button className="pane-collapse-btn" onClick={() => setSourceCollapsed(true)} title="Collapse source">&lsaquo;</button>
                  </div>
                  <div className="debate-source-body">
                    <DebateSourceViewer
                      content={activeDebate.source_content}
                      sourceType={activeDebate.source_type as 'document' | 'url'}
                      sourceRef={activeDebate.source_ref}
                    />
                  </div>
                </div>
              )}
              <div className="resize-handle" onMouseDown={onPane3MouseDown} />
              {/* Pane 3: Debate workspace */}
              <div className="detail-panel debate-workspace-container" style={{ width: pane3Width, minWidth: pane3Width }}>
                <DebateWorkspace onExport={handleExport} exportStatus={exportStatus} />
              </div>
            </>
          ) : activeDebate && activeDebate.source_type === 'situations' ? (
            <>
              {/* Cross-cutting debate: workspace directly in Pane 2 (context via Details button) */}
              {detailCollapsed ? (
                <div className="pane-collapsed pane-collapsed-detail" onClick={() => setDetailCollapsed(false)} title="Expand workspace">
                  <span className="pane-collapsed-label">Workspace</span>
                </div>
              ) : (
                <div className="detail-panel debate-workspace-container">
                  <DebateWorkspace onExport={handleExport} exportStatus={exportStatus} />
                </div>
              )}
            </>
          ) : (
            <>
              {/* Topic debate: Pane 2 = workspace */}
              {detailCollapsed ? (
                <div className="pane-collapsed pane-collapsed-detail" onClick={() => setDetailCollapsed(false)} title="Expand workspace">
                  <span className="pane-collapsed-label">Workspace</span>
                </div>
              ) : (
                <div className="detail-panel debate-workspace-container">
                  {activeDebateId ? (
                    <DebateWorkspace onExport={handleExport} exportStatus={exportStatus} />
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
              )}
            </>
          )}

          {/* Node inspector (shown when a taxonomy pill is clicked) */}
          {inspectedNodeId && (() => {
            const resolved = resolveNode(inspectedNodeId);
            if (!resolved) return null;
            if (inspectCollapsed) {
              return (
                <>
                  <div className="resize-handle" onMouseDown={onPane3MouseDown} />
                  <div className="pane-collapsed" onClick={() => setInspectCollapsed(false)} title="Expand inspector">
                    <span className="pane-collapsed-label">Inspector</span>
                  </div>
                </>
              );
            }
            return (
              <>
                <div className="resize-handle" onMouseDown={onPane3MouseDown} />
                <div className="detail-panel debate-inspect-panel" style={{ width: pane3Width, minWidth: pane3Width }}>
                  <div className="debate-inspect-header">
                    <span className="debate-inspect-title">{resolved.node.label}</span>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <button className="pane-collapse-btn" onClick={() => setInspectCollapsed(true)} title="Collapse">&lsaquo;</button>
                      <button
                        className="debate-inspect-close"
                        onClick={() => inspectNode(null)}
                        title="Close inspector"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <div className="debate-inspect-body">
                    {resolved.kind === 'situation' ? (
                      <SituationDetail node={resolved.node} readOnly />
                    ) : resolved.kind === 'policy' ? (
                      <div style={{ padding: 16, fontSize: '0.85rem' }}>
                        <div style={{ fontWeight: 700, marginBottom: 8, color: 'var(--color-sit)' }}>{resolved.node.id}</div>
                        <div style={{ marginBottom: 12 }}>{resolved.node.label}</div>
                        {resolved.node.source_povs?.length > 0 && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            Source POVs: {resolved.node.source_povs.join(', ')}
                          </div>
                        )}
                        {resolved.node.member_count > 0 && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                            Referenced by {resolved.node.member_count} taxonomy node{resolved.node.member_count !== 1 ? 's' : ''}
                          </div>
                        )}
                      </div>
                    ) : (
                      <NodeDetail pov={resolved.pov} node={resolved.node} readOnly />
                    )}
                  </div>
                </div>
              </>
            );
          })()}

          {/* Pane 4: Attribute Info / Filter (shown when triggered from Pane 3) */}
          {showPane4 && (() => {
            if (pane4Collapsed) {
              return (
                <>
                  <div className="resize-handle" onMouseDown={onPane4MouseDown} />
                  <div className="pane-collapsed" onClick={() => setPane4Collapsed(false)} title="Expand">
                    <span className="pane-collapsed-label">{showAttrFilterPanel ? 'Filter' : 'Info'}</span>
                  </div>
                </>
              );
            }
            return (
              <>
                <div className="resize-handle" onMouseDown={onPane4MouseDown} />
                {showAttrFilterPanel ? (
                  <AttributeFilterPanel width={pane4Width} />
                ) : showInfoPanel ? (
                  <AttributeInfoPanel width={pane4Width} />
                ) : null}
              </>
            );
          })()}
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
                  <span className="bulk-delete-item-meta">{s.phase} &middot; {s.turn_count ?? '?'} turns</span>
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
                  setSelectMode(false);
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
