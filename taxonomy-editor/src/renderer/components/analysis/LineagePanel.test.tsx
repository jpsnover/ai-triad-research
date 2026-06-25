// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../hooks/useTaxonomyStore', () => {
  const hook = () => ({ pendingLineageValue: null, accelerationist: undefined, safetyist: undefined, skeptic: undefined, situations: undefined });
  hook.setState = () => {};
  return { useTaxonomyStore: hook };
});
vi.mock('../../data/lineageLookup', () => ({
  getAllLineages: () => ({ 'Effective Altruism': {} }),
  getLineageInfo: (k: string) => ({ label: k }),
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
  beforeEach(() => { vi.clearAllMocks(); });
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
});
