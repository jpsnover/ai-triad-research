// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { DIMENSION_LABELS, RATING_COLORS } from './constants';
import type { StructuralScore, FrameScore } from '@lib/debate/topicCritique';

export function RadarChart({ structural, frame }: { structural: StructuralScore; frame: FrameScore | null }) {
  const dimensions = [
    { key: 'crux_density', value: structural.crux_density },
    { key: 'evidence_coverage', value: structural.evidence_coverage },
    { key: 'bdi_heterogeneity', value: structural.bdi_heterogeneity },
    { key: 'abstraction_level', value: structural.abstraction_level },
    { key: 'situation_activation', value: structural.situation_activation },
    { key: 'conditionality', value: frame?.conditionality ?? 0 },
    { key: 'mechanism', value: frame?.mechanism ?? 0 },
    { key: 'stakeholder', value: frame?.stakeholder ?? 0 },
    { key: 'tension', value: frame?.tension ?? 0 },
    { key: 'scope', value: frame?.scope ?? 0 },
  ];

  const cx = 100, cy = 100, r = 75;
  const n = dimensions.length;
  const angleStep = (2 * Math.PI) / n;
  const maxVal = 2;

  const pointAt = (i: number, val: number) => {
    const angle = -Math.PI / 2 + i * angleStep;
    const dist = (val / maxVal) * r;
    return { x: cx + dist * Math.cos(angle), y: cy + dist * Math.sin(angle) };
  };

  // Grid rings at 1 and 2
  const ringPaths = [1, 2].map(ring => {
    const pts = Array.from({ length: n }, (_, i) => pointAt(i, ring));
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + ' Z';
  });

  // Data polygon
  const dataPts = dimensions.map((d, i) => pointAt(i, d.value));
  const dataPath = dataPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + ' Z';

  // Axis lines
  const axes = Array.from({ length: n }, (_, i) => pointAt(i, maxVal));

  return (
    <svg viewBox="0 0 200 200" style={{ width: 200, height: 200 }}>
      {/* Grid rings */}
      {ringPaths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="var(--border-color, #555)" strokeWidth={0.5} opacity={0.4} />
      ))}
      {/* Axis lines */}
      {axes.map((p, i) => (
        <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="var(--border-color, #555)" strokeWidth={0.3} opacity={0.3} />
      ))}
      {/* Data polygon */}
      <path d={dataPath} fill="var(--accent-color, #3b82f6)" fillOpacity={0.2} stroke="var(--accent-color, #3b82f6)" strokeWidth={1.5} />
      {/* Data points */}
      {dataPts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={2.5}
          fill={([RATING_COLORS.weak, RATING_COLORS.fair, RATING_COLORS.strong] as string[])[dimensions[i].value] ?? RATING_COLORS.strong}
        />
      ))}
      {/* Labels */}
      {axes.map((p, i) => {
        const label = DIMENSION_LABELS[dimensions[i].key] ?? dimensions[i].key;
        const dx = p.x - cx, dy = p.y - cy;
        const labelDist = 14;
        const lx = p.x + (dx / r) * labelDist;
        const ly = p.y + (dy / r) * labelDist;
        const anchor = Math.abs(dx) < 5 ? 'middle' : dx > 0 ? 'start' : 'end';
        return (
          <text key={i} x={lx} y={ly} textAnchor={anchor} dominantBaseline="central"
            style={{ fontSize: 7.5, fill: 'var(--text-secondary, #999)' }}>
            {label}
          </text>
        );
      })}
    </svg>
  );
}
