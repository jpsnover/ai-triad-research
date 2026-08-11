// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * YourActivityPanel — self-only engagement view for the profile/Help menu.
 * Calls GET /api/analytics/engagement?user=<self> and renders the caller's
 * own camp distribution, category drill-down, and most-visited leaderboards.
 * No admin gate — server enforces self-only; non-admin users receive their
 * own .user subtree and never receive other users' data. (t/2469)
 * Spec: docs/ux/usage-analytics-instrumentation.md §5.2.
 */

import { useState, useEffect, useMemo } from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { bridgeGet } from '../../bridge/web-bridge';
import { useUserProfile } from '../../hooks/useAuthStatus';
import {
  type TreeNode,
  CAMP_COLORS, CAMP_LABELS,
  fmtDuration, fmtNumber, categoryLabel,
  sumByCamp, sumByCategoryForCamp, collectLeafNodes,
} from './engagementTree';
import './YourActivityPanel.css';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ActivityResult {
  user?: TreeNode;  // caller's own subtree (t/2467#2); absent if no events yet
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function last30DayRange(): { from: string; to: string } {
  const to = new Date().toISOString().slice(0, 10);
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 29);
  return { from: fromDate.toISOString().slice(0, 10), to };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CampBars({
  root, selectedCamp, onSelectCamp,
}: { root: TreeNode; selectedCamp: string | null; onSelectCamp: (k: string | null) => void }) {
  const camps = useMemo(() => sumByCamp(root), [root]);
  const maxMs = camps[0]?.engagedMs ?? 1;

  if (camps.length === 0) return (
    <div className="yap-panel">
      <div className="yap-panel-title">Camp Distribution</div>
      <div className="yap-empty">No camp data yet.</div>
    </div>
  );

  return (
    <div className="yap-panel">
      <div className="yap-panel-title">Camp Distribution</div>
      <div className="yap-camp-hint">Click a camp to see category breakdown</div>
      {camps.map(c => {
        const color = CAMP_COLORS[c.key] ?? '#6b7280';
        const label = CAMP_LABELS[c.key] ?? c.key;
        const isActive = selectedCamp === c.key;
        return (
          <div
            key={c.key}
            className={`yap-camp-row${isActive ? ' yap-camp-row--active' : ''}`}
            onClick={() => onSelectCamp(isActive ? null : c.key)}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && onSelectCamp(isActive ? null : c.key)}
          >
            <div className="yap-camp-row-head">
              <span className="yap-camp-label">{label}</span>
              <span className="yap-camp-value">{fmtDuration(c.engagedMs)}</span>
            </div>
            <div className="yap-camp-track">
              <div
                className="yap-camp-fill"
                /* eslint-disable-next-line local/no-inline-style -- dynamic: bar width + camp color from data */
                style={{ width: `${(c.engagedMs / maxMs) * 100}%`, background: color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CategoryBreakdown({ root, camp }: { root: TreeNode; camp: string }) {
  const categories = useMemo(() => sumByCategoryForCamp(root, camp), [root, camp]);
  const maxMs = categories[0]?.engagedMs ?? 1;
  const color = CAMP_COLORS[camp] ?? '#6b7280';
  const campLabel = CAMP_LABELS[camp] ?? camp;

  return (
    <div className="yap-panel">
      <div className="yap-panel-title">{campLabel} — Category Breakdown</div>
      {categories.length === 0 ? (
        <div className="yap-empty">No category data.</div>
      ) : categories.map(c => (
        <div key={c.key} className="yap-cat-row">
          <div className="yap-cat-row-head">
            <span className="yap-cat-label">{categoryLabel(c.key)}</span>
            <span className="yap-cat-value">{fmtDuration(c.engagedMs)}</span>
          </div>
          <div className="yap-camp-track">
            <div
              className="yap-camp-fill"
              /* eslint-disable-next-line local/no-inline-style -- dynamic: bar width + camp color */
              style={{ width: `${(c.engagedMs / maxMs) * 100}%`, background: color, opacity: 0.7 }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityLeaderboards({ root }: { root: TreeNode }) {
  const nodes = useMemo(() => {
    const results: Array<{ id: string; engagedMs: number; visits: number }> = [];
    collectLeafNodes(root, 0, results);
    return results;
  }, [root]);

  const byTime = useMemo(() => [...nodes].sort((a, b) => b.engagedMs - a.engagedMs).slice(0, 10), [nodes]);
  const byVisits = useMemo(() => [...nodes].sort((a, b) => b.visits - a.visits).slice(0, 10), [nodes]);

  const List = ({ items, valueKey, title }: {
    items: Array<{ id: string; engagedMs: number; visits: number }>;
    valueKey: 'engagedMs' | 'visits';
    title: string;
  }) => (
    <div>
      <div className="yap-leader-col-title">{title}</div>
      {items.length === 0 ? <div className="yap-empty">No data.</div> : items.map((n, i) => (
        <div key={n.id} className="yap-leader-row">
          <span className="yap-leader-rank">{i + 1}</span>
          <span className="yap-leader-id" title={n.id}>{n.id}</span>
          <span className="yap-leader-val">
            {valueKey === 'engagedMs' ? fmtDuration(n.engagedMs) : fmtNumber(n.visits)}
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="yap-panel">
      <div className="yap-panel-title">Your Most-Visited Nodes</div>
      <div className="yap-leaders-row">
        <List items={byTime} valueKey="engagedMs" title="Most Time Spent" />
        <List items={byVisits} valueKey="visits" title="Most Visited" />
      </div>
    </div>
  );
}

// ── Fetch hook (extracted to keep YourActivityPanel under complexity limit) ────

interface FetchState { userTree: TreeNode | null; loading: boolean; error: string | null }

function useFetchUserActivity(userId: string | null, isAnonymous: boolean): FetchState {
  const [userTree, setUserTree] = useState<TreeNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (userId === null) return;
    if (isAnonymous) { setLoading(false); return; }

    setLoading(true);
    setError(null);
    const { from, to } = last30DayRange();
    // Non-admin path: server returns .user for the caller's own userId and strips
    // all other-user data server-side. (verified seam: t/2469#3)
    bridgeGet<ActivityResult>(`/api/analytics/engagement?user=${encodeURIComponent(userId)}&from=${from}&to=${to}`)
      .then(d => { setUserTree(d.user ?? null); setLoading(false); })
      .catch(err => {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'your-activity-panel',
          level: 'error',
          message: 'Activity fetch failed',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        setError(String(err));
        setLoading(false);
      });
  }, [userId, isAnonymous]);

  return { userTree, loading, error };
}

// ── Panel body (extracted so conditional branches don't inflate main component) ─

function PanelBody({ loading, error, isAnonymous, userTree, selectedCamp, onSelectCamp }: {
  loading: boolean; error: string | null; isAnonymous: boolean;
  userTree: TreeNode | null; selectedCamp: string | null; onSelectCamp: (k: string | null) => void;
}) {
  if (loading) return <div className="yap-loading">Loading…</div>;
  if (error) return <div className="yap-error">Failed to load: {error}</div>;
  if (isAnonymous) return <div className="yap-auth-required">Sign in to see your activity.</div>;
  if (userTree === null || userTree.visits === 0) {
    return <div className="yap-empty">No activity recorded yet. Start exploring the taxonomy!</div>;
  }
  return (
    <>
      <CampBars root={userTree} selectedCamp={selectedCamp} onSelectCamp={onSelectCamp} />
      {selectedCamp && <CategoryBreakdown root={userTree} camp={selectedCamp} />}
      <ActivityLeaderboards root={userTree} />
    </>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function YourActivityPanel() {
  const profile = useUserProfile();
  const userId = profile?.userId ?? null;
  const isAnonymous = profile?.isAnonymous ?? false;

  const { userTree, loading, error } = useFetchUserActivity(userId, isAnonymous);
  const [selectedCamp, setSelectedCamp] = useState<string | null>(null);

  const handleBack = () => { window.location.hash = ''; window.location.reload(); };
  const { from, to } = last30DayRange();

  return (
    <div className="yap-root">
      <div className="yap-header">
        <button onClick={handleBack} className="yap-back-btn">← Back</button>
        <h1 className="yap-title">Your Activity</h1>
        <span className="yap-period-label">{from} – {to}</span>
      </div>
      <PanelBody
        loading={loading} error={error} isAnonymous={isAnonymous}
        userTree={userTree} selectedCamp={selectedCamp} onSelectCamp={setSelectedCamp}
      />
    </div>
  );
}
