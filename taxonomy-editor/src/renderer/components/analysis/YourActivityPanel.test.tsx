// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { YourActivityPanel } from './YourActivityPanel';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@bridge', () => ({ api: {} }));

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: vi.fn(() => ({ record: vi.fn() })),
}));

vi.mock('../../bridge/web-bridge', () => ({
  bridgeGet: vi.fn(),
}));

vi.mock('../../hooks/useAuthStatus', () => ({
  useUserProfile: vi.fn(),
}));

import { bridgeGet } from '../../bridge/web-bridge';
import { useUserProfile } from '../../hooks/useAuthStatus';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const LEAF_NODE = (id: string) => ({
  id, visits: 10, engagedVisits: 8, engagedMs: 30_000,
});

const FIXTURE_TREE = {
  id: 'root', visits: 80, engagedVisits: 64, engagedMs: 200_000,
  children: {
    taxonomy: {
      id: 'taxonomy', visits: 80, engagedVisits: 64, engagedMs: 200_000,
      children: {
        acc: {
          id: 'acc', visits: 40, engagedVisits: 32, engagedMs: 100_000,
          children: {
            'acc-bel': {
              id: 'acc-bel', visits: 20, engagedVisits: 16, engagedMs: 60_000,
              children: { 'acc-bel-001': LEAF_NODE('acc-bel-001') },
            },
            'acc-des': {
              id: 'acc-des', visits: 20, engagedVisits: 16, engagedMs: 40_000,
              children: { 'acc-des-001': LEAF_NODE('acc-des-001') },
            },
          },
        },
        saf: {
          id: 'saf', visits: 40, engagedVisits: 32, engagedMs: 100_000,
          children: {
            'saf-bel': {
              id: 'saf-bel', visits: 40, engagedVisits: 32, engagedMs: 100_000,
              children: { 'saf-bel-001': LEAF_NODE('saf-bel-001') },
            },
          },
        },
      },
    },
  },
};

const SIGNED_IN_PROFILE = {
  userId: 'user-123',
  displayName: 'Test User',
  idp: 'github',
  isAnonymous: false,
  isAdmin: false,
  quotas: null,
};

