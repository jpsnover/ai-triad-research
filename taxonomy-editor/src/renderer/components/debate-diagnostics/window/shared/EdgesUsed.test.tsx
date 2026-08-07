// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { edgeNodeColor, EdgesUsedDetail, EdgesUsedGrouped } from './EdgesUsed';
import { truncateLabel } from './constants';
import type { TaxRefEdge } from '../../../taxonomy/TaxonomyRefDetail';

// --- edgeNodeColor ---

describe('edgeNodeColor', () => {
  it('returns acc color for acc- prefix', () => {
    expect(edgeNodeColor('acc-B-001')).toBe('var(--color-acc)');
  });

  it('returns saf color for saf- prefix', () => {
    expect(edgeNodeColor('saf-D-010')).toBe('var(--color-saf)');
  });

  it('returns skp color for skp- prefix', () => {
    expect(edgeNodeColor('skp-I-003')).toBe('var(--color-skp)');
  });

  it('returns sit color for sit- prefix', () => {
    expect(edgeNodeColor('sit-042')).toBe('var(--color-sit)');
  });

  it('returns muted color for unknown prefix', () => {
    expect(edgeNodeColor('pol-A-001')).toBe('var(--text-muted)');
  });

  it('returns muted color for empty string', () => {
    expect(edgeNodeColor('')).toBe('var(--text-muted)');
  });

  it('matches only prefix, not substring', () => {
    expect(edgeNodeColor('xacc-B-001')).toBe('var(--text-muted)');
  });
});

// --- truncateLabel ---

describe('truncateLabel', () => {
  it('returns short strings unchanged', () => {
    expect(truncateLabel('hello', 10)).toBe('hello');
  });

  it('returns string at exact max length unchanged', () => {
    expect(truncateLabel('12345', 5)).toBe('12345');
  });

  it('truncates and adds ellipsis for strings exceeding max', () => {
    const result = truncateLabel('abcdefghij', 5);
    expect(result).toBe('abcde…');
    expect(result.length).toBe(6);
  });

  it('handles empty string', () => {
    expect(truncateLabel('', 5)).toBe('');
  });

  it('handles max of 0', () => {
    expect(truncateLabel('abc', 0)).toBe('…');
  });
});

// --- EdgesUsedDetail ---

function makeEdge(overrides: Partial<TaxRefEdge> = {}): TaxRefEdge {
  return {
    source: 'acc-B-001',
    target: 'saf-B-002',
    type: 'supports',
    confidence: 0.85,
    bidirectional: false,
    rationale: '',
    status: '',
    weight: undefined,
    strength: undefined,
    notes: undefined,
    ...overrides,
  };
}

describe('EdgesUsedDetail', () => {
  const emptyMap = new Map<string, Record<string, unknown>>();
  const emptyLabels = new Map<string, string>();

  it('renders edge type name', () => {
    render(<EdgesUsedDetail edge={makeEdge({ type: 'contradicts' })} taxNodeMap={emptyMap} nodeLabels={emptyLabels} />);
    expect(screen.getByText('contradicts')).toBeInTheDocument();
  });

  it('replaces underscores with spaces in edge type', () => {
    render(<EdgesUsedDetail edge={makeEdge({ type: 'mutual_support' })} taxNodeMap={emptyMap} nodeLabels={emptyLabels} />);
    expect(screen.getByText('mutual support')).toBeInTheDocument();
  });

  it('renders source and target IDs', () => {
    render(<EdgesUsedDetail edge={makeEdge()} taxNodeMap={emptyMap} nodeLabels={emptyLabels} />);
    // IDs appear as both label and endpoint-id when no nodeLabels provided
    expect(screen.getAllByText('acc-B-001').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('saf-B-002').length).toBeGreaterThanOrEqual(1);
  });

  it('renders node labels when available', () => {
    const labels = new Map([
      ['acc-B-001', 'AI acceleration is beneficial'],
      ['saf-B-002', 'Safety requires caution'],
    ]);
    render(<EdgesUsedDetail edge={makeEdge()} taxNodeMap={emptyMap} nodeLabels={labels} />);
    expect(screen.getByText('AI acceleration is beneficial')).toBeInTheDocument();
    expect(screen.getByText('Safety requires caution')).toBeInTheDocument();
  });

  it('renders SOURCE and TARGET role labels', () => {
    render(<EdgesUsedDetail edge={makeEdge()} taxNodeMap={emptyMap} nodeLabels={emptyLabels} />);
    expect(screen.getByText('SOURCE')).toBeInTheDocument();
    expect(screen.getByText('TARGET')).toBeInTheDocument();
  });

  it('renders confidence as percentage', () => {
    render(<EdgesUsedDetail edge={makeEdge({ confidence: 0.72 })} taxNodeMap={emptyMap} nodeLabels={emptyLabels} />);
    expect(screen.getByText('Confidence: 72%')).toBeInTheDocument();
  });

  it('renders strength when present', () => {
    render(<EdgesUsedDetail edge={makeEdge({ strength: 'substantial' })} taxNodeMap={emptyMap} nodeLabels={emptyLabels} />);
    expect(screen.getByText('Strength: substantial')).toBeInTheDocument();
  });

  it('does not render strength when absent', () => {
    render(<EdgesUsedDetail edge={makeEdge()} taxNodeMap={emptyMap} nodeLabels={emptyLabels} />);
    expect(screen.queryByText(/Strength:/)).not.toBeInTheDocument();
  });

  it('renders rationale when present', () => {
    render(<EdgesUsedDetail edge={makeEdge({ rationale: 'Both address regulatory scope' })} taxNodeMap={emptyMap} nodeLabels={emptyLabels} />);
    expect(screen.getByText('RATIONALE')).toBeInTheDocument();
    expect(screen.getByText('Both address regulatory scope')).toBeInTheDocument();
  });

  it('does not render rationale section when empty', () => {
    render(<EdgesUsedDetail edge={makeEdge({ rationale: '' })} taxNodeMap={emptyMap} nodeLabels={emptyLabels} />);
    expect(screen.queryByText('RATIONALE')).not.toBeInTheDocument();
  });

  it('renders approved status with checkmark', () => {
    render(<EdgesUsedDetail edge={makeEdge({ status: 'approved' })} taxNodeMap={emptyMap} nodeLabels={emptyLabels} />);
    expect(screen.getByText(/Approved/)).toBeInTheDocument();
  });

  it('renders rejected status', () => {
    render(<EdgesUsedDetail edge={makeEdge({ status: 'rejected' })} taxNodeMap={emptyMap} nodeLabels={emptyLabels} />);
    expect(screen.getByText(/rejected/)).toBeInTheDocument();
  });

  it('renders notes when present', () => {
    render(<EdgesUsedDetail edge={makeEdge({ notes: 'Needs review' })} taxNodeMap={emptyMap} nodeLabels={emptyLabels} />);
    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByText('Needs review')).toBeInTheDocument();
  });

  it('renders node descriptions when taxNodeMap has entries', () => {
    const taxNodeMap = new Map<string, Record<string, unknown>>([
      ['acc-B-001', { description: 'Accelerationist belief about progress' }],
    ]);
    render(<EdgesUsedDetail edge={makeEdge()} taxNodeMap={taxNodeMap} nodeLabels={emptyLabels} />);
    expect(screen.getByText('Source Description')).toBeInTheDocument();
    expect(screen.getByText('Accelerationist belief about progress')).toBeInTheDocument();
  });

  it('shows bidirectional arrow when bidirectional is true', () => {
    render(<EdgesUsedDetail edge={makeEdge({ bidirectional: true })} taxNodeMap={emptyMap} nodeLabels={emptyLabels} />);
    expect(screen.getByTitle('Bidirectional')).toBeInTheDocument();
  });
});

