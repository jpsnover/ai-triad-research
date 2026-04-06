// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useRef, useMemo } from 'react';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { useResizablePanel } from '../hooks/useResizablePanel';
import { ConflictDetail } from './ConflictDetail';
import { PinnedPanel } from './PinnedPanel';
import { LineagePanel } from './LineagePanel';
import { EdgeBrowser } from './EdgeBrowser';
import { PolicyAlignmentPanel } from './PolicyAlignmentPanel';
import { PolicyDashboard } from './PolicyDashboard';
import { TerminalPanel } from './TerminalPanel';
import { SearchPanel } from './SearchPanel';
import { FallacyPanel } from './FallacyPanel';

export function ConflictsTab() {
  const { conflicts, selectedNodeId, setSelectedNodeId, createConflict, pinnedStack, pinAtDepth, toolbarPanel } = useTaxonomyStore();
  const [showNew, setShowNew] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [listCollapsed, setListCollapsed] = useState(false);
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const { width, onMouseDown } = useResizablePanel();

  const orderedIds = useMemo(
    () => conflicts.map(c => c.claim_id),
    [conflicts],
  );
  useKeyboardNav(orderedIds, selectedNodeId, setSelectedNodeId);

  // Auto-select first conflict when tab loads
  useEffect(() => {
    if (!selectedNodeId && orderedIds.length > 0) {
      setSelectedNodeId(orderedIds[0]);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedConflict = conflicts.find(c => c.claim_id === selectedNodeId) || null;

  const handleCreate = () => {
    if (newLabel.trim()) {
      createConflict(newLabel.trim());
      setNewLabel('');
      setShowNew(false);
    }
  };

  const handlePin = () => {
    if (selectedConflict) {
      pinAtDepth(0, {
        type: 'conflict',
        conflict: structuredClone(selectedConflict),
      });
    }
  };

  const isFullWidthPanel = toolbarPanel === 'edges' || toolbarPanel === 'policyAlignment' || toolbarPanel === 'policyDashboard' || toolbarPanel === 'console';

  const renderToolbarPane = () => {
    switch (toolbarPanel) {
      case 'search': return <SearchPanel onSelectResult={() => {}} />;
      case 'lineage': return <LineagePanel onSelectValue={() => {}} />;
      case 'fallacy': return <FallacyPanel onSelectFallacy={() => {}} />;
      case 'edges': return <EdgeBrowser />;
      case 'policyAlignment': return <PolicyAlignmentPanel />;
      case 'policyDashboard': return <PolicyDashboard />;
      case 'console': return <TerminalPanel />;
      default: return null;
    }
  };

  return (
    <div className="two-column">
      {isFullWidthPanel ? (
        <div className="list-panel list-panel-full">
          {renderToolbarPane()}
        </div>
      ) : toolbarPanel ? (
        <div className="list-panel" style={{ width }}>
          {renderToolbarPane()}
        </div>
      ) : listCollapsed ? (
        <div className="pane-collapsed pane-collapsed-list" onClick={() => setListCollapsed(false)} title="Expand list">
          <span className="pane-collapsed-label">Conflicts</span>
        </div>
      ) : (
        <div className="list-panel" style={{ width }}>
          <div className="list-panel-header">
            <h2>Conflicts</h2>
            <div className="list-panel-header-actions">
              <button className="btn btn-sm" onClick={() => setShowNew(true)}>
                + New
              </button>
              <button className="pane-collapse-btn" onClick={() => setListCollapsed(true)} title="Collapse">&lsaquo;</button>
            </div>
          </div>
          <div className="list-panel-items">
            {conflicts.map((conflict) => (
              <ConflictListItem
                key={conflict.claim_id}
                claimId={conflict.claim_id}
                label={conflict.claim_label}
                status={conflict.status}
                isSelected={selectedNodeId === conflict.claim_id}
                onSelect={setSelectedNodeId}
              />
            ))}
          </div>
        </div>
      )}
      {!isFullWidthPanel && (
        <div className="resize-handle" onMouseDown={onMouseDown} />
      )}
      {isFullWidthPanel ? null : detailCollapsed ? (
        <div className="pane-collapsed pane-collapsed-detail" onClick={() => setDetailCollapsed(false)} title="Expand detail">
          <span className="pane-collapsed-label">Detail</span>
        </div>
      ) : (
        <div className="detail-panel">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
            <button className="pane-collapse-btn" onClick={() => setDetailCollapsed(true)} title="Collapse">&lsaquo;</button>
          </div>
          {selectedConflict ? (
            <ConflictDetail conflict={selectedConflict} onPin={handlePin} />
          ) : (
            <div className="detail-panel-empty">Select a conflict to edit</div>
          )}
        </div>
      )}
      {pinnedStack.length > 0 && <PinnedPanel />}

      {showNew && (
        <div className="dialog-overlay" onClick={() => setShowNew(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>New Conflict</h3>
            <div className="form-group">
              <label>Claim Label</label>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g., AGI Timeline Estimates"
                autoFocus
              />
            </div>
            <div className="dialog-actions">
              <button className="btn" onClick={() => setShowNew(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={!newLabel.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConflictListItem({ claimId, label, status, isSelected, onSelect }: {
  claimId: string;
  label: string;
  status: string;
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isSelected && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest' });
    }
  }, [isSelected]);

  return (
    <div
      ref={ref}
      className={`node-item ${isSelected ? 'selected' : ''}`}
      onClick={() => onSelect(claimId)}
    >
      <div>{label || '(untitled)'}</div>
      <div className="node-item-id">
        {claimId}
        <span style={{ marginLeft: 8, color: status === 'open' ? 'var(--color-skp)' : 'var(--text-muted)' }}>
          [{status}]
        </span>
      </div>
    </div>
  );
}