const ANON_PROFILE = {
  userId: '',
  displayName: '',
  idp: null,
  isAnonymous: true,
  isAdmin: false,
  quotas: null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockProfile(profile: typeof SIGNED_IN_PROFILE | typeof ANON_PROFILE | null) {
  vi.mocked(useUserProfile).mockReturnValue(profile);
}

function mockBridgeGet(tree: typeof FIXTURE_TREE | null) {
  vi.mocked(bridgeGet).mockResolvedValue({ user: tree });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('YourActivityPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfile(null);
    vi.mocked(bridgeGet).mockReturnValue(new Promise(() => {}));
  });

  it('shows loading while profile is null', () => {
    mockProfile(null);
    render(<YourActivityPanel />);
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it('shows auth-required message for anonymous users', async () => {
    mockProfile(ANON_PROFILE);
    render(<YourActivityPanel />);
    await waitFor(() => expect(screen.getByText(/sign in/i)).toBeTruthy());
  });

  it('does not call bridgeGet for anonymous users', async () => {
    mockProfile(ANON_PROFILE);
    render(<YourActivityPanel />);
    await waitFor(() => expect(screen.getByText(/sign in/i)).toBeTruthy());
    expect(vi.mocked(bridgeGet)).not.toHaveBeenCalled();
  });

  it('shows loading while fetch is in flight', () => {
    mockProfile(SIGNED_IN_PROFILE);
    vi.mocked(bridgeGet).mockReturnValue(new Promise(() => {}));
    render(<YourActivityPanel />);
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it('shows empty state when user tree has no visits', async () => {
    mockProfile(SIGNED_IN_PROFILE);
    vi.mocked(bridgeGet).mockResolvedValue({
      user: { id: 'root', visits: 0, engagedVisits: 0, engagedMs: 0 },
    });
    render(<YourActivityPanel />);
    await waitFor(() => expect(screen.getByText(/no activity recorded/i)).toBeTruthy());
  });

  it('shows empty state when server returns no user subtree', async () => {
    mockProfile(SIGNED_IN_PROFILE);
    vi.mocked(bridgeGet).mockResolvedValue({ user: undefined });
    render(<YourActivityPanel />);
    // userTree === null → same as empty (null check path)
    await waitFor(() => expect(screen.queryByText(/camp distribution/i)).toBeNull());
  });

  it('renders camp distribution with camp labels', async () => {
    mockProfile(SIGNED_IN_PROFILE);
    mockBridgeGet(FIXTURE_TREE);
    render(<YourActivityPanel />);
    await waitFor(() => expect(screen.getByText('Camp Distribution')).toBeTruthy());
    expect(screen.getByText('Accelerationist')).toBeTruthy();
    expect(screen.getByText('Safetyist')).toBeTruthy();
  });

  it('renders leaderboard section', async () => {
    mockProfile(SIGNED_IN_PROFILE);
    mockBridgeGet(FIXTURE_TREE);
    render(<YourActivityPanel />);
    await waitFor(() => expect(screen.getByText(/most-visited nodes/i)).toBeTruthy());
    expect(screen.getByText(/most time spent/i)).toBeTruthy();
    expect(screen.getByText(/most visited/i)).toBeTruthy();
  });

  it('shows node IDs in leaderboard', async () => {
    mockProfile(SIGNED_IN_PROFILE);
    mockBridgeGet(FIXTURE_TREE);
    render(<YourActivityPanel />);
    await waitFor(() => expect(screen.getAllByText(/acc-bel-001|saf-bel-001/).length).toBeGreaterThan(0));
  });

  it('shows category breakdown when camp is clicked', async () => {
    mockProfile(SIGNED_IN_PROFILE);
    mockBridgeGet(FIXTURE_TREE);
    render(<YourActivityPanel />);
    await waitFor(() => expect(screen.getByText('Accelerationist')).toBeTruthy());
    fireEvent.click(screen.getByText('Accelerationist'));
    await waitFor(() => expect(screen.getByText(/accelerationist.*category breakdown/i)).toBeTruthy());
    expect(screen.getByText('Beliefs')).toBeTruthy();
    expect(screen.getByText('Desires')).toBeTruthy();
  });

  it('closes category breakdown when same camp clicked again', async () => {
    mockProfile(SIGNED_IN_PROFILE);
    mockBridgeGet(FIXTURE_TREE);
    render(<YourActivityPanel />);
    await waitFor(() => expect(screen.getByText('Accelerationist')).toBeTruthy());
    fireEvent.click(screen.getByText('Accelerationist'));
    await waitFor(() => expect(screen.getByText('Beliefs')).toBeTruthy());
    fireEvent.click(screen.getByText('Accelerationist'));
    await waitFor(() => expect(screen.queryByText('Beliefs')).toBeNull());
  });

  it('shows error state on fetch failure', async () => {
    mockProfile(SIGNED_IN_PROFILE);
    vi.mocked(bridgeGet).mockRejectedValue(new Error('Network error'));
    render(<YourActivityPanel />);
    await waitFor(() => expect(screen.getByText(/failed to load/i)).toBeTruthy());
  });

  it('calls bridgeGet with userId as user param', async () => {
    mockProfile(SIGNED_IN_PROFILE);
    mockBridgeGet(FIXTURE_TREE);
    render(<YourActivityPanel />);
    await waitFor(() => expect(vi.mocked(bridgeGet)).toHaveBeenCalled());
    const url = vi.mocked(bridgeGet).mock.calls[0][0] as string;
    expect(url).toContain('user=user-123');
    expect(url).toContain('/api/analytics/engagement');
  });

  it('shows the period label in header', async () => {
    mockProfile(SIGNED_IN_PROFILE);
    mockBridgeGet(FIXTURE_TREE);
    render(<YourActivityPanel />);
    await waitFor(() => expect(screen.getByText('Camp Distribution')).toBeTruthy());
    // Period label: "YYYY-MM-DD – YYYY-MM-DD" format
    const periodLabel = screen.getByText(/\d{4}-\d{2}-\d{2} – \d{4}-\d{2}-\d{2}/);
    expect(periodLabel).toBeTruthy();
  });
});
