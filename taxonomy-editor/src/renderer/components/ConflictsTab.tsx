// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useRef, useMemo } from 'react';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { useResizablePanel } from '../hooks/useResizablePanel';
import { ConflictDetail } from './ConflictDetail';
import { PinnedPanel } from './PinnedPanel';

export function ConflictsTab() {
  const { conflicts, selectedNodeId, setSelectedNodeId, createConflict, pinnedStack, pinAtDepth } = useTaxonomyStore();
  const [showNew, setShowNew] = useState(false);
  const [newLabel, setNewLabel] = useState('');
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

  return (
    <div className="two-column">
      <div className="list-panel" style={{ width }}>
        <div className="list-panel-header">
          <h2>Conflicts</h2>
          <button className="btn btn-sm" onClick={() => setShowNew(true)}>
            + New
          </button>
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
      <div className="resize-handle" onMouseDown={onMouseDown} />
      <div className="detail-panel">
        {selectedConflict ? (
          <ConflictDetail conflict={selectedConflict} onPin={handlePin} />
        ) : (
          <div className="detail-panel-empty">Select a conflict to edit</div>
        )}
      </div>
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
