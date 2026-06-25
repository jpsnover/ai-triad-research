// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => null }));

// POVER_INFO is loaded from JSON with import assertions; mock the re-export module.
vi.mock('../../types/debate', () => ({
  POVER_INFO: {
    accelerationist: { label: 'Accelerationist', color: '#f59e0b', pov: 'accelerationist' },
    safetyist: { label: 'Safetyist', color: '#3b82f6', pov: 'safetyist' },
    skeptic: { label: 'Skeptic', color: '#a855f7', pov: 'skeptic' },
  },
  POV_KEYS: ['accelerationist', 'safetyist', 'skeptic'],
}));

const { TaxonomyGapPanel } = await import('./TaxonomyGapPanel');

// ── Fixtures ────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeDebate(overrides: Record<string, any> = {}): any {
  return {
    id: 'debate-test',
    title: 'Test debate',
    convergence_signals: [],
    gap_injections: [],
    cross_cutting_proposals: [],
    taxonomy_gap_analysis: undefined,
    ...overrides,
  };
}

const BASE_ANALYSIS = {
  summary: {
    overall_coverage_pct: 55,
    most_underserved_pov: 'skeptic',
    most_underserved_bdi: 'intentions',
    unmapped_argument_count: 3,
    cross_pov_gap_count: 2,
    recommendation: 'Focus more on skeptic intentions.',
  },
  pov_coverage: {
    accelerationist: {
      total_nodes: 10, injected_nodes: 8, referenced_nodes: 6,
      utilization_rate: 0.75,
      unreferenced_relevant: [],
      never_injected: [],
      category_breakdown: {},
    },
  },
  bdi_balance: {
    accelerationist: {
      beliefs: { node_count: 4, cited_count: 3, argument_count: 5 },
      desires: { node_count: 3, cited_count: 2, argument_count: 3 },
      intentions: { node_count: 3, cited_count: 1, argument_count: 2 },
      weakest_category: 'intentions',
      recommendation: 'Strengthen intentions.',
    },
  },
  unmapped_arguments: [
    { an_node_id: 'an-001', text: 'AI will improve healthcare rapidly.', speaker: 'accelerationist', gap_type: 'novel_argument' },
  ],
  cross_pov_gaps: [
    { description: 'No safetyist response to AGI timelines.', evidence_entries: ['an-001'], suggested_pov: 'safetyist', suggested_bdi: 'belief' },
  ],
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe('TaxonomyGapPanel', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('shows empty state when taxonomy_gap_analysis is absent', () => {
    render(<TaxonomyGapPanel debate={makeDebate()} />);
    expect(screen.getByText(/Gap analysis not available/)).toBeInTheDocument();
  });

  it('renders the overall coverage percentage in the summary banner', () => {
    render(<TaxonomyGapPanel debate={makeDebate({ taxonomy_gap_analysis: BASE_ANALYSIS })} />);
    expect(screen.getByText('55%')).toBeInTheDocument();
    expect(screen.getByText('Gap Analysis Summary')).toBeInTheDocument();
  });

  it('labels coverage as "Moderate" for values between 40% and 70%', () => {
    render(<TaxonomyGapPanel debate={makeDebate({ taxonomy_gap_analysis: BASE_ANALYSIS })} />);
    expect(screen.getByText('Moderate')).toBeInTheDocument();
  });

  it('labels coverage as "Good" for values above 70%', () => {
    const analysis = { ...BASE_ANALYSIS, summary: { ...BASE_ANALYSIS.summary, overall_coverage_pct: 80 } };
    render(<TaxonomyGapPanel debate={makeDebate({ taxonomy_gap_analysis: analysis })} />);
    expect(screen.getByText('Good')).toBeInTheDocument();
  });

  it('shows the most underserved POV and BDI from the summary', () => {
    render(<TaxonomyGapPanel debate={makeDebate({ taxonomy_gap_analysis: BASE_ANALYSIS })} />);
    expect(screen.getByText('skeptic')).toBeInTheDocument();
    expect(screen.getByText('intentions')).toBeInTheDocument();
  });

  it('shows unmapped argument counts and table rows', () => {
    render(<TaxonomyGapPanel debate={makeDebate({ taxonomy_gap_analysis: BASE_ANALYSIS })} />);
    expect(screen.getByText('Unmapped Arguments (1)')).toBeInTheDocument();
    expect(screen.getByText('AI will improve healthcare rapidly.')).toBeInTheDocument();
    expect(screen.getByText('Novel argument')).toBeInTheDocument();
  });

  it('shows cross-pov gap descriptions', () => {
    render(<TaxonomyGapPanel debate={makeDebate({ taxonomy_gap_analysis: BASE_ANALYSIS })} />);
    expect(screen.getByText('Cross-Perspective Gaps (1)')).toBeInTheDocument();
    expect(screen.getByText('No safetyist response to AGI timelines.')).toBeInTheDocument();
  });

  it('renders the recommendation text from the summary', () => {
    render(<TaxonomyGapPanel debate={makeDebate({ taxonomy_gap_analysis: BASE_ANALYSIS })} />);
    expect(screen.getByText('Focus more on skeptic intentions.')).toBeInTheDocument();
  });

  it('renders gap injections section when debate has gap_injections', () => {
    const debate = makeDebate({
      taxonomy_gap_analysis: BASE_ANALYSIS,
      gap_injections: [{
        round: 2,
        transcript_entry_id: 'entry-42',
        trigger: 'scheduled',
        arguments: [{ argument: 'What about long-term risk?', gap_type: 'blind_spot', relevant_povs: ['safetyist'] }],
        responses: [],
      }],
    });
    render(<TaxonomyGapPanel debate={debate} />);
    expect(screen.getByText('Gap Injection Results')).toBeInTheDocument();
    expect(screen.getByText('What about long-term risk?')).toBeInTheDocument();
    expect(screen.getByText('Blind spot')).toBeInTheDocument();
  });

  it('renders cross-cutting proposals section when debate has proposals', () => {
    const debate = makeDebate({
      taxonomy_gap_analysis: BASE_ANALYSIS,
      cross_cutting_proposals: [{
        agreement_text: 'All sides agree on transparency.',
        proposed_label: 'Transparency Norm',
        proposed_description: 'desc',
        rationale: 'rationale',
        interpretations: {
          accelerationist: { belief: 'b', desire: 'd', intention: 'i', summary: 'acc summary' },
          safetyist: { belief: 'b', desire: 'd', intention: 'i', summary: 'saf summary' },
          skeptic: { belief: 'b', desire: 'd', intention: 'i', summary: 'skp summary' },
        },
        linked_nodes: [],
      }],
    });
    render(<TaxonomyGapPanel debate={debate} />);
    expect(screen.getByText('Cross-Cutting Proposals (1)')).toBeInTheDocument();
    expect(screen.getByText('All sides agree on transparency.')).toBeInTheDocument();
    expect(screen.getByText('Transparency Norm')).toBeInTheDocument();
  });

  it('shows per-POV interpretations when a proposal is expanded', () => {
    const debate = makeDebate({
      taxonomy_gap_analysis: BASE_ANALYSIS,
      cross_cutting_proposals: [{
        agreement_text: 'All sides agree on transparency.',
        proposed_label: 'Transparency Norm',
        proposed_description: 'desc',
        rationale: 'rationale',
        interpretations: {
          accelerationist: { belief: 'b', desire: 'd', intention: 'i', summary: 'Acc sees transparency as speed.' },
          safetyist: { belief: 'b', desire: 'd', intention: 'i', summary: 'Saf sees transparency as safety.' },
          skeptic: { belief: 'b', desire: 'd', intention: 'i', summary: 'Skp questions transparency.' },
        },
        linked_nodes: [],
      }],
    });
    render(<TaxonomyGapPanel debate={debate} />);

    fireEvent.click(screen.getByText('Show per-Perspective interpretations'));

    expect(screen.getByText('Acc sees transparency as speed.')).toBeInTheDocument();
    expect(screen.getByText('Saf sees transparency as safety.')).toBeInTheDocument();
  });
});
