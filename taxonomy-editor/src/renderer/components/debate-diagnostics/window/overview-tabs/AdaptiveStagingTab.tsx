// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React from 'react';
import type { DebateSession } from '../../../../types/debate';
import './AdaptiveStagingTab.css';
import { TheoryLink } from '../../../shared/TheoryLink';

interface AdaptiveStagingDiagnostics {
  phases: { phase: string; rounds: number[]; exit_reason: string }[];
  regressions: { from_round: number; crux_id: string; threshold_after: number }[];
  total_predicate_evaluations: number;
  confidence_deferrals: number;
  vetoes_fired: number;
  forces_fired: number;
  network_size_peak: number;
  gc_events: { round: number; before: number; after: number; pruned: number }[];
  signal_telemetry: {
    round: number; phase: string;
    signals: Record<string, number>;
    composite: { saturation_score: number | null; convergence_score: number | null };
    confidence: { extraction: number; stability: number; global: number };
    predicate_result: { action: string; reason: string; veto_active: boolean; force_active: boolean; confidence_deferred: boolean };
    network_size: number; elapsed_ms: number;
  }[];
}

interface AdaptiveStagingTabProps {
  debate: DebateSession;
}

export function AdaptiveStagingTab({ debate }: AdaptiveStagingTabProps) {
  const sm = debate.stage_models;
  const diag = (debate as unknown as Record<string, unknown>).adaptive_staging_diagnostics as AdaptiveStagingDiagnostics | undefined;
  if (!diag && !sm) return <div className="adst-empty">No adaptive staging data available.</div>;

  const downloadSignals = () => {
    const blob = new Blob([JSON.stringify(diag, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `adaptive-signals-${debate.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="adst-root">
      {/* Stage Models config */}
      {sm && Object.keys(sm).length > 0 && (
        <div className="adst-stage-models">
          <div className="adst-section-header">Stage Model Overrides</div>
          <div className="adst-stage-row">
            {(['brief', 'plan', 'cite'] as const).map(stage => (
              <div key={stage}>
                <span className="adst-stage-name">{stage}: </span>
                {/* eslint-disable-next-line local/no-inline-style -- dynamic color: override presence */}
                <span style={{ color: sm[stage] ? 'var(--accent, var(--color-saf))' : 'var(--text-muted)' }}>
                  {sm[stage] || 'debate model'}
                </span>
              </div>
            ))}
            <div>
              <span className="adst-draft-name">Draft: </span>
              <span className="adst-muted">debate model (always)</span>
            </div>
          </div>
        </div>
      )}

      {!diag && <div className="adst-empty-sm">No adaptive staging signal data yet.</div>}

      {diag && <>
      <div className="adst-diag-header">
        <span className="adst-title">Adaptive Staging Diagnostics</span>
        <TheoryLink docPath="docs/adaptive-staging-signals.md" size={12} />
        <button onClick={downloadSignals} className="adst-download-btn">
          Download Signals JSON
        </button>
      </div>

      {/* Summary stats */}
      <div className="adst-stats-grid">
        {[
          { label: 'Predicate evals', value: diag.total_predicate_evaluations },
          { label: 'Confidence deferrals', value: diag.confidence_deferrals },
          { label: 'Vetoes', value: diag.vetoes_fired },
          { label: 'Forces', value: diag.forces_fired },
          { label: 'Peak network', value: diag.network_size_peak },
          { label: 'GC events', value: diag.gc_events.length },
          { label: 'Regressions', value: diag.regressions.length },
          { label: 'Phases', value: diag.phases.length },
        ].map(s => (
          <div key={s.label} className="adst-stat-card">
            <div className="adst-stat-value">{s.value}</div>
            <div className="adst-stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Phase timeline */}
      {diag.phases.length > 0 && (
        <div className="adst-mb12">
          <div className="adst-section-header">Phase Timeline</div>
          <table className="adst-phase-table">
            <thead>
              <tr className="adst-row-border">
                <th className="adst-th-left">Phase</th>
                <th className="adst-th-left">Rounds</th>
                <th className="adst-th-left">Exit Reason</th>
              </tr>
            </thead>
            <tbody>
              {diag.phases.map((p, i) => (
                <tr key={i} className="adst-row-border">
                  {/* eslint-disable-next-line local/no-inline-style -- dynamic color by phase */}
                  <td style={{ padding: 4, fontWeight: 600, color: p.phase === 'confrontation' ? 'var(--text-secondary)' : p.phase === 'argumentation' ? 'var(--warning)' : 'var(--text-secondary)' }}>{p.phase}</td>
                  <td className="adst-td">{p.rounds.length > 0 ? `${p.rounds[0]}–${p.rounds[p.rounds.length - 1]}` : '—'}</td>
                  <td className="adst-td-secondary">{p.exit_reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Signal telemetry table */}
      {diag.signal_telemetry.length > 0 && (
        <div>
          <div className="adst-section-header">Signal Telemetry (per round)</div>
          <TheoryLink docPath="docs/adaptive-staging-signals.md" anchor="signal-glossary" size={12} />
          <div className="adst-telemetry-scroll">
            <table className="adst-telemetry-table">
              <thead>
                <tr className="adst-telemetry-head-row">
                  <th className="adst-cell-sm">Rd</th>
                  <th className="adst-cell-sm">Phase</th>
                  <th className="adst-cell-sm">Sat</th>
                  <th className="adst-cell-sm">Conv</th>
                  <th className="adst-cell-sm">Conf</th>
                  <th className="adst-cell-sm" title="Topic Coherence — mean embedding similarity to crux centroid (anti-drift)">TC</th>
                  <th className="adst-cell-sm">Net</th>
                  <th className="adst-cell-sm">Action</th>
                  <th className="adst-cell-sm">Reason</th>
                </tr>
              </thead>
              <tbody>
                {diag.signal_telemetry.map((t, i) => (
                  // eslint-disable-next-line local/no-inline-style -- dynamic row background by action
                  <tr key={i} className="adst-row-border" style={{
                    background: t.predicate_result.action !== 'stay' ? 'color-mix(in srgb, var(--warning) 10%, transparent)' : undefined,
                  }}>
                    <td className="adst-cell-sm">{t.round}</td>
                    {/* eslint-disable-next-line local/no-inline-style -- dynamic color by phase */}
                    <td style={{ padding: '2px 4px', color: t.phase === 'confrontation' ? 'var(--text-secondary)' : t.phase === 'argumentation' ? 'var(--warning)' : 'var(--text-secondary)' }}>{t.phase.slice(0, 5)}</td>
                    <td className="adst-cell-sm">{t.composite.saturation_score?.toFixed(2) ?? '—'}</td>
                    <td className="adst-cell-sm">{t.composite.convergence_score?.toFixed(2) ?? '—'}</td>
                    {/* eslint-disable-next-line local/no-inline-style -- dynamic color by confidence threshold */}
                    <td style={{ padding: '2px 4px', color: (t.confidence?.global ?? 0) < 0.4 ? 'var(--danger)' : undefined }}>{(t.confidence?.global ?? 0).toFixed(2)}</td>
                    {(() => {
                      const raw = t.signals?.topic_coherence;
                      if (raw == null) return <td className="adst-cell-sm adst-muted">{'—'}</td>;
                      const coh = 1 - raw;
                      return (
                        // eslint-disable-next-line local/no-inline-style -- dynamic color by coherence threshold
                        <td style={{ padding: '2px 4px', color: coh > 0.7 ? 'var(--success)' : coh > 0.4 ? 'var(--warning)' : 'var(--danger)' }} title={`Coherence: ${coh.toFixed(3)} (raw signal: ${raw.toFixed(3)})`}>{coh.toFixed(2)}</td>
                      );
                    })()}
                    <td className="adst-cell-sm">{t.network_size}</td>
                    {/* eslint-disable-next-line local/no-inline-style -- dynamic font-weight by action */}
                    <td style={{ padding: '2px 4px', fontWeight: t.predicate_result.action !== 'stay' ? 700 : 400 }}>{t.predicate_result.action}</td>
                    <td className="adst-td-reason" title={t.predicate_result.reason}>{t.predicate_result.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Regressions */}
      {diag.regressions.length > 0 && (
        <div className="adst-mt12">
          <div className="adst-section-header">Regressions</div>
          {diag.regressions.map((r, i) => (
            <div key={i} className="adst-regression-item">
              Round {r.from_round}: crux {r.crux_id}, threshold ratcheted to {(r.threshold_after * 100).toFixed(0)}%
            </div>
          ))}
        </div>
      )}

      {/* GC Events */}
      {diag.gc_events.length > 0 && (
        <div className="adst-mt12">
          <div className="adst-section-header">Network GC Events</div>
          {diag.gc_events.map((g, i) => (
            <div key={i} className="adst-gc-item">
              Round {g.round}: {g.before} → {g.after} nodes ({g.pruned} pruned)
            </div>
          ))}
        </div>
      )}
      </>}
    </div>
  );
}
