// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Flight recorder is a no-op in tests.
vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => null,
}));

// Controllable admin profile.
let isAdmin = true;
vi.mock('../../hooks/useAuthStatus', () => ({
  useUserProfile: () => ({ userId: 'jpsnover', displayName: 'JP', idp: 'github', isAnonymous: false, isAdmin }),
}));

// CSS import is a no-op under vitest, but stub to be safe.
vi.mock('./CalibrationAdmin.css', () => ({}));

const { CalibrationAdmin } = await import('./CalibrationAdmin');

const PENDING = {
  groups: [
    {
      origin: 'alice',
      source: 'users/alice',
      entries: [
        { debate_id: 'debate-aaaa1111', model: 'gemini-2.0', rounds: 3, crux_addressed_ratio: 0.8, avg_utilization_rate: 0.5, timestamp: '2026-06-01T00:00:00Z', lineage_frame: [{ cluster_id: 'c1', label: 'Safety', percentage: 60 }] },
        { debate_id: 'debate-bbbb2222', model: 'claude-opus', rounds: 2, crux_addressed_ratio: null, avg_utilization_rate: 0.4, timestamp: '2026-06-02T00:00:00Z', lineage_frame: null },
      ],
    },
    {
      origin: 'bob',
      source: 'users/bob',
      entries: [
        { debate_id: 'debate-cccc3333', model: 'groq-llama', rounds: 4, timestamp: '2026-06-03T00:00:00Z' },
      ],
    },
  ],
};

function mockFetch() {
  const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
    if (url === '/api/admin/calibration/pending') {
      return { ok: true, json: async () => PENDING } as Response;
    }
    if (url === '/api/admin/calibration/promote') {
      const body = JSON.parse((opts?.body as string) ?? '{}');
      const edited = body.edits ? Object.keys(body.edits) : [];
      return { ok: true, json: async () => ({ promoted: body.entryIds.length, entries: body.entryIds, edited }) } as Response;
    }
    if (url === '/api/admin/calibration/reject') {
      const body = JSON.parse((opts?.body as string) ?? '{}');
      return { ok: true, json: async () => ({ rejected: body.entryIds.length, entries: body.entryIds }) } as Response;
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('CalibrationAdmin', () => {
  beforeEach(() => {
    isAdmin = true;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders nothing for non-admins', () => {
    isAdmin = false;
    const { container } = render(<CalibrationAdmin />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the collapsed toggle for admins and does not fetch until opened', () => {
    const fetchMock = mockFetch();
    render(<CalibrationAdmin />);
    expect(screen.getByText('Calibration Curation')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads and groups pending entries by user when opened', async () => {
    mockFetch();
    render(<CalibrationAdmin />);
    fireEvent.click(screen.getByText('Calibration Curation'));
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument());
    expect(screen.getByText('bob')).toBeInTheDocument();
    expect(screen.getByText('debate-aaaa1')).toBeInTheDocument(); // sliced to 12 chars
    expect(screen.getByText(/3 pending · 2 users/)).toBeInTheDocument();
  });

  it('promotes all entries from a user group', async () => {
    const fetchMock = mockFetch();
    render(<CalibrationAdmin />);
    fireEvent.click(screen.getByText('Calibration Curation'));
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument());

    fireEvent.click(screen.getAllByText('Promote all')[0]);

    await waitFor(() => {
      const promoteCall = fetchMock.mock.calls.find(c => c[0] === '/api/admin/calibration/promote');
      expect(promoteCall).toBeTruthy();
      const body = JSON.parse((promoteCall![1] as RequestInit).body as string);
      expect(body.source).toBe('users/alice');
      expect(body.entryIds).toEqual(['debate-aaaa1111', 'debate-bbbb2222']);
    });
    await waitFor(() => expect(screen.getByText(/Promoted 2 entries to core/)).toBeInTheDocument());
  });

  it('sends an edited lineage label as a lineage_frame patch on promote', async () => {
    const fetchMock = mockFetch();
    render(<CalibrationAdmin />);
    fireEvent.click(screen.getByText('Calibration Curation'));
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument());

    // Open the editor on alice's first entry (dominant label "Safety") and correct it.
    fireEvent.click(screen.getAllByText('Edit')[0]);
    fireEvent.change(screen.getByPlaceholderText(/Corrected topic label/), { target: { value: 'Governance' } });
    fireEvent.click(screen.getAllByText('Promote all')[0]);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(c => c[0] === '/api/admin/calibration/promote');
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body.edits).toEqual({
        'debate-aaaa1111': { lineage_frame: [{ cluster_id: 'c1', label: 'Governance', percentage: 60 }] },
      });
    });
    await waitFor(() => expect(screen.getByText(/Promoted 2 entries to core \(1 edited\)/)).toBeInTheDocument());
  });

  it('omits edits and promotes verbatim when labels are untouched', async () => {
    const fetchMock = mockFetch();
    render(<CalibrationAdmin />);
    fireEvent.click(screen.getByText('Calibration Curation'));
    await waitFor(() => expect(screen.getByText('bob')).toBeInTheDocument());

    fireEvent.click(screen.getAllByText('Promote all')[1]); // bob's group

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        c => c[0] === '/api/admin/calibration/promote' && JSON.parse((c[1] as RequestInit).body as string).source === 'users/bob',
      );
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body.edits).toBeUndefined();
    });
  });

  it('requires a reason before rejecting selected entries', async () => {
    const fetchMock = mockFetch();
    render(<CalibrationAdmin />);
    fireEvent.click(screen.getByText('Calibration Curation'));
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument());

    // Select the first entry, then attempt reject with no reason.
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByText('Reject selected (1)'));

    await waitFor(() => expect(screen.getByText(/Enter a rejection reason first/)).toBeInTheDocument());
    expect(fetchMock.mock.calls.some(c => c[0] === '/api/admin/calibration/reject')).toBe(false);
  });

  it('rejects selected entries with a reason', async () => {
    const fetchMock = mockFetch();
    render(<CalibrationAdmin />);
    fireEvent.click(screen.getByText('Calibration Curation'));
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.change(screen.getByPlaceholderText(/Rejection reason/), { target: { value: 'low quality' } });
    fireEvent.click(screen.getByText('Reject selected (1)'));

    await waitFor(() => {
      const rejectCall = fetchMock.mock.calls.find(c => c[0] === '/api/admin/calibration/reject');
      expect(rejectCall).toBeTruthy();
      const body = JSON.parse((rejectCall![1] as RequestInit).body as string);
      expect(body.source).toBe('users/alice');
      expect(body.entryIds).toEqual(['debate-aaaa1111']);
      expect(body.reason).toBe('low quality');
    });
  });

  it('shows an error message when the pending fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) } as Response)));
    render(<CalibrationAdmin />);
    fireEvent.click(screen.getByText('Calibration Curation'));
    await waitFor(() => expect(screen.getByText(/Could not load pending entries/)).toBeInTheDocument());
  });
});
