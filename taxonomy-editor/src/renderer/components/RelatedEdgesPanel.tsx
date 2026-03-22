// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import type { Edge, EdgeType, EdgeStatus } from '../types/taxonomy';

interface RelatedEdgesPanelProps {
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

const STATUS_LABEL: Record<EdgeStatus, string> = {
  approved: 'Approved',
  proposed: 'Proposed',
  rejected: 'Rejected',
};

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <span className="related-confidence" title={`${pct}% confidence`}>
      <span className="related-confidence-bar" style={{ width: `${pct}%` }} />
      <span className="related-confidence-label">{pct}%</span>
    </span>
  );
}

function EdgeRow({
  edge,
  nodeId,
  isSelected,
  onSelect,
}: {
  edge: Edge;
  nodeId: string;
  isSelected: boolean;
  onSelect: (edge: Edge) => void;
}) {
  const isSource = edge.source === nodeId;
  const otherNodeId = isSource ? edge.target : edge.source;
  const direction = edge.bidirectional ? '\u2194' : isSource ? '\u2192' : '\u2190';
  const otherLabel = useTaxonomyStore.getState().getLabelForId(otherNodeId);

  return (
    <div
      className={`related-edge-card${isSelected ? ' related-edge-selected' : ''}`}
      onClick={() => onSelect(edge)}
    >
      <div className="related-edge-header">
        <span className="related-edge-direction">{direction}</span>
        <span
          className="related-edge-node"
          style={{ color: nodeColor(otherNodeId) }}
        >
          {otherNodeId}
        </span>
        <ConfidenceBar value={edge.confidence} />
        {edge.status !== 'approved' && (
          <span className={`related-edge-status status-${edge.status}`}>
            {edge.status === 'rejected' ? '\u2717 ' : '\u25CF '}{STATUS_LABEL[edge.status]}
          </span>
        )}
      </div>
      <div className="related-edge-label">{otherLabel}</div>
    </div>
  );
}

function EdgeGroup({
  edgeType,
  edges,
  definition,
  nodeId,
  selectedEdge,
  onSelectEdge,
}: {
  edgeType: EdgeType;
  edges: Edge[];
  definition: string;
  nodeId: string;
  selectedEdge: Edge | null;
  onSelectEdge: (edge: Edge) => void;
}) {
  const [collapsed, setCollapsed] = useState(true);

  // Auto-expand when this group contains the selected edge
  useEffect(() => {
    if (selectedEdge && edges.some(e => e.source === selectedEdge.source && e.target === selectedEdge.target && e.type === selectedEdge.type)) {
      setCollapsed(false);
    }
  }, [selectedEdge, edges]);

  return (
    <div className="related-edge-group">
      <div
        className="related-edge-group-header"
        title={definition}
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className="related-edge-group-toggle">{collapsed ? '\u25B6' : '\u25BC'}</span>
        <span className="related-edge-type-name">{edgeType.replace(/_/g, ' ')}</span>
        <span className="related-edge-type-count">{edges.length}</span>
      </div>
      {!collapsed && edges.map((edge, i) => {
        const isSelected = selectedEdge !== null
          && edge.source === selectedEdge.source
          && edge.target === selectedEdge.target
          && edge.type === selectedEdge.type;
        return (
          <EdgeRow
            key={`${edge.source}-${edge.target}-${edge.type}-${i}`}
            edge={edge}
            nodeId={nodeId}
            isSelected={isSelected}
            onSelect={onSelectEdge}
          />
        );
      })}
    </div>
  );
}

