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
    }),
  },
}));

const { FactsPanel } = await import('./FactsPanel');

describe('FactsPanel (t/1025)', () => {
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
});
