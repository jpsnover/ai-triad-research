// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { DebateSession } from '../../types/debate';

let mockAccNode: Record<string, unknown> = { id: 'acc-belief-001', label: 'Growth belief' };

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => null }));
vi.mock('@bridge', () => ({
  api: {
    loadTaxonomyFile: (name: string) =>
      name === 'accelerationist'
        ? Promise.resolve({ nodes: [mockAccNode] })
        : Promise.resolve({ nodes: [] }),
  },
}));

const { GroundingPanel } = await import('./GroundingPanel');

function debateWith(transcript: unknown[]): DebateSession {
  return { id: 'd1', transcript } as unknown as DebateSession;
}

describe('GroundingPanel (t/1025)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockAccNode = { id: 'acc-belief-001', label: 'Growth belief' };
  });

  it('shows an empty state when no taxonomy refs exist', () => {
    render(<GroundingPanel debate={debateWith([
      { id: 'e1', speaker: 'system', type: 'statement', taxonomy_refs: [], metadata: {} },
    ])} />);
    expect(screen.getByText(/No taxonomy references found/)).toBeInTheDocument();
  });

  it('aggregates references into rows with counts and resolves labels', async () => {
    render(<GroundingPanel debate={debateWith([
      { id: 'e1', speaker: 'system', type: 'statement', taxonomy_refs: [{ node_id: 'acc-belief-001', relevance: 'because reasons' }], metadata: {} },
      { id: 'e2', speaker: 'system', type: 'statement', taxonomy_refs: [{ node_id: 'acc-belief-001', relevance: '' }], metadata: {} },
    ])} />);
    // Aggregated count is synchronous from the transcript.
    expect(screen.getByText('2')).toBeInTheDocument();
    // Once the label resolves, the id column and label column diverge.
    await waitFor(() => expect(screen.getByText('Growth belief')).toBeInTheDocument());
    expect(screen.getByText('acc-belief-001')).toBeInTheDocument();
  });

  it('expands a row to show per-statement reference detail on click', () => {
    render(<GroundingPanel debate={debateWith([
      { id: 'e1', speaker: 'system', type: 'statement', taxonomy_refs: [{ node_id: 'acc-belief-001', relevance: 'because reasons' }], metadata: {} },
    ])} />);
    // Click the id cell (label column also shows the id until the async load resolves).
    fireEvent.click(screen.getAllByText('acc-belief-001')[0]);
    expect(screen.getByText('because reasons')).toBeInTheDocument();
    expect(screen.getByText('Moderator')).toBeInTheDocument();
  });

  it('reads the Testing badge from the taxonomy node\'s historical debate_tested.tier, not current-debate evidence', async () => {
    // Historical tier says contested, but the current debate has a single citing
    // statement with no attack and no cross-speaker corroboration — proves the
    // badge is sourced from the taxonomy file, not derived from this debate.
    mockAccNode = {
      id: 'acc-belief-001',
      label: 'Growth belief',
      graph_attributes: { debate_tested: { tier: 'contested' } },
    };
    render(<GroundingPanel debate={debateWith([
      { id: 'e1', speaker: 'accelerationist', type: 'statement', taxonomy_refs: [{ node_id: 'acc-belief-001', relevance: 'r' }], metadata: {} },
    ])} />);
    await waitFor(() => expect(screen.getByText('Contested')).toBeInTheDocument());
  });

  it('renders Well-tested for a node with debate_tested.tier of well_tested', async () => {
    mockAccNode = {
      id: 'acc-belief-001',
      label: 'Growth belief',
      graph_attributes: { debate_tested: { tier: 'well_tested' } },
    };
    render(<GroundingPanel debate={debateWith([
      { id: 'e1', speaker: 'accelerationist', type: 'statement', taxonomy_refs: [{ node_id: 'acc-belief-001', relevance: 'r' }], metadata: {} },
    ])} />);
    await waitFor(() => expect(screen.getByText('Well-tested')).toBeInTheDocument());
  });

  it('renders Cited for a node with debate_tested.tier of cited', async () => {
    mockAccNode = {
      id: 'acc-belief-001',
      label: 'Growth belief',
      graph_attributes: { debate_tested: { tier: 'cited' } },
    };
    render(<GroundingPanel debate={debateWith([
      { id: 'e1', speaker: 'accelerationist', type: 'statement', taxonomy_refs: [{ node_id: 'acc-belief-001', relevance: 'r' }], metadata: {} },
    ])} />);
    await waitFor(() => expect(screen.getByText('Cited')).toBeInTheDocument());
  });

  it('omits the Testing badge for a node with no debate_tested data (untested)', async () => {
    render(<GroundingPanel debate={debateWith([
      { id: 'e1', speaker: 'accelerationist', type: 'statement', taxonomy_refs: [{ node_id: 'acc-belief-001', relevance: 'r' }], metadata: {} },
    ])} />);
    await waitFor(() => expect(screen.getByText('Growth belief')).toBeInTheDocument());
    expect(screen.queryByText('Cited')).not.toBeInTheDocument();
    expect(screen.queryByText('Well-tested')).not.toBeInTheDocument();
    expect(screen.queryByText('Contested')).not.toBeInTheDocument();
  });
});

describe('GroundingPanel — Well-Tested Exclusion box', () => {
  afterEach(() => {
    mockAccNode = { id: 'acc-belief-001', label: 'Growth belief' };
  });

  const citing = (metadata: Record<string, unknown> = {}) => [
    { id: 'e1', speaker: 'accelerationist', type: 'statement', taxonomy_refs: [{ node_id: 'acc-belief-001', relevance: 'r' }], metadata },
  ];

  it('is hidden when the debate ran without the exclusion', () => {
    render(<GroundingPanel debate={debateWith(citing())} />);
    expect(screen.queryByText('Well-Tested Exclusion')).not.toBeInTheDocument();
  });

  it('shows manifest pre-filter counts and warns when cited grounding is still mostly well-tested', async () => {
    mockAccNode = { id: 'acc-belief-001', label: 'Growth belief', graph_attributes: { debate_tested: { tier: 'well_tested' } } };
    const manifest = { injection_manifest: { povNodeIds: ['acc-belief-001'], testing_selection: { well_tested_excluded: 73, greatest_hits_excluded: 12, under_tested_promoted_ids: ['acc-belief-009'] } } };
    const debate = { ...debateWith(citing(manifest)), exclude_greatest_hits: true } as DebateSession;
    render(<GroundingPanel debate={debate} />);
    expect(screen.getByText('Well-Tested Exclusion')).toBeInTheDocument();
    expect(screen.getByText('73')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Well-tested nodes still dominate/)).toBeInTheDocument());
  });

  it('notes a pre-feature debate that has no exclusion diagnostics, without a warning for untested grounding', async () => {
    const debate = { ...debateWith(citing()), exclude_greatest_hits: true } as DebateSession;
    render(<GroundingPanel debate={debate} />);
    expect(screen.getByText(/No exclusion diagnostics recorded/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Growth belief')).toBeInTheDocument());
    expect(screen.queryByText(/Well-tested nodes still dominate/)).not.toBeInTheDocument();
  });
});
