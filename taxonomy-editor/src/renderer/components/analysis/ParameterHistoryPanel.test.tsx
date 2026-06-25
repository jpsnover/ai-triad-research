// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => null }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let historyResp: any;
vi.mock('@bridge', () => ({ api: { getCalibrationHistory: () => Promise.resolve(historyResp) } }));

const { ParameterHistoryPanel } = await import('./ParameterHistoryPanel');

describe('ParameterHistoryPanel (t/1025)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('shows an empty state when no calibration data exists', async () => {
    historyResp = { current: null, history: [] };
    render(<ParameterHistoryPanel />);
    await waitFor(() => expect(screen.getByText(/No calibration data available/)).toBeInTheDocument());
  });

  it('renders the current values table', async () => {
    historyResp = { current: { exploration_exit: 0.55, relevance_threshold: 0.3 }, history: [] };
    render(<ParameterHistoryPanel />);
    await waitFor(() => expect(screen.getByText('Current Values')).toBeInTheDocument());
    expect(screen.getByText('Exploration Exit')).toBeInTheDocument();
    expect(screen.getByText('0.55')).toBeInTheDocument();
  });

  it('expands a change-history entry to show the diff and rationale', async () => {
    historyResp = {
      current: { exploration_exit: 0.55 },
      history: [{
        source: 'optimizer', timestamp: '2026-01-01T00:00:00Z', data_points: 10,
        before: {}, after: { exploration_exit: 0.55 },
        changes: [{ parameter: 'exploration_exit', from: 0.5, to: 0.55, confidence: 'high', rationale: 'tuned after 10 debates' }],
      }],
    };
    render(<ParameterHistoryPanel />);
    await waitFor(() => expect(screen.getByText('Change History')).toBeInTheDocument());
    // The expand toggle carries the ▶ arrow; the subtitle also says "1 change".
    fireEvent.click(screen.getByText(/▶ 1 change/));
    expect(screen.getByText('tuned after 10 debates')).toBeInTheDocument();
  });
});
