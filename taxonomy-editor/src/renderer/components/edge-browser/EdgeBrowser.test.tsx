// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));
vi.mock('@bridge', () => ({
  api: {
    getEdgeDetail: vi.fn().mockResolvedValue({ rationale: '' }),
    loadEdges: vi.fn().mockResolvedValue(undefined),
    bulkUpdateEdges: vi.fn().mockResolvedValue(undefined),
    updateEdgeStatus: vi.fn().mockResolvedValue(undefined),
    swapEdgeDirection: vi.fn().mockResolvedValue(undefined),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let storeValue: any;
vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: Object.assign(() => storeValue, { setState: vi.fn(), getState: () => storeValue }),
}));

const { EdgeBrowser } = await import('./EdgeBrowser');

const LABELS: Record<string, string> = {
  'acc-belief-001': 'Alpha',
  'saf-belief-002': 'Beta',
  'skp-belief-003': 'Gamma',
  'acc-belief-004': 'Delta',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeEdge(over: any = {}) {
  return {
    source: 'acc-belief-001',
    target: 'saf-belief-002',
    type: 'SUPPORTS',
    bidirectional: false,
    confidence: 0.9,
    status: 'proposed',
    discovered_at: '2026-01-01',
    model: 'test',
    ...over,
  };
}

const EDGES_FILE = {
  edge_types: [{ type: 'SUPPORTS', bidirectional: false, definition: 'def' }],
  edges: [
    makeEdge(),
    makeEdge({ source: 'skp-belief-003', target: 'acc-belief-004', type: 'CONTRADICTS' }),
  ],
};

describe('EdgeBrowser (t/1009)', () => {
  beforeEach(() => {
    storeValue = {
      edgesFile: EDGES_FILE,
      loadEdges: vi.fn().mockResolvedValue(undefined),
      edgesLoading: false,
      getLabelForId: (id: string) => LABELS[id] ?? id,
      getDescriptionForId: (id: string) => `desc:${id}`,
    };
  });

  it('shows a loading state while edges load', () => {
    storeValue.edgesFile = null;
    storeValue.edgesLoading = true;
    render(<EdgeBrowser />);
    expect(screen.getByText('Loading edges...')).toBeDefined();
  });

  it('shows an empty-data state when no edges file is available', () => {
    storeValue.edgesFile = null;
    storeValue.edgesLoading = false;
    render(<EdgeBrowser />);
    expect(screen.getByText('No edges data found')).toBeDefined();
  });

  it('renders the edge list with resolved labels', () => {
    render(<EdgeBrowser />);
    expect(screen.getByText('Alpha')).toBeDefined();
    expect(screen.getByText('Beta')).toBeDefined();
    expect(screen.getByText('Gamma')).toBeDefined();
    expect(screen.getByText('2 / 2')).toBeDefined();
  });

  it('filters the list as the user types in the search box', () => {
    render(<EdgeBrowser />);
    const search = screen.getByPlaceholderText('Search nodes, rationale, type...');
    fireEvent.change(search, { target: { value: 'alpha' } });
    expect(screen.getByText('1 / 2')).toBeDefined();
    expect(screen.getByText('Alpha')).toBeDefined();
    expect(screen.queryByText('Gamma')).toBeNull();
  });

  it('shows a no-match message when nothing matches the filter', () => {
    render(<EdgeBrowser />);
    const search = screen.getByPlaceholderText('Search nodes, rationale, type...');
    fireEvent.change(search, { target: { value: 'zzz-no-match' } });
    expect(screen.getByText('No edges match filters')).toBeDefined();
    expect(screen.getByText('0 / 2')).toBeDefined();
  });
});
