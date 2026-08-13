// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * SystemOverviewRow — a one-line cross-domain summary strip at the top of the
 * Usage Analytics dashboard (t/890). Surfaces a headline stat from each domain
 * (Usage, Debates, Taxonomy, Calibration) with a link to its detailed view.
 *
 * Each domain loads independently and degrades to "—" on failure or missing
 * data, so a slow or unavailable domain never blocks the row or the page.
 */

import { useState, useEffect, useMemo } from 'react';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import './SystemOverviewRow.css';

interface ValidationSummary { pass: number; fail: number; skip: number }

export interface UsageOverview {
  sessions: number;
  /** Period-over-period change, or null when comparison is off. */
  sessionsDeltaPct: number | null;
}

/** A loading sentinel distinct from "unavailable" (null) and a real value. */
type Loadable<T> = T | null | 'loading';

function recordWarn(message: string, err: unknown): void {
  getGlobalRecorder()?.record({
    type: 'system.error',
    component: 'system-overview-row',
    level: 'warn',
    message,
    error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
  });
}

function DomainCard({ label, primary, secondary, onClick }: {
  label: string;
  primary: string;
  secondary?: string;
  onClick?: () => void;
}) {
  const clickable = !!onClick;
  return (
    <div
      className={`sys-overview-card${clickable ? ' sys-overview-card--link-color' : ''}`}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e => { if (e.key === 'Enter' || e.key === ' ') onClick!(); }) : undefined}
    >
      <div className="sys-overview-label">{label}</div>
      <div className="sys-overview-primary">{primary}</div>
      <div className="sys-overview-secondary">{secondary ?? ' '}</div>
    </div>
  );
}

export function SystemOverviewRow({ usage }: { usage: UsageOverview }) {
  const { accelerationist, safetyist, skeptic, situations, setToolbarPanel } = useTaxonomyStore();
  const [calibration, setCalibration] = useState<Loadable<ValidationSummary>>('loading');
  const [debateCount, setDebateCount] = useState<Loadable<number>>('loading');
  const [avgQuality, setAvgQuality] = useState<number | null>(null);

  // Taxonomy — synchronous from the store. Null when nothing is loaded (e.g. a
  // direct #analytics load that never ran loadAll), which renders as "—".
  const taxonomy = useMemo(() => {
    const files = [accelerationist, safetyist, skeptic, situations] as Array<{ nodes?: { graph_attributes?: Record<string, unknown> }[] } | undefined>;
    const nodes = files.flatMap(f => f?.nodes ?? []);
    if (nodes.length === 0) return null;
    const enriched = nodes.filter(n => n.graph_attributes && Object.keys(n.graph_attributes).length > 0).length;
    return { total: nodes.length, enrichedPct: Math.round((enriched / nodes.length) * 100) };
  }, [accelerationist, safetyist, skeptic, situations]);

  // Calibration summary + a debate-quality proxy (mean crux-addressed ratio).
  useEffect(() => {
    let cancelled = false;
    api.getCalibrationLog()
      .then(resp => {
        if (cancelled) return;
        const vr = resp?.validationReport as { summary?: ValidationSummary } | null;
        setCalibration(vr?.summary ?? null);
        const entries = (resp?.entries ?? []) as { crux_addressed_ratio?: number | null }[];
        const vals = entries.map(e => e.crux_addressed_ratio).filter((v): v is number => typeof v === 'number');
        setAvgQuality(vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null);
      })
      .catch(err => {
        recordWarn('Calibration overview unavailable', err);
        if (!cancelled) setCalibration(null);
      });
    return () => { cancelled = true; };
  }, []);

  // Debate count.
  useEffect(() => {
    let cancelled = false;
    api.listDebateSessionsMeta()
      .then(list => { if (!cancelled) setDebateCount(Array.isArray(list) ? list.length : 0); })
      .catch(err => {
        recordWarn('Debate overview unavailable', err);
        if (!cancelled) setDebateCount(null);
      });
    return () => { cancelled = true; };
  }, []);

  const goToEditor = (panel?: 'calibration') => {
    if (panel) setToolbarPanel(panel);
    // App routes on hashchange (no reload), so the store-set panel survives.
    window.location.hash = '';
  };

  // ── Per-domain display (— when unavailable, … while loading) ──

  const usagePrimary = `${usage.sessions} session${usage.sessions === 1 ? '' : 's'}`;
  const usageSecondary = usage.sessionsDeltaPct != null
    ? `${usage.sessionsDeltaPct >= 0 ? '↑' : '↓'}${Math.abs(usage.sessionsDeltaPct).toFixed(0)}% vs prev`
    : undefined;

  const debatePrimary = debateCount === 'loading' ? '…' : debateCount == null ? '—' : `${debateCount} debate${debateCount === 1 ? '' : 's'}`;
  const debateSecondary = avgQuality != null ? `avg quality ${avgQuality.toFixed(2)}` : undefined;

  const taxonomyPrimary = taxonomy == null ? '—' : `${taxonomy.total.toLocaleString()} nodes`;
  const taxonomySecondary = taxonomy == null ? undefined : `${taxonomy.enrichedPct}% enriched`;

  let calibrationPrimary = '…';
  if (calibration !== 'loading') {
    if (calibration == null) {
      calibrationPrimary = '—';
    } else {
      const total = calibration.pass + calibration.fail + calibration.skip;
      calibrationPrimary = total > 0 ? `${calibration.pass}/${total} passing` : '—';
    }
  }

  return (
    <div className="sys-overview-row">
      <DomainCard label="Usage" primary={usagePrimary} secondary={usageSecondary} />
      <DomainCard label="Debates" primary={debatePrimary} secondary={debateSecondary} onClick={() => goToEditor()} />
      <DomainCard label="Taxonomy" primary={taxonomyPrimary} secondary={taxonomySecondary} onClick={() => goToEditor()} />
      <DomainCard label="Calibration" primary={calibrationPrimary} secondary={undefined} onClick={() => goToEditor('calibration')} />
    </div>
  );
}
