// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo } from 'react';
import { useDebateStore } from '../hooks/useDebateStore';
import type { ConvergenceIssue, ConvergenceTracker } from '../types/debate';

// ── SVG Radar Chart ───────────────────────────────────

const SIZE = 380;
const CENTER = SIZE / 2;
const RADIUS = 120;
const GRID_LEVELS = [0.25, 0.5, 0.75, 1.0];
const MAX_LABEL_LEN = 30;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '\u2026' : s;
}

function polarToCart(angle: number, r: number): [number, number] {
  // Start from top (- PI/2) and go clockwise
  const a = angle - Math.PI / 2;
  return [CENTER + r * Math.cos(a), CENTER + r * Math.sin(a)];
}

interface RadarChartProps {
  issues: ConvergenceIssue[];
  onIssueClick?: (issue: ConvergenceIssue) => void;
}

function RadarChart({ issues, onIssueClick }: RadarChartProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const n = issues.length;
  if (n < 2) {
    return (
      <div className="convergence-radar-empty">
        Waiting for data — need at least 2 issues with claims from multiple debaters
      </div>
    );
  }

  const angleStep = (2 * Math.PI) / n;

  // Build the current convergence polygon
  const points = issues.map((issue, i) => {
    const r = issue.convergence * RADIUS;
    return polarToCart(i * angleStep, r);
  });
  const polygonStr = points.map(([x, y]) => `${x},${y}`).join(' ');

  // Ghost polygon from previous turn (second-to-last history entry)
  const ghostPoints = issues.map((issue, i) => {
    const hist = issue.history;
    const prev = hist.length >= 2 ? hist[hist.length - 2].value : issue.convergence;
    return polarToCart(i * angleStep, prev * RADIUS);
  });
  const ghostStr = ghostPoints.map(([x, y]) => `${x},${y}`).join(' ');

  return (
    <svg
      className="convergence-radar-svg"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
    >
      {/* Grid circles */}
      {GRID_LEVELS.map(level => (
        <circle
          key={level}
          cx={CENTER}
          cy={CENTER}
          r={level * RADIUS}
          className="convergence-grid-circle"
        />
      ))}

      {/* Axis lines */}
      {issues.map((_, i) => {
        const [x, y] = polarToCart(i * angleStep, RADIUS);
        return (
          <line
            key={`axis-${i}`}
            x1={CENTER}
            y1={CENTER}
            x2={x}
            y2={y}
            className="convergence-axis-line"
          />
        );
      })}

      {/* Ghost polygon (previous turn) */}
      <polygon
        points={ghostStr}
        className="convergence-ghost-polygon"
      />

      {/* Current polygon */}
      <polygon
        points={polygonStr}
        className="convergence-polygon"
      />

      {/* Data points */}
      {issues.map((issue, i) => {
        const [x, y] = points[i];
        return (
          <circle
            key={`pt-${issue.id}`}
            cx={x}
            cy={y}
            r={hovered === issue.id ? 5 : 3.5}
            className={`convergence-point${hovered === issue.id ? ' hovered' : ''}`}
            onMouseEnter={() => setHovered(issue.id)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onIssueClick?.(issue)}
          />
        );
      })}

      {/* Labels */}
      {issues.map((issue, i) => {
        const labelR = RADIUS + 24;
        const [x, y] = polarToCart(i * angleStep, labelR);
        const angle = i * angleStep;
        // Normalize angle to 0–2PI range (after the -PI/2 offset in polarToCart)
        const normAngle = ((angle - Math.PI / 2) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        // Right half of circle → start anchor, left half → end anchor, near top/bottom → middle
        const anchor = normAngle > 0.3 && normAngle < Math.PI - 0.3 ? 'start'
          : normAngle > Math.PI + 0.3 && normAngle < 2 * Math.PI - 0.3 ? 'end'
          : 'middle';
        return (
          <text
            key={`lbl-${issue.id}`}
            x={x}
            y={y}
            textAnchor={anchor}
            dominantBaseline="central"
            className={`convergence-label${hovered === issue.id ? ' hovered' : ''}`}
            onMouseEnter={() => setHovered(issue.id)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onIssueClick?.(issue)}
          >
            <title>{issue.label} ({(issue.convergence * 100).toFixed(0)}%)</title>
            {truncate(issue.label, MAX_LABEL_LEN)}
          </text>
        );
      })}

      {/* Center score label */}
      {hovered && (() => {
        const issue = issues.find(i => i.id === hovered);
        if (!issue) return null;
        return (
          <text
            x={CENTER}
            y={CENTER}
            textAnchor="middle"
            dominantBaseline="central"
            className="convergence-center-label"
          >
            {(issue.convergence * 100).toFixed(0)}%
          </text>
        );
      })()}
    </svg>
  );
}

// ── Convergence Panel ─────────────────────────────────

interface ConvergencePanelProps {
  tracker: ConvergenceTracker;
}

export function ConvergencePanel({ tracker }: ConvergencePanelProps) {
  const { swapConvergenceIssue } = useDebateStore();
  const [swapTarget, setSwapTarget] = useState<string | null>(null);

  const hasOverflow = tracker.available_issues.length > 0;

  const handleSwap = (removeId: string, add: { taxonomy_ref: string; label: string }) => {
    swapConvergenceIssue(removeId, add.taxonomy_ref, add.label);
    setSwapTarget(null);
  };

  // Average convergence
  const avg = useMemo(() => {
    if (tracker.issues.length === 0) return 0;
    return tracker.issues.reduce((s, i) => s + i.convergence, 0) / tracker.issues.length;
  }, [tracker.issues]);

  return (
    <div className="convergence-panel">
      <div className="convergence-panel-header">
        <span className="convergence-panel-title">
          Convergence
        </span>
        <span className="convergence-panel-avg">
          avg {(avg * 100).toFixed(0)}%
        </span>
      </div>

      <div className="convergence-panel-body">
        <RadarChart
          issues={tracker.issues}
          onIssueClick={(issue) => setSwapTarget(swapTarget === issue.id ? null : issue.id)}
        />

        {/* Swap UI */}
        {swapTarget && hasOverflow && (
          <div className="convergence-swap">
            <div className="convergence-swap-label">
              Replace "{tracker.issues.find(i => i.id === swapTarget)?.label}" with:
            </div>
            <div className="convergence-swap-options">
              {tracker.available_issues.slice(0, 8).map(a => (
                <button
                  key={a.taxonomy_ref}
                  className="convergence-swap-pill"
                  onClick={() => handleSwap(swapTarget, a)}
                  title={`${a.label} (${a.claim_count} claims)`}
                >
                  {truncate(a.label, 30)} ({a.claim_count})
                </button>
              ))}
            </div>
            <button className="convergence-swap-cancel" onClick={() => setSwapTarget(null)}>Cancel</button>
          </div>
        )}

        {/* Overflow pills */}
        {!swapTarget && hasOverflow && (
          <div className="convergence-overflow">
            <span className="convergence-overflow-label">
              +{tracker.available_issues.length} more issues (click a node to swap)
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
