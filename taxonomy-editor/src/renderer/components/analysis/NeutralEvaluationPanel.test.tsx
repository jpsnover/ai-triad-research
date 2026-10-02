// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NeutralEvaluationPanel } from './NeutralEvaluationPanel';

// The NeutralEvaluation shape is internal to the component; build plain fixtures.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const evaluations: any = [{
  checkpoint: 'final',
  timestamp: '2026-01-01T00:00:00Z',
  cruxes: [{ id: 'c1', description: 'Is AGI imminent?', disagreement_type: 'empirical', speakers_involved: ['1', '2'], status: 'unaddressed', confidence: 'high' }],
  claims: [{ id: 'cl1', speaker: '1', claim_text: 'Scaling laws continue', neutral_assessment: 'well_supported', reasoning: 'Strong empirical support', confidence: 'high' }],
  overall_assessment: { strongest_unaddressed_claim_id: null, debate_is_engaging_real_disagreement: true, notes: 'A focused debate.' },
}];

describe('NeutralEvaluationPanel (t/1025)', () => {
  it('shows an empty state when there are no evaluations', () => {
    render(<NeutralEvaluationPanel evaluations={[]} />);
    expect(screen.getByText(/No neutral evaluations available/)).toBeInTheDocument();
  });

  it('renders cruxes, claims, and the engagement verdict', () => {
    render(<NeutralEvaluationPanel evaluations={evaluations} />);
    expect(screen.getByText('Independent Evaluation')).toBeInTheDocument();
    expect(screen.getByText('Is AGI imminent?')).toBeInTheDocument();
    expect(screen.getByText('Scaling laws continue')).toBeInTheDocument();
    expect(screen.getByText('Engaging real disagreement')).toBeInTheDocument();
  });

  it('filters claims to the selected assessment', () => {
    render(<NeutralEvaluationPanel evaluations={evaluations} />);
    fireEvent.change(screen.getByDisplayValue('All'), { target: { value: 'refuted' } });
    expect(screen.getByText(/No claims match the current filter/)).toBeInTheDocument();
  });

  it('collapsing the header hides the body and flips aria-expanded, without affecting onClose (t/3843)', () => {
    const onClose = vi.fn();
    render(<NeutralEvaluationPanel evaluations={evaluations} onClose={onClose} />);
    const toggle = screen.getByRole('button', { name: /Independent Evaluation/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Is AGI imminent?')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Is AGI imminent?')).not.toBeInTheDocument();
    // Header (incl. Close) stays visible while collapsed — the user can still dismiss.
    expect(screen.getByText('Close')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Is AGI imminent?')).toBeInTheDocument();
  });

  it('calls onClose when the Close button is clicked', () => {
    const onClose = vi.fn();
    render(<NeutralEvaluationPanel evaluations={evaluations} onClose={onClose} />);
    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not render a Close button when onClose is not provided', () => {
    render(<NeutralEvaluationPanel evaluations={evaluations} />);
    expect(screen.queryByText('Close')).not.toBeInTheDocument();
  });
});
