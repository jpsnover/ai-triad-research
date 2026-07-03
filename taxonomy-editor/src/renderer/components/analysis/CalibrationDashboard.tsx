// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Calibration Dashboard — shows per-debate quality metrics over time,
 * parameter evolution, and validation status.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { api } from '@bridge';
import './CalibrationDashboard.css';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import type { CalibrationDataPoint } from '@lib/debate/calibrationLogger';
import { useChartTooltip, ChartTooltipLayer } from './chartTooltip';

type CalibrationEntry = CalibrationDataPoint;

interface ValidationMetric {
  label: string;
  status: 'pass' | 'fail' | 'skip';
  calibration?: { mean: number; n: number } | { true_rate: number; n: number };
  validation?: { mean: number; n: number } | { true_rate: number; n: number };
}

interface ValidationReport {
  schema_version: number;
  calibration_entries: number;
  validation_entries: number;
  metrics: Record<string, ValidationMetric>;
  summary: { pass: number; fail: number; skip: number };
  verdict: string;
}

// ── Chart helpers ──

const METRIC_CONFIG: { key: string; label: string; color: string; higherBetter: boolean; section?: string }[] = [
  { key: 'crux_addressed_ratio', label: 'Crux Addressed', color: '#22c55e', higherBetter: true },
  { key: 'avg_utilization_rate', label: 'Utilization Rate', color: '#3b82f6', higherBetter: true },
  { key: 'taxonomy_mapped_ratio', label: 'Taxonomy Mapped', color: '#8b5cf6', higherBetter: true },
  { key: 'claims_forgotten_rate', label: 'Claims Forgotten', color: '#f59e0b', higherBetter: false },
  { key: 'repetition_rate', label: 'Repetition Rate', color: '#ef4444', higherBetter: false },
  { key: 'structural_error_rate', label: 'Structural Errors', color: '#6b7280', higherBetter: false },
  { key: 'topic_alignment_rate', label: 'Alignment Pass Rate', color: '#06b6d4', higherBetter: true, section: 'Topic Alignment' },
  { key: 'scope_extraction_populated', label: 'Scope Populated', color: '#14b8a6', higherBetter: true },
  { key: 'draft_repair_rate', label: 'Draft Repair Rate', color: '#f97316', higherBetter: false },
  { key: 'taxonomy_demotion_rate', label: 'Demotion Rate', color: '#a855f7', higherBetter: false },
  { key: 'demoted_node_reference_rate', label: 'Demoted Ref Rate', color: '#ec4899', higherBetter: false },
  { key: 'moderator_drift_intervention_rate', label: 'Drift Interventions', color: '#ef5350', higherBetter: false },
  { key: 'mean_extraction_confidence', label: 'Mean FIRE Confidence', color: '#0ea5e9', higherBetter: true, section: 'Extraction Quality' },
  { key: 'low_confidence_claims_rate', label: 'Low-Confidence Claims', color: '#f43f5e', higherBetter: false },
  { key: 'entailment_pass_rate', label: 'Entailment Pass Rate', color: '#10b981', higherBetter: true },
  { key: 'entailment_repair_rate', label: 'Repair Rate', color: '#f59e0b', higherBetter: false },
  { key: 'entailment_sampling_coverage', label: 'Sampling Coverage', color: '#8b5cf6', higherBetter: true },
  { key: 'extraction_coverage_rate', label: 'Extraction Coverage', color: '#06b6d4', higherBetter: true },
];

