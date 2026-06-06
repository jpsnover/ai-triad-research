// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TopicCritiqueCard } from './TopicCritiqueCard';
import type { TopicCritique } from '@lib/debate/topicCritique';

// ── Mocks ────────────────────────────────────────────────────

// RadarChart and CritiqueColumn pull in heavy dependencies; stub them out.
vi.mock('./RadarChart', () => ({
  RadarChart: () => <svg data-testid="radar-chart" />,
}));

vi.mock('./CritiqueColumn', () => ({
  CritiqueColumn: ({ label, critique, action }: { label: string; critique: TopicCritique; action?: React.ReactNode }) => (
    <div data-testid={`critique-column-${label.replace(/\s+/g, '-').toLowerCase()}`}>
      <span>{label}</span>
      <span>{critique.composite_score}/20</span>
      {action}
    </div>
  ),
}));

// ── Helpers ──────────────────────────────────────────────────

function makeStructuralScore(total = 7) {
  return {
    crux_density: 1 as const,
    evidence_coverage: 1 as const,
    bdi_heterogeneity: 1 as const,
    abstraction_level: 2 as const,
    situation_activation: 2 as const,
    total,
    activated_nodes: [],
    pov_distribution: {},
    bdi_distribution: {},
  };
}

function makeFrameScore(total = 8) {
  return {
    conditionality: 2 as const,
    mechanism: 2 as const,
    stakeholder: 1 as const,
    tension: 1 as const,
    scope: 2 as const,
    total,
  };
}

