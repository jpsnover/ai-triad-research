// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useMemo } from 'react';
import type { CommitmentStore, ArgumentNetworkNode, ArgumentNetworkEdge } from '../../../../types/debate';
import { POVER_INFO } from '../../../../types/debate';
import type { SpeakerId } from '../../../../types/debate';
import { bandColor, RISK_BANDS } from '../../../../lib/bandColor';
import './CommitmentsPanel.css';

// NOTE: speakerLabel and AifBadge stay in DiagnosticsWindow.tsx (parent).
// This component uses a local copy of speakerLabel to remain self-contained.

function speakerLabel(speaker: string): string {
  if (speaker === 'system') return 'System';
  if (speaker === 'moderator') return 'Moderator';
  if (speaker === 'user') return 'You';
  return POVER_INFO[speaker as Exclude<SpeakerId, 'user'>]?.label || speaker;
}

// Mean strength of conceded claims (matched to AN nodes)
function computeConcededMean(store: CommitmentStore, pov: string, nodes: ArgumentNetworkNode[]): number {
  let concSum = 0, concCount = 0;
  for (const text of store.conceded) {
    const match = nodes.find(n => n.speaker === pov && (n.text === text || n.text.includes(text) || text.includes(n.text)));
    if (match) { concSum += match.computed_strength ?? match.base_strength ?? 0.5; concCount++; }
  }
  return concCount > 0 ? concSum / concCount : 0.5;
}

// Mean strength of attack targets
function computeAttackTargetMean(
  pov: string,
  nodesBySpeaker: Map<string, ArgumentNetworkNode[]>,
  nodeMap: Map<string, ArgumentNetworkNode>,
  edges: ArgumentNetworkEdge[],
): number {
  const speakerNodes = nodesBySpeaker.get(pov) ?? [];
  const speakerNodeIds = new Set(speakerNodes.map(n => n.id));
  const attackTargetIds = new Set<string>();
  for (const e of edges) {
    if (speakerNodeIds.has(e.source) && (e as { type?: string }).type === 'attacks') {
      attackTargetIds.add(e.target);
    }
  }
  let atkSum = 0, atkCount = 0;
  for (const id of attackTargetIds) {
    const n = nodeMap.get(id);
    if (n) { atkSum += n.computed_strength ?? n.base_strength ?? 0.5; atkCount++; }
  }
  return atkCount > 0 ? atkSum / atkCount : 0.5;
}

