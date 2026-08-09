// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => null }));
vi.mock('@bridge', () => ({
  api: {
    discoverSources: vi.fn(() => Promise.resolve([])),
    loadSummary: vi.fn(() => Promise.resolve(null)),
    loadSnapshot: vi.fn(() => Promise.resolve(null)),
  },
}));
vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: () => ({
    getLabelForId: () => '', navigateToNode: vi.fn(), setActiveTab: vi.fn(),
    createPovNode: vi.fn(), updatePovNode: vi.fn(),
  }),
}));
vi.mock('../../hooks/useResizablePanel', () => ({ useResizablePanel: () => ({ width: 300, onMouseDown: () => {} }) }));
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => 'desktop' }));
vi.mock('../../hooks/useFeatureFlags', () => ({ useFlag: () => true }));

const { SummariesTab } = await import('./SummariesTab');

describe('SummariesTab (t/1025)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders the source filter input', () => {
    render(<SummariesTab />);
    expect(screen.getByPlaceholderText('Filter sources...')).toBeInTheDocument();
  });

  it('shows the empty state when no summarized sources exist', async () => {
    render(<SummariesTab />);
    await waitFor(() => expect(screen.getByText('No sources with summaries found.')).toBeInTheDocument());
  });

  it('does not crash sorting by title when sources have null titles (t/2386)', async () => {
    const { api } = await import('@bridge');
    vi.mocked(api.discoverSources).mockResolvedValueOnce([
      { id: 'src-1', title: null as unknown as string, authors: [], tags: [], datePublished: '', dateIngested: '', summarized: true },
      { id: 'src-2', title: null as unknown as string, authors: [], tags: [], datePublished: '', dateIngested: '', summarized: true },
    ]);
    render(<SummariesTab />);
    await waitFor(() => expect(screen.queryByText('No sources with summaries found.')).toBeNull());
    expect(() => fireEvent.click(screen.getByText('Title'))).not.toThrow();
  });
});
