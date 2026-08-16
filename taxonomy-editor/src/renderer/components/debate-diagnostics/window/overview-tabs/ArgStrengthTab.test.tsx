// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ArgStrengthTab } from './ArgStrengthTab';

// ---------------------------------------------------------------------------
// Mocks — isolate the tab from qbaf math, INodeRow detail, and POV metadata.
// ---------------------------------------------------------------------------
vi.mock('@lib/debate/qbaf', () => ({ computeQbafStrengths: () => ({ strengths: new Map() }) }));
vi.mock('../shared/INodeRow', () => ({
  INodeRow: (props: { node?: { id?: string } }) => <div data-testid={`inode-${props.node?.id}`} />,
}));
vi.mock('../helpers', () => ({ speakerLabel: (s: string) => s }));
vi.mock('@lib/electron-shared/povMeta', () => ({
  POV_META: {
    accelerationist: { cssVar: '--color-acc' },
    safetyist: { cssVar: '--color-saf' },
    skeptic: { cssVar: '--color-skp' },
  },
}));

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------
function node(id: string, speaker: string, base: number) {
  return { id, speaker, base_strength: base, source_entry_id: 'e1' } as never;
}

function makeProps(nodes: unknown[]) {
  return {
    debate: { transcript: [{ id: 'e1' }] } as never,
    an: { nodes: nodes as never[], edges: [] as never[] },
    handleUpdateSubScore: vi.fn(),
    setOverviewTab: vi.fn(),
    setSelectedEntry: vi.fn(),
    setLocalOverride: vi.fn(),
    nodeLabels: new Map<string, string>(),
  };
}

// accelerationist has 7 args (to exercise Top 5); saf/skp have 2 each.
const NODES = [
  ...Array.from({ length: 7 }, (_, i) => node(`a${i}`, 'accelerationist', (i + 1) / 10)),
  node('s0', 'safetyist', 0.4), node('s1', 'safetyist', 0.2),
  node('k0', 'skeptic', 0.5), node('k1', 'skeptic', 0.3),
];

describe('ArgStrengthTab — t/2686 POV sections, collapse, Top 5', () => {
  it('renders a section for every POV present (not just Accelerationist)', () => {
    render(<ArgStrengthTab {...makeProps(NODES)} />);
    // One collapse toggle per POV section.
    expect(screen.getByRole('button', { name: /accelerationist/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /safetyist/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /skeptic/i })).toBeTruthy();
    // All 7 accelerationist rows render by default (expanded, no Top-5 filter).
    expect(screen.getAllByTestId(/^inode-a/)).toHaveLength(7);
  });

  it('collapsing a POV section hides its argument rows', () => {
    render(<ArgStrengthTab {...makeProps(NODES)} />);
    const toggle = screen.getByRole('button', { name: /accelerationist/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryAllByTestId(/^inode-a/)).toHaveLength(0);
    // Other sections stay expanded.
    expect(screen.getAllByTestId(/^inode-s/)).toHaveLength(2);
  });

  it('Top 5 filters a POV to its 5 strongest, and toggles back', () => {
    render(<ArgStrengthTab {...makeProps(NODES)} />);
    // Only accelerationist has >5 args, so exactly one Top 5 button exists.
    const top5 = screen.getByRole('button', { name: 'Top 5' });
    fireEvent.click(top5);
    expect(top5.getAttribute('aria-pressed')).toBe('true');
    const shown = screen.getAllByTestId(/^inode-a/);
    expect(shown).toHaveLength(5);
    // The 5 strongest are a6..a2 (base 0.7..0.3); a1/a0 are dropped.
    const ids = shown.map(el => el.getAttribute('data-testid'));
    expect(ids).toContain('inode-a6');
    expect(ids).not.toContain('inode-a0');
    fireEvent.click(top5);
    expect(screen.getAllByTestId(/^inode-a/)).toHaveLength(7);
  });

  it('Collapse All hides every section; Expand All restores them', () => {
    render(<ArgStrengthTab {...makeProps(NODES)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse All' }));
    expect(screen.queryAllByTestId(/^inode-/)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Expand All' }));
    expect(screen.getAllByTestId(/^inode-/).length).toBeGreaterThan(0);
  });

  it('shows the empty state when there is no argument network', () => {
    render(<ArgStrengthTab {...makeProps([])} />);
    expect(screen.getByText(/No argument network data/i)).toBeTruthy();
  });
});