export function CommitmentsPanel({ commitments, nodes, edges, onGoToNode }: {
  commitments: Record<string, CommitmentStore>;
  nodes: ArgumentNetworkNode[];
  edges: ArgumentNetworkEdge[];
  onGoToNode: (nodeId: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, string | null>>({});
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; text: string; nodeId: string | null } | null>(null);

  const toggle = (pov: string, category: string) => {
    setExpanded(prev => ({
      ...prev,
      [pov]: prev[pov] === category ? null : category,
    }));
  };

  // Map commitment text → AN node ID via exact or substring match
  const textToNodeId = useMemo(() => {
    const m = new Map<string, string>();
    for (const item of nodes) {
      m.set(item.text, item.id);
    }
    return m;
  }, [nodes]);

  const findNodeId = (commitmentText: string): string | null => {
    // Exact match first
    if (textToNodeId.has(commitmentText)) return textToNodeId.get(commitmentText)!;
    // Substring match — commitment text may be a prefix/substring of the node text
    for (const [nodeText, nodeId] of textToNodeId) {
      if (nodeText.includes(commitmentText) || commitmentText.includes(nodeText)) return nodeId;
    }
    return null;
  };

  const handleContextMenu = (e: React.MouseEvent, text: string) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, text, nodeId: findNodeId(text) });
  };

  useEffect(() => {
    if (!ctxMenu) return;
    const dismiss = () => setCtxMenu(null);
    window.addEventListener('click', dismiss);
    return () => window.removeEventListener('click', dismiss);
  }, [ctxMenu]);

  const categories = [
    { key: 'asserted', label: 'Asserted', color: 'var(--color-saf)' },
    { key: 'conceded', label: 'Conceded', color: 'var(--warning)' },
    { key: 'challenged', label: 'Challenged', color: 'var(--danger)' },
  ] as const;

  // Compute concession asymmetry per speaker (mirrors calibrationLogger logic)
  const asymmetryByPov = useMemo(() => {
    const result: Record<string, number | null> = {};
    const nodeMap = new Map<string, ArgumentNetworkNode>(nodes.map(n => [n.id, n]));
    const nodesBySpeaker = new Map<string, ArgumentNetworkNode[]>();
    for (const n of nodes) {
      if (!nodesBySpeaker.has(n.speaker)) nodesBySpeaker.set(n.speaker, []);
      nodesBySpeaker.get(n.speaker)!.push(n);
    }

    for (const [pov, store] of Object.entries(commitments)) {
      if (store.conceded.length === 0) { result[pov] = null; continue; }
      const concededMean = computeConcededMean(store, pov, nodes);
      const atkMean = computeAttackTargetMean(pov, nodesBySpeaker, nodeMap, edges);
      result[pov] = atkMean - concededMean;
    }
    return result;
  }, [commitments, nodes, edges]);

  return (
    <div className="commit-panel-root">
      {Object.entries(commitments).map(([pov, store]) => (
        <div key={pov} className="commit-panel-pov-row">
          <div className="commit-panel-pov-header">
            <strong className="commit-panel-pov-label">{speakerLabel(pov)}</strong>
            {asymmetryByPov[pov] != null && (() => {
              const a = asymmetryByPov[pov]!;
              const color = bandColor(Math.abs(a), RISK_BANDS);
              const label = Math.abs(a) > 0.3 ? 'high' : Math.abs(a) > 0.15 ? 'moderate' : 'balanced';
              return (
                // eslint-disable-next-line local/no-inline-style -- score-driven color from bandColor
                <span
                  title={`Concession asymmetry: ${a.toFixed(3)}\nAttack target strength minus conceded claim strength.\nHigh asymmetry = conceding weak claims while pressing strong ones.`}
                  style={{ fontSize: 'var(--text-2xs)', padding: '1px 6px', borderRadius: 10, background: `${color}15`, color, fontWeight: 600 }}
                >
                  asym: {a.toFixed(2)} ({label})
                </span>
              );
            })()}
          </div>
          <div className="commit-panel-cats-row">
            {categories.map(cat => {
              const items = store[cat.key];
              const isOpen = expanded[pov] === cat.key;
              return (
                // eslint-disable-next-line local/no-inline-style -- open-state and item-count drive background, color, opacity, and cursor
                <button
                  key={cat.key}
                  onClick={() => items.length > 0 && toggle(pov, cat.key)}
                  className="commit-panel-cat-btn"
                  style={{
                    cursor: items.length > 0 ? 'pointer' : 'default',
                    background: isOpen ? cat.color : `${cat.color}18`,
                    color: isOpen ? '#fff' : cat.color,
                    opacity: items.length === 0 ? 0.4 : 1,
                  }}
                >
                  {cat.label} {items.length}
                </button>
              );
            })}
          </div>
          {expanded[pov] && (() => {
            const cat = categories.find(c => c.key === expanded[pov])!;
            const items = store[cat.key];
            if (items.length === 0) return null;
            return (
              // eslint-disable-next-line local/no-inline-style -- category color drives borderLeft and background
              <div className="commit-panel-expanded-list" style={{
                borderLeft: `3px solid ${cat.color}`,
                background: `${cat.color}08`,
              }}>
                {items.map((item, i) => {
                  const nodeId = findNodeId(item);
                  return (
                    // eslint-disable-next-line local/no-inline-style -- index-driven border bottom
                    <div
                      key={i}
                      onContextMenu={(e) => handleContextMenu(e, item)}
                      className="commit-panel-item-row"
                      style={{ borderBottom: i < items.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}
                    >
                      {nodeId && (
                        <span className="commit-panel-node-badge">{nodeId}</span>
                      )}
                      {item}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      ))}
      {ctxMenu && (
        // eslint-disable-next-line local/no-inline-style -- cursor position drives left and top
        <div className="commit-panel-ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          <button
            onClick={() => { void navigator.clipboard.writeText(ctxMenu.text); setCtxMenu(null); }}
            className="commit-panel-ctx-btn"
          >Copy</button>
          {ctxMenu.nodeId && (
            <button
              onClick={() => { onGoToNode(ctxMenu.nodeId!); setCtxMenu(null); }}
              className="commit-panel-ctx-btn"
            >Go to {ctxMenu.nodeId}</button>
          )}
        </div>
      )}
    </div>
  );
}
