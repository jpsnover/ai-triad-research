// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Calibration Dashboard — shows per-debate quality metrics over time,
 * parameter evolution, and validation status.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { api } from '@bridge';

// ── Types ──

interface CalibrationEntry {
  debate_id: string;
  timestamp: string;
  model: string;
  rounds: number;
  engaging_real_disagreement: boolean | null;
  crux_addressed_ratio: number | null;
  avg_utilization_rate: number | null;
  avg_primary_utilization: number | null;
  structural_error_rate: number | null;
  repetition_rate: number | null;
  claims_forgotten_rate: number | null;
  taxonomy_mapped_ratio: number | null;
  an_nodes_at_synthesis: number | null;
  gc_runs: number | null;
}

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

const METRIC_CONFIG: { key: string; label: string; color: string; higherBetter: boolean }[] = [
  { key: 'crux_addressed_ratio', label: 'Crux Addressed', color: '#22c55e', higherBetter: true },
  { key: 'avg_utilization_rate', label: 'Utilization Rate', color: '#3b82f6', higherBetter: true },
  { key: 'taxonomy_mapped_ratio', label: 'Taxonomy Mapped', color: '#8b5cf6', higherBetter: true },
  { key: 'claims_forgotten_rate', label: 'Claims Forgotten', color: '#f59e0b', higherBetter: false },
  { key: 'repetition_rate', label: 'Repetition Rate', color: '#ef4444', higherBetter: false },
  { key: 'structural_error_rate', label: 'Structural Errors', color: '#6b7280', higherBetter: false },
];

/** SVG time-series chart for a metric. */
function MetricChart({ entries, metricKey, label, color }: {
  entries: CalibrationEntry[];
  metricKey: string;
  label: string;
  color: string;
}) {
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
      </svg>
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
      } catch { /* unavailable */ }
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
    return { total, avgRounds, models, timespan };
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
            <MetricChart
              key={mc.key}
              entries={filtered}
              metricKey={mc.key}
              label={mc.label}
              color={mc.color}
            />
          ))}
        </div>
      </div>

      {/* Rounds distribution */}
      <div className="cal-dash-rounds">
        <h4>Debate Length Distribution</h4>
        <RoundsHistogram entries={filtered} />
      </div>
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
