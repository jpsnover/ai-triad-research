// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Argument Network graph visualization (CG-1 + CG-2).
 * Renders AN nodes as POV-colored icons with BDI type, QBAF strength,
 * and typed edges. Click a node to open detail panel.
 */

import { useState, useMemo } from 'react';
import type { ArgumentNetworkNode, ArgumentNetworkEdge } from '../types/debate';
import { nodePovFromId } from '@lib/debate/nodeIdUtils';
import { explainNodeStrength } from '../utils/qbafExplain';

// ── Colors & Constants ────────────────────────────────────

const POV_COLORS: Record<string, string> = {
  accelerationist: '#27AE60',
  safetyist: '#E74C3C',
  skeptic: '#F1C40F',
  situations: '#3498DB',
};

const EDGE_STYLES: Record<string, { color: string; dash: string }> = {
  supports: { color: '#16a34a', dash: '' },
  attacks: { color: '#dc2626', dash: '6 3' },
};

const ATTACK_TYPE_COLORS: Record<string, string> = {
  rebut: '#dc2626',
  undercut: '#d97706',
  undermine: '#7c3aed',
};

const BDI_SHAPES: Record<string, string> = {
  Beliefs: 'circle',
  Desires: 'diamond',
  Intentions: 'square',
};

const SVG_SIZE = 600;
const NODE_RADIUS = 18;

// ── Layout ────────────────────────────────────────────────

function layoutNodes(nodes: ArgumentNetworkNode[]): Map<string, { x: number; y: number }> {
  // Simple radial layout grouped by speaker
  const positions = new Map<string, { x: number; y: number }>();
  const speakers = [...new Set(nodes.map(n => n.speaker))];
  const cx = SVG_SIZE / 2;
  const cy = SVG_SIZE / 2;
  const orbitalRadius = SVG_SIZE * 0.35;

  speakers.forEach((speaker, si) => {
    const speakerNodes = nodes.filter(n => n.speaker === speaker);
    const baseAngle = (si / speakers.length) * 2 * Math.PI - Math.PI / 2;

    speakerNodes.forEach((node, ni) => {
      const spread = 0.4;
      const offset = (ni - (speakerNodes.length - 1) / 2) * spread;
      const angle = baseAngle + offset;
      const r = orbitalRadius + (ni % 2 === 0 ? 0 : 20);
      positions.set(node.id, {
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
      });
    });
  });

  return positions;
}

function inferBdi(node: ArgumentNetworkNode): string {
  for (const ref of node.taxonomy_refs) {
    if (ref.includes('-beliefs-')) return 'Beliefs';
    if (ref.includes('-desires-')) return 'Desires';
    if (ref.includes('-intentions-')) return 'Intentions';
  }
  return 'Intentions'; // default
}

function inferPov(node: ArgumentNetworkNode): string {
  for (const ref of node.taxonomy_refs) {
    const pov = nodePovFromId(ref);
    if (pov && pov !== 'situations') return pov;
  }
  return 'situations';
}

// ── Components ────────────────────────────────────────────

interface ArgumentGraphProps {
  nodes: ArgumentNetworkNode[];
  edges: ArgumentNetworkEdge[];
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string) => void;
  turnFilter?: number; // CG-3: only show nodes up to this turn
}

