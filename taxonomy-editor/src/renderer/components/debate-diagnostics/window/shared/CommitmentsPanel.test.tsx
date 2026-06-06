// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommitmentsPanel } from './CommitmentsPanel';
import type { CommitmentStore, ArgumentNetworkNode, ArgumentNetworkEdge } from '../../../../types/debate';

// POVER_INFO is loaded from soul JSON files via poverInfo.ts.
// Mock the whole debate types re-export so POVER_INFO returns predictable labels.
vi.mock('@lib/debate/types', async (importOriginal) => {
  const original = await importOriginal<typeof import('@lib/debate/types')>();
  return {
    ...original,
    POVER_INFO: {
      accelerationist: { label: 'Accelerationist' },
      safetyist:       { label: 'Safetyist' },
      skeptic:         { label: 'Skeptic' },
    },
  };
});

// soul-doc JSON imports used transitively by poverInfo.ts
vi.mock('@lib/debate/soul-docs/accelerationist.soul.json', () => ({ default: { label: 'Accelerationist' } }));
vi.mock('@lib/debate/soul-docs/safetyist.soul.json',       () => ({ default: { label: 'Safetyist' } }));
vi.mock('@lib/debate/soul-docs/skeptic.soul.json',         () => ({ default: { label: 'Skeptic' } }));

function makeStore(overrides: Partial<CommitmentStore> = {}): CommitmentStore {
  return { asserted: [], conceded: [], challenged: [], ...overrides };
}

const NO_NODES: ArgumentNetworkNode[] = [];
const NO_EDGES: ArgumentNetworkEdge[] = [];

describe('CommitmentsPanel — empty commitments', () => {
  it('renders nothing when commitments object is empty', () => {
    const { container } = render(
      <CommitmentsPanel
        commitments={{}}
        nodes={NO_NODES}
        edges={NO_EDGES}
        onGoToNode={vi.fn()}
      />,
    );
    // No speaker rows should appear
    expect(container.querySelectorAll('strong').length).toBe(0);
  });
});

describe('CommitmentsPanel — speaker labels', () => {
  it('renders the speaker label for a known POV', () => {
    render(
      <CommitmentsPanel
        commitments={{ accelerationist: makeStore() }}
        nodes={NO_NODES}
        edges={NO_EDGES}
        onGoToNode={vi.fn()}
      />,
    );
    expect(screen.getByText('Accelerationist')).toBeInTheDocument();
  });

  it('renders the raw speaker id as fallback for an unknown speaker', () => {
    render(
      <CommitmentsPanel
        commitments={{ unknown_agent: makeStore() }}
        nodes={NO_NODES}
        edges={NO_EDGES}
        onGoToNode={vi.fn()}
      />,
    );
    expect(screen.getByText('unknown_agent')).toBeInTheDocument();
  });

  it('renders "System" for the system speaker', () => {
    render(
      <CommitmentsPanel
        commitments={{ system: makeStore() }}
        nodes={NO_NODES}
        edges={NO_EDGES}
        onGoToNode={vi.fn()}
      />,
    );
    expect(screen.getByText('System')).toBeInTheDocument();
  });
});

describe('CommitmentsPanel — category buttons', () => {
  it('renders Asserted, Conceded, and Challenged buttons for each speaker', () => {
    render(
      <CommitmentsPanel
        commitments={{ safetyist: makeStore() }}
        nodes={NO_NODES}
        edges={NO_EDGES}
        onGoToNode={vi.fn()}
      />,
    );
    expect(screen.getByText('Asserted 0')).toBeInTheDocument();
    expect(screen.getByText('Conceded 0')).toBeInTheDocument();
    expect(screen.getByText('Challenged 0')).toBeInTheDocument();
  });

  it('shows the correct count in each category button', () => {
    const store = makeStore({
      asserted:  ['claim A', 'claim B'],
      conceded:  ['claim C'],
      challenged: [],
    });
    render(
      <CommitmentsPanel
        commitments={{ skeptic: store }}
        nodes={NO_NODES}
        edges={NO_EDGES}
        onGoToNode={vi.fn()}
      />,
    );
    expect(screen.getByText('Asserted 2')).toBeInTheDocument();
    expect(screen.getByText('Conceded 1')).toBeInTheDocument();
    expect(screen.getByText('Challenged 0')).toBeInTheDocument();
  });
});

