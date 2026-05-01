// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { DebateSession, ConvergenceSignals } from '../types/debate';
import { POVER_INFO } from '../types/debate';
import type { PoverId } from '../types/debate';
import { SUPPORT_MOVES } from '@lib/debate/helpers';

interface Props {
  debate: DebateSession;
}

const TOOLTIPS = {
  collabRatio: 'Average proportion of collaborative vs confrontational moves.\nCollaborative: concede, integrate, steel-build, identify-crux.\nConfrontational: counterexample, undercut, empirical challenge, burden-shift, expose-assumption.\nHigher = more convergence-oriented.',
  concessions: 'How many concession opportunities were taken out of total.\nAn opportunity = facing a strong attack with QBAF strength >= 0.6 and using a concession move (CONCEDE, CONCEDE-AND-PIVOT, CONDITIONAL-AGREE).',
  recycling: 'Average max word-overlap with the speaker\'s own prior turns.\nHigh values (>50%) mean the debater is repeating themselves rather than evolving their position.',
  cruxMoves: 'Cumulative count of IDENTIFY-CRUX moves.\nCruxes are key disagreement points that, if resolved, would change a debater\'s position.',
  chartTitle: 'How each debater\'s collaborative-to-confrontational ratio evolves turn by turn.\nLines trending upward indicate more collaboration as the debate matures.',
  confCollab: 'Count of confrontational (red) vs collaborative (green) moves this turn.\nConfrontational: counterexample, undercut, empirical challenge, burden-shift, expose-assumption.\nCollaborative: concede, concede-and-pivot, conditional-agree, integrate, steel-build, identify-crux.',
  engagement: 'Fraction of this turn\'s claims that connect to existing argument network nodes (targeted) vs standalone new claims.\nHigher = more engaged with prior arguments.',
  recyclingCol: 'Max word-overlap between this turn\'s content and the speaker\'s prior turns.\nRed (>50%) indicates high repetition.',
  concessionCol: 'Whether the speaker faced strong attacks (QBAF >= 0.6) and used a concession move.\nTaken (green) = conceded. Missed (red) = faced attacks but didn\'t concede. N/A = no strong attacks faced.',
  drift: 'How much the speaker\'s position changed since their last turn.\nMeasured as delta in word-overlap with their opening statement.',
  cruxCol: 'Whether IDENTIFY-CRUX was used this turn (1 or 0), with cumulative count across all turns.\nCruxes are disagreement points that, if resolved, would change a debater\'s position.',
};

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
      <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 2, cursor: 'help' }}
        title={TOOLTIPS.chartTitle}>
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
    const avgRecycling = spkrSignals.reduce((sum, s) => sum + Math.max(s.recycling_rate.max_self_overlap, s.recycling_rate.semantic_max_similarity ?? 0), 0) / (spkrSignals.length || 1);
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
          <div style={{ fontSize: '0.72rem', color: '#e2e8f0', display: 'grid', gap: 2 }}>
            <div title={TOOLTIPS.collabRatio} style={{ cursor: 'help' }}>Collab ratio: <strong>{pct(s.avgCollabRatio)}</strong></div>
            <div title={TOOLTIPS.concessions} style={{ cursor: 'help' }}>Concessions: <strong>{s.takenCount}/{s.opportunityCount}</strong> opportunities</div>
            <div title={TOOLTIPS.recycling} style={{ cursor: 'help' }}>Avg recycling: <strong>{pct(s.avgRecycling)}</strong></div>
            <div title={TOOLTIPS.cruxMoves} style={{ cursor: 'help' }}>Crux moves: <strong>{s.cruxTotal}</strong></div>
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
  const containerRef = useRef<HTMLDivElement>(null);

  const navigate = useCallback((delta: number) => {
    if (filtered.length === 0) return;
    setSelectedIdx(prev => {
      if (prev === null) return 0;
      const next = prev + delta;
      if (next < 0 || next >= filtered.length) return prev;
      return next;
    });
  }, [filtered.length]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      if (selectedIdx === null) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); navigate(1); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); navigate(-1); }
      else if (e.key === 'Escape') { e.preventDefault(); setSelectedIdx(null); }
    };
    el.addEventListener('keydown', handler);
    return () => el.removeEventListener('keydown', handler);
  }, [selectedIdx, navigate]);

  const concessionVerbatims = useMemo(() => {
    if (!selected) return [];
    const an = debate.argument_network;
    if (!an) return [];
    const turnNodeIds = new Set(an.nodes.filter(n => n.source_entry_id === selected.entry_id).map(n => n.id));
    const supportEdges = an.edges.filter(e =>
      e.type === 'supports' && turnNodeIds.has(e.source) && e.scheme &&
      (() => {
        const norm = e.scheme!.toUpperCase().replace(/[_]/g, '-').trim();
        return SUPPORT_MOVES.has(norm) || SUPPORT_MOVES.has(norm.replace(/-/g, ' '));
      })(),
    );
    return supportEdges.map(e => {
      const sourceNode = an.nodes.find(n => n.id === e.source);
      const targetNode = an.nodes.find(n => n.id === e.target);
      return { scheme: e.scheme ?? 'supports', sourceText: sourceNode?.text ?? '', targetText: targetNode?.text ?? '', targetId: e.target, sourceId: e.source };
    });
  }, [selected, debate.argument_network]);

  return (
    <div ref={containerRef} tabIndex={0} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', outline: 'none' }}>
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
        <table style={{ borderCollapse: 'collapse', fontSize: '0.65rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--bg-secondary)' }}>
              <th style={{ padding: '4px 4px', textAlign: 'left' }}>Rnd</th>
              <th style={{ padding: '4px 4px', textAlign: 'left' }}>Speaker</th>
              <th style={{ padding: '4px 4px', textAlign: 'center', cursor: 'help' }} title={TOOLTIPS.confCollab}>Conf/Collab</th>
              <th style={{ padding: '4px 4px', textAlign: 'center', cursor: 'help' }} title={TOOLTIPS.engagement}>Engagement</th>
              <th style={{ padding: '4px 4px', textAlign: 'center', cursor: 'help' }} title={TOOLTIPS.recyclingCol}>Recycling</th>
              <th style={{ padding: '4px 4px', textAlign: 'center', cursor: 'help' }} title={TOOLTIPS.concessionCol}>Concession</th>
              <th style={{ padding: '4px 4px', textAlign: 'center', cursor: 'help' }} title={TOOLTIPS.drift}>Drift</th>
              <th style={{ padding: '4px 4px', textAlign: 'center', cursor: 'help' }} title={TOOLTIPS.cruxCol}>Crux</th>
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
                <td style={{ padding: '4px 4px' }}>{sig.round}</td>
                <td style={{ padding: '4px 4px', color: speakerColor(sig.speaker) }}>
                  {speakerLabel(sig.speaker)}
                </td>
                <td style={{ padding: '4px 4px', textAlign: 'center' }}>
                  <span style={{ color: '#ef4444' }}>{sig.move_disposition.confrontational}</span>
                  {' / '}
                  <span style={{ color: '#22c55e' }}>{sig.move_disposition.collaborative}</span>
                </td>
                <td style={{ padding: '4px 4px', textAlign: 'center' }}>
                  <MiniBar value={sig.engagement_depth.ratio} max={1} color="#3b82f6" />
                </td>
                <td style={{ padding: '4px 4px', textAlign: 'center' }}>
                  {(() => {
                    const effective = Math.max(sig.recycling_rate.max_self_overlap, sig.recycling_rate.semantic_max_similarity ?? 0);
                    return <MiniBar value={effective} max={1} color={sig.recycling_rate.semantically_recycled ? '#ef4444' : effective > 0.5 ? '#f59e0b' : '#22c55e'} />;
                  })()}
                </td>
                <td style={{ padding: '4px 4px', textAlign: 'center' }}>
                  <OutcomeBadge outcome={sig.concession_opportunity.outcome} />
                </td>
                <td style={{ padding: '4px 4px', textAlign: 'center' }}>
                  {pct(sig.position_delta.drift)}
                </td>
                <td style={{ padding: '4px 4px', textAlign: 'center' }}>
                  {sig.crux_rate.used_this_turn ? '1' : '0'}
                  <span style={{ color: 'var(--text-muted)' }}> ({sig.crux_rate.cumulative_count})</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (() => {
        const md = selected.move_disposition;
        const ed = selected.engagement_depth;
        const rr = selected.recycling_rate;
        const so = selected.strongest_opposing;
        const co = selected.concession_opportunity;
        const pd = selected.position_delta;
        const cr = selected.crux_rate;
        const lbl: React.CSSProperties = { color: '#94a3b8', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.03em' };
        const val: React.CSSProperties = { color: '#e2e8f0', fontSize: '0.7rem' };
        const cell: React.CSSProperties = { padding: '3px 6px', borderRadius: 3, background: 'rgba(255,255,255,0.03)' };
        return (
          <div style={{
            marginTop: 6, padding: 8, background: 'var(--bg-tertiary, #2a2a2a)',
            borderRadius: 4, maxHeight: 280, overflow: 'auto', color: '#e2e8f0',
            borderLeft: `3px solid ${speakerColor(selected.speaker)}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontWeight: 700, fontSize: '0.75rem', color: speakerColor(selected.speaker) }}>
                Round {selected.round} — {speakerLabel(selected.speaker)}
              </span>
              <span style={{ fontSize: '0.6rem', color: '#94a3b8' }}>← → to navigate, Esc to close</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
              <div style={cell}>
                <div style={lbl}>Disposition</div>
                <div style={val}>
                  <span style={{ color: '#ef4444' }}>{md.confrontational}C</span>{' / '}
                  <span style={{ color: '#22c55e' }}>{md.collaborative}S</span>
                  {' = '}<strong>{pct(md.ratio)}</strong>
                  {md.ratio >= 0.5
                    ? <span style={{ color: '#22c55e', marginLeft: 4, fontSize: '0.62rem' }}>cooperative</span>
                    : <span style={{ color: '#ef4444', marginLeft: 4, fontSize: '0.62rem' }}>confrontational</span>}
                </div>
              </div>
              <div style={cell}>
                <div style={lbl}>Engagement</div>
                <div style={val}>
                  {ed.targeted}/{ed.targeted + ed.standalone} targeted = <strong>{pct(ed.ratio)}</strong>
                  {ed.ratio >= 0.7
                    ? <span style={{ color: '#22c55e', marginLeft: 4, fontSize: '0.62rem' }}>deep</span>
                    : ed.ratio >= 0.4
                      ? <span style={{ color: '#f59e0b', marginLeft: 4, fontSize: '0.62rem' }}>moderate</span>
                      : <span style={{ color: '#ef4444', marginLeft: 4, fontSize: '0.62rem' }}>standalone</span>}
                </div>
              </div>
              <div style={cell}>
                <div style={lbl}>Recycling</div>
                <div style={val}>
                  avg <strong>{pct(rr.avg_self_overlap)}</strong>, max <strong>{pct(rr.max_self_overlap)}</strong>
                  {rr.semantic_max_similarity != null && (
                    <>, sem <strong>{pct(rr.semantic_max_similarity)}</strong></>
                  )}
                  {rr.semantically_recycled
                    ? <span style={{ color: '#ef4444', marginLeft: 4, fontSize: '0.62rem' }}>semantic repeat</span>
                    : rr.max_self_overlap >= 0.5
                      ? <span style={{ color: '#f59e0b', marginLeft: 4, fontSize: '0.62rem' }}>repeating</span>
                      : <span style={{ color: '#22c55e', marginLeft: 4, fontSize: '0.62rem' }}>fresh</span>}
                </div>
              </div>
              <div style={cell}>
                <div style={lbl}>Strongest Opposition</div>
                <div style={val}>
                  {so ? (
                    <>{so.node_id} str={so.strength.toFixed(2)} by {speakerLabel(so.attacker as PoverId)}
                      {so.strength >= 0.7
                        ? <span style={{ color: '#ef4444', marginLeft: 4, fontSize: '0.62rem' }}>strong</span>
                        : so.strength >= 0.5
                          ? <span style={{ color: '#f59e0b', marginLeft: 4, fontSize: '0.62rem' }}>moderate</span>
                          : <span style={{ color: '#22c55e', marginLeft: 4, fontSize: '0.62rem' }}>weak</span>}
                    </>
                  ) : <span style={{ color: '#64748b' }}>none</span>}
                </div>
              </div>
              <div style={cell}>
                <div style={lbl}>Concession</div>
                <div style={val}>
                  {co.strong_attacks_faced} attacks, used: {co.concession_used ? 'Y' : 'N'} — <OutcomeBadge outcome={co.outcome} />
                </div>
              </div>
              <div style={cell}>
                <div style={lbl}>Position Delta</div>
                <div style={val}>
                  opening: <strong>{pct(pd.overlap_with_opening)}</strong>, drift: <strong>{pct(pd.drift)}</strong>
                  {pd.overlap_with_opening >= 0.6
                    ? <span style={{ color: '#f59e0b', marginLeft: 4, fontSize: '0.62rem' }}>anchored</span>
                    : pd.overlap_with_opening < 0.3
                      ? <span style={{ color: '#3b82f6', marginLeft: 4, fontSize: '0.62rem' }}>shifted</span>
                      : <span style={{ color: '#22c55e', marginLeft: 4, fontSize: '0.62rem' }}>evolved</span>}
                </div>
              </div>
              <div style={{ ...cell, gridColumn: '1 / -1' }}>
                <div style={lbl}>Crux</div>
                <div style={val}>
                  this turn: {cr.used_this_turn ? 'Yes' : 'No'} | cumulative: {cr.cumulative_count} | follow-through: {cr.cumulative_follow_through}
                  {cr.cumulative_count > 0 && cr.cumulative_follow_through === 0 && (
                    <span style={{ color: '#f59e0b', marginLeft: 6, fontSize: '0.62rem' }}>no follow-through</span>
                  )}
                  {cr.cumulative_count > 0 && cr.cumulative_follow_through > 0 && (
                    <span style={{ color: '#22c55e', marginLeft: 6, fontSize: '0.62rem' }}>resolving</span>
                  )}
                </div>
              </div>
            </div>
            {concessionVerbatims.length > 0 && (
              <div style={{ marginTop: 6, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 4 }}>
                <div style={{ ...lbl, marginBottom: 3 }}>Concession Verbatims ({concessionVerbatims.length})</div>
                {concessionVerbatims.map((cv, i) => (
                  <div key={i} style={{ marginBottom: 4, padding: '3px 6px', borderRadius: 3, background: 'rgba(34,197,94,0.06)', borderLeft: '2px solid rgba(34,197,94,0.4)' }}>
                    <div style={{ fontSize: '0.62rem', color: '#94a3b8' }}>{cv.sourceId} → {cv.targetId} via {cv.scheme}</div>
                    <div style={{ fontSize: '0.68rem', color: '#e2e8f0', fontStyle: 'italic' }}>"{cv.sourceText}"</div>
                    {cv.targetText && <div style={{ fontSize: '0.62rem', color: '#94a3b8', marginTop: 1 }}>conceding: "{cv.targetText}"</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
