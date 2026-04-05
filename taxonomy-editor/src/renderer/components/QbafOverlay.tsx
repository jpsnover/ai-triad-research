// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * QBAF visualization overlay for debate transcript entries.
 * Shows argument strength scores when QBAF data is available and enabled.
 * 4 layers: node opacity, edge indicators, strength delta badges, color tint.
 */

import { useState, useCallback } from 'react';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { useDebateStore } from '../hooks/useDebateStore';
import type { ArgumentNetworkNode, ArgumentNetworkEdge } from '../types/debate';
import { CATEGORY_SLUGS } from '@lib/debate';

interface QbafClaimBadgeProps {
  node: ArgumentNetworkNode;
}

/** Strength band label per Risk Assessor recommendation (ranges, not precise decimals) */
function strengthBand(score: number): { label: string; className: string } {
  if (score >= 0.8) return { label: 'Strong', className: 'qbaf-strong' };
  if (score >= 0.5) return { label: 'Moderate', className: 'qbaf-moderate' };
  if (score >= 0.3) return { label: 'Weak', className: 'qbaf-weak' };
  return { label: 'Very Weak', className: 'qbaf-very-weak' };
}

/** Badge showing QBAF strength for a single claim in the transcript */
export function QbafClaimBadge({ node }: QbafClaimBadgeProps) {
  const qbafEnabled = useTaxonomyStore(s => s.qbafEnabled);
  if (!qbafEnabled) return null;
  if (node.computed_strength == null && node.base_strength == null) return null;

  const computed = node.computed_strength ?? node.base_strength ?? 0;
  const base = node.base_strength ?? computed;
  const delta = computed - base;
  const band = strengthBand(computed);
  const showDelta = Math.abs(delta) > 0.1;

  return (
    <span
      className={`qbaf-badge ${band.className}`}
      style={{ opacity: 0.3 + computed * 0.7 }}
      title={`Argument strength: ${band.label} (${computed.toFixed(2)})${showDelta ? ` — ${delta > 0 ? 'gained' : 'lost'} ${Math.abs(delta).toFixed(2)} from attacks/supports` : ''}`}
    >
      {band.label}
      {showDelta && (
        <span className={`qbaf-delta ${delta > 0 ? 'qbaf-delta-up' : 'qbaf-delta-down'}`}>
          {delta > 0 ? '+' : ''}{delta.toFixed(2)}
        </span>
      )}
    </span>
  );
}

/** Check if an AN node is a Beliefs claim (needs human scoring in hybrid mode) */
function isBeliefsNode(node: ArgumentNetworkNode): boolean {
  // A claim is Beliefs-category if any of its taxonomy_refs contains '-beliefs-'
  if (node.taxonomy_refs.some(ref => ref.includes('-beliefs-'))) return true;
  // If no taxonomy refs, we can't determine category — treat as needing human score
  return node.taxonomy_refs.length === 0;
}

/** Check if a node has only a placeholder base_strength (default 0.5, needs human scoring) */
function needsHumanScore(node: ArgumentNetworkNode): boolean {
  return isBeliefsNode(node) && (node.base_strength == null || node.base_strength === 0.5);
}

interface QbafScoreSliderProps {
  node: ArgumentNetworkNode;
  onScoreChange: (nodeId: string, score: number) => void;
}

/**
 * Editable slider for human-assigned base_strength on Beliefs claims.
 * Desires/Intentions claims show read-only badge (AI-scored).
 * Per hybrid scoring decision (e/19#23).
 */
