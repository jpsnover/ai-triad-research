// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React, { useState, useMemo } from 'react';
import './ArgStrengthTab.css';
import type { DebateSession, ArgumentNetworkNode, ArgumentNetworkEdge } from '../../../../types/debate';
import { computeQbafStrengths } from '@lib/debate/qbaf';
import type { QbafNode, QbafEdge } from '@lib/debate/qbaf';
import { DEBATE_TESTED_DEFAULTS } from '@lib/debate/debateTested';
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

// t/3301: 'all' = no filter; 'ge1' = in-degree ≥1 (default); 'ge2' = in-degree ≥2 (stricter).
type TestedFilter = 'all' | 'ge1' | 'ge2';

// t/3303: Debate-tested tier — derivable from single-debate attack edges.
// 'well_tested' requires multi-debate data; omitted here (single-debate view).
type DebateTier = 'untested' | 'cited' | 'contested';

// t/3303: Sort axis — strength (QBAF acceptability, default) or tier (dialectical testedness).
type SortMode = 'strength' | 'tier';

const POV_ORDER = ['accelerationist', 'safetyist', 'skeptic'] as const;

const TIER_RANK: Record<DebateTier, number> = { untested: 0, cited: 1, contested: 2 };

const TIER_LABEL: Record<DebateTier, string> = {
  untested: '–',
  cited: '·',
  contested: '✓',
};

const TIER_TOOLTIP: Record<DebateTier, string> = {
  untested: 'Untested — no incoming edges in this debate',
  cited: 'Cited — appeared but never severely challenged (no attack ≥ 0.5 strength)',
  contested: 'Contested — survived ≥1 severe attack (attacker strength ≥ 0.5)',
};

// Derive single-debate tier from incoming attack edges + attacker computed strength.
// Mirrors the predicate in debateTested.ts findStrongestAttack (SEVERE_ATTACK_THRESHOLD).
function deriveTier(
  nodeId: string,
  edges: ArgumentNetworkEdge[],
  strengthMap: Map<string, number>,
  baseStrengths: Map<string, number>,
): DebateTier {
  const incoming = edges.filter(e => e.target === nodeId);
  if (incoming.length === 0) return 'untested';

  const hasSevereAttack = incoming.some(e => {
    if (e.type !== 'attacks') return false;
    const s = strengthMap.get(e.source) ?? baseStrengths.get(e.source) ?? 0;
    return s >= DEBATE_TESTED_DEFAULTS.SEVERE_ATTACK_THRESHOLD;
  });

  return hasSevereAttack ? 'contested' : 'cited';
}

