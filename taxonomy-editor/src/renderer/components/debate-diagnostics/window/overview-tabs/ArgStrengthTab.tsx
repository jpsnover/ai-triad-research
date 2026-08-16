// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React, { useState, useMemo } from 'react';
import './ArgStrengthTab.css';
import type { DebateSession, ArgumentNetworkNode, ArgumentNetworkEdge } from '../../../../types/debate';
import { computeQbafStrengths } from '@lib/debate/qbaf';
import type { QbafNode, QbafEdge } from '@lib/debate/qbaf';
import { INodeRow } from '../shared/INodeRow';
import { speakerLabel } from '../helpers';
import type { OverviewTab } from '../types';
import { POV_META, type PovMetaKey } from '@lib/electron-shared/povMeta';

interface ArgStrengthTabProps {
  debate: DebateSession;
  an: { nodes: ArgumentNetworkNode[]; edges: ArgumentNetworkEdge[] };
  handleUpdateSubScore: (nodeId: string, key: string, value: number) => void;
  setOverviewTab: (tab: OverviewTab) => void;
  setSelectedEntry: (id: string | null) => void;
  setLocalOverride: (v: boolean) => void;
  nodeLabels: Map<string, string>;
}

const POV_ORDER = ['accelerationist', 'safetyist', 'skeptic'] as const;

