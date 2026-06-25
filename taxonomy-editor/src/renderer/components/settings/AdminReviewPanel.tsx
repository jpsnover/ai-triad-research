// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useUserProfile } from '../../hooks/useAuthStatus';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { api, isElectronMode } from '@bridge';
import { bridgeGet } from '../../bridge/web-bridge';
import ErrorBoundary from '../../../../../lib/electron-shared/components/ErrorBoundary';
import { CalibrationReviewViewer } from '../analysis';
import { CommunityReviewViewer } from './CommunityReviewViewer';
import { FeatureFlagsPanel } from './FeatureFlagsPanel';
import './FeatureFlagsPanel.css';
import { RuntimeConfigPanel } from './RuntimeConfigPanel';
import './AdminReviewPanel.css';

// ── Types mirroring server/admin/types.ts ──

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

interface FeedbackEntry {
  id: string;
  timestamp: string;
  userId: string;
  rating: 'up' | 'down';
  category: 'bug' | 'feature_request' | 'confusing' | 'general';
  text: string | null;
  context: Record<string, unknown>;
}

interface FeedbackResponse {
  items: FeedbackEntry[];
  total: number;
  hasMore: boolean;
}

type FeedbackCategory = FeedbackEntry['category'] | 'all';
type FeedbackRating = 'up' | 'down' | 'all';

// ── API helpers ──

async function fetchQueue(): Promise<ReviewItem[]> {
  const result = await api.adminReviewQueue();
  return result.items as ReviewItem[];
}

async function fetchStats(): Promise<ReviewStats> {
  return api.adminReviewStats();
}

