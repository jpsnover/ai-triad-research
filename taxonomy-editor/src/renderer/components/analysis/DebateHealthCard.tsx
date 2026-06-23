// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * DebateHealthCard (t/891) — completion rate, average quality, and quality
 * trend for the analytics dashboard. Completion comes from server-aggregated
 * event-type counts (debate.complete / debate.abandon); quality + trend are
 * sourced client-side from calibration entries (crux-addressed ratio), so the
 * score is real data, never hardcoded.
 */

import { useState, useEffect } from 'react';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import './analyticsCards.css';

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;

export function DebateHealthCard({ eventTypes }: { eventTypes?: Record<string, number> }) {
  const [quality, setQuality] = useState<{ avg: number; trend: number } | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getCalibrationLog()
      .then(resp => {
        if (cancelled) return;
        const entries = (resp?.entries ?? []) as { crux_addressed_ratio?: number | null }[];
        const vals = entries.map(e => e.crux_addressed_ratio).filter((v): v is number => typeof v === 'number');
        if (vals.length > 0) {
          const half = Math.floor(vals.length / 2);
          const trend = half > 0 ? mean(vals.slice(half)) - mean(vals.slice(0, half)) : 0;
          setQuality({ avg: mean(vals), trend });
        }
        setLoaded(true);
      })
      .catch(err => {
        getGlobalRecorder()?.record({
          type: 'system.error', component: 'debate-health-card', level: 'warn',
          message: 'Calibration quality unavailable for debate health',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        if (!cancelled) setLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  const complete = eventTypes?.['debate.complete'] ?? 0;
  const abandon = eventTypes?.['debate.abandon'] ?? 0;
  const total = complete + abandon;

  if (loaded && total === 0 && !quality) {
    return (
      <div className="analytics-card">
        <div className="analytics-card-label">Debate Health</div>
        <div className="analytics-card-empty">No debates yet</div>
      </div>
    );
  }

  const rate = total > 0 ? Math.round((complete / total) * 100) : null;
  const trend = quality?.trend ?? 0;
  const arrow = trend > 0.01 ? '↑' : trend < -0.01 ? '↓' : '→';
  const trendColor = trend > 0.01 ? 'var(--success, #22c55e)' : trend < -0.01 ? 'var(--danger, #ef4444)' : 'var(--text-muted)';

  return (
    <div className="analytics-card">
      <div className="analytics-card-label">Debate Health</div>
      <div className="analytics-card-primary">{rate != null ? `${rate}% completed` : '—'}</div>
      <div className="analytics-card-rows">
        <div>{complete} done · {abandon} abandoned</div>
        <div>
          avg quality {quality ? quality.avg.toFixed(2) : '—'}
          {quality && <span style={{ color: trendColor }}> {arrow}</span>}
        </div>
      </div>
    </div>
  );
}
