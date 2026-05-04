// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Parameter History Panel — shows current calibrated parameter values,
 * change history with before/after diffs, and per-parameter sparklines.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { api } from '@bridge';

// ── Types (mirrored from calibrationLogger) ──

interface ParameterSnapshot {
  exploration_exit: number;
  relevance_threshold: number;
  attack_weights: [number, number, number];
  draft_temperature: number;
  saturation_weights: Record<string, number>;
  recent_window: number;
  gc_trigger: number;
  polarity_resolved: number;
  max_nodes_cap: number;
  semantic_recycling_threshold: number;
}

interface ParameterChange {
  parameter: string;
  from: number | number[] | Record<string, number>;
  to: number | number[] | Record<string, number>;
  confidence?: 'high' | 'medium' | 'low';
  rationale?: string;
}

interface ParameterHistoryEntry {
  timestamp: string;
  source: 'initial' | 'optimizer' | 'manual';
  data_points: number;
  before: ParameterSnapshot;
  after: ParameterSnapshot;
  changes: ParameterChange[];
}

// ── Helpers ──

const PARAM_LABELS: Record<string, string> = {
  // Debate (1-10)
  exploration_exit: 'Exploration Exit',
  relevance_threshold: 'Relevance Threshold',
  attack_weights: 'Attack Weights',
  draft_temperature: 'Draft Temperature',
  saturation_weights: 'Saturation Weights',
  recent_window: 'Compression Window',
  gc_trigger: 'GC Trigger',
  polarity_resolved: 'Crux Resolution',
  max_nodes_cap: 'Node Cap',
  semantic_recycling_threshold: 'Recycling Threshold',
  // Upstream (11-15)
  cluster_min_similarity: 'Cluster Similarity',
  duplicate_similarity_threshold: 'Dedup Threshold',
  fire_confidence_threshold: 'FIRE Confidence',
  cohesion_clear_theme: 'Cohesion Threshold',
  kp_divisor: 'Extraction Density',
  budget_hard_multiplier: 'API Budget Multiplier',
  situation_max_nodes: 'Situation Node Cap',
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: '#22c55e',
  medium: '#f59e0b',
  low: '#9ca3af',
};

const SOURCE_LABELS: Record<string, string> = {
  initial: 'Baseline',
  optimizer: 'Auto-calibrated',
  manual: 'Manual',
};

function formatValue(v: number | number[] | Record<string, number> | null | undefined): string {
  if (v == null) return '—';
  if (typeof v === 'number') return v.toFixed(v < 10 ? 2 : 0);
  if (Array.isArray(v)) return `[${v.map(n => n.toFixed(2)).join(', ')}]`;
  return Object.entries(v).map(([k, n]) => `${k.replace(/_/g, ' ')}: ${n.toFixed(2)}`).join(', ');
}

function formatShortValue(v: number | number[] | Record<string, number> | null | undefined): string {
  if (v == null) return '—';
  if (typeof v === 'number') return v.toFixed(2);
  if (Array.isArray(v)) return v.map(n => n.toFixed(1)).join('/');
  return `{${Object.keys(v).length}}`;
}

