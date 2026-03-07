// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useMemo } from 'react';
import { useStore } from '../store/useStore';

function povLabel(pov: string): string {
  return pov.charAt(0).toUpperCase() + pov.slice(1);
}

function povClass(pov: string): string {
  return `pov-${pov.replace('-', '')}`;
}

export default function EdgeDetail() {
  const selectedEdgeIndex = useStore((s) => s.selectedEdgeIndex);
  const indexedEdges = useStore((s) => s.indexedEdges);
  const nodeMap = useStore((s) => s.nodeMap);
  const updateEdgeStatus = useStore((s) => s.updateEdgeStatus);
  const selectEdge = useStore((s) => s.selectEdge);
  const filteredEdges = useStore((s) => s.filteredEdges);

  const edge = useMemo(() => {
    if (selectedEdgeIndex === null) return null;
    return indexedEdges.find((e) => e.index === selectedEdgeIndex) || null;
  }, [selectedEdgeIndex, indexedEdges]);

  const currentFilteredIdx = useMemo(() => {
    if (selectedEdgeIndex === null) return -1;
    return filteredEdges.findIndex((e) => e.index === selectedEdgeIndex);
  }, [selectedEdgeIndex, filteredEdges]);

  const navigatePrev = () => {
    if (currentFilteredIdx > 0) {
      selectEdge(filteredEdges[currentFilteredIdx - 1].index);
    }
  };
  const navigateNext = () => {
    if (currentFilteredIdx < filteredEdges.length - 1) {
      selectEdge(filteredEdges[currentFilteredIdx + 1].index);
    }
  };

  if (!edge) {
    return (
      <div className="detail-panel">
        <div className="empty-state">Select an edge to view details</div>
      </div>
    );
  }

  const sourceNode = nodeMap[edge.source];
  const targetNode = nodeMap[edge.target];

  return (
    <div className="detail-panel">
      <div className="detail-nav">
        <button
          className="nav-btn"
          onClick={navigatePrev}
          disabled={currentFilteredIdx <= 0}
        >
          Prev
        </button>
        <span className="nav-position">
          {currentFilteredIdx + 1} / {filteredEdges.length}
        </span>
        <button
          className="nav-btn"
          onClick={navigateNext}
          disabled={currentFilteredIdx >= filteredEdges.length - 1}
        >
          Next
        </button>
      </div>

      <div className="detail-edge-type">
        <span className={`edge-type-badge type-${edge.type.toLowerCase().replace('_', '-')}`}>
          {edge.type.replace('_', ' ')}
        </span>
        <span className={`status-badge ${edge.status}`}>{edge.status}</span>
        {edge.bidirectional && <span className="bidi-badge">bidirectional</span>}
      </div>

      <div className="detail-connection">
        <div className={`detail-node source ${povClass(edge.sourcePov)}`}>
          <div className="node-pov">{povLabel(edge.sourcePov)}</div>
          <div className="node-id">{edge.source}</div>
          <div className="node-label">{edge.sourceLabel}</div>
          {sourceNode?.description && (
            <div className="node-desc resizable-box">{sourceNode.description}</div>
          )}
          {sourceNode?.category && (
            <div className="node-category">{sourceNode.category}</div>
          )}
        </div>

        <div className="connection-arrow">
          {edge.bidirectional ? '<--->' : '--->'}
        </div>

        <div className={`detail-node target ${povClass(edge.targetPov)}`}>
          <div className="node-pov">{povLabel(edge.targetPov)}</div>
          <div className="node-id">{edge.target}</div>
          <div className="node-label">{edge.targetLabel}</div>
          {targetNode?.description && (
            <div className="node-desc resizable-box">{targetNode.description}</div>
          )}
          {targetNode?.category && (
            <div className="node-category">{targetNode.category}</div>
          )}
        </div>
      </div>

      <div className="detail-meta-grid">
        <div className="meta-item">
          <span className="meta-label">Confidence</span>
          <span className="meta-value">
            <span className="confidence-bar-large">
              <span
                className="confidence-fill"
                style={{ width: `${edge.confidence * 100}%` }}
              />
            </span>
            {(edge.confidence * 100).toFixed(0)}%
          </span>
        </div>
        {edge.strength && (
          <div className="meta-item">
            <span className="meta-label">Strength</span>
            <span className={`meta-value strength-${edge.strength}`}>{edge.strength}</span>
          </div>
        )}
        <div className="meta-item">
          <span className="meta-label">Discovered</span>
          <span className="meta-value">{edge.discovered_at}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Model</span>
          <span className="meta-value">{edge.model}</span>
        </div>
      </div>

      <div className="detail-rationale resizable-box">
        <h3>Rationale</h3>
        <p>{edge.rationale}</p>
      </div>

      {edge.notes && (
        <div className="detail-notes resizable-box">
          <h3>Notes</h3>
          <p>{edge.notes}</p>
        </div>
      )}

      <div className="detail-actions">
        <button
          className="action-btn approve"
          onClick={() => updateEdgeStatus(edge.index, 'approved')}
          disabled={edge.status === 'approved'}
        >
          Approve
        </button>
        <button
          className="action-btn reject"
          onClick={() => updateEdgeStatus(edge.index, 'rejected')}
          disabled={edge.status === 'rejected'}
        >
          Reject
        </button>
        {edge.status !== 'proposed' && (
          <button
            className="action-btn reset"
            onClick={() => updateEdgeStatus(edge.index, 'proposed')}
          >
            Reset to Proposed
          </button>
        )}
      </div>
    </div>
  );
}
