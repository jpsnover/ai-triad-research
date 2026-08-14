// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, renderHook, waitFor } from '@testing-library/react';
import { getNodeConflicts, type NodeConflict, type NodeConflictsResponse } from './nodeConflictsApi';
import { useNodeConflicts } from './useNodeConflicts';
import { EditConflictBadge } from './EditConflictBadge';

// Flight recorder is a no-op in tests.
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => null }));

vi.mock('../../../bridge/web-bridge', () => ({
  bridgeGet: vi.fn(),
}));

import { bridgeGet } from '../../../bridge/web-bridge';
const mockBridgeGet = vi.mocked(bridgeGet);

const SAMPLE: NodeConflictsResponse = {
  enabled: true,
  session_branch: 'api-session/jeff',
  behind_by: 2,
  conflicts: [
    { id: 'acc-belief-001', pov: 'accelerationist', yourFields: ['summary', 'label'], theirFields: ['summary'], theirUser: 'dana', theirEditedAt: '2026-06-18T10:00:00Z' },
  ],
};

const CONFLICT: NodeConflict = SAMPLE.conflicts[0];

afterEach(() => { vi.restoreAllMocks(); mockBridgeGet.mockReset(); });

// Capture baseline env so each describe can restore cleanly.
const _origTarget = import.meta.env.VITE_TARGET;
const _origDev = import.meta.env.DEV;

describe('getNodeConflicts — electron-prod guard (t/2620)', () => {
  afterEach(() => {
    import.meta.env.VITE_TARGET = _origTarget;
    (import.meta.env as Record<string, unknown>).DEV = _origDev;
    mockBridgeGet.mockReset();
  });

  it('returns DISABLED immediately without touching bridgeGet in electron-prod', async () => {
    import.meta.env.VITE_TARGET = 'electron';
    (import.meta.env as Record<string, unknown>).DEV = false;
    // No server: if bridgeGet were called it would reject and open the read circuit.
    expect(await getNodeConflicts()).toEqual({ enabled: false, session_branch: null, behind_by: 0, conflicts: [] });
    expect(mockBridgeGet).not.toHaveBeenCalled();
  });

  it('calls bridgeGet in web-container mode (guard off)', async () => {
    import.meta.env.VITE_TARGET = 'web';
    (import.meta.env as Record<string, unknown>).DEV = false;
    mockBridgeGet.mockResolvedValue(SAMPLE);
    expect(await getNodeConflicts()).toEqual(SAMPLE);
    expect(mockBridgeGet).toHaveBeenCalledWith('/api/sync/node-conflicts');
  });

  it('calls bridgeGet in electron-dev mode (dev server is running)', async () => {
    import.meta.env.VITE_TARGET = 'electron';
    (import.meta.env as Record<string, unknown>).DEV = true;
    mockBridgeGet.mockResolvedValue(SAMPLE);
    expect(await getNodeConflicts()).toEqual(SAMPLE);
    expect(mockBridgeGet).toHaveBeenCalledWith('/api/sync/node-conflicts');
  });
});

describe('getNodeConflicts', () => {
  it('returns the disabled response on HTTP error', async () => {
    mockBridgeGet.mockRejectedValue(new Error('HTTP 500'));
    expect(await getNodeConflicts()).toEqual({ enabled: false, session_branch: null, behind_by: 0, conflicts: [] });
  });

  it('returns the disabled response on non-JSON (server absent)', async () => {
    mockBridgeGet.mockRejectedValue(new SyntaxError('Unexpected token'));
    expect((await getNodeConflicts()).enabled).toBe(false);
  });

  it('returns the disabled response when fetch throws', async () => {
    mockBridgeGet.mockRejectedValue(new Error('network down'));
    expect((await getNodeConflicts()).conflicts).toEqual([]);
  });

  it('passes through the parsed body', async () => {
    mockBridgeGet.mockResolvedValue(SAMPLE);
    expect(await getNodeConflicts()).toEqual(SAMPLE);
  });
});

describe('useNodeConflicts', () => {
  it('exposes conflicts keyed by node id', async () => {
    mockBridgeGet.mockResolvedValue(SAMPLE);
    const { result } = renderHook(() => useNodeConflicts());
    await waitFor(() => expect(result.current.enabled).toBe(true));
    expect(result.current.behindBy).toBe(2);
    expect(result.current.conflicts.get('acc-belief-001')?.theirUser).toBe('dana');
  });

  it('stays empty and disabled when the backend is off', async () => {
    mockBridgeGet.mockResolvedValue({ enabled: false, session_branch: null, behind_by: 0, conflicts: [] });
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
