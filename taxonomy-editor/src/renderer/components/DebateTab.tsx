// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useState } from 'react';
import { useDebateStore } from '../hooks/useDebateStore';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { useResizablePanel, useResizableRightPanel } from '../hooks/useResizablePanel';
import { NewDebateDialog } from './NewDebateDialog';
import { DebateWorkspace } from './DebateWorkspace';
import { NodeDetail } from './NodeDetail';
import { CrossCuttingDetail } from './CrossCuttingDetail';
import { AttributeInfoPanel } from './AttributeInfoPanel';
import { AttributeFilterPanel } from './AttributeFilterPanel';
import { DebateSourceViewer } from './DebateSourceViewer';
import type { DebateSessionSummary } from '../types/debate';
import type { Pov } from '../types/taxonomy';

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

  if (nodeId.startsWith('cc-')) {
    const node = state.crossCutting?.nodes?.find((n: { id: string }) => n.id === nodeId);
    return node ? { kind: 'crossCutting' as const, node } : null;
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
    activeDebateId, activeDebate, loadDebate, deleteDebate,
    inspectedNodeId, inspectNode,
  } = useDebateStore();
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const { attributeInfo, attributeFilter } = useTaxonomyStore();
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
  const [listCollapsed, setListCollapsed] = useState(false);
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [inspectCollapsed, setInspectCollapsed] = useState(false);
  const [pane4Collapsed, setPane4Collapsed] = useState(false);

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

  const handleExport = async () => {
    if (!activeDebate) return;
    try {
      const result = await window.electronAPI.exportDebateToFile(activeDebate);
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
      {/* Left pane: Session list */}
      {listCollapsed ? (
        <div className="pane-collapsed pane-collapsed-list" onClick={() => setListCollapsed(false)} title="Expand list">
          <span className="pane-collapsed-label">Debates</span>
        </div>
      ) : (
        <div className="list-panel debate-session-list" style={{ width }}>
          <div className="list-panel-header">
            <h2>Debates</h2>
            <div className="list-panel-header-actions">
              <button className="btn btn-sm" onClick={() => setShowNewDialog(true)}>
                + New
              </button>
              <button className="pane-collapse-btn" onClick={() => setListCollapsed(true)} title="Collapse">&lsaquo;</button>
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
                className={`debate-session-item ${s.id === activeDebateId ? 'selected' : ''}`}
                onClick={() => handleSelect(s)}
              >
                <div className="debate-session-item-title">{s.title}</div>
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

      <div className="resize-handle" onMouseDown={onMouseDown} />

      {/* For document/URL debates: Pane 2 = source content, Pane 3 = workspace */}
      {activeDebate && activeDebate.source_type !== 'topic' ? (
        <>
          {/* Pane 2: Document/URL content */}
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
            </div>
            <div className="debate-source-body">
              <DebateSourceViewer
                content={activeDebate.source_content}
                sourceType={activeDebate.source_type as 'document' | 'url'}
                sourceRef={activeDebate.source_ref}
              />
            </div>
          </div>
          <div className="resize-handle" onMouseDown={onPane3MouseDown} />
          {/* Pane 3: Debate workspace */}
          <div className="detail-panel debate-workspace-container" style={{ width: pane3Width, minWidth: pane3Width }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              {exportStatus && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{exportStatus}</span>
              )}
              <button className="btn btn-sm" onClick={handleExport} title="Export debate">Export</button>
            </div>
            <DebateWorkspace />
          </div>
        </>
      ) : (
        <>
          {/* Topic debate: Pane 2 = workspace (original layout) */}
          {detailCollapsed ? (
            <div className="pane-collapsed pane-collapsed-detail" onClick={() => setDetailCollapsed(false)} title="Expand workspace">
              <span className="pane-collapsed-label">Workspace</span>
            </div>
          ) : (
            <div className="detail-panel debate-workspace-container">
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                {exportStatus && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{exportStatus}</span>
                )}
                {activeDebateId && (
                  <button className="btn btn-sm" onClick={handleExport} title="Export debate to a JSON file">
                    Export
                  </button>
                )}
                <button className="pane-collapse-btn" onClick={() => setDetailCollapsed(true)} title="Collapse">&lsaquo;</button>
              </div>
              {activeDebateId ? (
                <DebateWorkspace />
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
                {resolved.kind === 'crossCutting' ? (
                  <CrossCuttingDetail node={resolved.node} readOnly />
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

      {showNewDialog && (
        <NewDebateDialog onClose={() => setShowNewDialog(false)} />
      )}
    </div>
  );
}
