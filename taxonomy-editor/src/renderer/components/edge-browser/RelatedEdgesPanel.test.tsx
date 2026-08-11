// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { openExternal } = vi.hoisted(() => ({ openExternal: vi.fn() }));

vi.mock('@bridge', () => ({ api: { openExternal } }));
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => null }));
vi.mock('../shared/TheoryLink', () => ({
  TheoryLink: ({ label }: { label?: string }) => <button aria-label={label ?? 'theory-link'}>📖</button>,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let storeValue: any;
vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: (sel?: (s: unknown) => unknown) => sel ? sel(storeValue) : storeValue,
  // Static .getState() used in EdgeRow for getLabelForId
  // Vitest allows module-level property assignment on the mock object
}));

// Patch the static getState on the mock after module resolution
import * as TaxonomyStore from '../../hooks/useTaxonomyStore';

const { RelatedEdgesPanel } = await import('./RelatedEdgesPanel');

function makeEdge(over = {}) {
  return {
    source: 'acc-belief-001',
    target: 'saf-belief-002',
    type: 'SUPPORTS',
    bidirectional: false,
    confidence: 0.9,
    status: 'approved',
    discovered_at: '2026-01-01',
    model: 'test',
    ...over,
  };
}

describe('RelatedEdgesPanel (t/2446)', () => {
  beforeEach(() => {
    openExternal.mockReset();
    storeValue = {
      edgesFile: null,
      edgesLoading: false,
      relatedNodeId: null,
      showRelatedEdges: vi.fn(),
      selectedEdge: null,
      selectEdge: vi.fn(),
      getLabelForId: (id: string) => `L:${id}`,
    };
    // Wire static getState used by EdgeRow
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TaxonomyStore.useTaxonomyStore as any).getState = () => storeValue;
  });

  it('renders nothing when no node is selected', () => {
    const { container } = render(<RelatedEdgesPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the POV-edges TheoryLink bookmark in the panel header', () => {
    storeValue.relatedNodeId = 'acc-belief-001';
    storeValue.edgesFile = {
      edges: [makeEdge()],
      edge_types: [{ type: 'SUPPORTS', bidirectional: false, definition: 'A supports B.' }],
    };

    render(<RelatedEdgesPanel />);

    // The TheoryLink mock renders with the label prop we passed
    expect(screen.getByRole('button', { name: 'Open POV Edges doc in GitHub' })).toBeDefined();
  });

  it('shows loading state', () => {
    storeValue.relatedNodeId = 'acc-belief-001';
    storeValue.edgesLoading = true;

    render(<RelatedEdgesPanel />);

    expect(screen.getByText(/Loading edges/)).toBeDefined();
  });
});
