// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
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
});
