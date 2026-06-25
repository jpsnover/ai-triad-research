// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DebateSession } from '../../types/debate';

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => null }));

const { ExtractionTimelinePanel } = await import('./ExtractionTimelinePanel');

const TRACE = {
  entry_id: 'e1', round: 1, speaker: 'accelerationist', status: 'ok',
  prompt_chars: 2048, prompt_token_estimate: 512, response_chars: 1024, response_truncated: false,
  candidates_proposed: 3, candidates_accepted: 2, candidates_rejected: 1,
  an_node_count_before: 0, an_node_count_after: 2,
  rejection_reasons: {}, rejected_overlap_pcts: [], an_nodes_added_ids: ['an-1', 'an-2'],
  max_overlap_vs_existing: 0.2, attribution_decisions: [],
  prompt_hash: 'abc123', extraction_prompt_version: 'v1', response_time_ms: 1200,
  model: 'gemini-2.0', attempt_count: 1, error_message: '',
};
const SUMMARY = {
  total_turns: 1, total_proposed: 3, total_accepted: 2, acceptance_rate: 0.67,
  an_growth_series: [{ round: 1, cumulative_count: 2 }], plateau_detected: false,
  unattributed_claim_ratio: null,
};

function debateWith(diagnostics: unknown, summary: unknown): DebateSession {
  return { id: 'd1', diagnostics, extraction_summary: summary } as unknown as DebateSession;
}

describe('ExtractionTimelinePanel (t/1025)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('shows an empty state when there are no extraction traces', () => {
    render(<ExtractionTimelinePanel debate={debateWith(undefined, undefined)} />);
    expect(screen.getByText(/No extraction traces yet/)).toBeInTheDocument();
  });

  it('renders the per-turn trace table and summary stats', () => {
    render(<ExtractionTimelinePanel debate={debateWith({ entries: { e1: { extraction_trace: TRACE } } }, SUMMARY)} />);
    expect(screen.getByText('OK')).toBeInTheDocument();
    expect(screen.getByText('Acceptance:')).toBeInTheDocument();
  });

  it('expands the per-turn detail when a trace row is clicked', () => {
    render(<ExtractionTimelinePanel debate={debateWith({ entries: { e1: { extraction_trace: TRACE } } }, SUMMARY)} />);
    fireEvent.click(screen.getByText('OK'));
    expect(screen.getByText('↗ Show in transcript')).toBeInTheDocument();
  });
});
