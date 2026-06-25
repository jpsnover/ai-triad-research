// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => null }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let storeValue: any;
vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: () => storeValue,
}));

const { PolicyAlignmentPanel } = await import('./PolicyAlignmentPanel');

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeStore(overrides: Record<string, unknown> = {}) {
  return {
    accelerationist: { nodes: [] },
    safetyist: { nodes: [] },
    skeptic: { nodes: [] },
    situations: { nodes: [] },
    policyRegistry: [],
    edgesFile: null,
    setToolbarPanel: vi.fn(),
    ...overrides,
  };
}

/** A store with pol-001 shared across acc + saf (cross-pov), and pol-002
 *  used twice within acc only (same-pov shared). */
function makeStoreWithPolicies() {
  return makeStore({
    accelerationist: {
      nodes: [
        { id: 'acc-001', graph_attributes: { policy_actions: [{ policy_id: 'pol-001', framing: 'Accelerate via pol-001' }] } },
        { id: 'acc-002', graph_attributes: { policy_actions: [{ policy_id: 'pol-002', framing: 'acc uses pol-002 first' }] } },
        { id: 'acc-003', graph_attributes: { policy_actions: [{ policy_id: 'pol-002', framing: 'acc uses pol-002 second' }] } },
      ],
    },
    safetyist: {
      nodes: [
        { id: 'saf-001', graph_attributes: { policy_actions: [{ policy_id: 'pol-001', framing: 'Safety perspective on pol-001' }] } },
      ],
    },
    policyRegistry: [
      { id: 'pol-001', action: 'Regulate AI development' },
      { id: 'pol-002', action: 'Fund AI research' },
    ],
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('PolicyAlignmentPanel', () => {
  beforeEach(() => { storeValue = makeStore(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('shows 0 policies when no nodes reference any policy', () => {
    render(<PolicyAlignmentPanel />);
    expect(screen.getByText('0 policies')).toBeInTheDocument();
  });

  it('shows the cross-pov policy count when two POVs reference the same policy', () => {
    storeValue = makeStoreWithPolicies();
    render(<PolicyAlignmentPanel />);
    // Default filter is cross-pov; pol-001 qualifies, pol-002 does not
    expect(screen.getByText('1 policies')).toBeInTheDocument();
    expect(screen.getByText('pol-001')).toBeInTheDocument();
    expect(screen.getByText('Regulate AI development')).toBeInTheDocument();
  });

  it('shows all shared policies when filter switches to all-shared', () => {
    storeValue = makeStoreWithPolicies();
    render(<PolicyAlignmentPanel />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'all-shared' } });

    expect(screen.getByText('2 policies')).toBeInTheDocument();
    expect(screen.getByText('pol-001')).toBeInTheDocument();
    expect(screen.getByText('pol-002')).toBeInTheDocument();
  });

  it('search query filters the list by policy id', () => {
    storeValue = makeStoreWithPolicies();
    render(<PolicyAlignmentPanel />);
    // Switch to all-shared so pol-002 is visible first
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'all-shared' } });
    expect(screen.getByText('2 policies')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Filter policies...'), { target: { value: 'pol-001' } });

    expect(screen.getByText('1 policies')).toBeInTheDocument();
    expect(screen.getByText('pol-001')).toBeInTheDocument();
    expect(screen.queryByText('pol-002')).toBeNull();
  });

  it('search query filters the list by action text', () => {
    storeValue = makeStoreWithPolicies();
    render(<PolicyAlignmentPanel />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'all-shared' } });

    fireEvent.change(screen.getByPlaceholderText('Filter policies...'), { target: { value: 'regulate' } });

    expect(screen.getByText('1 policies')).toBeInTheDocument();
    expect(screen.getByText('pol-001')).toBeInTheDocument();
  });

  it('expands a policy item to show per-pov framings on click', () => {
    storeValue = makeStoreWithPolicies();
    render(<PolicyAlignmentPanel />);

    fireEvent.click(screen.getByText('pol-001').closest('button')!);

    expect(screen.getByText('Accelerate via pol-001')).toBeInTheDocument();
    expect(screen.getByText('Safety perspective on pol-001')).toBeInTheDocument();
  });

  it('collapses an expanded policy item on a second click', () => {
    storeValue = makeStoreWithPolicies();
    render(<PolicyAlignmentPanel />);

    const header = screen.getByText('pol-001').closest('button')!;
    fireEvent.click(header);
    expect(screen.getByText('Accelerate via pol-001')).toBeInTheDocument();

    fireEvent.click(header);
    expect(screen.queryByText('Accelerate via pol-001')).toBeNull();
  });

  it('shows edge summary (contradicts/complements/tensions) when edgesFile has matching edges', () => {
    storeValue = makeStoreWithPolicies();
    storeValue.edgesFile = {
      edges: [
        { source: 'pol-001', target: 'other', type: 'CONTRADICTS' },
        { source: 'pol-001', target: 'other2', type: 'COMPLEMENTS' },
      ],
    };
    render(<PolicyAlignmentPanel />);

    fireEvent.click(screen.getByText('pol-001').closest('button')!);

    expect(screen.getByText('1 contradicts')).toBeInTheDocument();
    expect(screen.getByText('1 complements')).toBeInTheDocument();
  });

  it('calls setToolbarPanel(null) when Close is clicked', () => {
    storeValue = makeStore();
    render(<PolicyAlignmentPanel />);

    fireEvent.click(screen.getByText('Close'));

    expect(storeValue.setToolbarPanel).toHaveBeenCalledWith(null);
  });
});