async function fetchFeedback(opts: {
  limit?: number; offset?: number; category?: string; rating?: string;
}): Promise<FeedbackResponse> {
  // Feedback is server-only (no Azure Blob equivalent)
  if (isElectronMode()) return { items: [], total: 0, hasMore: false };
  const params = new URLSearchParams();
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.offset) params.set('offset', String(opts.offset));
  if (opts.category && opts.category !== 'all') params.set('category', opts.category);
  if (opts.rating && opts.rating !== 'all') params.set('rating', opts.rating);
  const qs = params.toString();
  return bridgeGet<FeedbackResponse>(`/api/admin/feedback${qs ? `?${qs}` : ''}`);
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
    return (
      <ErrorBoundary key={selected.id} fallbackLabel="CalibrationReviewViewer">
        <CalibrationReviewViewer groupId={selected.id} onActionComplete={onActionComplete} />
      </ErrorBoundary>
    );
  }

  if (selected.domain === 'community') {
    return (
      <ErrorBoundary key={selected.id} fallbackLabel="CommunityReviewViewer">
        <CommunityReviewViewer groupId={selected.id} onActionComplete={onActionComplete} />
      </ErrorBoundary>
    );
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

// ── Feedback constants ──

const CATEGORY_LABELS: Record<string, string> = {
  bug: 'Bug',
  feature_request: 'Feature',
  confusing: 'Confusing',
  general: 'General',
};

const CATEGORY_COLORS: Record<string, string> = {
  bug: '#ef4444',
  feature_request: '#8b5cf6',
  confusing: '#f59e0b',
  general: '#6b7280',
};

const PAGE_SIZE = 50;

// ── Feedback section ──

function FeedbackSection() {
  const [items, setItems] = useState<FeedbackEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<FeedbackCategory>('all');
  const [ratingFilter, setRatingFilter] = useState<FeedbackRating>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  const load = useCallback(async (newOffset = 0) => {
    setLoading(true);
    try {
      const data = await fetchFeedback({
        limit: PAGE_SIZE,
        offset: newOffset,
        category: categoryFilter,
        rating: ratingFilter,
      });
      setItems(data.items);
      setTotal(data.total);
      setHasMore(data.hasMore);
      setOffset(newOffset);
      setError(null);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'AdminReviewPanel.Feedback',
        level: 'error',
        message: 'Failed to load feedback',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, ratingFilter]);

  useEffect(() => { void load(0); }, [load]);

  // Compute summary from current (possibly filtered) data + total
  const upCount = items.filter(i => i.rating === 'up').length;
  const upPct = items.length > 0 ? Math.round((upCount / items.length) * 100) : 0;
  const catCounts: Record<string, number> = {};
  for (const item of items) {
    catCounts[item.category] = (catCounts[item.category] ?? 0) + 1;
  }

  return (
    <div className="admin-feedback">
      {/* Summary bar */}
      <div className="admin-feedback-summary">
        <div className="admin-feedback-stat">
          <span className="admin-feedback-stat-value">{total}</span>
          <span className="admin-feedback-stat-label">Total</span>
        </div>
        <div className="admin-feedback-stat">
          <span className="admin-feedback-stat-value">👍 {upPct}%</span>
          <span className="admin-feedback-stat-label">Positive</span>
        </div>
        {Object.entries(catCounts).map(([cat, count]) => (
          <div key={cat} className="admin-feedback-stat">
            <span className="admin-feedback-stat-value" style={{ color: CATEGORY_COLORS[cat] }}>{count}</span>
            <span className="admin-feedback-stat-label">{CATEGORY_LABELS[cat] ?? cat}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="admin-feedback-filters">
        <select className="admin-review-filter" value={categoryFilter}
          onChange={e => { setCategoryFilter(e.target.value as FeedbackCategory); setExpandedId(null); }}>
          <option value="all">All categories</option>
          <option value="bug">Bug</option>
          <option value="feature_request">Feature Request</option>
          <option value="confusing">Confusing</option>
          <option value="general">General</option>
        </select>
        <select className="admin-review-filter" value={ratingFilter}
          onChange={e => { setRatingFilter(e.target.value as FeedbackRating); setExpandedId(null); }}>
          <option value="all">All ratings</option>
          <option value="up">👍 Positive</option>
          <option value="down">👎 Negative</option>
        </select>
        <button className="btn btn-ghost btn-sm" onClick={() => void load(0)} title="Refresh">⟳</button>
      </div>

      {loading && <div className="admin-review-loading">Loading…</div>}
      {error && <div className="admin-review-error">{error}</div>}

      {!loading && !error && items.length === 0 && (
        <div className="admin-review-empty">No feedback entries yet.</div>
      )}

      {!loading && !error && items.length > 0 && (
        <>
          <div className="admin-feedback-table">
            <div className="admin-feedback-row admin-feedback-row--header">
              <span className="admin-feedback-col-date">Date</span>
              <span className="admin-feedback-col-user">User</span>
              <span className="admin-feedback-col-rating">Rating</span>
              <span className="admin-feedback-col-cat">Category</span>
              <span className="admin-feedback-col-text">Text</span>
            </div>
            {items.map(item => (
              <div key={item.id}>
                <div
                  className={`admin-feedback-row${expandedId === item.id ? ' admin-feedback-row--expanded' : ''}`}
                  onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setExpandedId(expandedId === item.id ? null : item.id); }}
                >
                  <span className="admin-feedback-col-date">{relativeAge(item.timestamp)}</span>
                  <span className="admin-feedback-col-user" title={item.userId}>
                    {item.userId.length > 12 ? `${item.userId.slice(0, 12)}…` : item.userId}
                  </span>
                  <span className="admin-feedback-col-rating">
                    {item.rating === 'up' ? '👍' : '👎'}
                  </span>
                  <span className="admin-feedback-col-cat">
                    <span className="admin-feedback-cat-badge" style={{
                      background: `color-mix(in srgb, ${CATEGORY_COLORS[item.category] ?? '#6b7280'} 15%, transparent)`,
                      color: CATEGORY_COLORS[item.category] ?? '#6b7280',
                    }}>
                      {CATEGORY_LABELS[item.category] ?? item.category}
                    </span>
                  </span>
                  <span className="admin-feedback-col-text">
                    {item.text ? (item.text.length > 80 ? `${item.text.slice(0, 80)}…` : item.text) : '—'}
                  </span>
                </div>
                {expandedId === item.id && (
                  <div className="admin-feedback-detail">
                    {item.text && (
                      <div className="admin-feedback-detail-section">
                        <strong>Full text:</strong>
                        <p>{item.text}</p>
                      </div>
                    )}
                    <div className="admin-feedback-detail-section">
                      <strong>Timestamp:</strong> {new Date(item.timestamp).toLocaleString()}
                    </div>
                    <div className="admin-feedback-detail-section">
                      <strong>User ID:</strong> <code>{item.userId}</code>
                    </div>
                    {Object.keys(item.context).length > 0 && (
                      <div className="admin-feedback-detail-section">
                        <strong>Context:</strong>
                        <pre className="admin-feedback-context">{JSON.stringify(item.context, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Pagination */}
          <div className="admin-feedback-pagination">
            <button className="btn btn-sm" disabled={offset === 0} onClick={() => void load(Math.max(0, offset - PAGE_SIZE))}>
              ← Previous
            </button>
            <span className="admin-feedback-page-info">
              {offset + 1}–{Math.min(offset + items.length, total)} of {total}
            </span>
            <button className="btn btn-sm" disabled={!hasMore} onClick={() => void load(offset + PAGE_SIZE)}>
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main panel ──

type AdminTab = 'reviews' | 'feedback' | 'flags' | 'config';

export function AdminReviewPanel() {
  const [adminTab, setAdminTab] = useState<AdminTab>('reviews');
  const profile = useUserProfile();
  const [queue, setQueue] = useState<ReviewItem[]>([]);
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [azureConfigured, setAzureConfigured] = useState<boolean | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // In Electron mode, local user is admin when Azure review is configured
  const isAdmin = isElectronMode()
    ? azureConfigured === true
    : profile?.isAdmin === true;

  useEffect(() => {
    if (isElectronMode()) {
      void api.adminReviewConfigured().then(setAzureConfigured);
    }
  }, []);

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
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void load();
    pollRef.current = setInterval(() => void load(), 60_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load, isAdmin]);

  if (!isAdmin) {
    const message = isElectronMode() && azureConfigured === false
      ? 'Set AZURE_STORAGE_ACCOUNT_URL to review community submissions from the desktop app.'
      : 'You do not have admin access.';
    return (
      <div className="admin-review">
        <div className="admin-review-header">
          <button className="btn btn-ghost"
            onClick={() => { window.location.hash = ''; window.location.reload(); }}>
            &larr; Back
          </button>
          <h2>Admin Review</h2>
        </div>
        <div className="admin-review-empty">{message}</div>
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
        <div className="admin-review-tabs">
          <button className={`admin-review-tab${adminTab === 'reviews' ? ' active' : ''}`}
            onClick={() => setAdminTab('reviews')}>Reviews</button>
          <button className={`admin-review-tab${adminTab === 'feedback' ? ' active' : ''}`}
            onClick={() => setAdminTab('feedback')}>Feedback</button>
          <button className={`admin-review-tab${adminTab === 'flags' ? ' active' : ''}`}
            onClick={() => setAdminTab('flags')}>Feature Flags</button>
          <button className={`admin-review-tab${adminTab === 'config' ? ' active' : ''}`}
            onClick={() => setAdminTab('config')}>Config</button>
        </div>
      </div>

      {adminTab === 'config' ? (
        <RuntimeConfigPanel />
      ) : adminTab === 'flags' ? (
        <FeatureFlagsPanel />
      ) : adminTab === 'feedback' ? (
        <FeedbackSection />
      ) : (
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
      )}
    </div>
  );
}
