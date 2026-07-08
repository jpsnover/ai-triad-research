// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScoreBreakdown, OutcomeBadge } from './ScoreBreakdown';
import type { TurnValidationDimensions } from '../../../../types/debate';

// Minimal dims factory
function makeDims(overrides: Partial<TurnValidationDimensions> = {}): TurnValidationDimensions {
  return {
    schema:      { pass: true,  issues: [] },
    grounding:   { pass: true,  issues: [] },
    advancement: { pass: true,  signals: [] },
    clarifies:   { pass: false, signals: [] },
    ...overrides,
  };
}

describe('ScoreBreakdown', () => {
  it('renders all four dimension rows', () => {
    render(<ScoreBreakdown dims={makeDims()} processReward={0.85} judgeUsed={false} />);
    expect(screen.getByText('schema')).toBeInTheDocument();
    expect(screen.getByText('grounding')).toBeInTheDocument();
    expect(screen.getByText('advancement')).toBeInTheDocument();
    expect(screen.getByText('clarifies')).toBeInTheDocument();
  });

  it('renders the "Score breakdown" heading', () => {
    render(<ScoreBreakdown dims={makeDims()} processReward={0.85} judgeUsed={false} />);
    expect(screen.getByText('Score breakdown')).toBeInTheDocument();
  });

  it('shows the total process reward value', () => {
    render(<ScoreBreakdown dims={makeDims()} processReward={0.75} judgeUsed={true} />);
    // processReward formatted via toFixed(2) — find element containing "0.75"
    expect(screen.getByText('0.75')).toBeInTheDocument();
  });

  it('shows "(default)" label when judgeUsed is false', () => {
    render(<ScoreBreakdown dims={makeDims()} processReward={0.60} judgeUsed={false} />);
    expect(screen.getByText('(default)')).toBeInTheDocument();
  });

  it('does not show "(default)" when judgeUsed is true', () => {
    render(<ScoreBreakdown dims={makeDims()} processReward={0.70} judgeUsed={true} />);
    expect(screen.queryByText('(default)')).not.toBeInTheDocument();
  });

  it('shows detail text when dimension issues are provided', () => {
    const dims = makeDims({ schema: { pass: false, issues: ['missing required field'] } });
    render(<ScoreBreakdown dims={dims} processReward={0.30} judgeUsed={false} />);
    expect(screen.getByText('missing required field')).toBeInTheDocument();
  });

  it('shows FAIL for failed dimension with no details', () => {
    const dims = makeDims({ schema: { pass: false, issues: [] } });
    render(<ScoreBreakdown dims={dims} processReward={0.20} judgeUsed={false} />);
    expect(screen.getAllByText('FAIL').length).toBeGreaterThan(0);
  });
});

describe('DimensionScoreRow (via ScoreBreakdown)', () => {
  it('renders weight annotations for all four dimensions', () => {
    render(<ScoreBreakdown dims={makeDims()} processReward={0.90} judgeUsed={false} />);
    // Weights are rendered as ×0.4, ×0.3, ×0.2, ×0.1
    expect(screen.getByText('×0.4')).toBeInTheDocument();
    expect(screen.getByText('×0.3')).toBeInTheDocument();
    expect(screen.getByText('×0.2')).toBeInTheDocument();
    expect(screen.getByText('×0.1')).toBeInTheDocument();
  });

  it('renders passing weighted scores for all-pass dims', () => {
    render(<ScoreBreakdown dims={makeDims()} processReward={1.00} judgeUsed={false} />);
    // All pass=true: weighted values are 0.40, 0.30, 0.20, 0.10
    expect(screen.getByText('0.40')).toBeInTheDocument();
    expect(screen.getByText('0.30')).toBeInTheDocument();
    expect(screen.getByText('0.20')).toBeInTheDocument();
    // clarifies weight=0.1 × 0 (fail) = 0.00 by default
  });

  it('renders 0.00 score for a failing dimension', () => {
    // Only schema fails (weight 0.4), so its weighted score is 0.00
    const dims = makeDims({ schema: { pass: false, issues: [] } });
    render(<ScoreBreakdown dims={dims} processReward={0.60} judgeUsed={false} />);
    // Should have at least one 0.00 in the document for the failing dimension
    const zeroes = screen.getAllByText('0.00');
    expect(zeroes.length).toBeGreaterThanOrEqual(1);
  });
});

describe('OutcomeBadge', () => {
  it('renders PASS badge text', () => {
    render(<OutcomeBadge outcome="pass" />);
    expect(screen.getByText('PASS')).toBeInTheDocument();
  });

  it('renders RETRY badge text', () => {
    render(<OutcomeBadge outcome="retry" />);
    expect(screen.getByText('RETRY')).toBeInTheDocument();
  });

  it('renders ACCEPT (flagged) badge text', () => {
    render(<OutcomeBadge outcome="accept_with_flag" />);
    expect(screen.getByText('ACCEPT (flagged)')).toBeInTheDocument();
  });

  it('renders SKIPPED badge text', () => {
    render(<OutcomeBadge outcome="skipped" />);
    expect(screen.getByText('SKIPPED')).toBeInTheDocument();
  });

  it('applies pass verdict class for pass outcome', () => {
    const { container } = render(<OutcomeBadge outcome="pass" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.classList.contains('verdict-chip--pass')).toBe(true);
  });

  it('applies fail verdict class for retry outcome', () => {
    const { container } = render(<OutcomeBadge outcome="retry" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.classList.contains('verdict-chip--fail')).toBe(true);
  });

  it('applies flag verdict class for accept_with_flag outcome', () => {
    const { container } = render(<OutcomeBadge outcome="accept_with_flag" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.classList.contains('verdict-chip--flag')).toBe(true);
  });

  it('applies fail verdict class for skipped outcome', () => {
    const { container } = render(<OutcomeBadge outcome="skipped" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.classList.contains('verdict-chip--fail')).toBe(true);
  });
});
