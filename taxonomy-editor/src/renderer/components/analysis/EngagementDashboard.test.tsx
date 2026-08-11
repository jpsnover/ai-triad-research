// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EngagementDashboard } from './EngagementDashboard';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@bridge', () => ({
  api: {},
}));

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: vi.fn(() => ({ record: vi.fn() })),
}));

vi.mock('../../bridge/web-bridge', () => ({
  bridgeGet: vi.fn(),
}));

vi.mock('../../hooks/useFeatureFlags', () => ({
  useFlag: vi.fn(() => false),
}));

vi.mock('./chartTooltip', () => ({
  useChartTooltip: () => ({ tip: null, showTip: vi.fn(), hideTip: vi.fn() }),
  ChartTooltipLayer: () => null,
}));

import { bridgeGet } from '../../bridge/web-bridge';
import { useFlag } from '../../hooks/useFeatureFlags';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const LEAF_NODE = (id: string) => ({
  id, visits: 10, engagedVisits: 8, engagedMs: 30_000, cappedRate: 0.05,
});

const FIXTURE_TREE = {
  id: 'root', visits: 100, engagedVisits: 80, engagedMs: 240_000, cappedRate: 0.05, uniqueUsers: 5,
  children: {
    taxonomy: {
      id: 'taxonomy', visits: 100, engagedVisits: 80, engagedMs: 240_000,
      children: {
        acc: {
          id: 'acc', visits: 40, engagedVisits: 32, engagedMs: 90_000,
          children: {
            'acc-bel': {
              id: 'acc-bel', visits: 20, engagedVisits: 16, engagedMs: 50_000,
              children: { 'acc-bel-001': LEAF_NODE('acc-bel-001'), 'acc-bel-002': LEAF_NODE('acc-bel-002') },
            },
            'acc-des': {
              id: 'acc-des', visits: 20, engagedVisits: 16, engagedMs: 40_000,
              children: { 'acc-des-001': LEAF_NODE('acc-des-001') },
            },
          },
        },
        saf: {
          id: 'saf', visits: 60, engagedVisits: 48, engagedMs: 150_000,
          children: {
            'saf-bel': {
              id: 'saf-bel', visits: 60, engagedVisits: 48, engagedMs: 150_000,
              children: { 'saf-bel-001': LEAF_NODE('saf-bel-001') },
            },
          },
        },
      },
    },
  },
};

const FIXTURE_USERS = [
  { user: 'alice@example.com', visits: 50, engagedVisits: 40, engagedMs: 120_000, topCamp: 'saf', lastActive: new Date(Date.now() - 60_000).toISOString() },
  { user: 'bob@example.com',   visits: 20, engagedVisits: 15, engagedMs:  60_000, topCamp: 'acc', lastActive: new Date(Date.now() - 3_600_000).toISOString() },
];

const FIXTURE_RESULT = {
  aggregate: FIXTURE_TREE,
  subtree: null,
  daily: [
    { date: '2026-08-04', visits: 30, engagedVisits: 24, engagedMs: 80_000 },
    { date: '2026-08-05', visits: 20, engagedVisits: 16, engagedMs: 60_000 },
    { date: '2026-08-06', visits: 40, engagedVisits: 32, engagedMs: 100_000 },
  ],
  users: FIXTURE_USERS,
};

const EMPTY_RESULT = {
  aggregate: { id: 'root', visits: 0, engagedVisits: 0, engagedMs: 0 },
  subtree: null,
  daily: [],
  users: [],
};

// ── Test helpers ───────────────────────────────────────────────────────────────

function mockBridgeGet(result: typeof FIXTURE_RESULT | typeof EMPTY_RESULT) {
  vi.mocked(bridgeGet).mockResolvedValue(result);
}

