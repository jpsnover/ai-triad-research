// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let attributeFilter: any;
const fns = { clearAttributeFilter: vi.fn(), runAttributeFilter: vi.fn(), navigateToNode: vi.fn() };
vi.mock('../../hooks/useTaxonomyStore', () => {
  const hook = () => ({ attributeFilter, ...fns });
  hook.getState = () => ({});
  return { useTaxonomyStore: hook };
});
vi.mock('../../hooks/useResizablePanel', () => ({
  useResizableVerticalSplit: () => ({ height: 155, onMouseDown: () => {} }),
}));
// Heavy detail components are only rendered once a node is selected — stub them out.
vi.mock('../taxonomy/NodeDetail', () => ({ NodeDetail: () => null }));
vi.mock('../debate/SituationDetail', () => ({ SituationDetail: () => null }));

const { AttributeFilterPanel } = await import('./AttributeFilterPanel');

describe('AttributeFilterPanel (t/1025)', () => {
  beforeEach(() => { attributeFilter = null; vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders nothing when no filter is active', () => {
    const { container } = render(<AttributeFilterPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the field/value controls and matching node rows', () => {
    attributeFilter = {
      field: 'epistemic_type', value: 'empirical_claim',
      results: [{ id: 'acc-belief-001', label: 'Scaling drives capability', pov: 'accelerationist' }],
    };
    render(<AttributeFilterPanel />);
    expect(screen.getByText('Epistemic Type')).toBeInTheDocument();
    expect(screen.getByText('acc-belief-001')).toBeInTheDocument();
    expect(screen.getByText('Scaling drives capability')).toBeInTheDocument();
    expect(screen.getByText('Select a node above to view details')).toBeInTheDocument();
  });

  it('shows "No matching nodes" when the filter has no results', () => {
    attributeFilter = { field: 'epistemic_type', value: 'empirical_claim', results: [] };
    render(<AttributeFilterPanel />);
    expect(screen.getByText('No matching nodes')).toBeInTheDocument();
  });
});
