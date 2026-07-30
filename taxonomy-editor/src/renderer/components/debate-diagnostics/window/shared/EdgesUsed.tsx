// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo } from 'react';
import { nodeIdColor, truncateLabel } from './constants';
import type { TaxRefEdge, TaxRefNode } from '../../../taxonomy/TaxonomyRefDetail';

// NOTE: AifBadge stays in DiagnosticsWindow.tsx (parent) — not used by these components directly.
// NOTE: speakerLabel stays in DiagnosticsWindow.tsx (parent) — not used by these components directly.
// NOTE: Section stays in DiagnosticsWindow.tsx (parent) — wrap EdgesUsedGrouped in a <Section> at the call site.

/** Returns a CSS color for a taxonomy node ID based on its POV prefix. */
export function edgeNodeColor(id: string): string {
  return nodeIdColor(id);
}

// truncateLabel imported from ./constants

/** A single edge used by a debater during the debate. */
export type EdgeUsed = { source: string; target: string; type: string; confidence: number };

function EdgesUsedGroup({ edgeType, edges, selectedIdx, onSelect, nodeLabels }: {
  edgeType: string;
  edges: EdgeUsed[];
  selectedIdx: string | null;
  onSelect: (idx: string | null) => void;
  nodeLabels: Map<string, string>;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="related-edge-group">
      <div className="related-edge-group-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="related-edge-group-toggle">{collapsed ? '▶' : '▼'}</span>
        <span className="related-edge-type-name">{edgeType.replace(/_/g, ' ')}</span>
        <span className="related-edge-type-count">{edges.length}</span>
      </div>
      {!collapsed && edges.map((e, i) => {
        const key = `${e.source}|${e.target}|${e.type}`;
        const isSelected = selectedIdx === key;
        const srcLabel = nodeLabels.get(e.source);
        const tgtLabel = nodeLabels.get(e.target);
        return (
          <div
            key={i}
            className={`related-edge-card${isSelected ? ' related-edge-selected' : ''}`}
            onClick={() => onSelect(isSelected ? null : key)}
            style={{ cursor: 'pointer' }}
          >
            <div className="related-edge-header">
              <span className="related-edge-label-primary" style={{ color: edgeNodeColor(e.source) }}>
                {srcLabel ? truncateLabel(srcLabel, 20) : e.source}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-2xs)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.03em' }}>{edgeType.replace(/_/g, ' ')}</span>
              <span className="related-edge-label-primary" style={{ color: edgeNodeColor(e.target) }}>
                {tgtLabel ? truncateLabel(tgtLabel, 20) : e.target}
              </span>
            </div>
            <div className="related-edge-sub">
              <span className="related-edge-id">{e.source} &rarr; {e.target}</span>
              <span className="related-wc-tag">c{Math.round(e.confidence * 100)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EdgeDescriptions({ srcNode, tgtNode }: {
  srcNode: TaxRefNode | undefined;
  tgtNode: TaxRefNode | undefined;
}) {
  if (!(srcNode?.description || tgtNode?.description)) return null;
  return (
    <div style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
      {srcNode?.description && (
        <div style={{ flex: 1, padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: 6, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4, letterSpacing: '0.04em' }}>Source Description</div>
          <div style={{ fontSize: '0.75rem', lineHeight: 1.5 }}>{srcNode.description as string}</div>
        </div>
      )}
      {tgtNode?.description && (
        <div style={{ flex: 1, padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: 6, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4, letterSpacing: '0.04em' }}>Target Description</div>
          <div style={{ fontSize: '0.75rem', lineHeight: 1.5 }}>{tgtNode.description as string}</div>
        </div>
      )}
    </div>
  );
}

function EdgeStatus({ status }: { status: string }) {
  return (
    <>
      {status && status !== 'approved' && (
        <span className={`edge-detail-status-badge status-${status}`}>
          {status === 'rejected' ? '✗ ' : '● '}{status}
        </span>
      )}
      {status === 'approved' && (
        <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: '0.75rem' }}>{'✓'} Approved</span>
      )}
    </>
  );
}

export function EdgesUsedDetail({ edge, taxNodeMap, nodeLabels }: {
  edge: TaxRefEdge;
  taxNodeMap: Map<string, Record<string, unknown>>;
  nodeLabels: Map<string, string>;
}) {
  const srcNode = taxNodeMap.get(edge.source) as TaxRefNode | undefined;
  const tgtNode = taxNodeMap.get(edge.target) as TaxRefNode | undefined;
  const srcLabel = nodeLabels.get(edge.source) ?? edge.source;
  const tgtLabel = nodeLabels.get(edge.target) ?? edge.target;
  const pct = Math.round(edge.confidence * 100);

  return (
    <div style={{ fontSize: '0.78rem' }}>
      {/* Edge type banner */}
      <div className="edge-detail-type-banner">
        <span className="edge-detail-type-name">{edge.type.replace(/_/g, ' ')}</span>
        {edge.bidirectional && <span className="edge-detail-bidir" title="Bidirectional">&harr;</span>}
      </div>

      {/* Source → Target */}
      <div className="edge-detail-endpoints">
        <div className="edge-detail-endpoint">
          <div className="edge-detail-endpoint-role">SOURCE</div>
          <div className="edge-detail-endpoint-label" style={{ color: edgeNodeColor(edge.source) }}>{srcLabel}</div>
          <div className="edge-detail-endpoint-id">{edge.source}</div>
        </div>
        <div className="edge-detail-arrow">{edge.bidirectional ? '↔' : '→'}</div>
        <div className="edge-detail-endpoint">
          <div className="edge-detail-endpoint-role">TARGET</div>
          <div className="edge-detail-endpoint-label" style={{ color: edgeNodeColor(edge.target) }}>{tgtLabel}</div>
          <div className="edge-detail-endpoint-id">{edge.target}</div>
        </div>
      </div>

      {/* Source & Target descriptions */}
      <EdgeDescriptions srcNode={srcNode} tgtNode={tgtNode} />

      {/* Rationale */}
      {edge.rationale && (
        <div className="edge-detail-section">
          <div className="edge-detail-section-label">RATIONALE</div>
          <div style={{ fontSize: '0.78rem', lineHeight: 1.55 }}>{edge.rationale}</div>
        </div>
      )}

      {/* Confidence & Strength */}
      <div style={{ display: 'flex', gap: 24, alignItems: 'center', margin: '10px 0', fontSize: '0.78rem' }}>
        <span>Confidence: {pct}%</span>
        {edge.strength && <span>Strength: {edge.strength}</span>}
      </div>

      {/* Status */}
      <EdgeStatus status={edge.status} />

      {/* Notes */}
      {edge.notes && (
        <div className="edge-detail-section" style={{ marginTop: 10 }}>
          <div className="edge-detail-section-label">Notes</div>
          <div style={{ fontSize: '0.75rem' }}>{edge.notes}</div>
        </div>
      )}
    </div>
  );
}

export function EdgesUsedGrouped({ edges, allEdges, taxNodeMap, nodeLabels }: {
  edges: EdgeUsed[];
  allEdges: TaxRefEdge[];
  taxNodeMap: Map<string, Record<string, unknown>>;
  nodeLabels: Map<string, string>;
}) {
  const [selectedIdx, setSelectedIdx] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const groups = new Map<string, EdgeUsed[]>();
    for (const e of edges) {
      const arr = groups.get(e.type);
      if (arr) arr.push(e); else groups.set(e.type, [e]);
    }
    for (const arr of groups.values()) arr.sort((a, b) => b.confidence - a.confidence);
    return groups;
  }, [edges]);

  // Look up full edge from allEdges
  const selectedEdge = useMemo(() => {
    if (!selectedIdx) return null;
    const [src, tgt, typ] = selectedIdx.split('|');
    return allEdges.find(e => e.source === src && e.target === tgt && e.type === typ) ?? null;
  }, [selectedIdx, allEdges]);

  const selectedUsed = useMemo(() => {
    if (!selectedIdx) return null;
    const [src, tgt, typ] = selectedIdx.split('|');
    return edges.find(e => e.source === src && e.target === tgt && e.type === typ) ?? null;
  }, [selectedIdx, edges]);

  return (
    <div style={{ display: 'flex', gap: 8, minHeight: 200 }}>
      {/* Left: edge list */}
      <div style={{ flex: '1 1 45%', maxHeight: 400, overflowY: 'auto' }}>
        {Array.from(grouped.entries()).map(([type, edgeList]) => (
          <EdgesUsedGroup key={type} edgeType={type} edges={edgeList} selectedIdx={selectedIdx} onSelect={setSelectedIdx} nodeLabels={nodeLabels} />
        ))}
      </div>
      {/* Right: edge detail */}
      <div style={{ flex: '1 1 55%', maxHeight: 400, overflowY: 'auto', borderLeft: '1px solid var(--border)', paddingLeft: 10 }}>
        {selectedEdge ? (
          <EdgesUsedDetail edge={selectedEdge} taxNodeMap={taxNodeMap} nodeLabels={nodeLabels} />
        ) : selectedUsed ? (
          <EdgesUsedDetail edge={{ ...selectedUsed, bidirectional: false, rationale: '', status: '', weight: undefined, strength: undefined, notes: undefined }} taxNodeMap={taxNodeMap} nodeLabels={nodeLabels} />
        ) : (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', padding: '20px 8px', textAlign: 'center' }}>Select an edge to view details</div>
        )}
      </div>
    </div>
  );
}
