// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect } from 'react';
import type { DebateTestedTier, DebateTestedRecord } from '../../bridge/types';
import './DebateTestedChip.css';

const TIER_COLORS: Record<DebateTestedTier, { bg: string; fg: string }> = {
  untested:    { bg: '#e2e8f0', fg: '#475569' },
  cited:       { bg: '#dbeafe', fg: '#1e40af' },
  contested:   { bg: '#fef3c7', fg: '#92400e' },
  well_tested: { bg: '#bbf7d0', fg: '#166534' },
};

const TIER_LABELS: Record<DebateTestedTier, string> = {
  untested: 'Untested',
  cited: 'Cited',
  contested: 'Contested',
  well_tested: 'Well Tested',
};

export async function computeSha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}

interface DebateTestedChipProps {
  record?: DebateTestedRecord;
  description?: string;
  onClick?: () => void;
  compact?: boolean;
}

export function DebateTestedChip({ record, description, onClick, compact }: DebateTestedChipProps) {
  const tier: DebateTestedTier = record?.tier ?? 'untested';
  const colors = TIER_COLORS[tier];
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    if (!record?.description_hash || !description) {
      setIsStale(!record ? false : !record.description_hash);
      return;
    }
    let cancelled = false;
    void computeSha256(description).then(hash => {
      if (!cancelled) setIsStale(hash !== record.description_hash);
    });
    return () => { cancelled = true; };
  }, [record?.description_hash, description]);

  return (
    <span
      className={`debate-tested-chip${onClick ? ' clickable' : ''}${compact ? ' compact' : ''}`}
      style={{ background: colors.bg, color: colors.fg }}
      onClick={onClick}
      title={isStale ? 'Stale — node description changed since last test' : `Debate-Tested: ${TIER_LABELS[tier]}`}
    >
      {TIER_LABELS[tier]}
      {isStale && <span className="debate-tested-stale" title="Description changed since last test">⚠</span>}
    </span>
  );
}

export { TIER_LABELS as DEBATE_TESTED_TIER_LABELS };
export type { DebateTestedChipProps };
