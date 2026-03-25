// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState } from 'react';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';

interface EdgeDetailPanelProps {
  width?: number;
}

const POV_COLOR: Record<string, string> = {
  'acc-': 'var(--color-acc)',
  'saf-': 'var(--color-saf)',
  'skp-': 'var(--color-skp)',
  'cc-': 'var(--color-cc)',
};

function nodeColor(id: string): string {
  for (const [prefix, color] of Object.entries(POV_COLOR)) {
    if (id.startsWith(prefix)) return color;
  }
  return 'var(--text-muted)';
}

function povLabel(id: string): string {
  if (id.startsWith('acc-')) return 'Accelerationist';
  if (id.startsWith('saf-')) return 'Safetyist';
  if (id.startsWith('skp-')) return 'Skeptic';
  if (id.startsWith('cc-')) return 'Cross-Cutting';
  return 'Unknown';
}

export function EdgeDetailPanel({ width }: EdgeDetailPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [rationaleClamped, setRationaleClamped] = useState(true);
  const { selectedEdge, selectEdge, getLabelForId, edgesFile, setActiveTab, setSelectedNodeId, showRelatedEdges } = useTaxonomyStore();

  if (!selectedEdge) return null;

  if (collapsed) {
    return (
      <div className="pane-collapsed" onClick={() => setCollapsed(false)} title="Expand Edge Detail">
        <span className="pane-collapsed-label">Edge Detail</span>
      </div>
    );
  }

  const edge = selectedEdge;
  const sourceLabel = getLabelForId(edge.source);
  const targetLabel = getLabelForId(edge.target);
  const pct = Math.round(edge.confidence * 100);

  // Find the edge type definition
  const typeDef = edgesFile?.edge_types.find((t) => t.type === edge.type);

  const handleNavigate = (nodeId: string) => {
    let tab: 'accelerationist' | 'safetyist' | 'skeptic' | 'cross-cutting' = 'cross-cutting';
    if (nodeId.startsWith('acc-')) tab = 'accelerationist';
    else if (nodeId.startsWith('saf-')) tab = 'safetyist';
    else if (nodeId.startsWith('skp-')) tab = 'skeptic';
    setActiveTab(tab);
    setSelectedNodeId(nodeId);
    showRelatedEdges(nodeId);
  };

  return (
    <div className="edge-detail-panel" style={{ flex: 1, minWidth: 280 }}>
      <div className="edge-detail-header">
        <h3>Edge Detail</h3>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button className="pane-collapse-btn" onClick={() => setCollapsed(true)} title="Collapse">&lsaquo;</button>
          <button
            className="edge-detail-close"
            onClick={() => selectEdge(null)}
            title="Close"
          >
            &times;
          </button>
        </div>
      </div>

      <div className="edge-detail-body">
        {/* Edge type */}
        <div className="edge-detail-type-banner">
          <span className="edge-detail-type-name">{edge.type.replace(/_/g, ' ')}</span>
          {edge.bidirectional && <span className="edge-detail-bidir" title="Bidirectional">&harr;</span>}
        </div>
        {typeDef && (
          <div className="edge-detail-type-def">{typeDef.definition}</div>
        )}

        {/* Source → Target */}
        <div className="edge-detail-endpoints">
          <div className="edge-detail-endpoint">
            <div className="edge-detail-endpoint-role">Source</div>
            <div
              className="edge-detail-endpoint-id"
              style={{ color: nodeColor(edge.source) }}
              onClick={() => handleNavigate(edge.source)}
            >
              {edge.source}
            </div>
            <div className="edge-detail-endpoint-label">{sourceLabel}</div>
            <div className="edge-detail-endpoint-pov">{povLabel(edge.source)}</div>
          </div>

          <div className="edge-detail-arrow">
            {edge.bidirectional ? '\u2194' : '\u2192'}
          </div>

          <div className="edge-detail-endpoint">
            <div className="edge-detail-endpoint-role">Target</div>
            <div
              className="edge-detail-endpoint-id"
              style={{ color: nodeColor(edge.target) }}
              onClick={() => handleNavigate(edge.target)}
            >
              {edge.target}
            </div>
            <div className="edge-detail-endpoint-label">{targetLabel}</div>
            <div className="edge-detail-endpoint-pov">{povLabel(edge.target)}</div>
          </div>
        </div>

        {/* Rationale */}
        <div className="edge-detail-section">
          <div className="edge-detail-section-label">Rationale</div>
          <div className={`edge-detail-rationale${rationaleClamped ? ' clamped' : ''}`}>{edge.rationale}</div>
          {edge.rationale.length > 200 && (
            <button className="edge-detail-rationale-toggle" onClick={() => setRationaleClamped(!rationaleClamped)}>
              {rationaleClamped ? 'Show more' : 'Show less'}
            </button>
          )}
        </div>

        {/* Confidence */}
        <div className="edge-detail-section">
          <div className="edge-detail-section-label">Confidence</div>
          <div className="edge-detail-confidence">
            <div className="edge-detail-confidence-track">
              <div className="edge-detail-confidence-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="edge-detail-confidence-pct">{pct}%</span>
          </div>
        </div>

        {/* Status — only show if not approved */}
        {edge.status !== 'approved' && (
          <div className="edge-detail-section">
            <div className="edge-detail-section-label">Status</div>
            <span className={`edge-detail-status-badge status-${edge.status}`}>
              {edge.status === 'rejected' ? '\u2717 ' : '\u25CF '}{edge.status}
            </span>
          </div>
        )}

        {/* Strength */}
        {edge.strength && (
          <div className="edge-detail-section">
            <div className="edge-detail-section-label">Strength</div>
            <span className="edge-detail-strength-badge">{edge.strength}</span>
          </div>
        )}

        {/* Notes */}
        {edge.notes && (
          <div className="edge-detail-section">
            <div className="edge-detail-section-label">Notes</div>
            <div className="edge-detail-notes">{edge.notes}</div>
          </div>
        )}
      </div>
    </div>
  );
}
