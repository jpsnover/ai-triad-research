// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Tests for the Community view of Ask a Question (t/3678, epic req 1/AC2). Covers: fetch on
// mount, empty state, rendering via the shared CommunityCard (drift guard against a second card
// implementation), copy, and admin remove.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockFetchInquiries = vi.fn();
const mockCopyItem = vi.fn();
const mockRemoveItem = vi.fn();
let mockInquiries: { id: string; question: string; created_at: string; updated_at: string; camps: string[]; verdict_count: number }[] = [];
let mockLoading = false;

vi.mock('../../hooks/useCommunityStore', () => ({
  useCommunityStore: () => ({
    inquiries: mockInquiries,
    loading: mockLoading,
    fetchInquiries: mockFetchInquiries,
    copyItem: mockCopyItem,
    removeItem: mockRemoveItem,
  }),
}));

let mockIsAdmin = false;
vi.mock('../../hooks/useFeatureFlags', () => ({
  useFlag: () => mockIsAdmin,
}));

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));

const { InquiryCommunityList } = await import('./InquiryCommunityList');

describe('InquiryCommunityList (t/3678)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInquiries = [];
    mockLoading = false;
    mockIsAdmin = false;
  });

  it('fetches community inquiries on mount', () => {
    render(<InquiryCommunityList />);
    expect(mockFetchInquiries).toHaveBeenCalled();
  });

  it('shows an empty state when there are no community questions', () => {
    render(<InquiryCommunityList />);
    expect(screen.getByText(/No community questions yet/)).toBeInTheDocument();
  });

  it('renders each community inquiry via the shared CommunityCard (same card as the standalone Community Library)', () => {
    mockInquiries = [
      { id: 'inq-1', question: 'What counts as an AI harm?', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', camps: ['acc'], verdict_count: 1 },
    ];
    render(<InquiryCommunityList />);
    expect(screen.getByText('What counts as an AI harm?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy to My Library/i })).toBeInTheDocument();
  });

  it('Copy calls copyItem with the inquiries type and item id', async () => {
    mockInquiries = [
      { id: 'inq-1', question: 'Q', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', camps: [], verdict_count: 0 },
    ];
    mockCopyItem.mockResolvedValue('new-id');
    render(<InquiryCommunityList />);
    fireEvent.click(screen.getByRole('button', { name: /Copy to My Library/i }));
    await waitFor(() => expect(mockCopyItem).toHaveBeenCalledWith('inquiries', 'inq-1'));
  });

  it('does not show a remove control to non-admins', () => {
    mockInquiries = [
      { id: 'inq-1', question: 'Q', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', camps: [], verdict_count: 0 },
    ];
    mockIsAdmin = false;
    render(<InquiryCommunityList />);
    expect(screen.queryByLabelText('Remove from community')).not.toBeInTheDocument();
  });

  it('admin remove calls removeItem with the inquiries type', async () => {
    mockInquiries = [
      { id: 'inq-1', question: 'Q', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', camps: [], verdict_count: 0 },
    ];
    mockIsAdmin = true;
    mockRemoveItem.mockResolvedValue(undefined);
    render(<InquiryCommunityList />);
    fireEvent.click(screen.getByLabelText('Remove from community'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(mockRemoveItem).toHaveBeenCalledWith('inquiries', 'inq-1', undefined));
  });
});
