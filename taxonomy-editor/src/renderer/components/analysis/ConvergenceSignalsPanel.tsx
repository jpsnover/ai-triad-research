// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { DebateSession, ConvergenceSignals } from '../../types/debate';
import { POVER_INFO } from '../../types/debate';
import type { SpeakerId } from '../../types/debate';
import { SUPPORT_MOVES } from '@lib/debate/helpers';
import './ConvergenceSignalsPanel.css';

interface Props {
  debate: DebateSession;
}

const TOOLTIPS = {
  collabRatio: 'Average proportion of collaborative vs confrontational moves.\nCollaborative: concede, integrate, steel-build, identify-crux.\nConfrontational: counterexample, undercut, empirical challenge, burden-shift, expose-assumption.\nHigher = more convergence-oriented.',
  concessions: 'How many concession opportunities were taken out of total.\nAn opportunity = facing a strong attack with QBAF strength >= 0.6 and using a concession move (CONCEDE, CONCEDE-AND-PIVOT, CONDITIONAL-AGREE).',
  recycling: 'Average max word-overlap with the speaker\'s own prior turns.\nHigh values (>50%) mean the debater is restating arguments rather than evolving their position.',
  cruxMoves: 'Cumulative count of IDENTIFY-CRUX moves.\nCruxes are key disagreement points that, if resolved, would change a debater\'s position.',
  chartTitle: 'How each debater\'s collaborative-to-confrontational ratio evolves turn by turn.\nLines trending upward indicate more collaboration as the debate matures.',
  confCollab: 'Count of confrontational (red) vs collaborative (green) moves this turn.\nConfrontational: counterexample, undercut, empirical challenge, burden-shift, expose-assumption.\nCollaborative: concede, concede-and-pivot, conditional-agree, integrate, steel-build, identify-crux.',
  engagement: 'Fraction of this turn\'s claims that connect to existing argument network nodes (targeted) vs standalone new claims.\nHigher = more dialectically engaged with prior arguments.',
  recyclingCol: 'Max word-overlap between this turn\'s content and the speaker\'s prior turns.\nRed (>50%) indicates high argument redundancy.',
  concessionCol: 'Whether the speaker faced strong attacks (QBAF >= 0.6) and used a concession move.\nTaken (green) = conceded. Missed (red) = faced attacks but didn\'t concede. N/A = no strong attacks faced.',
  drift: 'How much the speaker\'s position changed since their last turn.\nMeasured as delta in word-overlap with their opening statement.',
  cruxCol: 'Whether IDENTIFY-CRUX was used this turn (1 or 0), with cumulative count across all turns.\nCruxes are disagreement points that, if resolved, would change a debater\'s position.',
};

function speakerLabel(speaker: SpeakerId): string {
  if (speaker === 'user') return 'You';
  return POVER_INFO[speaker as Exclude<SpeakerId, 'user'>]?.label || speaker;
}

function speakerColor(speaker: SpeakerId): string {
  const colors: Record<string, string> = {
    accelerationist: 'var(--color-acc, #f59e0b)',
    safetyist: 'var(--color-saf, #3b82f6)',
    skeptic: 'var(--color-skp, #a855f7)',
    user: 'var(--success)',
  };
  return colors[speaker] ?? 'var(--text-muted)';
}

function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

