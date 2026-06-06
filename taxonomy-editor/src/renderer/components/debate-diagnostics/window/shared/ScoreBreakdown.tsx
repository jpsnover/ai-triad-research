// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { DIMENSION_WEIGHTS } from './constants';
import type { TurnValidation, TurnValidationDimensions } from '../../../../types/debate';
import { humanizeSpeakerIds } from '../../../../utils/humanizeSpeakers';

// NOTE: TrafficLight stays in DiagnosticsWindow.tsx (parent). It is not used by these
// components directly — ScoreBreakdown uses its own inline pass/fail indicators.

function DimensionScoreRow({ name, pass, weight, details }: {
  name: string; pass: boolean; weight: number; details: string[];
}) {
  const score = pass ? 1 : 0;
  const weighted = weight * score;
  const desc = DIMENSION_WEIGHTS[name]?.description ?? name;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: '0.72rem', padding: '3px 0' }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 100,
        color: pass ? '#16a34a' : '#dc2626', fontWeight: 600,
      }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />
        {name}
      </span>
      <span style={{ minWidth: 36, color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)', fontSize: '0.68rem' }}>
        ×{weight.toFixed(1)}
      </span>
      <span style={{
        minWidth: 36, fontWeight: 700, fontFamily: 'var(--font-mono, monospace)', fontSize: '0.68rem',
        color: pass ? '#16a34a' : '#dc2626',
      }}>
        {weighted.toFixed(2)}
      </span>
      <span style={{ color: 'var(--text-muted)', fontSize: '0.66rem', flex: 1 }} title={desc}>
        {details.length > 0
          ? humanizeSpeakerIds(details.join('; '))
          : (pass ? desc : 'FAIL')}
      </span>
    </div>
  );
}

export function ScoreBreakdown({ dims, processReward, judgeUsed }: {
  dims: TurnValidationDimensions;
  processReward: number;
  judgeUsed: boolean;
}) {
  const stageAScore =
    0.4 * (dims.schema.pass ? 1 : 0) +
    0.3 * (dims.grounding.pass ? 1 : 0) +
    0.2 * (dims.advancement.pass ? 1 : 0) +
    0.1 * (dims.clarifies.pass ? 1 : 0);
  // Back-calculate judge quality: process_reward = 0.4 * stageA + 0.6 * judgeQuality
  const judgeQuality = stageAScore > 0
    ? Math.max(0, Math.min(1, (processReward - 0.4 * stageAScore) / 0.6))
    : 0.7;

  const mono = { fontFamily: 'var(--font-mono, monospace)', fontSize: '0.68rem' } as const;

  return (
    <div style={{
      background: 'var(--bg-subtle)', borderRadius: 4, padding: '6px 10px',
      fontSize: '0.72rem', marginBottom: 8,
    }}>
      <div style={{ fontWeight: 600, marginBottom: 6, fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Score breakdown
      </div>
      <DimensionScoreRow name="schema"      pass={dims.schema.pass}      weight={0.4} details={dims.schema.issues ?? []} />
      <DimensionScoreRow name="grounding"   pass={dims.grounding.pass}   weight={0.3} details={dims.grounding.issues ?? []} />
      <DimensionScoreRow name="advancement" pass={dims.advancement.pass} weight={0.2} details={dims.advancement.signals ?? []} />
      <DimensionScoreRow name="clarifies"   pass={dims.clarifies.pass}   weight={0.1} details={dims.clarifies.signals ?? []} />
      <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0', paddingTop: 4, display: 'flex', gap: 16 }}>
        <span>Stage A: <strong style={mono}>{stageAScore.toFixed(2)}</strong> <span style={{ color: 'var(--text-muted)' }}>× 0.4 = {(0.4 * stageAScore).toFixed(2)}</span></span>
        <span>Judge: <strong style={mono}>{judgeQuality.toFixed(2)}</strong>{!judgeUsed && <span style={{ color: 'var(--text-muted)' }}> (default)</span>} <span style={{ color: 'var(--text-muted)' }}>× 0.6 = {(0.6 * judgeQuality).toFixed(2)}</span></span>
        <span>Total: <strong style={mono}>{processReward.toFixed(2)}</strong></span>
      </div>
    </div>
  );
}

export function OutcomeBadge({ outcome }: { outcome: TurnValidation['outcome'] }) {
  const palette: Record<TurnValidation['outcome'], { bg: string; fg: string; text: string }> = {
    pass:              { bg: 'rgba(34,197,94,0.15)',  fg: '#16a34a', text: 'PASS' },
    accept_with_flag:  { bg: 'rgba(234,179,8,0.18)',  fg: '#b45309', text: 'ACCEPT (flagged)' },
    retry:             { bg: 'rgba(239,68,68,0.15)',  fg: '#dc2626', text: 'RETRY' },
    skipped:           { bg: 'rgba(148,163,184,0.18)', fg: '#475569', text: 'SKIPPED' },
  };
  const c = palette[outcome] ?? palette.pass;
  return (
    <span style={{
      background: c.bg, color: c.fg, fontWeight: 700, fontSize: '0.7rem',
      padding: '2px 8px', borderRadius: 10, letterSpacing: 0.5,
    }}>{c.text}</span>
  );
}
