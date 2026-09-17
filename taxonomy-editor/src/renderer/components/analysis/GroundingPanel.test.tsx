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