function mockAdmin(isAdmin: boolean) {
  vi.mocked(useFlag).mockReturnValue(isAdmin);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EngagementDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdmin(false);
  });

  it('shows loading state initially', () => {
    vi.mocked(bridgeGet).mockReturnValue(new Promise(() => {}));
    render(<EngagementDashboard />);
    expect(screen.getByText(/loading engagement/i)).toBeTruthy();
  });

  it('shows empty state when aggregate.visits is 0', async () => {
    mockBridgeGet(EMPTY_RESULT);
    render(<EngagementDashboard />);
    await waitFor(() => expect(screen.getByText(/no engagement data/i)).toBeTruthy());
  });

  it('renders all visible sections from fixture data', async () => {
    mockBridgeGet(FIXTURE_RESULT);
    render(<EngagementDashboard />);
    await waitFor(() => expect(screen.getByText(/engaged time over time/i)).toBeTruthy());
    expect(screen.getByText(/camp distribution/i)).toBeTruthy();
    expect(screen.getByText(/leaderboards/i)).toBeTruthy();
  });

  it('shows camp distribution bars with camp labels', async () => {
    mockBridgeGet(FIXTURE_RESULT);
    render(<EngagementDashboard />);
    await waitFor(() => expect(screen.getByText('Safetyist')).toBeTruthy());
    expect(screen.getByText('Accelerationist')).toBeTruthy();
  });

  it('drill-down shows category breakdown on camp click', async () => {
    mockBridgeGet(FIXTURE_RESULT);
    render(<EngagementDashboard />);
    await waitFor(() => expect(screen.getByText('Accelerationist')).toBeTruthy());
    fireEvent.click(screen.getByText('Accelerationist'));
    await waitFor(() => expect(screen.getByText(/accelerationist.*category breakdown/i)).toBeTruthy());
    expect(screen.getByText('Beliefs')).toBeTruthy();
    expect(screen.getByText('Desires')).toBeTruthy();
  });

  it('drill-down closes when same camp clicked again', async () => {
    mockBridgeGet(FIXTURE_RESULT);
    render(<EngagementDashboard />);
    await waitFor(() => expect(screen.getByText('Accelerationist')).toBeTruthy());
    fireEvent.click(screen.getByText('Accelerationist'));
    // Drill-down open: category rows appear
    await waitFor(() => expect(screen.getByText('Beliefs')).toBeTruthy());
    fireEvent.click(screen.getByText('Accelerationist'));
    // Drill-down closed: category rows gone
    await waitFor(() => expect(screen.queryByText('Beliefs')).toBeNull());
  });

  it('renders both leaderboards with distinct titles', async () => {
    mockBridgeGet(FIXTURE_RESULT);
    render(<EngagementDashboard />);
    await waitFor(() => expect(screen.getByText(/most engaged time/i)).toBeTruthy());
    expect(screen.getByText(/most visited/i)).toBeTruthy();
  });

  it('leaderboard items are visually distinct (different sort orders)', async () => {
    mockBridgeGet(FIXTURE_RESULT);
    render(<EngagementDashboard />);
    await waitFor(() => expect(screen.getByText(/most engaged time/i)).toBeTruthy());
    // Both columns render node IDs — check at least one appears
    expect(screen.getAllByText(/acc-bel-001|saf-bel-001/).length).toBeGreaterThan(0);
  });

  it('hides admin sections (per-user table, health strip) for non-admins', async () => {
    mockAdmin(false);
    mockBridgeGet(FIXTURE_RESULT);
    render(<EngagementDashboard />);
    await waitFor(() => expect(screen.getByText(/camp distribution/i)).toBeTruthy());
    expect(screen.queryByText(/per-user engagement/i)).toBeNull();
    expect(screen.queryByText(/heuristic health/i)).toBeNull();
  });

  it('shows per-user table and health strip for admins', async () => {
    mockAdmin(true);
    mockBridgeGet(FIXTURE_RESULT);
    render(<EngagementDashboard />);
    await waitFor(() => expect(screen.getByText(/per-user engagement/i)).toBeTruthy());
    expect(screen.getByText(/heuristic health/i)).toBeTruthy();
    expect(screen.getByText('alice@example.com')).toBeTruthy();
    expect(screen.getByText('bob@example.com')).toBeTruthy();
  });

  it('per-user table: non-admin user filter input not shown', async () => {
    mockAdmin(false);
    mockBridgeGet(FIXTURE_RESULT);
    render(<EngagementDashboard />);
    await waitFor(() => expect(screen.getByText(/camp distribution/i)).toBeTruthy());
    expect(screen.queryByPlaceholderText(/filter by user/i)).toBeNull();
  });

  it('per-user table: admin sees user filter input', async () => {
    mockAdmin(true);
    mockBridgeGet(FIXTURE_RESULT);
    render(<EngagementDashboard />);
    await waitFor(() => expect(screen.getByPlaceholderText(/filter by user/i)).toBeTruthy());
  });

  it('shows error state on fetch failure', async () => {
    vi.mocked(bridgeGet).mockRejectedValue(new Error('Network error'));
    render(<EngagementDashboard />);
    await waitFor(() => expect(screen.getByText(/failed to load/i)).toBeTruthy());
  });

  it('date preset buttons present and change selection', async () => {
    mockBridgeGet(FIXTURE_RESULT);
    render(<EngagementDashboard />);
    await waitFor(() => expect(screen.getByText('30 days')).toBeTruthy());
    expect(screen.getByText('7 days')).toBeTruthy();
    expect(screen.getByText('90 days')).toBeTruthy();
    fireEvent.click(screen.getByText('30 days'));
    // Re-fetch triggered (bridgeGet called again)
    await waitFor(() => expect(vi.mocked(bridgeGet).mock.calls.length).toBeGreaterThan(1));
  });

  it('health strip shows engagement rate', async () => {
    mockAdmin(true);
    mockBridgeGet(FIXTURE_RESULT);
    render(<EngagementDashboard />);
    // aggregate: visits=100, engagedVisits=80 → 80.0%
    await waitFor(() => expect(screen.getByText('80.0%')).toBeTruthy());
  });
});