/** Mini sparkline SVG for a numeric parameter's history. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 80, h = 20;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={w} height={h} style={{ verticalAlign: 'middle', marginLeft: 6 }}>
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      <circle cx={(values.length - 1) / (values.length - 1) * w} cy={h - ((values[values.length - 1] - min) / range) * (h - 4) - 2} r="2" fill="var(--accent)" />
    </svg>
  );
}

// ── Component ──

interface ParameterHistoryPanelProps {
  onClose?: () => void;
}

export function ParameterHistoryPanel({ onClose }: ParameterHistoryPanelProps) {
  const [current, setCurrent] = useState<ParameterSnapshot | null>(null);
  const [history, setHistory] = useState<ParameterHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedEntry, setExpandedEntry] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const resp = await api.getCalibrationHistory();
        if (resp?.current) {
          setCurrent(resp.current as ParameterSnapshot);
          setHistory((resp.history ?? []) as ParameterHistoryEntry[]);
        }
      } catch {
        // Calibration history unavailable — panel will show empty state.
      }
      setLoading(false);
    })();
  }, []);

  // Build per-parameter sparkline data from history
  const sparklines = useMemo(() => {
    const result: Record<string, number[]> = {};
    const simpleKeys = [
      'exploration_exit', 'relevance_threshold', 'draft_temperature',
      'recent_window', 'gc_trigger', 'polarity_resolved', 'max_nodes_cap',
      'semantic_recycling_threshold', 'cluster_min_similarity',
      'duplicate_similarity_threshold', 'fire_confidence_threshold',
      'cohesion_clear_theme', 'kp_divisor', 'budget_hard_multiplier', 'situation_max_nodes',
    ];
    for (const key of simpleKeys) {
      result[key] = history.map(e => (e.after as any)[key] as number).filter(v => typeof v === 'number');
    }
    return result;
  }, [history]);

  if (loading) {
    return (
      <div className="param-history-panel">
        <div className="param-history-header">
          <h3>Parameter Calibration</h3>
          {onClose && <button className="btn btn-sm" onClick={onClose}>Close</button>}
        </div>
        <p className="param-history-placeholder">Loading...</p>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="param-history-panel">
        <div className="param-history-header">
          <h3>Parameter Calibration</h3>
          {onClose && <button className="btn btn-sm" onClick={onClose}>Close</button>}
        </div>
        <p className="param-history-placeholder">
          No calibration data available. Run debates to generate calibration data.
        </p>
      </div>
    );
  }

  return (
    <div className="param-history-panel">
      <div className="param-history-header">
        <h3>Parameter Calibration</h3>
        <span className="param-history-subtitle">
          {history.length} change{history.length !== 1 ? 's' : ''} recorded
        </span>
        {onClose && <button className="btn btn-sm" onClick={onClose}>Close</button>}
      </div>

      {/* Current values table */}
      <div className="param-history-section">
        <h4>Current Values</h4>
        <table className="param-history-table">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Value</th>
              <th data-tooltip={"Sparkline showing parameter value over calibration runs.\nRequires 2+ entries. Each dot = one calibration."}>Trend</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(PARAM_LABELS).map(([key, label]) => (
              <tr key={key}>
                <td className="param-name">{label}</td>
                <td className="param-value">{formatShortValue((current as any)[key])}</td>
                <td className="param-sparkline">
                  {sparklines[key] && sparklines[key].length >= 2 ? (
                    <Sparkline values={sparklines[key]} />
                  ) : sparklines[key] && sparklines[key].length === 1 ? (
                    <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>1 sample</span>
                  ) : (
                    <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Change history */}
      {history.length > 0 && (
        <div className="param-history-section">
          <h4>Change History</h4>
          <div className="param-history-timeline">
            {[...history].reverse().map((entry, idx) => {
              const realIdx = history.length - 1 - idx;
              const expanded = expandedEntry === realIdx;
              return (
                <div key={realIdx} className="param-history-entry">
                  <div
                    className="param-history-entry-header"
                    onClick={() => setExpandedEntry(expanded ? null : realIdx)}
                    style={{ cursor: entry.changes.length > 0 ? 'pointer' : 'default' }}
                  >
                    <span className={`param-source-badge param-source-${entry.source}`}>
                      {SOURCE_LABELS[entry.source] ?? entry.source}
                    </span>
                    <span className="param-history-date">
                      {new Date(entry.timestamp).toLocaleDateString()} {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="param-history-meta">
                      {entry.data_points > 0 && `${entry.data_points} debates`}
                    </span>
                    {entry.changes.length > 0 && (
                      <span className="param-history-count">
                        {expanded ? '▼' : '▶'} {entry.changes.length} change{entry.changes.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  {expanded && entry.changes.length > 0 && (
                    <div className="param-history-changes">
                      {entry.changes.map((change, ci) => (
                        <div key={ci} className="param-history-change">
                          <div className="param-change-header">
                            <strong>{PARAM_LABELS[change.parameter] ?? change.parameter}</strong>
                            {change.confidence && (
                              <span
                                className="param-confidence-badge"
                                style={{ color: CONFIDENCE_COLORS[change.confidence] }}
                              >
                                {change.confidence}
                              </span>
                            )}
                          </div>
                          <div className="param-change-diff">
                            <span className="param-change-from">{formatValue(change.from)}</span>
                            <span className="param-change-arrow">→</span>
                            <span className="param-change-to">{formatValue(change.to)}</span>
                          </div>
                          {change.rationale && (
                            <div className="param-change-rationale">{change.rationale}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
