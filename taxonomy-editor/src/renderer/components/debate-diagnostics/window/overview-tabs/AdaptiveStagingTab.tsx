// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React from 'react';
import type { DebateSession } from '../../../../types/debate';

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
  const diag = (debate as unknown as Record<string, unknown>).adaptive_staging_diagnostics as AdaptiveStagingDiagnostics | undefined;
  if (!diag) return <div style={{ color: 'var(--text-secondary)', padding: 16 }}>No adaptive staging data available.</div>;

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
    <div style={{ fontSize: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 600 }}>Adaptive Staging Diagnostics</span>
        <button onClick={downloadSignals} style={{ fontSize: '0.7rem', padding: '2px 8px', cursor: 'pointer', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)' }}>
          Download Signals JSON
        </button>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 12 }}>
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
          <div key={s.label} style={{ background: 'var(--bg-secondary)', padding: '4px 8px', borderRadius: 4, textAlign: 'center' }}>
            <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{s.value}</div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Phase timeline */}
      {diag.phases.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Phase Timeline</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.7rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: 4 }}>Phase</th>
                <th style={{ textAlign: 'left', padding: 4 }}>Rounds</th>
                <th style={{ textAlign: 'left', padding: 4 }}>Exit Reason</th>
              </tr>
            </thead>
            <tbody>
              {diag.phases.map((p, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 4, fontWeight: 600, color: p.phase === 'confrontation' ? '#60a5fa' : p.phase === 'argumentation' ? '#f59e0b' : '#34d399' }}>{p.phase}</td>
                  <td style={{ padding: 4 }}>{p.rounds.length > 0 ? `${p.rounds[0]}–${p.rounds[p.rounds.length - 1]}` : '—'}</td>
                  <td style={{ padding: 4, color: 'var(--text-secondary)' }}>{p.exit_reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Signal telemetry table */}
      {diag.signal_telemetry.length > 0 && (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Signal Telemetry (per round)</div>
          <div style={{ overflowX: 'auto', maxHeight: 300, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.65rem', whiteSpace: 'nowrap' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--bg-primary)' }}>
                  <th style={{ padding: '2px 4px' }}>Rd</th>
                  <th style={{ padding: '2px 4px' }}>Phase</th>
                  <th style={{ padding: '2px 4px' }}>Sat</th>
                  <th style={{ padding: '2px 4px' }}>Conv</th>
                  <th style={{ padding: '2px 4px' }}>Conf</th>
                  <th style={{ padding: '2px 4px' }} title="Topic Coherence — mean embedding similarity to crux centroid (anti-drift)">TC</th>
                  <th style={{ padding: '2px 4px' }}>Net</th>
                  <th style={{ padding: '2px 4px' }}>Action</th>
                  <th style={{ padding: '2px 4px' }}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {diag.signal_telemetry.map((t, i) => (
                  <tr key={i} style={{
                    borderBottom: '1px solid var(--border)',
                    background: t.predicate_result.action !== 'stay' ? 'rgba(245, 158, 11, 0.1)' : undefined,
                  }}>
                    <td style={{ padding: '2px 4px' }}>{t.round}</td>
                    <td style={{ padding: '2px 4px', color: t.phase === 'confrontation' ? '#60a5fa' : t.phase === 'argumentation' ? '#f59e0b' : '#34d399' }}>{t.phase.slice(0, 5)}</td>
                    <td style={{ padding: '2px 4px' }}>{t.composite.saturation_score?.toFixed(2) ?? '—'}</td>
                    <td style={{ padding: '2px 4px' }}>{t.composite.convergence_score?.toFixed(2) ?? '—'}</td>
                    <td style={{ padding: '2px 4px', color: (t.confidence?.global ?? 0) < 0.4 ? '#ef4444' : undefined }}>{(t.confidence?.global ?? 0).toFixed(2)}</td>
                    {(() => { const raw = t.signals?.topic_coherence; if (raw == null) return <td style={{ padding: '2px 4px', color: 'var(--text-muted)' }}>{'—'}</td>; const coh = 1 - raw; return <td style={{ padding: '2px 4px', color: coh > 0.7 ? '#16a34a' : coh > 0.4 ? '#d97706' : '#dc2626' }} title={`Coherence: ${coh.toFixed(3)} (raw signal: ${raw.toFixed(3)})`}>{coh.toFixed(2)}</td>; })()}
                    <td style={{ padding: '2px 4px' }}>{t.network_size}</td>
                    <td style={{ padding: '2px 4px', fontWeight: t.predicate_result.action !== 'stay' ? 700 : 400 }}>{t.predicate_result.action}</td>
                    <td style={{ padding: '2px 4px', color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }} title={t.predicate_result.reason}>{t.predicate_result.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Regressions */}
      {diag.regressions.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Regressions</div>
          {diag.regressions.map((r, i) => (
            <div key={i} style={{ padding: '4px 8px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: 4, marginBottom: 4, fontSize: '0.7rem' }}>
              Round {r.from_round}: crux {r.crux_id}, threshold ratcheted to {(r.threshold_after * 100).toFixed(0)}%
            </div>
          ))}
        </div>
      )}

      {/* GC Events */}
      {diag.gc_events.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Network GC Events</div>
          {diag.gc_events.map((g, i) => (
            <div key={i} style={{ padding: '4px 8px', background: 'var(--bg-secondary)', borderRadius: 4, marginBottom: 4, fontSize: '0.7rem' }}>
              Round {g.round}: {g.before} → {g.after} nodes ({g.pruned} pruned)
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
