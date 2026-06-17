// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TaxonomyDiffPanel, type NodeDiffResponse } from './TaxonomyDiffPanel';

// Flight recorder is a no-op in tests.
vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => null,
}));

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
});
