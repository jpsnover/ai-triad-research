// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useUserProfile } from '../../hooks/useAuthStatus';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { CalibrationReviewViewer } from '../analysis';
import { CommunityReviewViewer } from './CommunityReviewViewer';
import './AdminReviewPanel.css';

// ── Types mirroring server/admin/types.ts (web-only, no bridge needed) ──

interface ReviewItem {
  id: string;
  domain: string;
  submitter: string;
  submitterDisplay: string;
  submittedAt: string;
  summary: string;
  itemCount: number;
  status: 'pending' | 'viewed';
}

interface ReviewStats {
  total: number;
  byDomain: Record<string, number>;
}

// ── API helpers ──

async function fetchQueue(): Promise<ReviewItem[]> {
  const res = await fetch('/api/admin/review/queue');
  if (!res.ok) throw new Error(`GET queue failed: HTTP ${res.status}`);
  const body = await res.json();
  return body.items ?? body;
}

async function fetchStats(): Promise<ReviewStats> {
  const res = await fetch('/api/admin/review/stats');
  if (!res.ok) throw new Error(`GET stats failed: HTTP ${res.status}`);
  return res.json();
}

// ── Helpers ──

function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const DOMAIN_LABELS: Record<string, string> = {
  calibration: 'Calibration',
  community: 'Community',
  taxonomy: 'Taxonomy',
};

// ── Queue card ──

function QueueCard({ item, selected, onClick }: {
  item: ReviewItem;
  selected: boolean;
  onClick: () => void;
}) {
  const cls = [
    'admin-review-card',
    selected && 'admin-review-card--selected',
    item.status === 'pending' && 'admin-review-card--new',
  ].filter(Boolean).join(' ');

  return (
    <div className={cls} onClick={onClick} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}>
      <div className="admin-review-card-top">
        <span className={`admin-review-domain-badge admin-review-domain-badge--${item.domain}`}>
          {DOMAIN_LABELS[item.domain] ?? item.domain}
        </span>
        <span className="admin-review-card-submitter">{item.submitterDisplay}</span>
        <span className="admin-review-card-count">{item.itemCount}</span>
      </div>
      <div className="admin-review-card-bottom">
        <span className="admin-review-card-summary">{item.summary}</span>
        <span className="admin-review-card-age">{relativeAge(item.submittedAt)}</span>
      </div>
    </div>
  );
}

// ── Viewer router ──

function ViewerRouter({ selected, onActionComplete }: {
  selected: ReviewItem | null;
  onActionComplete: () => void;
}) {
  if (!selected) {
    return (
      <div className="admin-review-placeholder">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
        Select a review item to see details
      </div>
    );
  }

  if (selected.domain === 'calibration') {
    return <CalibrationReviewViewer groupId={selected.id} onActionComplete={onActionComplete} />;
  }

  if (selected.domain === 'community') {
    return <CommunityReviewViewer groupId={selected.id} onActionComplete={onActionComplete} />;
  }

  return (
    <div className="admin-review-placeholder">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="9" y1="21" x2="9" y2="9" />
      </svg>
      <div style={{ marginTop: 8 }}>
        <strong>{DOMAIN_LABELS[selected.domain] ?? selected.domain}</strong> viewer
      </div>
      <div style={{ fontSize: '0.75rem', marginTop: 4 }}>
        {selected.summary} from {selected.submitterDisplay}
      </div>
      <div style={{ fontSize: '0.7rem', marginTop: 8, fontStyle: 'italic' }}>
        Domain-specific viewer coming soon.
      </div>
    </div>
  );
}

// ── Main panel ──

export function AdminReviewPanel() {
  const profile = useUserProfile();
  const [queue, setQueue] = useState<ReviewItem[]>([]);
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const [q, s] = await Promise.all([fetchQueue(), fetchStats()]);
      setQueue(q);
      setStats(s);
      setError(null);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'AdminReviewPanel',
        level: 'error',
        message: 'Failed to load admin review queue',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (profile && !profile.isAdmin) return;
    void load();
    pollRef.current = setInterval(() => void load(), 60_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load, profile?.isAdmin]);

  if (profile && !profile.isAdmin) {
    return (
      <div className="admin-review">
        <div className="admin-review-header">
          <button className="btn btn-ghost"
            onClick={() => { window.location.hash = ''; window.location.reload(); }}>
            &larr; Back
          </button>
          <h2>Admin Review</h2>
        </div>
        <div className="admin-review-empty">You do not have admin access.</div>
      </div>
    );
  }

  const filtered = filter === 'all' ? queue : queue.filter(i => i.domain === filter);
  const selected = filtered.find(i => i.id === selectedId) ?? null;

  const domains = Object.keys(stats?.byDomain ?? {});

  return (
    <div className="admin-review">
      <div className="admin-review-header">
        <button className="btn btn-ghost"
          onClick={() => { window.location.hash = ''; window.location.reload(); }}>
          &larr; Back
        </button>
        <h2>Admin Review</h2>
        {stats && stats.total > 0 && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {stats.total} pending
          </span>
        )}
      </div>

      <div className="admin-review-body">
        {/* Left pane: queue */}
        <div className="admin-review-queue">
          <div className="admin-review-queue-toolbar">
            <select className="admin-review-filter" value={filter}
              onChange={e => { setFilter(e.target.value); setSelectedId(null); }}>
              <option value="all">All domains{stats ? ` (${stats.total})` : ''}</option>
              {domains.map(d => (
                <option key={d} value={d}>
                  {DOMAIN_LABELS[d] ?? d} ({stats?.byDomain[d] ?? 0})
                </option>
              ))}
            </select>
            <button className="btn btn-ghost btn-sm" onClick={() => { setLoading(true); void load(); }}
              title="Refresh queue">
              ⟳
            </button>
          </div>

          {loading && <div className="admin-review-loading">Loading…</div>}
          {error && <div className="admin-review-error">{error}</div>}

          {!loading && !error && filtered.length === 0 && (
            <div className="admin-review-empty">
              No pending reviews{filter !== 'all' ? ` for ${DOMAIN_LABELS[filter] ?? filter}` : ''}.
            </div>
          )}

          <div className="admin-review-queue-list">
            {filtered.map(item => (
              <QueueCard
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                onClick={() => setSelectedId(item.id)}
              />
            ))}
          </div>
        </div>

        {/* Right pane: domain-specific viewer */}
        <div className="admin-review-viewer">
          <ViewerRouter selected={selected} onActionComplete={load} />
        </div>
      </div>
    </div>
  );
}
