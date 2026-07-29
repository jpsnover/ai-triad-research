// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// setSelectedRef spy — the mention-render kit routes ref-link clicks through
// useDebateStore.getState().setSelectedRef (t/1906). Hoisted so the vi.mock factory can close over it.
const { setSelectedRef } = vi.hoisted(() => ({ setSelectedRef: vi.fn() }));

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => null }));
vi.mock('../../hooks/useDebateStore', () => ({
  useDebateStore: Object.assign(() => undefined, { getState: () => ({ setSelectedRef }) }),
}));
vi.mock('@bridge', () => ({
  api: {
    loadSourceEvidenceIndex: () => Promise.resolve({
      'node-facts': { facts: [{ claim: 'GDP rose 3% in 2024', label: 'Economic growth', doc_id: 'doc-42', specificity: 'precise', temporal_bound: '2024' }] },
      'node-empty': { facts: [] },
      'node-mention': { facts: [{ claim: 'Anthropic released a model', label: 'Model release', doc_id: 'doc-7', specificity: 'precise', temporal_bound: null }] },
    }),
    // Mention-render kit dependency (t/1901 bridge). Returns a stored mention for the
    // mention node; empty (plain text) for everything else.
    getContainerMentions: (containerId: string) => Promise.resolve(
      containerId === 'sei:node-mention'
        ? { containerId, mentions: [{ entity_ref: 'org-anthropic', quote: 'Anthropic', offset: 0, discovered_by: 'extraction' }] }
        : { containerId, mentions: [] },
    ),
  },
}));

const { FactsPanel } = await import('./FactsPanel');

describe('FactsPanel (t/1025, t/1906)', () => {
  afterEach(() => { vi.restoreAllMocks(); setSelectedRef.mockClear(); });

  it('shows an empty state for a node with no linked evidence', async () => {
    render(<FactsPanel nodeId="node-empty" />);
    await waitFor(() => expect(screen.getByText(/No source evidence linked/)).toBeInTheDocument());
  });

  it('lists facts and expands one (firing onSelectFact) on click', async () => {
    const onSelectFact = vi.fn();
    render(<FactsPanel nodeId="node-facts" onSelectFact={onSelectFact} />);
    await waitFor(() => expect(screen.getByText('Economic growth')).toBeInTheDocument());
    expect(screen.getByText(/1 fact from source documents/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Economic growth'));
    // Doc id only appears in the expanded detail.
    expect(screen.getByText(/doc-42/)).toBeInTheDocument();
    expect(onSelectFact).toHaveBeenCalledWith(expect.objectContaining({ label: 'Economic growth' }));
  });

  it('renders a stored entity mention as a .ref-link and routes the click (t/1906)', async () => {
    render(<FactsPanel nodeId="node-mention" />);
    // Once mentions load, "Anthropic" in the claim renders as a ref-link button
    // (kind conveyed via aria-label), not plain text.
    const link = await screen.findByRole('button', { name: /Organization: Anthropic/ });
    expect(link).toHaveClass('ref-link');

    // Clicking routes to the shared DetailPane via setSelectedRef with the parsed ref,
    // and does not toggle the card (stopPropagation).
    fireEvent.click(link);
    expect(setSelectedRef).toHaveBeenCalledWith({ kind: 'organization', id: 'org-anthropic' });
  });
});
