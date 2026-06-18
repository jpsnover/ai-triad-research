// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, renderHook, waitFor } from '@testing-library/react';
import { getNodeConflicts, type NodeConflict, type NodeConflictsResponse } from './nodeConflictsApi';
import { useNodeConflicts } from './useNodeConflicts';
import { EditConflictBadge } from './EditConflictBadge';

// Flight recorder is a no-op in tests.
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => null }));

function mockFetchOnce(body: unknown, { ok = true, contentType = 'application/json' } = {}) {
  const res = { ok, headers: { get: () => contentType }, json: async () => body } as unknown as Response;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res));
}

const SAMPLE: NodeConflictsResponse = {
  enabled: true,
  session_branch: 'api-session/jeff',
  behind_by: 2,
  conflicts: [
    { id: 'acc-belief-001', pov: 'accelerationist', yourFields: ['summary', 'label'], theirFields: ['summary'], theirUser: 'dana', theirEditedAt: '2026-06-18T10:00:00Z' },
  ],
};

const CONFLICT: NodeConflict = SAMPLE.conflicts[0];

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('getNodeConflicts', () => {
  it('returns the disabled response on HTTP error', async () => {
    mockFetchOnce({}, { ok: false });
    expect(await getNodeConflicts()).toEqual({ enabled: false, session_branch: null, behind_by: 0, conflicts: [] });
  });

  it('returns the disabled response on non-JSON (server absent)', async () => {
    mockFetchOnce('<html>', { contentType: 'text/html' });
    expect((await getNodeConflicts()).enabled).toBe(false);
  });

  it('returns the disabled response when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect((await getNodeConflicts()).conflicts).toEqual([]);
  });

  it('passes through the parsed body', async () => {
    mockFetchOnce(SAMPLE);
    expect(await getNodeConflicts()).toEqual(SAMPLE);
  });
});

describe('useNodeConflicts', () => {
  it('exposes conflicts keyed by node id', async () => {
    mockFetchOnce(SAMPLE);
    const { result } = renderHook(() => useNodeConflicts());
    await waitFor(() => expect(result.current.enabled).toBe(true));
    expect(result.current.behindBy).toBe(2);
    expect(result.current.conflicts.get('acc-belief-001')?.theirUser).toBe('dana');
  });

  it('stays empty and disabled when the backend is off', async () => {
    mockFetchOnce({ enabled: false, session_branch: null, behind_by: 0, conflicts: [] });
    const { result } = renderHook(() => useNodeConflicts());
    await waitFor(() => expect(result.current.conflicts.size).toBe(0));
    expect(result.current.enabled).toBe(false);
  });
});

describe('EditConflictBadge', () => {
  it('renders nothing when there is no conflict', () => {
    const { container } = render(<EditConflictBadge conflict={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the both-edited overlap and other-editor info', () => {
    render(<EditConflictBadge conflict={CONFLICT} />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('Edited on main');
    // Overlap of yourFields∩theirFields = ['summary'].
    expect(badge.title).toContain('You and dana both changed: summary');
    expect(badge.title).toContain('dana changed: summary');
  });

  it('renders the Resolve on GitHub link only when a url is given', () => {
    const { rerender } = render(<EditConflictBadge conflict={CONFLICT} />);
    expect(screen.queryByText('Resolve on GitHub')).toBeNull();
    rerender(<EditConflictBadge conflict={CONFLICT} resolveUrl="https://github.com/x/y/pull/3" />);
    expect(screen.getByText('Resolve on GitHub')).toHaveAttribute('href', 'https://github.com/x/y/pull/3');
  });

  it('ignores a non-https resolve url', () => {
    render(<EditConflictBadge conflict={CONFLICT} resolveUrl="javascript:alert(1)" />);
    expect(screen.queryByText('Resolve on GitHub')).toBeNull();
  });
});