function makeCritique(overrides: Partial<TopicCritique> = {}): TopicCritique {
  return {
    structural_score: makeStructuralScore(),
    frame_score: makeFrameScore(),
    composite_score: 15,
    rating: 'fair',
    issues: [],
    reframe_suggestions: [],
    rewritten_topic: '',
    computed_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('TopicCritiqueCard', () => {
  const defaultProps = {
    currentTopicText: 'Should AI development be accelerated?',
    onUseSuggested: vi.fn(),
    onReEvaluateSuggested: vi.fn(),
  };

  beforeEach(() => {
    defaultProps.onUseSuggested.mockClear();
    defaultProps.onReEvaluateSuggested.mockClear();
  });

  // ── Composite score display ──────────────────────────────

  it('renders the composite score as "X/20"', () => {
    render(<TopicCritiqueCard critique={makeCritique({ composite_score: 15 })} {...defaultProps} />);
    expect(screen.getByText('15/20')).toBeInTheDocument();
  });

  it('renders composite score of 7/20 for a weak critique', () => {
    render(<TopicCritiqueCard critique={makeCritique({ composite_score: 7, rating: 'weak' })} {...defaultProps} />);
    expect(screen.getByText('7/20')).toBeInTheDocument();
  });

  it('renders composite score of 20/20 for a perfect critique', () => {
    render(<TopicCritiqueCard critique={makeCritique({ composite_score: 20, rating: 'strong' })} {...defaultProps} />);
    expect(screen.getByText('20/20')).toBeInTheDocument();
  });

  // ── Show/Hide Details toggle ─────────────────────────────

  it('initially shows "Show Details" button', () => {
    render(<TopicCritiqueCard critique={makeCritique()} {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Show Details' })).toBeInTheDocument();
  });

  it('toggles to "Hide Details" when Show Details is clicked', async () => {
    render(<TopicCritiqueCard critique={makeCritique()} {...defaultProps} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show Details' }));
    expect(screen.getByRole('button', { name: 'Hide Details' })).toBeInTheDocument();
  });

  it('hides the detail columns before Show Details is clicked', () => {
    render(<TopicCritiqueCard critique={makeCritique()} {...defaultProps} />);
    expect(screen.queryByTestId('critique-column-current-topic')).not.toBeInTheDocument();
  });

  it('shows the Current Topic column after Show Details is clicked', async () => {
    render(<TopicCritiqueCard critique={makeCritique()} {...defaultProps} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show Details' }));
    expect(screen.getByTestId('critique-column-current-topic')).toBeInTheDocument();
  });

  it('collapses details again when Hide Details is clicked', async () => {
    render(<TopicCritiqueCard critique={makeCritique()} {...defaultProps} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show Details' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hide Details' }));
    expect(screen.queryByTestId('critique-column-current-topic')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show Details' })).toBeInTheDocument();
  });

  // ── "Use Suggested Topic" button ────────────────────────

  it('does not show "Use Suggested Topic" when rewritten_topic is empty', async () => {
    render(
      <TopicCritiqueCard
        critique={makeCritique({ rewritten_topic: '', rating: 'fair' })}
        {...defaultProps}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show Details' }));
    expect(screen.queryByRole('button', { name: 'Use Suggested Topic' })).not.toBeInTheDocument();
  });

  it('does not show "Use Suggested Topic" when rating is "strong"', async () => {
    render(
      <TopicCritiqueCard
        critique={makeCritique({ rewritten_topic: 'A better topic', rating: 'strong' })}
        {...defaultProps}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show Details' }));
    expect(screen.queryByRole('button', { name: 'Use Suggested Topic' })).not.toBeInTheDocument();
  });

  it('shows "Use Suggested Topic" when rewritten_topic exists and rating is "fair"', async () => {
    render(
      <TopicCritiqueCard
        critique={makeCritique({ rewritten_topic: 'A better topic', rating: 'fair' })}
        {...defaultProps}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show Details' }));
    expect(screen.getByRole('button', { name: 'Use Suggested Topic' })).toBeInTheDocument();
  });

  it('shows "Use Suggested Topic" when rewritten_topic exists and rating is "weak"', async () => {
    render(
      <TopicCritiqueCard
        critique={makeCritique({ rewritten_topic: 'A better topic', rating: 'weak' })}
        {...defaultProps}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show Details' }));
    expect(screen.getByRole('button', { name: 'Use Suggested Topic' })).toBeInTheDocument();
  });

  it('calls onUseSuggested with the rewritten_topic when button is clicked', async () => {
    const onUseSuggested = vi.fn();
    render(
      <TopicCritiqueCard
        critique={makeCritique({ rewritten_topic: 'A better topic', rating: 'fair' })}
        {...defaultProps}
        onUseSuggested={onUseSuggested}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show Details' }));
    await userEvent.click(screen.getByRole('button', { name: 'Use Suggested Topic' }));
    expect(onUseSuggested).toHaveBeenCalledWith('A better topic');
  });

  // ── Suggested critique score (second badge) ──────────────

  it('renders the suggested critique score badge when suggestedCritique is provided', () => {
    const suggested = makeCritique({ composite_score: 18, rating: 'strong' });
    render(
      <TopicCritiqueCard
        critique={makeCritique({ composite_score: 15, rating: 'fair' })}
        suggestedCritique={suggested}
        {...defaultProps}
      />,
    );
    expect(screen.getByText('15/20')).toBeInTheDocument();
    expect(screen.getByText('18/20')).toBeInTheDocument();
  });

  it('renders a positive delta indicator when suggestedCritique score is higher', () => {
    const suggested = makeCritique({ composite_score: 18, rating: 'strong' });
    render(
      <TopicCritiqueCard
        critique={makeCritique({ composite_score: 15, rating: 'fair' })}
        suggestedCritique={suggested}
        {...defaultProps}
      />,
    );
    expect(screen.getByText('(+3)')).toBeInTheDocument();
  });

  it('renders a negative delta indicator when suggestedCritique score is lower', () => {
    const suggested = makeCritique({ composite_score: 10, rating: 'fair' });
    render(
      <TopicCritiqueCard
        critique={makeCritique({ composite_score: 15, rating: 'fair' })}
        suggestedCritique={suggested}
        {...defaultProps}
      />,
    );
    expect(screen.getByText('(-5)')).toBeInTheDocument();
  });

  it('does not render delta when scores are equal', () => {
    const suggested = makeCritique({ composite_score: 15, rating: 'fair' });
    render(
      <TopicCritiqueCard
        critique={makeCritique({ composite_score: 15, rating: 'fair' })}
        suggestedCritique={suggested}
        {...defaultProps}
      />,
    );
    expect(screen.queryByText(/\(\+/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\(-/)).not.toBeInTheDocument();
  });

  // ── Edit suggested topic flow ────────────────────────────

  it('shows Edit button alongside Use Suggested Topic', async () => {
    render(
      <TopicCritiqueCard
        critique={makeCritique({ rewritten_topic: 'A better topic', rating: 'fair' })}
        {...defaultProps}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show Details' }));
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('switches to textarea mode when Edit is clicked', async () => {
    render(
      <TopicCritiqueCard
        critique={makeCritique({ rewritten_topic: 'A better topic', rating: 'fair' })}
        {...defaultProps}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show Details' }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('cancels edit mode and restores buttons', async () => {
    render(
      <TopicCritiqueCard
        critique={makeCritique({ rewritten_topic: 'A better topic', rating: 'fair' })}
        {...defaultProps}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show Details' }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use Suggested Topic' })).toBeInTheDocument();
  });
});
