// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));
// Child dialogs pull in unrelated deps; stub them out — they only render conditionally.
vi.mock('../settings/ApiKeyDialog', () => ({ ApiKeyDialog: () => null }));
vi.mock('../settings/ApiKeyErrorMessage', () => ({ ApiKeyErrorMessage: () => null }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let storeValue: any;
vi.mock('../../hooks/useTaxonomyStore', () => ({ useTaxonomyStore: () => storeValue }));

const { SearchBar } = await import('./SearchBar');

describe('SearchBar (t/1009)', () => {
  beforeEach(() => {
    storeValue = {
      accelerationist: { nodes: [] },
      safetyist: { nodes: [] },
      skeptic: { nodes: [] },
      situations: { nodes: [] },
      conflicts: [],
      navigateToNode: vi.fn(),
      findQuery: '',
      findMode: 'raw',
      findCaseSensitive: false,
      setFindQuery: vi.fn(),
      setFindMode: vi.fn(),
      setFindCaseSensitive: vi.fn(),
      hasApiKey: true,
      checkApiKey: vi.fn().mockResolvedValue(true),
      runSemanticSearch: vi.fn().mockResolvedValue(undefined),
      semanticResults: [],
      embeddingLoading: false,
      embeddingError: null,
      getLabelForId: (id: string) => `L:${id}`,
    };
  });

  it('renders the search input', () => {
    render(<SearchBar />);
    expect(screen.getByPlaceholderText('Search taxonomy...')).toBeDefined();
  });

  it('updates the query as the user types', () => {
    render(<SearchBar />);
    const input = screen.getByPlaceholderText('Search taxonomy...');
    fireEvent.change(input, { target: { value: 'governance' } });
    expect(storeValue.setFindQuery).toHaveBeenCalledWith('governance');
  });

  it('switches search mode via the mode selector', () => {
    render(<SearchBar />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'semantic' } });
    expect(storeValue.setFindMode).toHaveBeenCalledWith('semantic');
  });

  it('shows the semantic placeholder when in semantic mode', () => {
    storeValue.findMode = 'semantic';
    render(<SearchBar />);
    expect(screen.getByPlaceholderText(/Describe what you/)).toBeDefined();
    // The text-mode Raw placeholder is gone in semantic mode.
    expect(screen.queryByPlaceholderText('Search taxonomy...')).toBeNull();
  });
});
