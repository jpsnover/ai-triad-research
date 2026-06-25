// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WhatIfSection } from './WhatIfSection';
import type { ArgumentNetworkNode, ArgumentNetworkEdge } from '../../../types/debate';

// ── Mock @bridge (used transitively by helpers.tsx) ──────────────────────────
vi.mock('@bridge', () => ({
  api: { clipboardWriteText: vi.fn() },
}));

// ── Mock useFeatureFlags ─────────────────────────────────────────────────────
let mockQbafEnabled = true;

vi.mock('../../../hooks/useFeatureFlags', () => ({
  useFlag: () => mockQbafEnabled,
}));

// ── Mock @lib/debate/qbaf ────────────────────────────────────────────────────
const mockComputeQbafStrengths = vi.fn();

vi.mock('@lib/debate/qbaf', () => ({
  computeQbafStrengths: (...args: unknown[]) => mockComputeQbafStrengths(...args),
}));

// ── Mock helpers (CollapsibleSection + speakerLabel) ─────────────────────────
vi.mock('./helpers', () => ({
  CollapsibleSection: ({
    title,
    children,
    defaultOpen,
  }: {
    title: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
  }) => (
    <div data-testid="collapsible" data-open={String(defaultOpen ?? false)}>
      <div data-testid="collapsible-title">{title}</div>
      <div>{children}</div>
    </div>
  ),
  speakerLabel: (speaker: string) => {
    const map: Record<string, string> = {
      accelerationist: 'Accelerationist',
      safetyist: 'Safetyist',
      skeptic: 'Skeptic',
      system: 'System',
      moderator: 'Moderator',
      user: 'You',
    };
    return map[speaker] ?? speaker;
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeNode(
  id: string,
  speaker: ArgumentNetworkNode['speaker'] = 'accelerationist',
  base_strength = 0.7,
  computed_strength = 0.65,
): ArgumentNetworkNode {
  return {
    id,
    text: `Claim text for ${id}`,
    speaker,
    source_entry_id: `entry-${id}`,
    taxonomy_refs: [],
    turn_number: 1,
    base_strength,
    computed_strength,
  };
}

const NO_EDGES: ArgumentNetworkEdge[] = [];

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WhatIfSection — hidden states', () => {
  beforeEach(() => {
    mockQbafEnabled = true;
    mockComputeQbafStrengths.mockReset();
  });

  it('renders nothing when qbafEnabled is false', () => {
    mockQbafEnabled = false;
    const { container } = render(
      <WhatIfSection nodes={[makeNode('acc-B-001')]} edges={NO_EDGES} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when no nodes have base_strength', () => {
    const nodeWithoutStrength: ArgumentNetworkNode = {
      id: 'acc-B-002',
      text: 'No strength claim',
      speaker: 'accelerationist',
      source_entry_id: 'e-1',
      taxonomy_refs: [],
      turn_number: 1,
      // base_strength intentionally absent
    };
    const { container } = render(
      <WhatIfSection nodes={[nodeWithoutStrength]} edges={NO_EDGES} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('WhatIfSection — initial render (qbaf enabled, nodes present)', () => {
  beforeEach(() => {
    mockQbafEnabled = true;
    mockComputeQbafStrengths.mockReset();
  });

  it('renders the CollapsibleSection with correct title (inactive)', () => {
    render(<WhatIfSection nodes={[makeNode('acc-B-001')]} edges={NO_EDGES} />);
    expect(screen.getByTestId('collapsible-title')).toHaveTextContent(
      'What-If Mode — counterfactual strength propagation',
    );
    expect(screen.getByTestId('collapsible-title').textContent).not.toContain('(active)');
  });

  it('renders the "Enable What-If" button', () => {
    render(<WhatIfSection nodes={[makeNode('acc-B-001')]} edges={NO_EDGES} />);
    expect(screen.getByText('Enable What-If')).toBeInTheDocument();
  });

  it('does not render node list before activating', () => {
    render(<WhatIfSection nodes={[makeNode('acc-B-001')]} edges={NO_EDGES} />);
    expect(screen.queryByText('Claim text for acc-B-001')).not.toBeInTheDocument();
  });
});

describe('WhatIfSection — activating What-If mode', () => {
  beforeEach(() => {
    mockQbafEnabled = true;
    mockComputeQbafStrengths.mockReturnValue({ strengths: new Map() });
  });

  it('shows "Disable What-If" button after activation', async () => {
    render(<WhatIfSection nodes={[makeNode('acc-B-001')]} edges={NO_EDGES} />);
    await userEvent.click(screen.getByText('Enable What-If'));
    expect(screen.getByText('Disable What-If')).toBeInTheDocument();
    expect(screen.queryByText('Enable What-If')).not.toBeInTheDocument();
  });

  it('renders node entries after activation', async () => {
    render(<WhatIfSection nodes={[makeNode('acc-B-001')]} edges={NO_EDGES} />);
    await userEvent.click(screen.getByText('Enable What-If'));
    expect(screen.getByText('Claim text for acc-B-001')).toBeInTheDocument();
  });

  it('renders multiple nodes after activation', async () => {
    const nodes = [makeNode('acc-B-001'), makeNode('saf-B-002', 'safetyist')];
    render(<WhatIfSection nodes={nodes} edges={NO_EDGES} />);
    await userEvent.click(screen.getByText('Enable What-If'));
    expect(screen.getByText('Claim text for acc-B-001')).toBeInTheDocument();
    expect(screen.getByText('Claim text for saf-B-002')).toBeInTheDocument();
  });

  it('renders speaker label for each node', async () => {
    render(<WhatIfSection nodes={[makeNode('acc-B-001', 'accelerationist')]} edges={NO_EDGES} />);
    await userEvent.click(screen.getByText('Enable What-If'));
    expect(screen.getByText('(Accelerationist)')).toBeInTheDocument();
  });

  it('renders a range slider for each node', async () => {
    render(<WhatIfSection nodes={[makeNode('acc-B-001')]} edges={NO_EDGES} />);
    await userEvent.click(screen.getByText('Enable What-If'));
    const sliders = screen.getAllByRole('slider');
    expect(sliders).toHaveLength(1);
  });

  it('shows the current base_strength value on the slider display', async () => {
    render(<WhatIfSection nodes={[makeNode('acc-B-001', 'accelerationist', 0.7)]} edges={NO_EDGES} />);
    await userEvent.click(screen.getByText('Enable What-If'));
    expect(screen.getByText('0.70')).toBeInTheDocument();
  });
});

describe('WhatIfSection — overrides and counterfactual computation', () => {
  beforeEach(() => {
    mockQbafEnabled = true;
  });

  it('shows Reset button when an override exists', async () => {
    // computeQbafStrengths returns a result so whatIfStrengths is non-null
    mockComputeQbafStrengths.mockReturnValue({
      strengths: new Map([['acc-B-001', 0.55]]),
    });

    render(<WhatIfSection nodes={[makeNode('acc-B-001', 'accelerationist', 0.7)]} edges={NO_EDGES} />);
    await userEvent.click(screen.getByText('Enable What-If'));

    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '0.5' } });

    expect(screen.queryByText('Reset')).toBeInTheDocument();
  });

  it('calls computeQbafStrengths when an override is applied', async () => {
    mockComputeQbafStrengths.mockReturnValue({
      strengths: new Map([['acc-B-001', 0.60]]),
    });

    render(<WhatIfSection nodes={[makeNode('acc-B-001', 'accelerationist', 0.7)]} edges={NO_EDGES} />);
    await userEvent.click(screen.getByText('Enable What-If'));

    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '0.5' } });

    expect(mockComputeQbafStrengths).toHaveBeenCalled();
  });

  it('hides node list and resets overrides when What-If is disabled', async () => {
    mockComputeQbafStrengths.mockReturnValue({ strengths: new Map() });

    render(<WhatIfSection nodes={[makeNode('acc-B-001')]} edges={NO_EDGES} />);
    await userEvent.click(screen.getByText('Enable What-If'));
    expect(screen.getByText('Claim text for acc-B-001')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Disable What-If'));
    expect(screen.queryByText('Claim text for acc-B-001')).not.toBeInTheDocument();
    expect(screen.getByText('Enable What-If')).toBeInTheDocument();
  });
});

describe('WhatIfSection — title reflects active state', () => {
  beforeEach(() => {
    mockQbafEnabled = true;
    mockComputeQbafStrengths.mockReturnValue({ strengths: new Map() });
  });

  it('includes "(active)" in the title when What-If is enabled', async () => {
    render(<WhatIfSection nodes={[makeNode('acc-B-001')]} edges={NO_EDGES} />);
    await userEvent.click(screen.getByText('Enable What-If'));
    expect(screen.getByTestId('collapsible-title').textContent).toContain('(active)');
  });
});