export function RelatedEdgesPanel({ width }: RelatedEdgesPanelProps) {
  const { edgesFile, edgesLoading, relatedNodeId, showRelatedEdges, selectedEdge, selectEdge } = useTaxonomyStore();
  const [collapsed, setCollapsed] = useState(false);
  const [statusFilter, setStatusFilter] = useState<EdgeStatus | ''>('');
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.75);
  const panelRef = useRef<HTMLDivElement>(null);

  const nodeId = relatedNodeId;

  // Find all edges where this node is source or target, grouped by edge type
  const groupedEdges = useMemo(() => {
    if (!edgesFile || !nodeId) return new Map<EdgeType, Edge[]>();

    const groups = new Map<EdgeType, Edge[]>();
    for (const edge of edgesFile.edges) {
      if (edge.source !== nodeId && edge.target !== nodeId) continue;
      if (statusFilter && edge.status !== statusFilter) continue;
      if (edge.confidence < confidenceThreshold) continue;

      const existing = groups.get(edge.type);
      if (existing) {
        existing.push(edge);
      } else {
        groups.set(edge.type, [edge]);
      }
    }

    // Sort edges within each group by confidence (descending)
    for (const edges of groups.values()) {
      edges.sort((a, b) => b.confidence - a.confidence);
    }

    return groups;
  }, [edgesFile, nodeId, statusFilter, confidenceThreshold]);

  // Get edge type definitions for labels
  const edgeTypeDefs = useMemo(() => {
    if (!edgesFile) return new Map<string, string>();
    const m = new Map<string, string>();
    for (const def of edgesFile.edge_types) {
      m.set(def.type, def.definition);
    }
    return m;
  }, [edgesFile]);

  const totalEdges = useMemo(() => {
    let count = 0;
    for (const edges of groupedEdges.values()) count += edges.length;
    return count;
  }, [groupedEdges]);

  // Flat list of all visible edges for keyboard navigation
  const allEdges = useMemo(() => {
    const flat: Edge[] = [];
    for (const edges of groupedEdges.values()) {
      flat.push(...edges);
    }
    return flat;
  }, [groupedEdges]);

  const handleSelectEdge = useCallback((edge: Edge) => {
    selectEdge(edge);
  }, [selectEdge]);

  // Keyboard: up/down to navigate edges
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (allEdges.length === 0) return;
    e.preventDefault();
    e.stopPropagation();

    const currentIdx = selectedEdge
      ? allEdges.findIndex(ed => ed.source === selectedEdge.source && ed.target === selectedEdge.target && ed.type === selectedEdge.type)
      : -1;

    let nextIdx: number;
    if (e.key === 'ArrowDown') {
      nextIdx = currentIdx < allEdges.length - 1 ? currentIdx + 1 : 0;
    } else {
      nextIdx = currentIdx > 0 ? currentIdx - 1 : allEdges.length - 1;
    }
    selectEdge(allEdges[nextIdx]);
  }, [allEdges, selectedEdge, selectEdge]);

  if (!nodeId) return null;

  if (collapsed) {
    return (
      <div className="pane-collapsed" onClick={() => setCollapsed(false)} title="Expand Related Edges">
        <span className="pane-collapsed-label">Related Edges</span>
      </div>
    );
  }

  const nodeLabel = useTaxonomyStore.getState().getLabelForId(nodeId);

  return (
    <div className="related-edges-panel" style={width ? { width, minWidth: width } : undefined} ref={panelRef} tabIndex={0} onKeyDown={handleKeyDown} onMouseDown={() => panelRef.current?.focus()}>
      <div className="related-edges-node-banner">
        <span className="related-edges-node-id" style={{ color: nodeColor(nodeId) }}>{nodeId}</span>
        <span className="related-edges-node-label">{nodeLabel}</span>
      </div>
      <div className="related-edges-header">
        <div className="related-edges-title">
          <h3>Related Edges</h3>
          <span className="related-edges-count">{totalEdges}</span>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button className="pane-collapse-btn" onClick={() => setCollapsed(true)} title="Collapse">&lsaquo;</button>
          <button
            className="related-edges-close"
            onClick={() => showRelatedEdges(null)}
            title="Close"
          >
            &times;
          </button>
        </div>
      </div>

      <div className="related-edges-toolbar">
        <select
          className="related-edges-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as EdgeStatus | '')}
        >
          <option value="">All statuses</option>
          <option value="approved">Approved</option>
          <option value="proposed">Proposed</option>
          <option value="rejected">Rejected</option>
        </select>
        <div className="related-edges-threshold">
          <label className="related-edges-threshold-label">
            Confidence &ge; {Math.round(confidenceThreshold * 100)}%
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(confidenceThreshold * 100)}
            onChange={(e) => setConfidenceThreshold(Number(e.target.value) / 100)}
            className="related-edges-threshold-slider"
          />
        </div>
      </div>

      <div className="related-edges-body">
        {edgesLoading && (
          <div className="related-edges-loading">Loading edges...</div>
        )}

        {!edgesLoading && !edgesFile && (
          <div className="related-edges-empty">
            No edges.json found in the active taxonomy directory.
          </div>
        )}

        {!edgesLoading && edgesFile && totalEdges === 0 && (
          <div className="related-edges-empty">
            No edges found for this node{statusFilter ? ` with status "${statusFilter}"` : ''}.
          </div>
        )}

        {Array.from(groupedEdges.entries()).map(([edgeType, edges]) => (
          <EdgeGroup
            key={edgeType}
            edgeType={edgeType}
            edges={edges}
            definition={edgeTypeDefs.get(edgeType) || ''}
            nodeId={nodeId}
            selectedEdge={selectedEdge}
            onSelectEdge={handleSelectEdge}
          />
        ))}
      </div>
    </div>
  );
}
