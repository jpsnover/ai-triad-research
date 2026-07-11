// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ConflictFile } from '../../types/taxonomy';

// Mocked store: apply the component's selector to a fake state we control per-test.
const h = vi.hoisted(() => ({
  conflicts: [] as ConflictFile[],
  navigate: vi.fn(),
}));
vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: (sel: (s: unknown) => unknown) =>
    sel({ conflicts: h.conflicts, navigateToConflict: h.navigate }),
}));

import { ConflictsPanel, conflictsForNode, linkedNodeIds } from './ConflictsPanel';

/** Build a ConflictFile; `linked` accepts both the array and legacy single-string shape. */
function mkConflict(claim_id: string, linked: string | string[], over: Partial<ConflictFile> = {}): ConflictFile {
  return {
    claim_id,
    claim_label: `Label ${claim_id}`,
    description: `Description for ${claim_id}`,
    status: 'open',
    linked_taxonomy_nodes: linked as unknown as string[],
    instances: [],
    human_notes: [],
    ...over,
  };
}

afterEach(() => { h.conflicts = []; h.navigate = vi.fn(); vi.clearAllMocks(); });

describe('linkedNodeIds', () => {
  it('returns the array shape as-is', () => {
    expect(linkedNodeIds(mkConflict('c1', ['acc-belief-001', 'saf-desire-002']))).toEqual(['acc-belief-001', 'saf-desire-002']);
  });
  it('wraps the legacy single-string shape into an array', () => {
    expect(linkedNodeIds(mkConflict('c2', 'acc-belief-001'))).toEqual(['acc-belief-001']);
  });
  it('returns [] for empty / missing links', () => {
    expect(linkedNodeIds(mkConflict('c3', []))).toEqual([]);
    expect(linkedNodeIds(mkConflict('c4', '' as unknown as string))).toEqual([]);
  });
});

describe('conflictsForNode', () => {
  const conflicts = [
    mkConflict('c-arr', ['acc-belief-001', 'saf-desire-002']),
    mkConflict('c-legacy', 'acc-belief-001'),      // legacy single-string
    mkConflict('c-other', ['skp-intention-003']),
    mkConflict('c-empty', []),
  ];

  it('matches both array and legacy shapes referencing the node', () => {
    const ids = conflictsForNode(conflicts, 'acc-belief-001').map((c) => c.claim_id);
    expect(ids).toEqual(['c-arr', 'c-legacy']);
  });
  it('matches a node only present in a multi-node array', () => {
    expect(conflictsForNode(conflicts, 'saf-desire-002').map((c) => c.claim_id)).toEqual(['c-arr']);
  });
  it('returns [] when no conflict references the node', () => {
    expect(conflictsForNode(conflicts, 'nonexistent-999')).toEqual([]);
  });
});

describe('ConflictsPanel', () => {
  beforeEach(() => { h.conflicts = []; h.navigate = vi.fn(); });

  it('renders the empty state when no conflict references the node', () => {
    h.conflicts = [mkConflict('c-other', ['skp-intention-003'])];
    render(<ConflictsPanel nodeId="acc-belief-001" />);
    expect(screen.getByText('No conflicts reference this node.')).toBeInTheDocument();
  });

  it('lists label + description for each referencing conflict (both shapes)', () => {
    h.conflicts = [
      mkConflict('c-arr', ['acc-belief-001'], { claim_label: 'Timelines disagreement' }),
      mkConflict('c-legacy', 'acc-belief-001', { claim_label: 'Risk framing clash', description: 'They differ on catastrophic risk.' }),
      mkConflict('c-other', ['skp-intention-003']),
    ];
    render(<ConflictsPanel nodeId="acc-belief-001" />);
    expect(screen.getByText('2 conflicts reference this node')).toBeInTheDocument();
    expect(screen.getByText('Timelines disagreement')).toBeInTheDocument();
    expect(screen.getByText('Risk framing clash')).toBeInTheDocument();
    expect(screen.getByText('They differ on catastrophic risk.')).toBeInTheDocument();
    expect(screen.queryByText('Label c-other')).toBeNull();
  });

  it('navigates to the clicked conflict by claim_id and notifies the parent', () => {
    const onSelect = vi.fn();
    h.conflicts = [mkConflict('c-arr', ['acc-belief-001'], { claim_label: 'Timelines disagreement' })];
    render(<ConflictsPanel nodeId="acc-belief-001" onSelectConflict={onSelect} />);
    fireEvent.click(screen.getByTitle('Go to conflict: Timelines disagreement'));
    expect(h.navigate).toHaveBeenCalledWith('c-arr');
    expect(onSelect).toHaveBeenCalledWith('c-arr');
  });
});