export function QbafScoreSlider({ node, onScoreChange }: QbafScoreSliderProps) {
  const qbafEnabled = useTaxonomyStore(s => s.qbafEnabled);
  if (!qbafEnabled) return null;

  const beliefs = isBeliefsNode(node);
  const score = node.base_strength ?? 0.5;
  const unscored = needsHumanScore(node);

  if (!beliefs) {
    // AI-scored (Desires/Intentions) — read-only badge
    return <QbafClaimBadge node={node} />;
  }

  return (
    <div className={`qbaf-slider-container ${unscored ? 'qbaf-needs-score' : ''}`}>
      {unscored && <span className="qbaf-needs-score-label">needs human score</span>}
      <input
        type="range"
        min={0.1}
        max={1.0}
        step={0.1}
        value={score}
        onChange={e => onScoreChange(node.id, Number(e.target.value))}
        className="qbaf-score-slider"
        title={`Base strength: ${score.toFixed(1)} — adjust to reflect how well-evidenced this claim is`}
      />
      <QbafClaimBadge node={node} />
    </div>
  );
}

interface QbafEdgeIndicatorProps {
  edge: ArgumentNetworkEdge;
}

/** Inline indicator for attack/support weight on an edge */
export function QbafEdgeIndicator({ edge }: QbafEdgeIndicatorProps) {
  const qbafEnabled = useTaxonomyStore(s => s.qbafEnabled);
  if (!qbafEnabled || edge.weight == null) return null;

  const thickness = 1 + edge.weight * 3; // 1px to 4px
  const isAttack = edge.type === 'attacks';

  return (
    <span
      className={`qbaf-edge-indicator ${isAttack ? 'qbaf-edge-attack' : 'qbaf-edge-support'}`}
      style={{ borderBottomWidth: `${thickness}px` }}
      title={`${isAttack ? 'Attack' : 'Support'} weight: ${edge.weight.toFixed(2)}${edge.attack_type ? ` (${edge.attack_type})` : ''}`}
    >
      {isAttack ? '\u2194' : '\u2192'} {edge.weight.toFixed(2)}
    </span>
  );
}

interface QbafSummaryProps {
  nodes: ArgumentNetworkNode[];
  edges: ArgumentNetworkEdge[];
}

/** Summary panel showing QBAF statistics for the current debate */
export function QbafSummary({ nodes, edges }: QbafSummaryProps) {
  const qbafEnabled = useTaxonomyStore(s => s.qbafEnabled);
  if (!qbafEnabled) return null;

  const scoredNodes = nodes.filter(n => n.computed_strength != null);
  if (scoredNodes.length === 0) return null;

  const avgStrength = scoredNodes.reduce((sum, n) => sum + (n.computed_strength ?? 0), 0) / scoredNodes.length;
  const strongest = scoredNodes.reduce((best, n) => (n.computed_strength ?? 0) > (best.computed_strength ?? 0) ? n : best, scoredNodes[0]);
  const weakest = scoredNodes.reduce((worst, n) => (n.computed_strength ?? 0) < (worst.computed_strength ?? 0) ? n : worst, scoredNodes[0]);
  const weightedEdges = edges.filter(e => e.weight != null);

  return (
    <div className="qbaf-summary">
      <div className="qbaf-summary-header">Argument Strength (QBAF)</div>
      <div className="qbaf-summary-stats">
        <span className="qbaf-stat">{scoredNodes.length} scored claims</span>
        <span className="qbaf-stat">Avg: {strengthBand(avgStrength).label}</span>
        {weightedEdges.length > 0 && <span className="qbaf-stat">{weightedEdges.length} weighted edges</span>}
      </div>
      {strongest && (
        <div className="qbaf-summary-extreme">
          <span className="qbaf-extreme-label">Strongest:</span>
          <span className="qbaf-extreme-text" title={strongest.text}>{strongest.text.slice(0, 80)}{strongest.text.length > 80 ? '...' : ''}</span>
          <QbafClaimBadge node={strongest} />
        </div>
      )}
      {weakest && weakest.id !== strongest?.id && (
        <div className="qbaf-summary-extreme">
          <span className="qbaf-extreme-label">Weakest:</span>
          <span className="qbaf-extreme-text" title={weakest.text}>{weakest.text.slice(0, 80)}{weakest.text.length > 80 ? '...' : ''}</span>
          <QbafClaimBadge node={weakest} />
        </div>
      )}
    </div>
  );
}
