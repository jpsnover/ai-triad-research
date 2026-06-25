// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { DebateSession } from '../../types/debate';

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => null }));
vi.mock('@bridge', () => ({
  api: {
    loadTaxonomyFile: (name: string) =>
      name === 'accelerationist'
        ? Promise.resolve({ nodes: [{ id: 'acc-belief-001', label: 'Growth belief' }] })
        : Promise.resolve({ nodes: [] }),
  },
}));

const { GroundingPanel } = await import('./GroundingPanel');

function debateWith(transcript: unknown[]): DebateSession {
  return { id: 'd1', transcript } as unknown as DebateSession;
}

describe('GroundingPanel (t/1025)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

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
});
