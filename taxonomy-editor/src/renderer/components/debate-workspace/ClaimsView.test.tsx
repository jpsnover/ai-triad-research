// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClaimsView, ClaimNodeRow } from './ClaimsView';
import type { ArgumentNetworkNode, ArgumentNetworkEdge } from '../../types/debate';

// ── Mocks ────────────────────────────────────────────────────

vi.mock('@lib/debate/qbaf', () => ({
  computeQbafStrengths: vi.fn(() => ({ strengths: new Map<string, number>() })),
}));

vi.mock('./utils', () => ({
  speakerLabel: (s: string) => {
    const labels: Record<string, string> = {
      accelerationist: 'Accelerationist',
      safetyist: 'Safetyist',
      skeptic: 'Skeptic',
      system: 'System',
      moderator: 'Moderator',
      user: 'You',
      document: 'Document',
    };
    return labels[s] ?? s;
  },
  STRENGTH_BAND: (v: number) => {
    if (v >= 0.8) return { label: 'Strong', color: '#22c55e' };
    if (v >= 0.5) return { label: 'Moderate', color: '#3b82f6' };
    if (v >= 0.3) return { label: 'Weak', color: '#f59e0b' };
    return { label: 'Very Weak', color: '#ef4444' };
  },
}));

// ── Helpers ──────────────────────────────────────────────────

function makeNode(overrides: Partial<ArgumentNetworkNode> = {}): ArgumentNetworkNode {
  return {
    id: 'an-001',
    speaker: 'accelerationist',
    text: 'AI will bring enormous benefits.',
    base_strength: 0.6,
    bdi_category: 'belief',
    source_entry_id: 'entry-1',
    ...overrides,
  };
}

function makeEdge(overrides: Partial<ArgumentNetworkEdge> = {}): ArgumentNetworkEdge {
  return {
    source: 'an-001',
    target: 'an-002',
    type: 'attacks',
    weight: 0.5,
    ...overrides,
  };
}

// ── ClaimsView ───────────────────────────────────────────────

describe('ClaimsView', () => {
  it('renders "No argument network yet" when argument_network is undefined', () => {
    const debate = { transcript: [] };
    render(<ClaimsView debate={debate} />);
    expect(screen.getByText('No argument network yet')).toBeInTheDocument();
  });

  it('renders "No argument network yet" when argument_network has no nodes', () => {
    const debate = { argument_network: { nodes: [], edges: [] }, transcript: [] };
    render(<ClaimsView debate={debate} />);
    expect(screen.getByText('No argument network yet')).toBeInTheDocument();
  });

  it('renders "No claims extracted" when entry has no matching nodes', () => {
    const node = makeNode({ source_entry_id: 'entry-other' });
    const debate = {
      argument_network: { nodes: [node], edges: [] },
      transcript: [],
    };
    render(<ClaimsView entryId="entry-1" debate={debate} />);
    expect(screen.getByText('No claims extracted for this statement')).toBeInTheDocument();
  });

  it('renders claim count summary with 1 attack and 0 supports', () => {
    const node1 = makeNode({ id: 'an-001', source_entry_id: 'entry-1' });
    const node2 = makeNode({ id: 'an-002', source_entry_id: 'entry-2' });
    const edge = makeEdge({ source: 'an-002', target: 'an-001', type: 'attacks' });
    const debate = {
      argument_network: { nodes: [node1, node2], edges: [edge] },
      transcript: [],
    };
    render(<ClaimsView entryId="entry-1" debate={debate} />);
    expect(screen.getByText(/1 claim/)).toBeInTheDocument();
    expect(screen.getByText(/1 attack/)).toBeInTheDocument();
    expect(screen.getByText(/0 supports/)).toBeInTheDocument();
  });

  it('renders claim count summary with 3 claims, 1 attack, 2 supports', () => {
    const n1 = makeNode({ id: 'an-001', source_entry_id: 'entry-1' });
    const n2 = makeNode({ id: 'an-002', source_entry_id: 'entry-1' });
    const n3 = makeNode({ id: 'an-003', source_entry_id: 'entry-1' });
    const n4 = makeNode({ id: 'an-004', source_entry_id: 'entry-2' });
    const edges: ArgumentNetworkEdge[] = [
      makeEdge({ source: 'an-004', target: 'an-001', type: 'attacks' }),
      makeEdge({ source: 'an-004', target: 'an-002', type: 'supports' }),
      makeEdge({ source: 'an-004', target: 'an-003', type: 'supports' }),
    ];
    const debate = {
      argument_network: { nodes: [n1, n2, n3, n4], edges },
      transcript: [],
    };
    render(<ClaimsView entryId="entry-1" debate={debate} />);
    expect(screen.getByText(/3 claims/)).toBeInTheDocument();
    expect(screen.getByText(/1 attack/)).toBeInTheDocument();
    expect(screen.getByText(/2 supports/)).toBeInTheDocument();
  });

  it('renders all nodes when no entryId is provided', () => {
    const n1 = makeNode({ id: 'an-001', source_entry_id: 'entry-1' });
    const n2 = makeNode({ id: 'an-002', source_entry_id: 'entry-2' });
    const debate = {
      argument_network: { nodes: [n1, n2], edges: [] },
      transcript: [],
    };
    render(<ClaimsView debate={debate} />);
    expect(screen.getByText(/2 claims/)).toBeInTheDocument();
  });

  it('renders political salience histogram when nodes have salience', () => {
    const n1 = makeNode({ id: 'an-001', source_entry_id: 'entry-1', political_salience: 'high' });
    const n2 = makeNode({ id: 'an-002', source_entry_id: 'entry-1', political_salience: 'medium' });
    const debate = {
      argument_network: { nodes: [n1, n2], edges: [] },
      transcript: [],
    };
    render(<ClaimsView entryId="entry-1" debate={debate} />);
    expect(screen.getByText(/Salience/)).toBeInTheDocument();
  });
});

