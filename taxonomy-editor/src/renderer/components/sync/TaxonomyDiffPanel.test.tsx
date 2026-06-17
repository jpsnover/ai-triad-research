// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TaxonomyDiffPanel, type NodeDiffResponse } from './TaxonomyDiffPanel';
import type { SyncStatus } from '../../utils/syncApi';

// Flight recorder is a no-op in tests.
vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => null,
}));

// Stub the PR-submission client call (Phase 5E).
const createPullRequestTracked = vi.fn();
vi.mock('../../utils/syncApi', () => ({
  createPullRequestTracked: (...args: unknown[]) => createPullRequestTracked(...args),
}));

function makeStatus(overrides: Partial<SyncStatus> = {}): SyncStatus {
  return {
    enabled: true,
    unsynced_count: 3,
    session_branch: 'api-session/jeff',
    pr_number: null,
    pr_url: null,
    push_pending: false,
    github_configured: true,
    main_updated_available: false,
    rebase_in_progress: false,
    ...overrides,
  };
}

function mockFetchOnce(body: unknown, { ok = true, contentType = 'application/json' } = {}) {
  const res = {
    ok,
    headers: { get: () => contentType },
    json: async () => body,
  } as unknown as Response;
  globalThis.fetch = vi.fn().mockResolvedValue(res);
}

const SAMPLE: NodeDiffResponse = {
  enabled: true,
  session_branch: 'api-session/jeff',
  totals: { added: 1, modified: 1, removed: 1 },
  files: [
    {
      path: 'accelerationist.json',
      added: [{ id: 'acc-goal-009', label: 'New goal' }],
      modified: [
        {
          id: 'acc-goal-001',
          label: 'Existing goal',
          fields: [{ field: 'label', old: 'Old label', new: 'New label' }],
        },
      ],
      removed: [{ id: 'acc-goal-002', label: 'Dropped goal' }],
    },
  ],
};

describe('TaxonomyDiffPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when closed', () => {
    mockFetchOnce(SAMPLE);
    const { container } = render(<TaxonomyDiffPanel open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders added, modified and removed nodes with field-level detail', async () => {
    mockFetchOnce(SAMPLE);
    render(<TaxonomyDiffPanel open onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('acc-goal-009')).toBeInTheDocument());
    expect(screen.getByText('acc-goal-001')).toBeInTheDocument();
    expect(screen.getByText('acc-goal-002')).toBeInTheDocument();

    // Modified node expands its field diff by default.
    expect(screen.getByText('label')).toBeInTheDocument();
    expect(screen.getByText('Old label')).toBeInTheDocument();
    expect(screen.getByText('New label')).toBeInTheDocument();

    // File label drops the .json suffix.
    expect(screen.getByText('accelerationist')).toBeInTheDocument();
  });

  it('shows an empty state when the branch matches main', async () => {
    mockFetchOnce({
      enabled: true,
      session_branch: 'api-session/jeff',
      totals: { added: 0, modified: 0, removed: 0 },
      files: [],
    } satisfies NodeDiffResponse);
    render(<TaxonomyDiffPanel open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/No pending changes/i)).toBeInTheDocument());
  });

  it('degrades gracefully when the endpoint is unavailable', async () => {
    mockFetchOnce(null, { ok: false });
    render(<TaxonomyDiffPanel open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/isn.t available right now/i)).toBeInTheDocument());
  });

  it('treats a disabled response as unavailable', async () => {
    mockFetchOnce({ enabled: false, session_branch: null, totals: { added: 0, modified: 0, removed: 0 }, files: [] });
    render(<TaxonomyDiffPanel open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/isn.t available right now/i)).toBeInTheDocument());
  });

  it('closes via the × button', async () => {
    mockFetchOnce(SAMPLE);
    const onClose = vi.fn();
    render(<TaxonomyDiffPanel open onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('acc-goal-009')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', async () => {
    mockFetchOnce(SAMPLE);
    const onClose = vi.fn();
    render(<TaxonomyDiffPanel open onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('acc-goal-009')).toBeInTheDocument());
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('offers a "Manage changes" handoff when provided', async () => {
    mockFetchOnce(SAMPLE);
    const onManageChanges = vi.fn();
    const onClose = vi.fn();
    render(<TaxonomyDiffPanel open onClose={onClose} onManageChanges={onManageChanges} />);
    await waitFor(() => expect(screen.getByText('acc-goal-009')).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Manage changes/));
    expect(onClose).toHaveBeenCalled();
    expect(onManageChanges).toHaveBeenCalled();
  });

  // ── Phase 5E: pre-submission / PR flow ──

  it('shows a "Submit for review" affordance with a seeded description when status is provided', async () => {
    mockFetchOnce(SAMPLE);
    render(<TaxonomyDiffPanel open onClose={() => {}} status={makeStatus()} />);
    await waitFor(() => expect(screen.getByText('Submit for review')).toBeInTheDocument());
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    // Description seeded from the diff totals.
    expect(textarea.value).toMatch(/1 added, 1 modified, 1 removed/);
  });

  it('submits a PR and shows the resulting PR link', async () => {
    mockFetchOnce(SAMPLE);
    createPullRequestTracked.mockResolvedValue({ ok: true, number: 42, url: 'https://github.com/x/y/pull/42', branch: 'api-session/jeff', created: true });
    const onSubmitted = vi.fn();
    render(<TaxonomyDiffPanel open onClose={() => {}} status={makeStatus()} onSubmitted={onSubmitted} />);
    await waitFor(() => expect(screen.getByText('Submit for review')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Submit for review'));

    await waitFor(() => expect(screen.getByText(/Opened PR #42/)).toBeInTheDocument());
    expect(createPullRequestTracked).toHaveBeenCalledTimes(1);
    expect(onSubmitted).toHaveBeenCalled();
    const link = screen.getByText(/View on GitHub/) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://github.com/x/y/pull/42');
  });

  it('labels the action "Update PR" when a PR already exists', async () => {
    mockFetchOnce(SAMPLE);
    render(<TaxonomyDiffPanel open onClose={() => {}} status={makeStatus({ pr_number: 7, pr_url: 'https://github.com/x/y/pull/7' })} />);
    await waitFor(() => expect(screen.getByText('Update PR #7')).toBeInTheDocument());
  });

  it('disables submission when GitHub is not configured', async () => {
    mockFetchOnce(SAMPLE);
    render(<TaxonomyDiffPanel open onClose={() => {}} status={makeStatus({ github_configured: false })} />);
    await waitFor(() => expect(screen.getByText('Submit for review')).toBeInTheDocument());
    expect(screen.getByText('Submit for review').closest('button')).toBeDisabled();
  });

  it('surfaces a submission error and does not show a PR link', async () => {
    mockFetchOnce(SAMPLE);
    createPullRequestTracked.mockRejectedValue(new Error('rate limited'));
    render(<TaxonomyDiffPanel open onClose={() => {}} status={makeStatus()} />);
    await waitFor(() => expect(screen.getByText('Submit for review')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Submit for review'));
    await waitFor(() => expect(screen.getByText(/rate limited/)).toBeInTheDocument());
    expect(screen.queryByText(/View on GitHub/)).toBeNull();
  });
});
