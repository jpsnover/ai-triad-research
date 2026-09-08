// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3401: the debate ref-popup couldn't resolve pol-* ids ("Node not found in loaded Perspective
// files"). Regression coverage for the new policy view.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaxonomyRefDetail } from './TaxonomyRefDetail';

vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: () => ({}),
}));

describe('TaxonomyRefDetail — policy view (t/3401)', () => {
  it('renders the policy action, description, and referencing nodes when given a policy prop', () => {
    render(
      <TaxonomyRefDetail
        nodeId="pol-001"
        node={undefined}
        pov=""
        onClose={vi.fn()}
        policy={{ id: 'pol-001', action: 'Fund retraining programs.', description: 'Workforce policy.', source_povs: ['skeptic'], member_count: 3 }}
        policyReferencingNodes={[
          { id: 'skp-beliefs-042', label: 'A Skeptic Belief', pov: 'skeptic', action: 'Node-level action', framing: 'Node-level framing' },
        ]}
      />,
    );
    // Appears twice by design: the header title AND the body "Action" section.
    expect(screen.getAllByText('Fund retraining programs.').length).toBe(2);
    expect(screen.getByText('Workforce policy.')).toBeInTheDocument();
    expect(screen.getByText('A Skeptic Belief')).toBeInTheDocument();
    expect(screen.getByText(/Node-level framing/)).toBeInTheDocument();
    expect(screen.queryByText(/Node not found/)).not.toBeInTheDocument();
  });

  it('shows an empty-state message when no loaded node references the policy', () => {
    render(
      <TaxonomyRefDetail
        nodeId="pol-002"
        node={undefined}
        pov=""
        onClose={vi.fn()}
        policy={{ id: 'pol-002', action: 'Some other policy.', source_povs: [], member_count: 0 }}
        policyReferencingNodes={[]}
      />,
    );
    expect(screen.getByText(/No loaded node currently references this policy/)).toBeInTheDocument();
  });

  it('falls back to "Node not found" when neither node nor policy is provided (regression guard)', () => {
    render(<TaxonomyRefDetail nodeId="unknown-999" node={undefined} pov="" onClose={vi.fn()} />);
    expect(screen.getByText(/Node not found in loaded Perspective files/)).toBeInTheDocument();
  });

  it('still renders the normal node view when a node is provided (regression guard, no policy)', () => {
    render(
      <TaxonomyRefDetail
        nodeId="acc-beliefs-001"
        node={{ id: 'acc-beliefs-001', label: 'A POV Node', description: 'A description.' }}
        pov="accelerationist"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('A POV Node')).toBeInTheDocument();
    expect(screen.getByText('A description.')).toBeInTheDocument();
  });
});
