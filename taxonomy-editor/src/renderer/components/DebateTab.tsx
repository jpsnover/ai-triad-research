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
    activeDebateId, loadDebate, deleteDebate,
    inspectedNodeId, inspectNode,
  } = useDebateStore();
  const { width, onMouseDown } = useResizablePanel();
  const { width: pane3Width, onMouseDown: onPane3MouseDown } = useResizableRightPanel({
    storageKey: 'debate-inspect-panel-width',
    defaultWidth: 360,
    minWidth: 260,
    maxWidth: 600,
  });
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

  return (
    <div className="two-column">
      {/* Left pane: Session list */}
      <div className="list-panel debate-session-list" style={{ width }}>
        <div className="list-panel-header">
          <h2>Debates</h2>
          <button className="btn btn-sm" onClick={() => setShowNewDialog(true)}>
            + New
          </button>
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

      <div className="resize-handle" onMouseDown={onMouseDown} />

      {/* Center pane: Debate workspace */}
      <div className="detail-panel debate-workspace-container">
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

      {/* Pane 3: Node inspector (shown when a taxonomy pill is clicked) */}
      {inspectedNodeId && (() => {
        const resolved = resolveNode(inspectedNodeId);
        if (!resolved) return null;
        return (
          <>
            <div className="resize-handle" onMouseDown={onPane3MouseDown} />
            <div className="detail-panel debate-inspect-panel" style={{ width: pane3Width, minWidth: pane3Width }}>
              <div className="debate-inspect-header">
                <span className="debate-inspect-title">{resolved.node.label}</span>
                <button
                  className="debate-inspect-close"
                  onClick={() => inspectNode(null)}
                  title="Close inspector"
                >
                  ×
                </button>
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

      {showNewDialog && (
        <NewDebateDialog onClose={() => setShowNewDialog(false)} />
      )}
    </div>
  );
}
