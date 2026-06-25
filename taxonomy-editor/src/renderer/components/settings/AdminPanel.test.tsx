import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@bridge', () => ({ api: {} }));
vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));

const mockFetchSubmissions = vi.fn().mockResolvedValue(undefined);
const mockApproveSubmission = vi.fn().mockResolvedValue(undefined);
const mockRejectSubmission = vi.fn().mockResolvedValue(undefined);

vi.mock('../../hooks/useCommunityStore', () => ({
  useCommunityStore: () => ({
    submissions: [],
    fetchSubmissions: mockFetchSubmissions,
    approveSubmission: mockApproveSubmission,
    rejectSubmission: mockRejectSubmission,
  }),
}));

let mockProfile: { isAdmin: boolean } | null = { isAdmin: true };
vi.mock('../../hooks/useAuthStatus', () => ({
  useUserProfile: () => mockProfile,
}));

vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: Object.assign(
    () => ({ accelerationist: null, safetyist: null, skeptic: null }),
    { getState: () => ({ accelerationist: null, safetyist: null, skeptic: null }) },
  ),
}));

vi.mock('../../hooks/useDebateStore', () => ({
  useDebateStore: () => ({
    retryEnrichment: vi.fn(),
    enrichmentStatus: {},
  }),
}));

vi.mock('zustand/react/shallow', () => ({
  useShallow: (fn: unknown) => fn,
}));

import { AdminPanel } from './AdminPanel';

describe('AdminPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfile = { isAdmin: true };
  });

  it('renders the admin header with submissions heading', () => {
    render(<AdminPanel />);
    expect(screen.getByText('Admin — Submissions')).toBeInTheDocument();
  });

  it('fetches submissions on mount', () => {
    render(<AdminPanel />);
    expect(mockFetchSubmissions).toHaveBeenCalledWith('pending');
  });

  it('shows no-access message for non-admin users', () => {
    mockProfile = { isAdmin: false };
    render(<AdminPanel />);
    expect(screen.getByText('You do not have admin access.')).toBeInTheDocument();
    expect(screen.queryByText('Admin — Submissions')).not.toBeInTheDocument();
  });

  it('shows empty state when no submissions exist', () => {
    render(<AdminPanel />);
    expect(screen.getByText(/No.*submissions/)).toBeInTheDocument();
  });

  it('renders filter select with correct options', () => {
    render(<AdminPanel />);
    const filterSelect = screen.getByRole('combobox');
    const options = Array.from(filterSelect.querySelectorAll('option'));
    expect(options.map(o => o.textContent)).toEqual(['Pending', 'Approved', 'Rejected', 'All']);
  });

  it('refetches submissions when filter changes', async () => {
    const user = userEvent.setup();
    render(<AdminPanel />);
    mockFetchSubmissions.mockClear();
    const filterSelect = screen.getByRole('combobox');
    await user.selectOptions(filterSelect, 'approved');
    expect(mockFetchSubmissions).toHaveBeenCalledWith('approved');
  });

  it('renders enrichment repair section', () => {
    render(<AdminPanel />);
    expect(screen.getByText('Enrichment Repair')).toBeInTheDocument();
    expect(screen.getByText('All nodes are fully enriched.')).toBeInTheDocument();
  });
});