// --- EdgesUsedGrouped ---

describe('EdgesUsedGrouped', () => {
  const emptyTaxMap = new Map<string, Record<string, unknown>>();
  const nodeLabels = new Map([
    ['acc-B-001', 'AI benefits'],
    ['saf-B-002', 'Safety first'],
    ['skp-B-003', 'Skeptic view'],
  ]);

  const edges = [
    { source: 'acc-B-001', target: 'saf-B-002', type: 'supports', confidence: 0.9 },
    { source: 'acc-B-001', target: 'skp-B-003', type: 'supports', confidence: 0.7 },
    { source: 'saf-B-002', target: 'acc-B-001', type: 'contradicts', confidence: 0.6 },
  ];

  const allEdges: TaxRefEdge[] = edges.map(e => ({
    ...e,
    bidirectional: false,
    rationale: '',
    status: '',
    weight: undefined,
    strength: undefined,
    notes: undefined,
  }));

  it('renders placeholder text when no edge is selected', () => {
    render(<EdgesUsedGrouped edges={edges} allEdges={allEdges} taxNodeMap={emptyTaxMap} nodeLabels={nodeLabels} />);
    expect(screen.getByText('Select an edge to view details')).toBeInTheDocument();
  });

  it('groups edges by type', () => {
    render(<EdgesUsedGrouped edges={edges} allEdges={allEdges} taxNodeMap={emptyTaxMap} nodeLabels={nodeLabels} />);
    // "supports" appears as group header and within edge cards
    expect(screen.getAllByText('supports').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('contradicts').length).toBeGreaterThanOrEqual(1);
  });

  it('shows edge count per group', () => {
    render(<EdgesUsedGrouped edges={edges} allEdges={allEdges} taxNodeMap={emptyTaxMap} nodeLabels={nodeLabels} />);
    expect(screen.getByText('2')).toBeInTheDocument(); // supports group count
    expect(screen.getByText('1')).toBeInTheDocument(); // contradicts group count
  });

  it('renders node labels for edges', () => {
    render(<EdgesUsedGrouped edges={edges} allEdges={allEdges} taxNodeMap={emptyTaxMap} nodeLabels={nodeLabels} />);
    expect(screen.getAllByText('AI benefits').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Safety first').length).toBeGreaterThan(0);
  });

  it('shows confidence as percentage badge', () => {
    render(<EdgesUsedGrouped edges={edges} allEdges={allEdges} taxNodeMap={emptyTaxMap} nodeLabels={nodeLabels} />);
    expect(screen.getByText('c90')).toBeInTheDocument();
    expect(screen.getByText('c70')).toBeInTheDocument();
    expect(screen.getByText('c60')).toBeInTheDocument();
  });

  it('shows edge detail when an edge card is clicked', async () => {
    const user = userEvent.setup();
    render(<EdgesUsedGrouped edges={edges} allEdges={allEdges} taxNodeMap={emptyTaxMap} nodeLabels={nodeLabels} />);
    const edgeCards = screen.getAllByText('c90');
    await user.click(edgeCards[0].closest('.related-edge-card')!);
    expect(screen.getByText('SOURCE')).toBeInTheDocument();
    expect(screen.getByText('TARGET')).toBeInTheDocument();
  });

  it('handles empty edges array', () => {
    render(<EdgesUsedGrouped edges={[]} allEdges={[]} taxNodeMap={emptyTaxMap} nodeLabels={nodeLabels} />);
    expect(screen.getByText('Select an edge to view details')).toBeInTheDocument();
  });
});
