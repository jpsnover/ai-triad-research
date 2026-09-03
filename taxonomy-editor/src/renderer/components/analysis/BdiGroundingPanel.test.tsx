// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ConceptLinkRef, EntityLinkRef } from '@lib/entities/types';

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => null }));

const setToolbarPanel = vi.fn();

function makeStore(overrides: Record<string, unknown> = {}) {
  return {
    selectedNodeId: null,
    accelerationist: null,
    safetyist: null,
    skeptic: null,
    setToolbarPanel,
    ...overrides,
  };
}

vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: vi.fn(),
}));

import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
const mockStore = useTaxonomyStore as unknown as ReturnType<typeof vi.fn>;

const { BdiGroundingPanel } = await import('./BdiGroundingPanel');

const CONCEPT_LINKED: ConceptLinkRef = {
  ref: 'term:alignment',
  surface: 'alignment',
  method: 'surface',
  link_confidence: 1.0,
  status: 'linked',
};

const CONCEPT_PROPOSED: ConceptLinkRef = {
  ref: 'term:autonomy_human',
  surface: 'autonomy',
  method: 'embedding',
  link_confidence: 0.59,
  status: 'proposed',
};

const ENTITY_LINKED: EntityLinkRef = {
  ref: 'ent-001',
  surface: 'Anthropic',
  method: 'alias',
  link_confidence: 1.0,
  match_level: 'exact',
  status: 'linked',
};

function makeNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acc-beliefs-001',
    label: 'Test Node',
    ...overrides,
  };
}

describe('BdiGroundingPanel (t/3292)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows the no-node-selected empty state when selectedNodeId is null', () => {
    mockStore.mockReturnValue(makeStore());
    render(<BdiGroundingPanel />);
    expect(screen.getByText(/Select a BDI node/)).toBeInTheDocument();
  });

  it('shows the no-node-selected empty state when the node is not found in any POV file', () => {
    mockStore.mockReturnValue(makeStore({
      selectedNodeId: 'acc-beliefs-999',
      accelerationist: { nodes: [] },
    }));
    render(<BdiGroundingPanel />);
    expect(screen.getByText(/Select a BDI node/)).toBeInTheDocument();
  });

  it('renders Concepts and Entities section headers for a node with no refs', () => {
    mockStore.mockReturnValue(makeStore({
      selectedNodeId: 'acc-beliefs-001',
      accelerationist: { nodes: [makeNode()] },
    }));
    render(<BdiGroundingPanel />);
    expect(screen.getByText('Concepts')).toBeInTheDocument();
    expect(screen.getByText('Entities')).toBeInTheDocument();
  });

  it('renders DOLCE badges: "universal · kind" for concepts, "particular" for entities', () => {
    mockStore.mockReturnValue(makeStore({
      selectedNodeId: 'acc-beliefs-001',
      accelerationist: { nodes: [makeNode()] },
    }));
    render(<BdiGroundingPanel />);
    expect(screen.getByText('universal · kind')).toBeInTheDocument();
    expect(screen.getByText('particular')).toBeInTheDocument();
  });

  it('renders concept rows with surface, method, status, and confidence', () => {
    mockStore.mockReturnValue(makeStore({
      selectedNodeId: 'acc-beliefs-001',
      accelerationist: { nodes: [makeNode({ concept_refs: [CONCEPT_LINKED] })] },
    }));
    render(<BdiGroundingPanel />);
    expect(screen.getByText('alignment')).toBeInTheDocument();
    expect(screen.getByText('surface')).toBeInTheDocument();
    expect(screen.getByText('linked')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('applies --proposed class to proposed concept rows', () => {
    mockStore.mockReturnValue(makeStore({
      selectedNodeId: 'acc-beliefs-001',
      accelerationist: { nodes: [makeNode({ concept_refs: [CONCEPT_PROPOSED] })] },
    }));
    render(<BdiGroundingPanel />);
    const row = screen.getByRole('button', { name: /autonomy/ });
    expect(row.className).toContain('bdi-gr-row--proposed');
    expect(screen.getByText('proposed')).toBeInTheDocument();
    expect(screen.getByText('59%')).toBeInTheDocument();
  });

  it('renders entity rows with surface, ref id, method, status, and confidence', () => {
    mockStore.mockReturnValue(makeStore({
      selectedNodeId: 'acc-beliefs-001',
      accelerationist: { nodes: [makeNode({ entity_refs: [ENTITY_LINKED] })] },
    }));
    render(<BdiGroundingPanel />);
    expect(screen.getByText('Anthropic')).toBeInTheDocument();
    expect(screen.getByText('ent-001')).toBeInTheDocument();
    expect(screen.getByText('alias')).toBeInTheDocument();
  });

  it('shows the normal "No entity links" empty state when entity_refs is absent', () => {
    mockStore.mockReturnValue(makeStore({
      selectedNodeId: 'acc-beliefs-001',
      accelerationist: { nodes: [makeNode({ concept_refs: [CONCEPT_LINKED] })] },
    }));
    render(<BdiGroundingPanel />);
    expect(screen.getByText(/No entity links/)).toBeInTheDocument();
  });

  it('shows "No concept links" when concept_refs is absent', () => {
    mockStore.mockReturnValue(makeStore({
      selectedNodeId: 'acc-beliefs-001',
      accelerationist: { nodes: [makeNode()] },
    }));
    render(<BdiGroundingPanel />);
    expect(screen.getByText(/No concept links/)).toBeInTheDocument();
  });

  it('calls setToolbarPanel("vocabulary") when a concept row is clicked', () => {
    mockStore.mockReturnValue(makeStore({
      selectedNodeId: 'acc-beliefs-001',
      accelerationist: { nodes: [makeNode({ concept_refs: [CONCEPT_LINKED] })] },
    }));
    render(<BdiGroundingPanel />);
    fireEvent.click(screen.getByRole('button', { name: /alignment/ }));
    expect(setToolbarPanel).toHaveBeenCalledWith('vocabulary');
  });

  it('calls setToolbarPanel("entities") when an entity row is clicked', () => {
    mockStore.mockReturnValue(makeStore({
      selectedNodeId: 'acc-beliefs-001',
      accelerationist: { nodes: [makeNode({ entity_refs: [ENTITY_LINKED] })] },
    }));
    render(<BdiGroundingPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Anthropic/ }));
    expect(setToolbarPanel).toHaveBeenCalledWith('entities');
  });

  it('searches safetyist and skeptic files when node is not in accelerationist', () => {
    mockStore.mockReturnValue(makeStore({
      selectedNodeId: 'saf-beliefs-001',
      accelerationist: { nodes: [] },
      safetyist: { nodes: [{ id: 'saf-beliefs-001', label: 'Safety node', concept_refs: [CONCEPT_LINKED] }] },
    }));
    render(<BdiGroundingPanel />);
    expect(screen.getByText('alignment')).toBeInTheDocument();
  });
});
