// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let mockStoreState: Record<string, unknown> = { pendingLineageValue: null, accelerationist: undefined, safetyist: undefined, skeptic: undefined, situations: undefined };
vi.mock('../../hooks/useTaxonomyStore', () => {
  const hook = () => mockStoreState;
  hook.setState = () => {};
  hook.getState = () => mockStoreState;
  return { useTaxonomyStore: hook };
});
vi.mock('../../data/lineageLookup', () => ({
  getAllLineages: vi.fn(() => ({ 'Effective Altruism': {} })),
  getLineageInfo: (k: string) => ({ label: k }),
  lookupLineage: vi.fn((raw: string) => {
    const catalog: Record<string, boolean> = { 'Effective Altruism': true };
    const lower = raw.toLowerCase();
    for (const k of Object.keys(catalog)) {
      if (k.toLowerCase() === lower) return { key: k, info: {} };
    }
    return { key: null, info: null };
  }),
}));
vi.mock('../../data/lineageCategories', () => ({
  CATEGORY_ORDER: ['cat1'],
  classifyLineage: () => 'cat1',
  classifyLineageL2: () => undefined,
  getCategoryById: () => ({ label: 'Category One' }),
  getL2Categories: () => [],
  getL2CategoriesForL1: () => [],
  isLineageDataLoaded: () => false,
}));

const { LineagePanel } = await import('./LineagePanel');

describe('LineagePanel (t/1025)', () => {
  beforeAll(() => {
    // jsdom doesn't implement scrollIntoView; selectItem calls it inside rAF.
    Element.prototype.scrollIntoView = vi.fn();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreState = { pendingLineageValue: null, accelerationist: undefined, safetyist: undefined, skeptic: undefined, situations: undefined };
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders the category group header (collapsed by default)', () => {
    render(<LineagePanel />);
    expect(screen.getByText('Intellectual Lineage')).toBeInTheDocument();
    expect(screen.getByText('Category One')).toBeInTheDocument();
    expect(screen.getByText('(1)')).toBeInTheDocument();
  });

  it('shows an empty message when the filter matches nothing', () => {
    render(<LineagePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Filter lineage values/), { target: { value: 'zzzzz' } });
    expect(screen.getByText('No matching lineage values')).toBeInTheDocument();
  });

  it('expands the category and fires onSelectValue when an item is clicked', () => {
    const onSelectValue = vi.fn();
    render(<LineagePanel onSelectValue={onSelectValue} />);
    // Item is hidden until its L1 category is expanded.
    fireEvent.click(screen.getByText('Category One'));
    const item = screen.getByText('Effective Altruism');
    fireEvent.click(item);
    expect(onSelectValue).toHaveBeenCalledWith('Effective Altruism');
  });

  it('deduplicates casing variants from taxonomy data against catalog keys (t/1146)', () => {
    mockStoreState = {
      pendingLineageValue: null,
      accelerationist: {
        nodes: [
          { id: 'acc-b-001', label: 'Test Node', category: 'beliefs', graph_attributes: { intellectual_lineage: ['effective altruism'] } },
        ],
      },
      safetyist: undefined,
      skeptic: undefined,
      situations: undefined,
    };
    render(<LineagePanel />);
    // Expand the category to see items
    fireEvent.click(screen.getByText('Category One'));
    // Should show exactly one "Effective Altruism" (catalog key), not a duplicate "effective altruism"
    const items = screen.getAllByText('Effective Altruism');
    expect(items).toHaveLength(1);
    // Total count should be 1, not 2
    expect(screen.getByText('(1)')).toBeInTheDocument();
  });
});