describe('CommitmentsPanel — expand/collapse', () => {
  it('does not show commitment items before a category is clicked', () => {
    const store = makeStore({ asserted: ['AI will improve everything'] });
    render(
      <CommitmentsPanel
        commitments={{ accelerationist: store }}
        nodes={NO_NODES}
        edges={NO_EDGES}
        onGoToNode={vi.fn()}
      />,
    );
    expect(screen.queryByText('AI will improve everything')).not.toBeInTheDocument();
  });

  it('shows commitment items after clicking the category button', async () => {
    const store = makeStore({ asserted: ['AI will improve everything'] });
    render(
      <CommitmentsPanel
        commitments={{ accelerationist: store }}
        nodes={NO_NODES}
        edges={NO_EDGES}
        onGoToNode={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByText('Asserted 1'));
    expect(screen.getByText('AI will improve everything')).toBeInTheDocument();
  });

  it('collapses an open category when its button is clicked again', async () => {
    const store = makeStore({ asserted: ['AI will improve everything'] });
    render(
      <CommitmentsPanel
        commitments={{ accelerationist: store }}
        nodes={NO_NODES}
        edges={NO_EDGES}
        onGoToNode={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByText('Asserted 1'));
    expect(screen.getByText('AI will improve everything')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Asserted 1'));
    expect(screen.queryByText('AI will improve everything')).not.toBeInTheDocument();
  });

  it('does not expand a category with zero items', async () => {
    const store = makeStore({ asserted: [] });
    render(
      <CommitmentsPanel
        commitments={{ accelerationist: store }}
        nodes={NO_NODES}
        edges={NO_EDGES}
        onGoToNode={vi.fn()}
      />,
    );
    // click should have no effect (cursor: 'default' path)
    await userEvent.click(screen.getByText('Asserted 0'));
    // Nothing extra should appear
    expect(screen.queryByText('No items')).not.toBeInTheDocument();
  });
});

describe('CommitmentsPanel — node relationship display', () => {
  it('shows node id badge when commitment text matches an AN node', async () => {
    const claimText = 'AI accelerates scientific discovery';
    const node: ArgumentNetworkNode = {
      id: 'acc-B-001',
      text: claimText,
      speaker: 'accelerationist',
      source_entry_id: 'e-1',
      taxonomy_refs: [],
      turn_number: 1,
    };
    const store = makeStore({ asserted: [claimText] });
    render(
      <CommitmentsPanel
        commitments={{ accelerationist: store }}
        nodes={[node]}
        edges={NO_EDGES}
        onGoToNode={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByText('Asserted 1'));
    expect(screen.getByText('acc-B-001')).toBeInTheDocument();
  });

  it('does not show a node badge when no matching node exists', async () => {
    const store = makeStore({ asserted: ['unmatched claim text'] });
    render(
      <CommitmentsPanel
        commitments={{ accelerationist: store }}
        nodes={NO_NODES}
        edges={NO_EDGES}
        onGoToNode={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByText('Asserted 1'));
    // The commitment text renders but no node id badge
    expect(screen.getByText('unmatched claim text')).toBeInTheDocument();
    expect(screen.queryByText(/acc-/)).not.toBeInTheDocument();
  });
});

describe('CommitmentsPanel — context menu and onGoToNode', () => {
  beforeEach(() => {
    // jsdom does not implement navigator.clipboard
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('opens context menu on right-click of a commitment item', async () => {
    const claimText = 'Safety constraints must be verifiable';
    const store = makeStore({ asserted: [claimText] });
    render(
      <CommitmentsPanel
        commitments={{ safetyist: store }}
        nodes={NO_NODES}
        edges={NO_EDGES}
        onGoToNode={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByText('Asserted 1'));
    const item = screen.getByText(claimText);
    // fire contextmenu event
    await userEvent.pointer({ target: item, keys: '[MouseRight]' });
    expect(screen.getByText('Copy')).toBeInTheDocument();
  });

  it('calls onGoToNode when "Go to" menu item is clicked', async () => {
    const claimText = 'AI alignment is tractable';
    const node: ArgumentNetworkNode = {
      id: 'saf-B-005',
      text: claimText,
      speaker: 'safetyist',
      source_entry_id: 'e-2',
      taxonomy_refs: [],
      turn_number: 2,
    };
    const onGoToNode = vi.fn();
    const store = makeStore({ asserted: [claimText] });
    render(
      <CommitmentsPanel
        commitments={{ safetyist: store }}
        nodes={[node]}
        edges={NO_EDGES}
        onGoToNode={onGoToNode}
      />,
    );
    await userEvent.click(screen.getByText('Asserted 1'));
    const item = screen.getByText(claimText);
    await userEvent.pointer({ target: item, keys: '[MouseRight]' });
    const goToBtn = screen.getByText('Go to saf-B-005');
    await userEvent.click(goToBtn);
    expect(onGoToNode).toHaveBeenCalledWith('saf-B-005');
  });
});
