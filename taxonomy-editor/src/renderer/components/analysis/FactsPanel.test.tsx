// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => null }));
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
  afterEach(() => { vi.restoreAllMocks(); });

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

  it('linkifies a stored mention and routes via the wired onSelectRef (t/1906)', async () => {
    const onSelectRef = vi.fn();
    render(<FactsPanel nodeId="node-mention" onSelectRef={onSelectRef} />);
    // Links render only in the EXPANDED claim (the muted collapsed preview stays plain
    // text for WCAG AA — see FactsPanel §9 note). Expand the card first.
    await waitFor(() => expect(screen.getByText('Model release')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Model release'));
    // "Anthropic" in the expanded claim renders as a ref-link button (kind via aria-label).
    const link = await screen.findByRole('button', { name: /Organization: Anthropic/ });
    expect(link).toHaveClass('ref-link');
    // Clicking routes through the injected handler with the parsed ref (not a dead link).
    fireEvent.click(link);
    expect(onSelectRef).toHaveBeenCalledWith({ kind: 'organization', id: 'org-anthropic' });
  });

  it('renders mentions as PLAIN text when no onSelectRef is wired (t/1977 — no dead links)', async () => {
    render(<FactsPanel nodeId="node-mention" />); // no co-mounted pane → no handler
    await waitFor(() => expect(screen.getByText('Model release')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Model release'));
    // The claim text is present, but "Anthropic" is NOT a link (would be a dead click).
    expect(screen.getByText(/Anthropic released a model/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Organization: Anthropic/ })).toBeNull();
  });
});