export function ArgumentGraph({ nodes, edges, selectedNodeId, onSelectNode, turnFilter }: ArgumentGraphProps) {
  const filteredNodes = useMemo(
    () => turnFilter != null ? nodes.filter(n => n.turn_number <= turnFilter) : nodes,
    [nodes, turnFilter]
  );
  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map(n => n.id)), [filteredNodes]);
  const filteredEdges = useMemo(
    () => edges.filter(e => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target)),
    [edges, filteredNodeIds]
  );

  const positions = useMemo(() => layoutNodes(filteredNodes), [filteredNodes]);

  if (filteredNodes.length === 0) {
    return <div className="ag-empty">No argument network nodes yet</div>;
  }

  return (
    <div className="ag-container">
      <svg viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`} className="ag-svg">
        {/* Edges */}
        {filteredEdges.map((edge, i) => {
          const from = positions.get(edge.source);
          const to = positions.get(edge.target);
          if (!from || !to) return null;
          const style = EDGE_STYLES[edge.type] ?? EDGE_STYLES.attacks;
          const attackColor = edge.attack_type ? ATTACK_TYPE_COLORS[edge.attack_type] : style.color;
          const thickness = edge.weight != null ? 1 + edge.weight * 3 : 1.5;
          return (
            <g key={`e-${i}`}>
              <line
                x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                stroke={attackColor}
                strokeWidth={thickness}
                strokeDasharray={style.dash}
                opacity={0.6}
                markerEnd={edge.type === 'attacks' ? 'url(#arrowhead-attack)' : 'url(#arrowhead-support)'}
              />
              {edge.attack_type && (
                <text
                  x={(from.x + to.x) / 2}
                  y={(from.y + to.y) / 2 - 6}
                  className="ag-edge-label"
                  fill={attackColor}
                >
                  {edge.attack_type}
                </text>
              )}
            </g>
          );
        })}

        {/* Arrow markers */}
        <defs>
          <marker id="arrowhead-attack" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#dc2626" />
          </marker>
          <marker id="arrowhead-support" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#16a34a" />
          </marker>
        </defs>

        {/* Nodes */}
        {filteredNodes.map(node => {
          const pos = positions.get(node.id);
          if (!pos) return null;
          const pov = inferPov(node);
          const bdi = inferBdi(node);
          const color = POV_COLORS[pov] ?? '#64748b';
          const strength = node.computed_strength ?? node.base_strength ?? 0.5;
          const opacity = 0.4 + strength * 0.6;
          const size = NODE_RADIUS * (0.7 + strength * 0.6);
          const isSelected = selectedNodeId === node.id;
          const isNew = turnFilter != null && node.turn_number === turnFilter;

          return (
            <g
              key={node.id}
              className={`ag-node ${isSelected ? 'ag-node-selected' : ''} ${isNew ? 'ag-node-new' : ''}`}
              onClick={() => onSelectNode?.(node.id)}
              style={{ cursor: 'pointer' }}
            >
              {/* Node shape based on BDI type */}
              {bdi === 'Beliefs' ? (
                <circle cx={pos.x} cy={pos.y} r={size} fill={color} opacity={opacity} stroke={isSelected ? '#fff' : 'none'} strokeWidth={isSelected ? 3 : 0} />
              ) : bdi === 'Desires' ? (
                <polygon
                  points={`${pos.x},${pos.y - size} ${pos.x + size},${pos.y} ${pos.x},${pos.y + size} ${pos.x - size},${pos.y}`}
                  fill={color} opacity={opacity} stroke={isSelected ? '#fff' : 'none'} strokeWidth={isSelected ? 3 : 0}
                />
              ) : (
                <rect
                  x={pos.x - size} y={pos.y - size} width={size * 2} height={size * 2}
                  rx={3} fill={color} opacity={opacity} stroke={isSelected ? '#fff' : 'none'} strokeWidth={isSelected ? 3 : 0}
                />
              )}
              {/* AN ID label */}
              <text x={pos.x} y={pos.y + 4} className="ag-node-label" textAnchor="middle" fill="#fff" fontSize={9} fontWeight={600}>
                {node.id}
              </text>
              {/* BDI badge */}
              <text x={pos.x + size + 3} y={pos.y - size + 8} className="ag-bdi-badge" fontSize={8} fill={color}>
                {bdi[0]}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="ag-legend">
        <span className="ag-legend-title">Legend:</span>
        <span className="ag-legend-item"><span className="ag-legend-dot" style={{ background: '#27AE60', borderRadius: '50%' }} /> Acc</span>
        <span className="ag-legend-item"><span className="ag-legend-dot" style={{ background: '#E74C3C', borderRadius: '50%' }} /> Saf</span>
        <span className="ag-legend-item"><span className="ag-legend-dot" style={{ background: '#F1C40F', borderRadius: '50%' }} /> Skp</span>
        <span className="ag-legend-sep">|</span>
        <span className="ag-legend-item">&#9679; Belief</span>
        <span className="ag-legend-item">&#9670; Desire</span>
        <span className="ag-legend-item">&#9632; Intention</span>
        <span className="ag-legend-sep">|</span>
        <span className="ag-legend-item" style={{ color: '#16a34a' }}>&#8212; supports</span>
        <span className="ag-legend-item" style={{ color: '#dc2626' }}>- - attacks</span>
      </div>
    </div>
  );
}

// ── Node Detail Panel (CG-2) ──────────────────────────────

interface NodeDetailPanelProps {
  node: ArgumentNetworkNode;
  edges: ArgumentNetworkEdge[];
  allNodes: ArgumentNetworkNode[];
  onClose: () => void;
}

export function GraphNodeDetailPanel({ node, edges, allNodes, onClose }: NodeDetailPanelProps) {
  const pov = inferPov(node);
  const bdi = inferBdi(node);
  const color = POV_COLORS[pov] ?? '#64748b';

  const incomingEdges = edges.filter(e => e.target === node.id);
  const outgoingEdges = edges.filter(e => e.source === node.id);
  const getNodeText = (id: string) => allNodes.find(n => n.id === id)?.text?.slice(0, 80) ?? id;

  const explanation = useMemo(() => {
    if (node.computed_strength == null || incomingEdges.length === 0) return null;
    return explainNodeStrength(allNodes, edges, node.id);
  }, [node.id, node.computed_strength, allNodes, edges, incomingEdges.length]);

  return (
    <div className="ag-detail-panel">
      <div className="ag-detail-header">
        <span className="ag-detail-id" style={{ color }}>{node.id}</span>
        <span className="ag-detail-bdi">{bdi}</span>
        <button className="ag-detail-close" onClick={onClose}>&times;</button>
      </div>
      <div className="ag-detail-claim">{node.text}</div>
      <div className="ag-detail-meta">
        <span>Speaker: {node.speaker}</span>
        <span>Turn: {node.turn_number}</span>
        {node.computed_strength != null && <span>Strength: {node.computed_strength.toFixed(2)}</span>}
        {node.base_strength != null && <span>Intrinsic: {node.base_strength.toFixed(2)}</span>}
        {node.bdi_confidence != null && <span>Reliability: {node.bdi_confidence.toFixed(2)}</span>}
        {(node as Record<string, unknown>).extraction_confidence != null && (
          <span>FIRE conf: {((node as Record<string, unknown>).extraction_confidence as number).toFixed(2)}</span>
        )}
      </div>
      {node.bdi_sub_scores && (
        <div className="ag-detail-subscores">
          <strong>Criteria scores:</strong>{' '}
          {Object.entries(node.bdi_sub_scores)
            .filter(([, v]) => v != null)
            .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${(v as number).toFixed(2)}`)
            .join(', ')}
        </div>
      )}
      {node.taxonomy_refs.length > 0 && (
        <div className="ag-detail-refs">
          <strong>Taxonomy refs:</strong> {node.taxonomy_refs.join(', ')}
        </div>
      )}
      {incomingEdges.length > 0 && (
        <div className="ag-detail-edges">
          <strong>Incoming:</strong>
          {incomingEdges.map((e, i) => (
            <div key={i} className="ag-detail-edge">
              <span style={{ color: e.type === 'attacks' ? '#dc2626' : '#16a34a' }}>
                {e.type}{e.attack_type ? ` (${e.attack_type})` : ''}
              </span>
              from {getNodeText(e.source)}
              {e.weight != null && <span className="ag-detail-weight">w:{e.weight.toFixed(2)}</span>}
            </div>
          ))}
        </div>
      )}
      {outgoingEdges.length > 0 && (
        <div className="ag-detail-edges">
          <strong>Outgoing:</strong>
          {outgoingEdges.map((e, i) => (
            <div key={i} className="ag-detail-edge">
              <span style={{ color: e.type === 'attacks' ? '#dc2626' : '#16a34a' }}>
                {e.type}{e.attack_type ? ` (${e.attack_type})` : ''}
              </span>
              → {getNodeText(e.target)}
              {e.weight != null && <span className="ag-detail-weight">w:{e.weight.toFixed(2)}</span>}
            </div>
          ))}
        </div>
      )}
      {explanation && (
        <div className="ag-detail-attribution">
          <div className="ag-detail-explanation">{explanation.summary}</div>
          {explanation.attributions.length > 0 && (
            <div className="ag-detail-attr-list">
              <strong>Edge attributions:</strong>
              {explanation.attributions.map((a, i) => (
                <div
                  key={i}
                  className="ag-detail-attr-row"
                  style={{ fontWeight: i === 0 ? 700 : 400 }}
                >
                  <span style={{ color: a.influence >= 0 ? '#16a34a' : '#dc2626' }}>
                    {a.influence >= 0 ? '+' : ''}{a.influence.toFixed(3)}
                  </span>
                  {' '}
                  <span className="ag-detail-attr-type" style={{ color: a.edgeType === 'attacks' ? '#dc2626' : '#16a34a' }}>
                    {a.edgeType}{a.attackType ? ` (${a.attackType})` : ''}
                  </span>
                  {' from '}
                  <span className="ag-detail-attr-source">{a.sourceId}</span>
                  {a.scheme && <span className="ag-detail-attr-scheme"> via {a.scheme}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
