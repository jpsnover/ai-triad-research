import { useState, useEffect, useRef, useMemo } from 'react';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { ConflictDetail } from './ConflictDetail';
import { PinnedPanel } from './PinnedPanel';

export function ConflictsTab() {
  const { conflicts, selectedNodeId, setSelectedNodeId, createConflict, pinnedData, setPinnedData } = useTaxonomyStore();
  const [showNew, setShowNew] = useState(false);
  const [newLabel, setNewLabel] = useState('');

  const orderedIds = useMemo(
    () => conflicts.map(c => c.claim_id),
    [conflicts],
  );
  useKeyboardNav(orderedIds, selectedNodeId, setSelectedNodeId);

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
      setPinnedData({
        type: 'conflict',
        conflict: structuredClone(selectedConflict),
      });
    }
  };

  return (
    <div className="two-column">
      <div className="list-panel">
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
      <div className="detail-panel">
        {selectedConflict ? (
          <ConflictDetail conflict={selectedConflict} onPin={handlePin} />
        ) : (
          <div className="detail-panel-empty">Select a conflict to edit</div>
        )}
      </div>
      {pinnedData && <PinnedPanel />}

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
