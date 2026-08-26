import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@bridge', () => ({
  api: {
    adminReviewDetail: vi.fn(),
    adminReviewAction: vi.fn(),
    trackEvent: vi.fn(),
  },
}));
vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));
vi.mock('@lib/electron-shared/povMeta', () => ({
  POV_META: {
    accelerationist: { color: '#ef4444', label: 'Accelerationist' },
    safetyist: { color: '#3b82f6', label: 'Safetyist' },
    skeptic: { color: '#22c55e', label: 'Skeptic' },
  },
}));

import { api } from '@bridge';
import { CommunityReviewViewer } from './CommunityReviewViewer';

const MOCK_DETAIL = {
  submissionId: 'sub-abc',
  type: 'debate',
  submitter: 'user@test.com',
  submittedAt: '2026-01-01T00:00:00Z',
  preview: 'Test debate preview',
  metadata: {},
  sanitization: { willStrip: [], willAdd: [] },
};

describe('CommunityReviewViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.adminReviewDetail).mockResolvedValue(MOCK_DETAIL);
    vi.mocked(api.adminReviewAction).mockResolvedValue(undefined);
  });

  it('shows "Already promoted" toast when promote returns 409', async () => {
    const user = userEvent.setup();
    vi.mocked(api.adminReviewAction).mockRejectedValueOnce(new Error('POST action failed: HTTP 409'));
    render(<CommunityReviewViewer groupId="group-1" />);
    await screen.findByRole('button', { name: 'Promote' });
    await user.click(screen.getByRole('button', { name: 'Promote' }));
    await waitFor(() => expect(screen.getByText(/Already promoted/)).toBeInTheDocument());
    expect(screen.queryByText(/^Error:/)).not.toBeInTheDocument();
  });

  it('shows generic error toast when promote returns a non-409 HTTP error', async () => {
    const user = userEvent.setup();
    vi.mocked(api.adminReviewAction).mockRejectedValueOnce(new Error('POST action failed: HTTP 500'));
    render(<CommunityReviewViewer groupId="group-1" />);
    await screen.findByRole('button', { name: 'Promote' });
    await user.click(screen.getByRole('button', { name: 'Promote' }));
    await waitFor(() => expect(screen.getByText(/Error:/)).toBeInTheDocument());
    expect(screen.queryByText(/Already promoted/)).not.toBeInTheDocument();
  });
});
