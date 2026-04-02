// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { Source, PovCamp } from '../types/types';
import { POV_COLORS, POV_LABELS } from '../types/types';

interface Props {
  source: Source;
}

const CAMPS: PovCamp[] = ['accelerationist', 'safetyist', 'skeptic', 'situations'];

export default function SummaryStats({ source }: Props) {
  const points = source.points;
  const total = points.length;

  // Per-camp counts (how many points have at least one mapping to this camp)
  const campCounts: Record<string, number> = {};
  for (const camp of CAMPS) {
    campCounts[camp] = points.filter(p => p.mappings.some(m => m.camp === camp)).length;
  }

  const contradictions = points.filter(p =>
    p.mappings.some(m => m.alignment === 'contradicts')
  ).length;

  const unmapped = points.filter(p => p.mappings.length === 0).length;

  return (
    <div className="summary-stats">
      <div className="stat-item">
        <span className="stat-value">{total}</span>
        <span>total points</span>
      </div>
      <div className="stat-item">
        <span className="stat-value" style={{ color: 'var(--color-contradicts)' }}>{contradictions}</span>
        <span>contradictions</span>
      </div>
      {CAMPS.map(camp => (
        <div key={camp} className="stat-item">
          <span className="stat-dot" style={{ background: POV_COLORS[camp] }} />
          <span className="stat-value">{campCounts[camp]}</span>
          <span>{POV_LABELS[camp]}</span>
        </div>
      ))}
      <div className="stat-item">
        <span className="stat-value" style={{ color: 'var(--color-unmapped)' }}>{unmapped}</span>
        <span>unmapped</span>
      </div>
    </div>
  );
}