export function ArgStrengthTab({
  debate, an, handleUpdateSubScore, setOverviewTab, setSelectedEntry, setLocalOverride, nodeLabels,
}: ArgStrengthTabProps) {
  const [allExpanded, setAllExpanded] = useState(false);
  // t/2686: per-POV-section collapse + per-POV Top-5 filter. Default: all sections expanded.
  const [collapsedPovs, setCollapsedPovs] = useState<Set<string>>(new Set());
  const [top5Povs, setTop5Povs] = useState<Set<string>>(new Set());
  // t/3301: default to in-degree ≥1 so untested priors are hidden by default.
  const [testedFilter, setTestedFilter] = useState<TestedFilter>('ge1');
  // t/3303: secondary sort axis. Default: QBAF acceptability strength.
  const [sortMode, setSortMode] = useState<SortMode>('strength');
  // t/3304: "Debate-tested only" opt-in filter — keeps tier ∈ {contested}.
  // Default OFF: this removes ~45-54% of nodes and must not be a silent default.
  const [debateTestedOnly, setDebateTestedOnly] = useState(false);

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

  const baseStrengths = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of an.nodes) m.set(n.id, n.base_strength ?? 0.5);
    return m;
  }, [an.nodes]);

  // t/3301: in-degree per node (incoming edges only — those test this node's strength).
  const inDegreeMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of an.nodes) m.set(n.id, 0);
    for (const e of edges) m.set(e.target, (m.get(e.target) ?? 0) + 1);
    return m;
  }, [an.nodes, edges]);

  // t/3303: derive Debate-Tested tier per node (single-debate approximation).
  const tierMap = useMemo(() => {
    const m = new Map<string, DebateTier>();
    for (const n of an.nodes) {
      m.set(n.id, deriveTier(n.id, edges, strengthMap, baseStrengths));
    }
    return m;
  }, [an.nodes, edges, strengthMap, baseStrengths]);

  const totalNodes = an.nodes.length;
  const testedGe1Count = useMemo(
    () => an.nodes.filter(n => (inDegreeMap.get(n.id) ?? 0) >= 1).length,
    [an.nodes, inDegreeMap],
  );
  const untestedCount = totalNodes - testedGe1Count;

  const nodesByPov = useMemo(() => {
    const map = new Map<string, ArgumentNetworkNode[]>();
    for (const n of an.nodes) {
      if (!map.has(n.speaker)) map.set(n.speaker, []);
      map.get(n.speaker)!.push(n);
    }
    for (const [, nodes] of map) {
      nodes.sort((a, b) => {
        if (sortMode === 'tier') {
          const ta = TIER_RANK[tierMap.get(a.id) ?? 'untested'];
          const tb = TIER_RANK[tierMap.get(b.id) ?? 'untested'];
          if (tb !== ta) return tb - ta;
        }
        return (
          (strengthMap.get(b.id) ?? b.base_strength ?? 0.5) -
          (strengthMap.get(a.id) ?? a.base_strength ?? 0.5)
        );
      });
    }
    return map;
  }, [an.nodes, strengthMap, tierMap, sortMode]);

  // t/3301: apply tested filter on top of the sorted nodesByPov.
  // t/3304: also apply debateTestedOnly (tier === 'contested') when enabled.
  const filteredNodesByPov = useMemo(() => {
    let result = nodesByPov;

    if (testedFilter !== 'all') {
      const minDegree = testedFilter === 'ge1' ? 1 : 2;
      const degreeFiltered = new Map<string, ArgumentNetworkNode[]>();
      for (const [pov, nodes] of result) {
        const f = nodes.filter(n => (inDegreeMap.get(n.id) ?? 0) >= minDegree);
        if (f.length > 0) degreeFiltered.set(pov, f);
      }
      result = degreeFiltered;
    }

    if (debateTestedOnly) {
      const strict = new Map<string, ArgumentNetworkNode[]>();
      for (const [pov, nodes] of result) {
        const f = nodes.filter(n => tierMap.get(n.id) === 'contested');
        if (f.length > 0) strict.set(pov, f);
      }
      result = strict;
    }

    return result;
  }, [nodesByPov, testedFilter, inDegreeMap, debateTestedOnly, tierMap]);

  const shownCount = useMemo(
    () => [...filteredNodesByPov.values()].reduce((s, ns) => s + ns.length, 0),
    [filteredNodesByPov],
  );

  // t/3304: when debateTestedOnly is on, show how many are hidden by the strict filter.
  const debateTestedHiddenCount = totalNodes - shownCount;

  if (an.nodes.length === 0) {
    return <div className="ast-empty">No argument network data for this debate.</div>;
  }

  const orderedPovs = [
    ...POV_ORDER.filter(p => filteredNodesByPov.has(p)),
    ...[...filteredNodesByPov.keys()].filter(p => !(POV_ORDER as readonly string[]).includes(p)),
  ];
  const anyCollapsed = orderedPovs.some(p => collapsedPovs.has(p));

  return (
    <div className="ast-root">
      <div className="ast-toolbar">
        {/* t/3301: count line + filter controls */}
        <div className="ast-filter-controls">
          <span className="ast-count-line">
            Showing {shownCount} of {totalNodes}
            {debateTestedOnly
              ? <> — <span className="ast-count-dt-hidden">{debateTestedHiddenCount} not yet debate-tested</span></>
              : untestedCount > 0 && (
                <> · <span className="ast-count-untested">{untestedCount} untested</span>
                {' '}<span className="ast-count-note">(mostly unmeasured)</span></>
              )
            }
          </span>
          <div className="ast-filter-btns">
            {(['all', 'ge1', 'ge2'] as TestedFilter[]).map(f => (
              <button
                key={f}
                type="button"
                className={`ast-filter-btn${testedFilter === f ? ' active' : ''}`}
                aria-pressed={testedFilter === f}
                onClick={() => setTestedFilter(f)}
                title={
                  f === 'all' ? 'Show all arguments' :
                  f === 'ge1' ? 'Show only arguments with ≥1 incoming edge (tested)' :
                  'Show only arguments with ≥2 incoming edges (more tested)'
                }
              >
                {f === 'all' ? 'All' : f === 'ge1' ? 'In-degree ≥1' : 'In-degree ≥2'}
              </button>
            ))}
            {/* t/3304: strict opt-in filter — only nodes that survived severe attack */}
            <button
              type="button"
              className={`ast-filter-btn ast-filter-btn-dt${debateTestedOnly ? ' active' : ''}`}
              aria-pressed={debateTestedOnly}
              onClick={() => setDebateTestedOnly(v => !v)}
              title="Debate-tested only — show arguments that survived ≥1 severe attack (attacker strength ≥ 0.5). Removes ~45-54% of nodes."
            >
              Debate-tested only
            </button>
          </div>
        </div>
        {/* t/3303: sort axis toggle + expand/collapse */}
        <div className="ast-toolbar-row">
          <span className="ast-sort-label">Sort:</span>
          <div className="ast-sort-btns">
            {(['strength', 'tier'] as SortMode[]).map(m => (
              <button
                key={m}
                type="button"
                className={`ast-sort-btn${sortMode === m ? ' active' : ''}`}
                aria-pressed={sortMode === m}
                onClick={() => setSortMode(m)}
                title={
                  m === 'strength'
                    ? 'Sort by QBAF acceptability (computed strength)'
                    : 'Sort by Debate-Tested tier (dialectical testedness), then strength'
                }
              >
                {m === 'strength' ? 'Strength' : 'Tier'}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="ast-expand-btn"
            onClick={() => {
              if (anyCollapsed) { setCollapsedPovs(new Set()); setAllExpanded(true); }
              else { setCollapsedPovs(new Set(orderedPovs)); }
            }}
          >
            {anyCollapsed ? 'Expand All' : 'Collapse All'}
          </button>
        </div>
      </div>
      {orderedPovs.length === 0 && (
        <div className="ast-empty">
          No tested arguments match the current filter.{' '}
          <button
            type="button"
            className="ast-filter-btn"
            onClick={() => setTestedFilter('all')}
          >Show all</button>
        </div>
      )}
      {orderedPovs.map(pov => {
        const nodes = filteredNodesByPov.get(pov) ?? [];
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
              const hasAttack = attacks.length > 0;
              const tier = tierMap.get(n.id) ?? 'untested';
              return (
                <div key={n.id} className="ast-node-wrap">
                  {(rank != null || hasAttack) && (
                    <div className="ast-badges-col">
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
                      {hasAttack && (
                        <span
                          className="ast-attack-badge"
                          title="Adversarially tested — has ≥1 incoming attack edge"
                        >
                          ⚔ adversarial
                        </span>
                      )}
                    </div>
                  )}
                  {/* t/3303: tier badge — dialectical testedness second axis */}
                  <span
                    className={`ast-tier-badge ast-tier-${tier}`}
                    title={TIER_TOOLTIP[tier]}
                    aria-label={`Tier: ${tier}`}
                  >
                    {TIER_LABEL[tier]}
                  </span>
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