function OutcomeBadge({ outcome }: { outcome: 'taken' | 'missed' | 'none' }) {
  const styles: Record<string, { bg: string; fg: string; label: string }> = {
    taken: { bg: 'color-mix(in srgb, var(--success) 15%, transparent)', fg: 'var(--success)', label: 'Taken' },
    missed: { bg: 'color-mix(in srgb, var(--danger) 15%, transparent)', fg: 'var(--danger)', label: 'Missed' },
    none: { bg: 'color-mix(in srgb, var(--text-muted) 15%, transparent)', fg: 'var(--text-muted)', label: 'N/A' },
  };
  const s = styles[outcome];
  return (
    <span className="conv-outcome-badge" style={{ background: s.bg, color: s.fg }}>{s.label}</span>
  );
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = max > 0 ? Math.min(1, value / max) * 100 : 0;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <div style={{ width: 50, height: 6, background: 'var(--bg-tertiary, #333)', borderRadius: 'var(--radius-sm)' }}>
        <div style={{ width: `${w}%`, height: '100%', background: color, borderRadius: 'var(--radius-sm)' }} />
      </div>
      <span className="conv-minibar-value">{value.toFixed(2)}</span>
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
      points: pts.map(p => `${x(p.round)},${H - PAD - (p.move_polarity?.ratio ?? 0) * (H - 2 * PAD)}`).join(' '),
    };
  });

  return (
    <div style={{ marginBottom: 8 }}>
      <div className="conv-chart-title" title={TOOLTIPS.chartTitle}>
        Collaborative Ratio Over Time
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        style={{ display: 'block', width: '100%', height: H, maxWidth: 720 }}>
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--border)" strokeWidth={0.5} />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="var(--border)" strokeWidth={0.5} />
        <text x={PAD - 2} y={PAD + 4} textAnchor="end" fontSize={7} fill="var(--text-muted)">1.0</text>
        <text x={PAD - 2} y={H - PAD + 4} textAnchor="end" fontSize={7} fill="var(--text-muted)">0.0</text>
        {linesBySpkr.map(l => (
          <polyline key={l.speaker} fill="none" stroke={speakerColor(l.speaker as SpeakerId)}
            strokeWidth={1.5} points={l.points} />
        ))}
      </svg>
      <div className="conv-chart-legend">
        {speakers.map(s => (
          <span key={s} style={{ color: speakerColor(s as SpeakerId) }}>
            {speakerLabel(s as SpeakerId)}
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
    const missedCount = spkrSignals.filter(s => s.concession_opportunity?.outcome === 'missed').length;
    const takenCount = spkrSignals.filter(s => s.concession_opportunity?.outcome === 'taken').length;
    const opportunityCount = missedCount + takenCount;
    const avgCollabRatio = spkrSignals.reduce((sum, s) => sum + (s.move_polarity?.ratio ?? 0), 0) / (spkrSignals.length || 1);
    const avgRecycling = spkrSignals.reduce((sum, s) => sum + Math.max(s.argument_redundancy?.max_self_overlap ?? 0, s.argument_redundancy?.semantic_max_similarity ?? 0), 0) / (spkrSignals.length || 1);
    const cruxTotal = spkrSignals.length > 0 ? spkrSignals[spkrSignals.length - 1].crux_engagement_rate?.cumulative_count ?? 0 : 0;
    return { speaker: spkr, missedCount, takenCount, opportunityCount, avgCollabRatio, avgRecycling, cruxTotal };
  });

  return (
    <div className="conv-summary-grid" style={{ gridTemplateColumns: `repeat(${speakers.length}, 1fr)` }}>
      {stats.map(s => (
        <div key={s.speaker} className="conv-summary-card"
          style={{ borderLeft: `3px solid ${speakerColor(s.speaker as SpeakerId)}` }}>
          <div className="conv-card-speaker" style={{ color: speakerColor(s.speaker as SpeakerId) }}>
            {speakerLabel(s.speaker as SpeakerId)}
          </div>
          <div className="conv-card-stats">
            <div title={TOOLTIPS.collabRatio}>Collab ratio: <strong>{pct(s.avgCollabRatio)}</strong></div>
            <div title={TOOLTIPS.concessions}>Concessions: <strong>{s.takenCount}/{s.opportunityCount}</strong> opportunities</div>
            <div title={TOOLTIPS.recycling}>Avg redundancy: <strong>{pct(s.avgRecycling)}</strong></div>
            <div title={TOOLTIPS.cruxMoves}>Crux moves: <strong>{s.cruxTotal}</strong></div>
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
      <div className="conv-empty">
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

      <div className="conv-filter-bar">
        <span className="conv-filter-label">Filter:</span>
        <button
          onClick={() => setFilterSpeaker('all')}
          className="conv-filter-btn"
          style={{
            border: '1px solid var(--border)',
            background: filterSpeaker === 'all' ? 'var(--warning, #f59e0b)' : 'transparent',
            color: filterSpeaker === 'all' ? 'var(--bg-primary)' : 'var(--text-primary)',
          }}
        >All</button>
        {speakerFilter.map(s => (
          <button
            key={s}
            onClick={() => setFilterSpeaker(s)}
            className="conv-filter-btn"
            style={{
              border: `1px solid ${speakerColor(s)}`,
              background: filterSpeaker === s ? speakerColor(s) : 'transparent',
              color: filterSpeaker === s ? 'var(--bg-primary)' : speakerColor(s),
            }}
          >{speakerLabel(s)}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <table className="conv-table">
          <thead>
            <tr>
              <th>Rnd</th>
              <th>Speaker</th>
              <th style={{ textAlign: 'center' }} title={TOOLTIPS.confCollab}>Conf/Collab</th>
              <th style={{ textAlign: 'center' }} title={TOOLTIPS.engagement}>Dialectical Engagement</th>
              <th style={{ textAlign: 'center' }} title={TOOLTIPS.recyclingCol}>Argument Redundancy</th>
              <th style={{ textAlign: 'center' }} title={TOOLTIPS.concessionCol}>Concession</th>
              <th style={{ textAlign: 'center' }} title={TOOLTIPS.drift}>Drift</th>
              <th style={{ textAlign: 'center' }} title={TOOLTIPS.cruxCol}>Crux</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((sig, i) => (
              <tr
                key={sig.entry_id}
                onClick={() => setSelectedIdx(selectedIdx === i ? null : i)}
                style={{
                  background: selectedIdx === i ? 'color-mix(in srgb, var(--warning, #f59e0b) 10%, transparent)' : undefined,
                }}
              >
                <td>{sig.round}</td>
                <td style={{ color: speakerColor(sig.speaker) }}>
                  {speakerLabel(sig.speaker)}
                </td>
                <td style={{ textAlign: 'center' }}>
                  <span style={{ color: 'var(--danger)' }}>{sig.move_polarity?.confrontational ?? 0}</span>
                  {' / '}
                  <span style={{ color: 'var(--success)' }}>{sig.move_polarity?.collaborative ?? 0}</span>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <MiniBar value={sig.dialectical_engagement?.ratio ?? 0} max={1} color="var(--color-saf, #3b82f6)" />
                </td>
                <td style={{ textAlign: 'center' }}>
                  {(() => {
                    const effective = Math.max(sig.argument_redundancy?.max_self_overlap ?? 0, sig.argument_redundancy?.semantic_max_similarity ?? 0);
                    return <MiniBar value={effective} max={1} color={sig.argument_redundancy?.semantically_recycled ? 'var(--danger)' : effective > 0.5 ? 'var(--warning, #f59e0b)' : 'var(--success)'} />;
                  })()}
                </td>
                <td style={{ textAlign: 'center' }}>
                  <OutcomeBadge outcome={sig.concession_opportunity?.outcome ?? 'none'} />
                </td>
                <td style={{ textAlign: 'center' }}>
                  {pct(sig.position_drift?.drift ?? 0)}
                </td>
                <td style={{ textAlign: 'center' }}>
                  {sig.crux_engagement_rate?.used_this_turn ? '1' : '0'}
                  <span style={{ color: 'var(--text-muted)' }}> ({sig.crux_engagement_rate?.cumulative_count ?? 0})</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (() => {
        const md = selected.move_polarity;
        const ed = selected.dialectical_engagement;
        const rr = selected.argument_redundancy;
        const so = selected.dominant_counterargument;
        const co = selected.concession_opportunity;
        const pd = selected.position_drift;
        const cr = selected.crux_engagement_rate;
        return (
          <div className="conv-detail"
            style={{ borderLeft: `3px solid ${speakerColor(selected.speaker)}` }}>
            <div className="conv-detail-header">
              <span className="conv-detail-speaker" style={{ color: speakerColor(selected.speaker) }}>
                Round {selected.round} — {speakerLabel(selected.speaker)}
              </span>
              <span className="conv-detail-hint">← → to navigate, Esc to close</span>
            </div>
            <div className="conv-detail-grid">
              <div className="conv-detail-cell">
                <div className="conv-detail-lbl">Polarity</div>
                <div className="conv-detail-val">
                  <span style={{ color: 'var(--danger)' }}>{md?.confrontational ?? 0}C</span>{' / '}
                  <span style={{ color: 'var(--success)' }}>{md?.collaborative ?? 0}S</span>
                  {' = '}<strong>{pct(md?.ratio ?? 0)}</strong>
                  {(md?.ratio ?? 0) >= 0.5
                    ? <span className="conv-status-good">cooperative</span>
                    : <span className="conv-status-bad">confrontational</span>}
                </div>
              </div>
              <div className="conv-detail-cell">
                <div className="conv-detail-lbl">Dialectical Engagement</div>
                <div className="conv-detail-val">
                  {ed?.targeted ?? 0}/{(ed?.targeted ?? 0) + (ed?.standalone ?? 0)} targeted = <strong>{pct(ed?.ratio ?? 0)}</strong>
                  {(ed?.ratio ?? 0) >= 0.7
                    ? <span className="conv-status-good">deep</span>
                    : (ed?.ratio ?? 0) >= 0.4
                      ? <span className="conv-status-warn">moderate</span>
                      : <span className="conv-status-bad">standalone</span>}
                </div>
              </div>
              <div className="conv-detail-cell">
                <div className="conv-detail-lbl">Argument Redundancy</div>
                <div className="conv-detail-val">
                  avg <strong>{pct(rr?.avg_self_overlap ?? 0)}</strong>, max <strong>{pct(rr?.max_self_overlap ?? 0)}</strong>
                  {rr?.semantic_max_similarity != null && (
                    <>, sem <strong>{pct(rr.semantic_max_similarity)}</strong></>
                  )}
                  {rr?.semantically_recycled
                    ? <span className="conv-status-bad">semantic repeat</span>
                    : (rr?.max_self_overlap ?? 0) >= 0.5
                      ? <span className="conv-status-warn">repeating</span>
                      : <span className="conv-status-good">fresh</span>}
                </div>
              </div>
              <div className="conv-detail-cell">
                <div className="conv-detail-lbl">Dominant Counterargument</div>
                <div className="conv-detail-val">
                  {so ? (
                    <>{so.node_id} str={(so.strength ?? 0).toFixed(2)} by {speakerLabel(so.attacker as SpeakerId)}
                      {(so.strength ?? 0) >= 0.7
                        ? <span className="conv-status-bad">strong</span>
                        : (so.strength ?? 0) >= 0.5
                          ? <span className="conv-status-warn">moderate</span>
                          : <span className="conv-status-good">weak</span>}
                    </>
                  ) : <span style={{ color: 'var(--text-muted)' }}>none</span>}
                </div>
              </div>
              <div className="conv-detail-cell">
                <div className="conv-detail-lbl">Concession</div>
                <div className="conv-detail-val">
                  {co?.strong_attacks_faced ?? 0} attacks, used: {co?.concession_used ? 'Y' : 'N'} — <OutcomeBadge outcome={co?.outcome ?? 'none'} />
                </div>
              </div>
              <div className="conv-detail-cell">
                <div className="conv-detail-lbl">Position Drift</div>
                <div className="conv-detail-val">
                  opening: <strong>{pct(pd?.overlap_with_opening ?? 0)}</strong>, drift: <strong>{pct(pd?.drift ?? 0)}</strong>
                  {(pd?.overlap_with_opening ?? 0) >= 0.6
                    ? <span className="conv-status-warn">anchored</span>
                    : (pd?.overlap_with_opening ?? 0) < 0.3
                      ? <span className="conv-status-info">shifted</span>
                      : <span className="conv-status-good">evolved</span>}
                </div>
              </div>
              <div className="conv-detail-cell" style={{ gridColumn: '1 / -1' }}>
                <div className="conv-detail-lbl">Crux Engagement</div>
                <div className="conv-detail-val">
                  this turn: {cr?.used_this_turn ? 'Yes' : 'No'} | cumulative: {cr?.cumulative_count ?? 0} | follow-through: {cr?.cumulative_follow_through ?? 0}
                  {(cr?.cumulative_count ?? 0) > 0 && (cr?.cumulative_follow_through ?? 0) === 0 && (
                    <span className="conv-status-warn">no follow-through</span>
                  )}
                  {(cr?.cumulative_count ?? 0) > 0 && (cr?.cumulative_follow_through ?? 0) > 0 && (
                    <span className="conv-status-good">resolving</span>
                  )}
                </div>
              </div>
            </div>
            {concessionVerbatims.length > 0 && (
              <div className="conv-verbatim-section">
                <div className="conv-detail-lbl" style={{ marginBottom: 3 }}>Concession Verbatims ({concessionVerbatims.length})</div>
                {concessionVerbatims.map((cv, i) => (
                  <div key={i} className="conv-verbatim-entry">
                    <div className="conv-verbatim-ids">{cv.sourceId} → {cv.targetId} via {cv.scheme}</div>
                    <div className="conv-verbatim-text">"{cv.sourceText}"</div>
                    {cv.targetText && <div className="conv-verbatim-target">conceding: "{cv.targetText}"</div>}
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
