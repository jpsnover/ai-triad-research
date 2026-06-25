// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let attributeInfo: any;
const clearAttributeInfo = vi.fn();
const runAttributeFilter = vi.fn();
const showAttributeInfo = vi.fn();
vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: () => ({ attributeInfo, clearAttributeInfo, runAttributeFilter, showAttributeInfo }),
}));
vi.mock('@bridge', () => ({ api: { openExternal: vi.fn() } }));

const { AttributeInfoPanel } = await import('./AttributeInfoPanel');

describe('AttributeInfoPanel (t/1025)', () => {
  beforeEach(() => { attributeInfo = null; vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders nothing when no attribute is selected', () => {
    const { container } = render(<AttributeInfoPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the field label and a no-description fallback for an unknown value', () => {
    attributeInfo = { field: 'rhetorical_strategy', value: 'zzz_unknown_strategy' };
    render(<AttributeInfoPanel />);
    expect(screen.getByText('Rhetorical Strategy')).toBeInTheDocument();
    expect(screen.getByText(/No description available/)).toBeInTheDocument();
  });

  it('runs the attribute filter when "Find nodes" is clicked', () => {
    attributeInfo = { field: 'rhetorical_strategy', value: 'zzz_unknown_strategy' };
    render(<AttributeInfoPanel />);
    fireEvent.click(screen.getByText(/Find nodes with this value/));
    expect(runAttributeFilter).toHaveBeenCalledWith('rhetorical_strategy', 'zzz_unknown_strategy');
  });
});
