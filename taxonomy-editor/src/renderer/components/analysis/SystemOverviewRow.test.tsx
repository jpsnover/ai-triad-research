// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => null }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let storeValue: any;
vi.mock('../../hooks/useTaxonomyStore', () => ({ useTaxonomyStore: () => storeValue }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let calibrationResp: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let debateResp: any;
let calibrationReject = false;
let debateReject = false;
vi.mock('@bridge', () => ({
  api: {
    getCalibrationLog: () => calibrationReject ? Promise.reject(new Error('cal fail')) : Promise.resolve(calibrationResp),
    listDebateSessionsMeta: () => debateReject ? Promise.reject(new Error('debate fail')) : Promise.resolve(debateResp),
  },
}));

const { SystemOverviewRow } = await import('./SystemOverviewRow');

describe('SystemOverviewRow (t/890)', () => {
  beforeEach(() => {
    calibrationReject = false;
    debateReject = false;
    storeValue = {
      accelerationist: { nodes: [{ graph_attributes: { x: 1 } }, { graph_attributes: {} }] },
      safetyist: { nodes: [{ graph_attributes: { y: 2 } }] },
      skeptic: { nodes: [] },
      situations: { nodes: [{}] },
      setToolbarPanel: vi.fn(),
    };
    calibrationResp = {
      entries: [{ crux_addressed_ratio: 0.8 }, { crux_addressed_ratio: 0.6 }],
      validationReport: { summary: { pass: 14, fail: 1, skip: 1 } },
    };
    debateResp = [{}, {}, {}];
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders a summary from all four domains', async () => {
    render(<SystemOverviewRow usage={{ sessions: 42, sessionsDeltaPct: 12 }} />);
    // Usage (from props, synchronous)
    expect(screen.getByText('42 sessions')).toBeInTheDocument();
    expect(screen.getByText('↑12% vs prev')).toBeInTheDocument();
    // Taxonomy (synchronous from store): 4 nodes, 2 enriched = 50%
    expect(screen.getByText('4 nodes')).toBeInTheDocument();
    expect(screen.getByText('50% enriched')).toBeInTheDocument();
    // Async domains
    await waitFor(() => expect(screen.getByText('3 debates')).toBeInTheDocument());
    expect(screen.getByText('avg quality 0.70')).toBeInTheDocument();
    expect(screen.getByText('14/16 passing')).toBeInTheDocument();
  });

  it('degrades to "—" when a domain fails, without erroring', async () => {
    calibrationReject = true;
    debateReject = true;
    render(<SystemOverviewRow usage={{ sessions: 5, sessionsDeltaPct: null }} />);
    // Usage + taxonomy still render
    expect(screen.getByText('5 sessions')).toBeInTheDocument();
    expect(screen.getByText('4 nodes')).toBeInTheDocument();
    // Failed domains show "—"
    await waitFor(() => expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2));
  });

  it('shows "—" for taxonomy when the store has no nodes loaded', async () => {
    storeValue = { accelerationist: { nodes: [] }, safetyist: { nodes: [] }, skeptic: { nodes: [] }, situations: { nodes: [] }, setToolbarPanel: vi.fn() };
    render(<SystemOverviewRow usage={{ sessions: 1, sessionsDeltaPct: null }} />);
    const taxLabel = screen.getByText('Taxonomy');
    const card = taxLabel.parentElement!;
    expect(card.textContent).toContain('—');
  });

  it('omits the usage delta when comparison is off', () => {
    render(<SystemOverviewRow usage={{ sessions: 9, sessionsDeltaPct: null }} />);
    expect(screen.getByText('9 sessions')).toBeInTheDocument();
    expect(screen.queryByText(/vs prev/)).toBeNull();
  });

  it('navigates to the calibration panel when the Calibration card is clicked', async () => {
    window.location.hash = '#analytics';
    render(<SystemOverviewRow usage={{ sessions: 1, sessionsDeltaPct: null }} />);
    await waitFor(() => expect(screen.getByText('14/16 passing')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Calibration').parentElement!);

    expect(storeValue.setToolbarPanel).toHaveBeenCalledWith('calibration');
    expect(window.location.hash).toBe('');
  });
});
