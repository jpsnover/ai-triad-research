// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo } from 'react';
import type { DebateSession, ConvergenceSignals } from '../types/debate';
import { POVER_INFO } from '../types/debate';
import type { PoverId } from '../types/debate';

interface Props {
  debate: DebateSession;
}

function speakerLabel(speaker: PoverId): string {
  if (speaker === 'user') return 'You';
  return POVER_INFO[speaker as Exclude<PoverId, 'user'>]?.label || speaker;
}

function speakerColor(speaker: PoverId): string {
  const colors: Record<string, string> = {
    prometheus: '#f59e0b',
    sentinel: '#3b82f6',
    cassandra: '#a855f7',
    user: '#10b981',
  };
  return colors[speaker] ?? '#94a3b8';
}

function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

function OutcomeBadge({ outcome }: { outcome: 'taken' | 'missed' | 'none' }) {
  const styles: Record<string, { bg: string; fg: string; label: string }> = {
    taken: { bg: 'rgba(34,197,94,0.15)', fg: '#22c55e', label: 'Taken' },
    missed: { bg: 'rgba(239,68,68,0.15)', fg: '#ef4444', label: 'Missed' },
    none: { bg: 'rgba(148,163,184,0.15)', fg: '#94a3b8', label: 'N/A' },
  };
  const s = styles[outcome];
  return (
    <span style={{
      background: s.bg, color: s.fg, padding: '1px 6px', borderRadius: 3,
      fontSize: '0.6rem', fontWeight: 700, whiteSpace: 'nowrap',
    }}>{s.label}</span>
  );
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = max > 0 ? Math.min(1, value / max) * 100 : 0;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <div style={{ width: 50, height: 6, background: 'var(--bg-tertiary, #333)', borderRadius: 3 }}>
        <div style={{ width: `${w}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{value.toFixed(2)}</span>
    </div>
  );
}

function DispositionChart({ signals }: { signals: ConvergenceSignals[] }) {
  const W = 420, H = 90, PAD = 20;
  if (signals.length < 2) return null;
  const maxRound = signals[signals.length - 1].round;
  const x = (round: number) => PAD + ((round - 1) / Math.max(1, maxRound - 1)) * (W - 2 * PAD);

  const speakers = [...new Set(signals.map(s => s.speaker))];
  const linesBySpkr = speakers.map(spkr => {
    const pts = signals.filter(s => s.speaker === spkr);
    return {
      speaker: spkr,
      points: pts.map(p => `${x(p.round)},${H - PAD - p.move_disposition.ratio * (H - 2 * PAD)}`).join(' '),
    };
  });

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 2 }}>
        Collaborative Ratio Over Time
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        style={{ display: 'block', width: '100%', height: H, maxWidth: 720 }}>
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--border)" strokeWidth={0.5} />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="var(--border)" strokeWidth={0.5} />
        <text x={PAD - 2} y={PAD + 4} textAnchor="end" fontSize={7} fill="var(--text-muted)">1.0</text>
        <text x={PAD - 2} y={H - PAD + 4} textAnchor="end" fontSize={7} fill="var(--text-muted)">0.0</text>
        {linesBySpkr.map(l => (
          <polyline key={l.speaker} fill="none" stroke={speakerColor(l.speaker as PoverId)}
            strokeWidth={1.5} points={l.points} />
        ))}
      </svg>
      <div style={{ display: 'flex', gap: 12, fontSize: '0.6rem' }}>
        {speakers.map(s => (
          <span key={s} style={{ color: speakerColor(s as PoverId) }}>
            {speakerLabel(s as PoverId)}
          </span>
        ))}
      </div>
    </div>
  );
}

function SummaryStats({ signals }: { signals: ConvergenceSignals[] }) {
  const speakers = [...new Set(signals.map(s => s.speaker))];
  const stats = speakers.map(spkr => {
    const spkrSignals = signals.filter(s => s.speaker === spkr);
    const missedCount = spkrSignals.filter(s => s.concession_opportunity.outcome === 'missed').length;
    const takenCount = spkrSignals.filter(s => s.concession_opportunity.outcome === 'taken').length;
    const opportunityCount = missedCount + takenCount;
    const avgCollabRatio = spkrSignals.reduce((sum, s) => sum + s.move_disposition.ratio, 0) / (spkrSignals.length || 1);
    const avgRecycling = spkrSignals.reduce((sum, s) => sum + s.recycling_rate.max_self_overlap, 0) / (spkrSignals.length || 1);
    const cruxTotal = spkrSignals.length > 0 ? spkrSignals[spkrSignals.length - 1].crux_rate.cumulative_count : 0;
    return { speaker: spkr, missedCount, takenCount, opportunityCount, avgCollabRatio, avgRecycling, cruxTotal };
  });

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: `repeat(${speakers.length}, 1fr)`, gap: 8, marginBottom: 12,
    }}>
      {stats.map(s => (
        <div key={s.speaker} style={{
          padding: 8, borderRadius: 6, background: 'var(--bg-tertiary, #2a2a2a)',
          border: `1px solid ${speakerColor(s.speaker as PoverId)}33`,
        }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: speakerColor(s.speaker as PoverId), marginBottom: 4 }}>
            {speakerLabel(s.speaker as PoverId)}
          </div>
          <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', display: 'grid', gap: 2 }}>
            <div>Collab ratio: <strong>{pct(s.avgCollabRatio)}</strong></div>
            <div>Concessions: <strong>{s.takenCount}/{s.opportunityCount}</strong> opportunities</div>
            <div>Avg recycling: <strong>{pct(s.avgRecycling)}</strong></div>
            <div>Crux moves: <strong>{s.cruxTotal}</strong></div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ConvergenceSignalsPanel({ debate }: Props) {
  const signals = debate.convergence_signals ?? [];
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const speakerFilter = useMemo(() => [...new Set(signals.map(s => s.speaker))], [signals]);
  const [filterSpeaker, setFilterSpeaker] = useState<string>('all');

  const filtered = useMemo(() => {
    if (filterSpeaker === 'all') return signals;
    return signals.filter(s => s.speaker === filterSpeaker);
  }, [signals, filterSpeaker]);

  if (signals.length === 0) {
    return (
      <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: '0.8rem' }}>
        No convergence signals recorded yet. Signals are computed after each claim extraction during debate turns.
      </div>
    );
  }

  const selected = selectedIdx !== null ? filtered[selectedIdx] : null;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <SummaryStats signals={signals} />
      <DispositionChart signals={signals} />

      <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Filter:</span>
        <button
          onClick={() => setFilterSpeaker('all')}
          style={{
            padding: '2px 8px', fontSize: '0.6rem', borderRadius: 3, cursor: 'pointer',
            border: '1px solid var(--border)',
            background: filterSpeaker === 'all' ? '#f59e0b' : 'transparent',
            color: filterSpeaker === 'all' ? '#000' : 'var(--text-primary)',
          }}
        >All</button>
        {speakerFilter.map(s => (
          <button
            key={s}
            onClick={() => setFilterSpeaker(s)}
            style={{
              padding: '2px 8px', fontSize: '0.6rem', borderRadius: 3, cursor: 'pointer',
              border: `1px solid ${speakerColor(s)}`,
              background: filterSpeaker === s ? speakerColor(s) : 'transparent',
              color: filterSpeaker === s ? '#000' : speakerColor(s),
            }}
          >{speakerLabel(s)}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.65rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--bg-secondary)' }}>
              <th style={{ padding: '4px 6px', textAlign: 'left' }}>Rnd</th>
              <th style={{ padding: '4px 6px', textAlign: 'left' }}>Speaker</th>
              <th style={{ padding: '4px 6px', textAlign: 'center' }}>Conf/Collab</th>
              <th style={{ padding: '4px 6px', textAlign: 'center' }}>Engagement</th>
              <th style={{ padding: '4px 6px', textAlign: 'center' }}>Recycling</th>
              <th style={{ padding: '4px 6px', textAlign: 'center' }}>Concession</th>
              <th style={{ padding: '4px 6px', textAlign: 'center' }}>Drift</th>
              <th style={{ padding: '4px 6px', textAlign: 'center' }}>Crux</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((sig, i) => (
              <tr
                key={sig.entry_id}
                onClick={() => setSelectedIdx(selectedIdx === i ? null : i)}
                style={{
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: selectedIdx === i ? 'rgba(245,158,11,0.1)' : undefined,
                }}
              >
                <td style={{ padding: '4px 6px' }}>{sig.round}</td>
                <td style={{ padding: '4px 6px', color: speakerColor(sig.speaker) }}>
                  {speakerLabel(sig.speaker)}
                </td>
                <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                  <span style={{ color: '#ef4444' }}>{sig.move_disposition.confrontational}</span>
                  {' / '}
                  <span style={{ color: '#22c55e' }}>{sig.move_disposition.collaborative}</span>
                </td>
                <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                  <MiniBar value={sig.engagement_depth.ratio} max={1} color="#3b82f6" />
                </td>
                <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                  <MiniBar value={sig.recycling_rate.max_self_overlap} max={1} color={sig.recycling_rate.max_self_overlap > 0.5 ? '#ef4444' : '#22c55e'} />
                </td>
                <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                  <OutcomeBadge outcome={sig.concession_opportunity.outcome} />
                </td>
                <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                  {pct(sig.position_delta.drift)}
                </td>
                <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                  {sig.crux_rate.used_this_turn ? '1' : '0'}
                  <span style={{ color: 'var(--text-muted)' }}> ({sig.crux_rate.cumulative_count})</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div style={{
          marginTop: 8, padding: 10, background: 'var(--bg-tertiary, #2a2a2a)',
          borderRadius: 6, fontSize: '0.65rem', maxHeight: 200, overflow: 'auto',
        }}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: speakerColor(selected.speaker) }}>
            Round {selected.round} — {speakerLabel(selected.speaker)} Detail
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
            <div>
              <strong>Move Disposition:</strong> {selected.move_disposition.confrontational} confrontational, {selected.move_disposition.collaborative} collaborative (ratio: {pct(selected.move_disposition.ratio)})
            </div>
            <div>
              <strong>Engagement:</strong> {selected.engagement_depth.targeted} targeted, {selected.engagement_depth.standalone} standalone (ratio: {pct(selected.engagement_depth.ratio)})
            </div>
            <div>
              <strong>Recycling:</strong> avg {pct(selected.recycling_rate.avg_self_overlap)}, max {pct(selected.recycling_rate.max_self_overlap)}
            </div>
            <div>
              <strong>Strongest Opposing:</strong>{' '}
              {selected.strongest_opposing
                ? `${selected.strongest_opposing.node_id} (str: ${selected.strongest_opposing.strength.toFixed(2)}, by ${selected.strongest_opposing.attacker})`
                : 'None'}
            </div>
            <div>
              <strong>Concession:</strong> {selected.concession_opportunity.strong_attacks_faced} strong attacks faced, used: {selected.concession_opportunity.concession_used ? 'Yes' : 'No'} — <OutcomeBadge outcome={selected.concession_opportunity.outcome} />
            </div>
            <div>
              <strong>Position Delta:</strong> opening overlap {pct(selected.position_delta.overlap_with_opening)}, drift {pct(selected.position_delta.drift)}
            </div>
            <div>
              <strong>Crux Rate:</strong> this turn: {selected.crux_rate.used_this_turn ? 'Yes' : 'No'}, cumulative: {selected.crux_rate.cumulative_count}, follow-through: {selected.crux_rate.cumulative_follow_through}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
