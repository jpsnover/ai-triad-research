// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DebateSession } from '../../types/debate';
import { ConvergenceSignalsPanel } from './ConvergenceSignalsPanel';

function debateWith(signals: unknown[]): DebateSession {
  return { id: 'd1', convergence_signals: signals } as unknown as DebateSession;
}

const SIGNAL = {
  round: 1, speaker: 'accelerationist', entry_id: 'e1',
  move_polarity: { ratio: 0.5, confrontational: 1, collaborative: 1 },
  dialectical_engagement: { ratio: 0.5, targeted: 1, standalone: 1 },
  argument_redundancy: { max_self_overlap: 0.2, avg_self_overlap: 0.1 },
  concession_opportunity: { outcome: 'taken', strong_attacks_faced: 1, concession_used: true },
  position_drift: { drift: 0.1, overlap_with_opening: 0.5 },
  crux_engagement_rate: { used_this_turn: false, cumulative_count: 0, cumulative_follow_through: 0 },
};

describe('ConvergenceSignalsPanel (t/1025)', () => {
  it('shows an empty state when no signals are recorded', () => {
    render(<ConvergenceSignalsPanel debate={debateWith([])} />);
    expect(screen.getByText(/No convergence signals recorded yet/)).toBeInTheDocument();
  });

  it('renders per-speaker summary stats and a signal row', () => {
    render(<ConvergenceSignalsPanel debate={debateWith([SIGNAL])} />);
    expect(screen.getByText(/Collab ratio:/)).toBeInTheDocument();
    // Round cell is present in the table.
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
  });

  it('opens the per-turn detail when a row is clicked', () => {
    render(<ConvergenceSignalsPanel debate={debateWith([SIGNAL])} />);
    // Click the round cell of the only row.
    const rows = document.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
    fireEvent.click(rows[0]);
    expect(screen.getByText(/← → to navigate, Esc to close/)).toBeInTheDocument();
  });
});