// ── ClaimNodeRow ─────────────────────────────────────────────

describe('ClaimNodeRow', () => {
  const baseNode = makeNode({
    id: 'an-001',
    text: 'AI will transform society.',
    base_strength: 0.6,
  });

  it('renders the node id', () => {
    render(
      <ClaimNodeRow
        node={baseNode}
        attacks={[]}
        supports={[]}
        allNodes={[baseNode]}
        strengthMap={new Map()}
      />,
    );
    expect(screen.getByText('an-001')).toBeInTheDocument();
  });

  it('renders the claim text', () => {
    render(
      <ClaimNodeRow
        node={baseNode}
        attacks={[]}
        supports={[]}
        allNodes={[baseNode]}
        strengthMap={new Map()}
      />,
    );
    expect(screen.getByText('AI will transform society.')).toBeInTheDocument();
  });

  it('does not show expand button when there are no edges', () => {
    render(
      <ClaimNodeRow
        node={baseNode}
        attacks={[]}
        supports={[]}
        allNodes={[baseNode]}
        strengthMap={new Map()}
      />,
    );
    // No ▶ or ▼ button should be present
    expect(screen.queryByText('▶')).not.toBeInTheDocument();
    expect(screen.queryByText('▼')).not.toBeInTheDocument();
  });

  it('shows expand button (▶) when there are attack edges', () => {
    const attackEdge = makeEdge({ source: 'an-002', target: 'an-001', type: 'attacks' });
    render(
      <ClaimNodeRow
        node={baseNode}
        attacks={[attackEdge]}
        supports={[]}
        allNodes={[baseNode]}
        strengthMap={new Map()}
      />,
    );
    expect(screen.getByText('▶')).toBeInTheDocument();
  });

  it('shows expand button (▶) when there are support edges', () => {
    const supportEdge = makeEdge({ source: 'an-002', target: 'an-001', type: 'supports' });
    render(
      <ClaimNodeRow
        node={baseNode}
        attacks={[]}
        supports={[supportEdge]}
        allNodes={[baseNode]}
        strengthMap={new Map()}
      />,
    );
    expect(screen.getByText('▶')).toBeInTheDocument();
  });

  it('expands to show attack detail on button click', async () => {
    const attackerNode = makeNode({ id: 'an-002', text: 'Counter argument text.', speaker: 'safetyist' });
    const attackEdge = makeEdge({ source: 'an-002', target: 'an-001', type: 'attacks', attack_type: 'rebut' });
    render(
      <ClaimNodeRow
        node={baseNode}
        attacks={[attackEdge]}
        supports={[]}
        allNodes={[baseNode, attackerNode]}
        strengthMap={new Map()}
      />,
    );
    const expandBtn = screen.getByText('▶');
    await userEvent.click(expandBtn);
    // After expanding, button becomes ▼
    expect(screen.getByText('▼')).toBeInTheDocument();
    expect(screen.getByText('an-002')).toBeInTheDocument();
  });

  it('collapses back on second button click', async () => {
    const attackerNode = makeNode({ id: 'an-002', text: 'Counter argument text.' });
    const attackEdge = makeEdge({ source: 'an-002', target: 'an-001', type: 'attacks' });
    render(
      <ClaimNodeRow
        node={baseNode}
        attacks={[attackEdge]}
        supports={[]}
        allNodes={[baseNode, attackerNode]}
        strengthMap={new Map()}
      />,
    );
    const expandBtn = screen.getByText('▶');
    await userEvent.click(expandBtn);
    expect(screen.getByText('▼')).toBeInTheDocument();
    await userEvent.click(screen.getByText('▼'));
    expect(screen.getByText('▶')).toBeInTheDocument();
  });

  it('uses strengthMap value when available', () => {
    const strengthMap = new Map([['an-001', 0.9]]);
    render(
      <ClaimNodeRow
        node={baseNode}
        attacks={[]}
        supports={[]}
        allNodes={[baseNode]}
        strengthMap={strengthMap}
      />,
    );
    // 0.90 should be rendered
    expect(screen.getByText(/0\.90/)).toBeInTheDocument();
  });
});
