// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import './ScoreBadge.css';
import { bandColor } from '../../../../lib/bandColor';
import type { BandEntry } from '../../../../lib/bandColor';

const SCORE_BANDS: readonly BandEntry[] = [
  { threshold: 0.7, color: 'score-badge--success' },
  { threshold: 0.4, color: 'score-badge--warning' },
  { threshold: 0,   color: 'score-badge--danger' },
];

interface ScoreBadgeProps {
  value: number;
  label: string;
  tooltip?: string;
  compact?: boolean;
}

export function ScoreBadge({ value, label, tooltip, compact = false }: ScoreBadgeProps) {
  const clamped = Math.max(0, Math.min(1, value));
  const pct = clamped * 100;
  const displayLabel = compact ? abbreviate(label) : humanize(label);

  return (
    <span
      className={`score-badge ${bandColor(clamped, SCORE_BANDS)}`}
      title={tooltip ?? `${humanize(label)}: ${clamped.toFixed(2)} (0–1 scale)`}
    >
      <span className="score-badge-label">{displayLabel}</span>
      <span
        className="score-badge-bar"
        style={{ '--score-pct': `${pct}%` } as React.CSSProperties}
      />
      <span className="score-badge-value">{clamped.toFixed(2)}</span>
    </span>
  );
}

function humanize(key: string): string {
  return key.replace(/_/g, ' ');
}

const ABBREVIATIONS: Record<string, string> = {
  evidence_quality: 'evid',
  source_reliability: 'src',
  falsifiability: 'fals',
  values_grounding: 'val',
  tradeoff_acknowledgment: 'trade',
  precedent_citation: 'prec',
  mechanism_specificity: 'mech',
  scope_bounding: 'scope',
  failure_mode_addressing: 'fail',
  position_strength: 'pos',
  attack_effectiveness: 'atk',
  crux_engagement: 'crux',
};

function abbreviate(key: string): string {
  return ABBREVIATIONS[key] ?? key.slice(0, 4);
}