/** SVG time-series chart for a metric. */
function MetricChart({ entries, metricKey, label, color }: {
  entries: CalibrationEntry[];
  metricKey: string;
  label: string;
  color: string;
}) {
  const { tip, showTip, hideTip } = useChartTooltip();
  const data = entries
    .map((e, i) => ({ idx: i, value: (e as Record<string, unknown>)[metricKey] as number | null }))
    .filter((d): d is { idx: number; value: number } => d.value !== null && typeof d.value === 'number');

  if (data.length < 2) return null;

  const w = 280, h = 80, pad = 4;
  const min = Math.min(...data.map(d => d.value));
  const max = Math.max(...data.map(d => d.value));
  const range = max - min || 0.01;

  const points = data.map(d => {
    const x = pad + (d.idx / (entries.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((d.value - min) / range) * (h - 2 * pad);
    return { x, y, value: d.value };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  // Moving average (window=5)
  const maWindow = 5;
  const maPoints: { x: number; y: number }[] = [];
  for (let i = 0; i < data.length; i++) {
    const slice = data.slice(Math.max(0, i - maWindow + 1), i + 1);
    const avg = slice.reduce((s, d) => s + d.value, 0) / slice.length;
    const x = pad + (data[i].idx / (entries.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((avg - min) / range) * (h - 2 * pad);
    maPoints.push({ x, y });
  }
  const maPathD = maPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  const latest = data[data.length - 1].value;
  const mean = data.reduce((s, d) => s + d.value, 0) / data.length;

  return (
    <div className="cal-dash-chart">
      <div className="cal-dash-chart-header">
        <span className="cal-dash-chart-label" style={{ color }}>{label}</span>
        <span className="cal-dash-chart-value">{latest.toFixed(3)} <span className="cal-dash-chart-mean">(avg {mean.toFixed(3)})</span></span>
      </div>
      <svg width={w} height={h} className="cal-dash-svg">
        {/* Data points */}
        <polyline points={points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={color} strokeWidth="1" opacity="0.4" />
        {/* Moving average trend line */}
        <path d={maPathD} fill="none" stroke={color} strokeWidth="2" />
        {/* Latest point */}
        <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="3" fill={color} />
        {/* Invisible per-point hover targets for rich tooltips */}
        {points.map((p, i) => {
          const ts = entries[data[i].idx]?.timestamp;
          const when = ts ? new Date(ts).toLocaleDateString() + ': ' : '';
          return (
            <circle
              key={i} cx={p.x} cy={p.y} r={6} fill="transparent" style={{ cursor: 'pointer' }}
              onMouseEnter={e => showTip(e, <><strong>{label}</strong><br />{when}{p.value.toFixed(3)}</>)}
              onMouseMove={e => showTip(e, <><strong>{label}</strong><br />{when}{p.value.toFixed(3)}</>)}
              onMouseLeave={hideTip}
            />
          );
        })}
      </svg>
      <ChartTooltipLayer tip={tip} />
    </div>
  );
}

/** Validation status badge. */
function ValidationBadge({ report }: { report: ValidationReport }) {
  const verdictColors: Record<string, string> = {
    PASS: '#22c55e',
    MARGINAL: '#f59e0b',
    FAIL: '#ef4444',
    INSUFFICIENT_DATA: '#6b7280',
  };
  const color = verdictColors[report.verdict] ?? '#6b7280';

  return (
    <div className="cal-dash-validation">
      <div className="cal-dash-validation-header">
        <span className="cal-dash-validation-badge" style={{ background: color }}>
          {report.verdict}
        </span>
        <span className="cal-dash-validation-meta">
          {report.validation_entries} validation / {report.calibration_entries} baseline debates
        </span>
      </div>
      <div className="cal-dash-validation-metrics">
        {Object.entries(report.metrics).map(([key, m]) => (
          <div key={key} className={`cal-dash-val-metric cal-dash-val-${m.status}`}>
            <span className="cal-dash-val-icon">
              {m.status === 'pass' ? '✓' : m.status === 'fail' ? '✗' : '–'}
            </span>
            <span className="cal-dash-val-label">{m.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ──

interface CalibrationDashboardProps {
  onClose?: () => void;
}

export function CalibrationDashboard({ onClose }: CalibrationDashboardProps) {
  const [entries, setEntries] = useState<CalibrationEntry[]>([]);
  const [validationReport, setValidationReport] = useState<ValidationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedModel, setSelectedModel] = useState<string>('all');

  useEffect(() => {
    void (async () => {
      try {
        const resp = await api.getCalibrationLog();
        setEntries((resp?.entries ?? []) as CalibrationEntry[]);
        if (resp?.validationReport) {
          setValidationReport(resp.validationReport as ValidationReport);
        }
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'calibration-dashboard',
          level: 'debug',
          message: 'Calibration log unavailable',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
      }
      setLoading(false);
    })();
  }, []);

  // Available models for filtering
  const models = useMemo(() => {
    const set = new Set(entries.map(e => e.model).filter(Boolean));
    return ['all', ...Array.from(set).sort()];
  }, [entries]);

  // Filtered entries
  const filtered = useMemo(() => {
    if (selectedModel === 'all') return entries;
    return entries.filter(e => e.model === selectedModel);
  }, [entries, selectedModel]);

  // Stats
  const stats = useMemo(() => {
    const total = filtered.length;
    const withRounds = filtered.filter(e => e.rounds > 1);
    const avgRounds = withRounds.length > 0
      ? (withRounds.reduce((s, e) => s + e.rounds, 0) / withRounds.length).toFixed(1)
      : '—';
    const models = new Set(filtered.map(e => e.model)).size;
    const timespan = total > 1
      ? `${new Date(filtered[0].timestamp).toLocaleDateString()} – ${new Date(filtered[total - 1].timestamp).toLocaleDateString()}`
      : '—';
    const withScope = filtered.filter(e => e.topic_scope_extracted).length;
    const alignedVals = filtered.map(e => e.topic_alignment_rate).filter((v): v is number => v != null);
    const avgAlignment = alignedVals.length > 0
      ? (alignedVals.reduce((s, v) => s + v, 0) / alignedVals.length * 100).toFixed(0) + '%'
      : '—';
    return { total, avgRounds, models, timespan, withScope, avgAlignment };
  }, [filtered]);

  if (loading) {
    return (
      <div className="cal-dash-panel">
        <div className="cal-dash-header">
          <h3>Calibration Dashboard</h3>
          {onClose && <button className="btn btn-sm" onClick={onClose}>Close</button>}
        </div>
        <p className="cal-dash-placeholder">Loading...</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="cal-dash-panel">
        <div className="cal-dash-header">
          <h3>Calibration Dashboard</h3>
          {onClose && <button className="btn btn-sm" onClick={onClose}>Close</button>}
        </div>
        <p className="cal-dash-placeholder">
          No calibration data. Run debates to generate metrics.
        </p>
      </div>
    );
  }

  return (
    <div className="cal-dash-panel">
      <div className="cal-dash-header">
        <h3>Calibration Dashboard</h3>
        <div className="cal-dash-controls">
          <select
            className="cal-dash-select"
            value={selectedModel}
            onChange={e => setSelectedModel(e.target.value)}
          >
            {models.map(m => (
              <option key={m} value={m}>{m === 'all' ? 'All models' : m}</option>
            ))}
          </select>
          {onClose && <button className="btn btn-sm" onClick={onClose}>Close</button>}
        </div>
      </div>

      {/* Summary stats */}
      <div className="cal-dash-stats">
        <div className="cal-dash-stat">
          <span className="cal-dash-stat-value">{stats.total}</span>
          <span className="cal-dash-stat-label">Debates</span>
        </div>
        <div className="cal-dash-stat">
          <span className="cal-dash-stat-value">{stats.avgRounds}</span>
          <span className="cal-dash-stat-label">Avg Rounds</span>
        </div>
        <div className="cal-dash-stat">
          <span className="cal-dash-stat-value">{stats.models}</span>
          <span className="cal-dash-stat-label">Models</span>
        </div>
        <div className="cal-dash-stat">
          <span className="cal-dash-stat-value">{stats.withScope}</span>
          <span className="cal-dash-stat-label">Scoped</span>
        </div>
        <div className="cal-dash-stat">
          <span className="cal-dash-stat-value">{stats.avgAlignment}</span>
          <span className="cal-dash-stat-label">Avg Alignment</span>
        </div>
        <div className="cal-dash-stat cal-dash-stat-wide">
          <span className="cal-dash-stat-value">{stats.timespan}</span>
          <span className="cal-dash-stat-label">Period</span>
        </div>
      </div>

      {/* Validation status */}
      {validationReport && <ValidationBadge report={validationReport} />}

      {/* Metric trend charts */}
      <div className="cal-dash-charts">
        <h4>Quality Metrics Over Time</h4>
        <div className="cal-dash-charts-grid">
          {METRIC_CONFIG.map(mc => (
            <React.Fragment key={mc.key}>
              {mc.section && <h4 style={{ gridColumn: '1 / -1', margin: '12px 0 4px', fontSize: '0.8rem', borderTop: '1px solid var(--border)', paddingTop: 8 }}>{mc.section}</h4>}
              <MetricChart
                entries={filtered}
                metricKey={mc.key}
                label={mc.label}
                color={mc.color}
              />
            </React.Fragment>
          ))}
        </div>
        <TopicHealthScore entries={filtered} />
      </div>

      {/* Rounds distribution */}
      <div className="cal-dash-rounds">
        <h4>Debate Length Distribution</h4>
        <RoundsHistogram entries={filtered} />
      </div>
    </div>
  );
}

/** Topic Health Score — weighted composite of topic alignment metrics. */
function TopicHealthScore({ entries }: { entries: CalibrationEntry[] }) {
  const scores = useMemo(() => {
    return entries.map((e, i) => {
      const alignment = e.topic_alignment_rate;
      const repair = e.draft_repair_rate;
      const drift = e.moderator_drift_intervention_rate;
      const scope = e.scope_extraction_populated;
      if (alignment == null && repair == null && drift == null && scope == null) return null;
      const score =
        (alignment ?? 1) * 0.4 +
        (1 - (repair ?? 0)) * 0.2 +
        (1 - (drift ?? 0)) * 0.2 +
        (scope ?? 1) * 0.2;
      return { idx: i, value: Math.round(score * 1000) / 1000 };
    }).filter((d): d is { idx: number; value: number } => d !== null);
  }, [entries]);

  if (scores.length < 2) return null;

  const w = 600, h = 50, pad = 4;
  const min = Math.min(...scores.map(d => d.value));
  const max = Math.max(...scores.map(d => d.value));
  const range = max - min || 0.01;
  const points = scores.map(d => ({
    x: pad + (d.idx / (entries.length - 1)) * (w - 2 * pad),
    y: h - pad - ((d.value - min) / range) * (h - 2 * pad),
    value: d.value,
  }));
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const latest = scores[scores.length - 1].value;
  const mean = scores.reduce((s, d) => s + d.value, 0) / scores.length;
  const color = latest >= 0.8 ? '#22c55e' : latest >= 0.6 ? '#f59e0b' : '#ef4444';

  return (
    <div style={{ marginTop: 12, padding: '8px 10px', borderRadius: 6, background: `${color}08`, border: `1px solid ${color}30` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <span style={{ fontWeight: 700, fontSize: '0.75rem', color }}>Topic Health Score</span>
        <span style={{ fontSize: '0.7rem' }}>{latest.toFixed(3)} <span style={{ color: 'var(--text-muted)', fontSize: '0.6rem' }}>(avg {mean.toFixed(3)})</span></span>
        <span style={{ fontSize: '0.55rem', color: 'var(--text-muted)' }}>40% alignment + 20% (1-repair) + 20% (1-drift) + 20% scope</span>
      </div>
      <svg width={w} height={h} style={{ display: 'block', width: '100%', height: h }}>
        <path d={pathD} fill="none" stroke={color} strokeWidth="2" />
        <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="3" fill={color} />
      </svg>
    </div>
  );
}

/** Simple histogram of debate round counts. */
function RoundsHistogram({ entries }: { entries: CalibrationEntry[] }) {
  const buckets = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const e of entries) {
      if (e.rounds > 0) {
        counts[e.rounds] = (counts[e.rounds] || 0) + 1;
      }
    }
    return counts;
  }, [entries]);

  const maxRounds = Math.max(...Object.keys(buckets).map(Number), 1);
  const maxCount = Math.max(...Object.values(buckets), 1);

  if (Object.keys(buckets).length === 0) return <p className="cal-dash-placeholder">No round data</p>;

  return (
    <div className="cal-dash-histogram">
      {Array.from({ length: maxRounds }, (_, i) => i + 1).map(r => {
        const count = buckets[r] || 0;
        const pct = (count / maxCount) * 100;
        return (
          <div key={r} className="cal-dash-hist-bar-wrapper">
            <div
              className="cal-dash-hist-bar"
              style={{ height: `${Math.max(pct, 2)}%` }}
              title={`${r} rounds: ${count} debates`}
            />
            <span className="cal-dash-hist-label">{r}</span>
          </div>
        );
      })}
    </div>
  );
}
