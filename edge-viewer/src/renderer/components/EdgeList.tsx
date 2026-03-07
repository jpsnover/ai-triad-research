// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useCallback } from 'react';
import { useStore } from '../store/useStore';
import type { IndexedEdge } from '../types/types';

function povClass(pov: string): string {
  return `pov-${pov.replace('-', '')}`;
}

function EdgeRow({ edge, isSelected }: { edge: IndexedEdge; isSelected: boolean }) {
  const selectEdge = useStore((s) => s.selectEdge);
  const updateEdgeStatus = useStore((s) => s.updateEdgeStatus);

  const handleClick = useCallback(() => {
    selectEdge(edge.index);
  }, [selectEdge, edge.index]);

  const handleApprove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      updateEdgeStatus(edge.index, 'approved');
    },
    [updateEdgeStatus, edge.index]
  );

  const handleReject = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      updateEdgeStatus(edge.index, 'rejected');
    },
    [updateEdgeStatus, edge.index]
  );

  return (
    <div
      className={`edge-row ${isSelected ? 'selected' : ''} status-${edge.status}`}
      onClick={handleClick}
    >
      <div className="edge-row-main">
        <span className={`edge-source ${povClass(edge.sourcePov)}`}>
          {edge.source}
        </span>
        <span className={`edge-type-label type-${edge.type.toLowerCase().replace('_', '-')}`}>
          {edge.type.replace('_', ' ')}
        </span>
        <span className={`edge-target ${povClass(edge.targetPov)}`}>
          {edge.target}
        </span>
      </div>
      <div className="edge-row-meta">
        <span className="confidence-indicator" title={`Confidence: ${edge.confidence}`}>
          <span
            className="confidence-fill"
            style={{ width: `${edge.confidence * 100}%` }}
          />
        </span>
        <span className={`status-dot ${edge.status}`} title={edge.status} />
        {edge.status === 'proposed' && (
          <span className="row-actions">
            <button className="row-btn approve" onClick={handleApprove} title="Approve">
              +
            </button>
            <button className="row-btn reject" onClick={handleReject} title="Reject">
              -
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

export default function EdgeList() {
  const filteredEdges = useStore((s) => s.filteredEdges);
  const selectedEdgeIndex = useStore((s) => s.selectedEdgeIndex);

  return (
    <div className="edge-list-panel">
      <div className="edge-list-scroll">
        {filteredEdges.map((edge) => (
          <EdgeRow
            key={edge.index}
            edge={edge}
            isSelected={edge.index === selectedEdgeIndex}
          />
        ))}
        {filteredEdges.length === 0 && (
          <div className="empty-state">No edges match current filters</div>
        )}
      </div>
    </div>
  );
}
