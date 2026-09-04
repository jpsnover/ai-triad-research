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

function edge(source: string, target: string, type: 'attacks' | 'supports') {
  return { source, target, type } as never;
}

function makeProps(nodes: unknown[], edges: unknown[] = []) {
  return {
    debate: { transcript: [{ id: 'e1' }] } as never,
    an: { nodes: nodes as never[], edges: edges as never[] },
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
    // Default filter is ge1; switch to All to see nodes with no incoming edges.
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByRole('button', { name: /accelerationist/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /safetyist/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /skeptic/i })).toBeTruthy();
    // All 7 accelerationist rows render by default (expanded, no Top-5 filter).
    expect(screen.getAllByTestId(/^inode-a/)).toHaveLength(7);
  });

  it('collapsing a POV section hides its argument rows', () => {
    render(<ArgStrengthTab {...makeProps(NODES)} />);
    // Switch to 'All' so all sections appear.
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
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
    // Switch to 'All' so all sections appear.
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
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
    // Switch to 'All' so orderedPovs is populated before collapse.
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
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

// ---------------------------------------------------------------------------
// t/3301: tested filter + count line + adversarial badge
// ---------------------------------------------------------------------------
describe('ArgStrengthTab — t/3301 tested filter, count line, attack badge', () => {
  // Nodes a0–a2 have incoming edges (tested); a3–a6 do not (untested).
  const EDGES = [
    edge('a4', 'a0', 'supports'),  // a0 in-degree 1
    edge('a5', 'a1', 'attacks'),   // a1 in-degree 1, has attack → adversarial badge
    edge('a6', 'a2', 'supports'),  // a2 in-degree 1
    edge('a4', 'a1', 'supports'),  // a1 in-degree 2 (also passes ge2 filter)
  ];

  it('default filter is In-degree ≥1 — only tested nodes render', () => {
    render(<ArgStrengthTab {...makeProps(NODES, EDGES)} />);
    // a0, a1, a2 are tested; a3–a6 are not.
    expect(screen.getAllByTestId(/^inode-a/)).toHaveLength(3);
    expect(screen.queryByTestId('inode-a3')).toBeNull();
    expect(screen.queryByTestId('inode-a6')).toBeNull();
  });

  it('In-degree ≥1 filter button is active by default', () => {
    render(<ArgStrengthTab {...makeProps(NODES, EDGES)} />);
    const ge1Btn = screen.getByRole('button', { name: 'In-degree ≥1' });
    expect(ge1Btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('switching to All shows all nodes including untested', () => {
    render(<ArgStrengthTab {...makeProps(NODES, EDGES)} />);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getAllByTestId(/^inode-a/)).toHaveLength(7);
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('In-degree ≥2 shows only doubly-tested nodes (a1 only in our fixture)', () => {
    render(<ArgStrengthTab {...makeProps(NODES, EDGES)} />);
    fireEvent.click(screen.getByRole('button', { name: 'In-degree ≥2' }));
    const shown = screen.getAllByTestId(/^inode-a/);
    expect(shown).toHaveLength(1);
    expect(shown[0].getAttribute('data-testid')).toBe('inode-a1');
  });

  it('count line shows shownCount of totalNodes', () => {
    render(<ArgStrengthTab {...makeProps(NODES, EDGES)} />);
    // ge1 default: 3 tested of 11 total
    expect(screen.getByText(/Showing 3 of 11/)).toBeTruthy();
  });

  it('count line shows untested count when untestedCount > 0', () => {
    render(<ArgStrengthTab {...makeProps(NODES, EDGES)} />);
    // 8 nodes have in-degree 0 (a3–a6 + s0 s1 k0 k1 = 8 untested)
    expect(screen.getByText(/8 untested/)).toBeTruthy();
    expect(screen.getByText(/mostly unmeasured/)).toBeTruthy();
  });

  it('adversarial badge appears on node with ≥1 incoming attack edge', () => {
    render(<ArgStrengthTab {...makeProps(NODES, EDGES)} />);
    // a1 has an incoming attack — badge should appear.
    expect(screen.getByTitle('Adversarially tested — has ≥1 incoming attack edge')).toBeTruthy();
  });

  it('adversarial badge does not appear for support-only tested nodes', () => {
    render(<ArgStrengthTab {...makeProps(NODES, EDGES)} />);
    // a0 and a2 are tested by support only — no attack badge.
    const badges = screen.queryAllByTitle('Adversarially tested — has ≥1 incoming attack edge');
    expect(badges).toHaveLength(1); // only a1
  });

  it('empty-filter state renders a Show all button when no nodes pass filter', () => {
    // No edges → all nodes have in-degree 0 → ge1 filter → empty.
    render(<ArgStrengthTab {...makeProps(NODES)} />);
    expect(screen.getByText(/No tested arguments match/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show all' })).toBeTruthy();
  });

  it('Show all button in empty state switches filter to All', () => {
    render(<ArgStrengthTab {...makeProps(NODES)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getAllByTestId(/^inode-a/)).toHaveLength(7);
  });
});