export function ArgStrengthTab({
  debate, an, handleUpdateSubScore, setOverviewTab, setSelectedEntry, setLocalOverride, nodeLabels,
}: ArgStrengthTabProps) {
  const [allExpanded, setAllExpanded] = useState(false);
  // t/2686: per-POV-section collapse + per-POV Top-5 filter. Default: all sections expanded.
  const [collapsedPovs, setCollapsedPovs] = useState<Set<string>>(new Set());
  const [top5Povs, setTop5Povs] = useState<Set<string>>(new Set());
  const togglePov = (pov: string, setter: React.Dispatch<React.SetStateAction<Set<string>>>) =>
    setter(prev => {
      const next = new Set(prev);
      if (next.has(pov)) next.delete(pov); else next.add(pov);
      return next;
    });
  const edges = an.edges ?? [];

  const stmtIdByEntry = useMemo(() => {
    const m = new Map<string, string>();
    debate.transcript.forEach((e, i) => m.set(e.id, `S${i + 1}`));
    return m;
  }, [debate.transcript]);

  const strengthMap = useMemo(() => {
    const qbafNodes: QbafNode[] = an.nodes.map(n => ({ id: n.id, base_strength: n.base_strength ?? 0.5 }));
    const qbafEdges: QbafEdge[] = edges.map(e => ({
      source: e.source,
      target: e.target,
      type: e.type as 'attacks' | 'supports',
      weight: e.weight ?? 0.5,
      attack_type: e.attack_type,
    }));
    return computeQbafStrengths(qbafNodes, qbafEdges).strengths;
  }, [an.nodes, edges]);

  const nodesByPov = useMemo(() => {
    const map = new Map<string, ArgumentNetworkNode[]>();
    for (const n of an.nodes) {
      if (!map.has(n.speaker)) map.set(n.speaker, []);
      map.get(n.speaker)!.push(n);
    }
    for (const [, nodes] of map) {
      nodes.sort(
        (a, b) =>
          (strengthMap.get(b.id) ?? b.base_strength ?? 0.5) -
          (strengthMap.get(a.id) ?? a.base_strength ?? 0.5),
      );
    }
    return map;
  }, [an.nodes, strengthMap]);

  if (an.nodes.length === 0) {
    return <div className="ast-empty">No argument network data for this debate.</div>;
  }

  const orderedPovs = [
    ...POV_ORDER.filter(p => nodesByPov.has(p)),
    ...[...nodesByPov.keys()].filter(p => !(POV_ORDER as readonly string[]).includes(p)),
  ];
  const anyCollapsed = orderedPovs.some(p => collapsedPovs.has(p));

  return (
    <div className="ast-root">
      <div className="ast-toolbar">
        <button
          type="button"
          className="ast-expand-btn"
          // t/2686: operates on POV SECTIONS. Expand All also expands argument-row detail.
          onClick={() => {
            if (anyCollapsed) { setCollapsedPovs(new Set()); setAllExpanded(true); }
            else { setCollapsedPovs(new Set(orderedPovs)); }
          }}
        >
          {anyCollapsed ? 'Expand All' : 'Collapse All'}
        </button>
      </div>
      {orderedPovs.map(pov => {
        const nodes = nodesByPov.get(pov) ?? [];
        const avgStrength =
          nodes.length > 0
            ? nodes.reduce((s, n) => s + (strengthMap.get(n.id) ?? n.base_strength ?? 0.5), 0) /
              nodes.length
            : 0;
        const cssVar = POV_META[pov as PovMetaKey]?.cssVar ?? '--text-primary';
        const isCollapsed = collapsedPovs.has(pov);
        const isTop5 = top5Povs.has(pov);
        const displayNodes = isTop5 ? nodes.slice(0, 5) : nodes;
        return (
          <div key={pov} className="ast-pov-section">
            <div className="ast-pov-header">
              <button
                type="button"
                className="ast-pov-toggle"
                onClick={() => togglePov(pov, setCollapsedPovs)}
                aria-expanded={!isCollapsed}
                title={isCollapsed ? 'Expand section' : 'Collapse section'}
              >
                <span className="ast-pov-caret" aria-hidden="true">{isCollapsed ? '▶' : '▼'}</span>
                {/* eslint-disable-next-line local/no-inline-style -- color is per-camp, derived from POV_META.cssVar */}
                <span className="ast-pov-label" style={{ color: `var(${cssVar})` }}>
                  {speakerLabel(pov)}
                </span>
              </button>
              <span className="ast-pov-stats">
                {nodes.length} argument{nodes.length !== 1 ? 's' : ''} · avg{' '}
                {avgStrength.toFixed(2)}
              </span>
              {nodes.length > 5 && (
                <button
                  type="button"
                  className={`ast-top5-btn${isTop5 ? ' active' : ''}`}
                  onClick={() => togglePov(pov, setTop5Povs)}
                  aria-pressed={isTop5}
                  disabled={isCollapsed}
                  title={isTop5 ? 'Show all arguments' : 'Show only the 5 strongest'}
                >
                  Top 5
                </button>
              )}
            </div>
            {!isCollapsed && displayNodes.map((n, idx) => {
              const attacks = edges.filter(e => e.target === n.id && e.type === 'attacks');
              const supports = edges.filter(e => e.target === n.id && e.type === 'supports');
              const isSource = edges.some(e => e.source === n.id);
              const rank = idx < 3 ? idx + 1 : null;
              return (
                <div key={n.id} className="ast-node-wrap">
                  {rank != null && (
                    <span
                      className="ast-rank-badge"
                      title={`#${rank} strongest ${speakerLabel(pov)} argument`}
                      // eslint-disable-next-line local/no-inline-style -- color is per-camp, derived from POV_META.cssVar
                      style={{ color: `var(${cssVar})`, borderColor: `var(${cssVar})` }}
                    >
                      #{rank}
                    </span>
                  )}
                  <INodeRow
                    node={n}
                    attacks={attacks}
                    supports={supports}
                    allNodes={an.nodes}
                    allEdges={edges}
                    isSource={isSource}
                    computedStrength={strengthMap.get(n.id)}
                    strengthMap={strengthMap}
                    statementId={stmtIdByEntry.get(n.source_entry_id)}
                    onGotoEntry={(eid) => {
                      setOverviewTab('transcript');
                      setSelectedEntry(eid);
                      setLocalOverride(true);
                    }}
                    stmtIdByEntry={stmtIdByEntry}
                    focused={false}
                    onUpdateSubScore={handleUpdateSubScore}
                    nodeLabels={nodeLabels}
                    defaultExpanded={allExpanded}
                  />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
