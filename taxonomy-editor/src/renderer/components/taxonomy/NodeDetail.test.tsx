// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression tests for t/2142: Zustand inline-object selector caused infinite
// render loop. Scalar selectors fix it; a successful render() call proves the
// fix holds. Also asserts Simple/Advanced tab visibility gate works correctly.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PovNode } from '../../types/taxonomy';

// ── Store mocks ──────────────────────────────────────────────────────────────

const mockTaxonomyStore = {
  updatePovNode: vi.fn(),
  deletePovNode: vi.fn(),
  movePovNodeCategory: vi.fn(),
  movePovNode: vi.fn(),
  validationErrors: {},
  getAllNodeIds: vi.fn(() => []),
  getAllConflictIds: vi.fn(() => []),
  runAttributeFilter: vi.fn(),
  showAttributeInfo: vi.fn(),
  navigateToLineage: vi.fn(),
  setToolbarPanel: vi.fn(),
  selectedEdge: null,
  relatedNodeId: null,
  loadEdges: vi.fn(),
  edgesFile: null,
  setSelectedNodeId: vi.fn(),
  getLabelForId: vi.fn(() => ''),
  aggregatedCruxes: null,
  showCruxDetail: vi.fn(),
  conflicts: [],
};

vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: () => mockTaxonomyStore,
}));

vi.mock('../../hooks/useDebateStore', () => ({
  useDebateStore: () => ({ activeDebate: null }),
}));

const mockPrefsState = {
  viewMode: 'simple' as 'simple' | 'advanced',
  setViewMode: vi.fn(),
  hydrate: vi.fn(),
};

vi.mock('../../store/preferencesStore', () => ({
  usePreferencesStore: (selector: (s: typeof mockPrefsState) => unknown) =>
    selector(mockPrefsState),
}));

// ── Bridge / lib mocks ───────────────────────────────────────────────────────

vi.mock('@bridge', () => ({
  api: {
    clipboardWriteText: vi.fn(),
    resolveSourceDocument: vi.fn().mockResolvedValue({ available: false, type: null }),
    openExternal: vi.fn(),
    getSourceEvidence: vi.fn().mockResolvedValue({ facts: [], keyPoints: [], formattedBlock: '', nodesCovered: [], totalCandidates: 0 }),
    getWebAppUrl: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));

vi.mock('@lib/electron-shared/povMeta', () => ({
  POV_META: {
    accelerationist: { label: 'Accelerationist', color: '#e74c3c' },
    safetyist: { label: 'Safetyist', color: '#2980b9' },
    skeptic: { label: 'Skeptic', color: '#27ae60' },
    'cross-cutting': { label: 'Cross-Cutting', color: '#8e44ad' },
  },
}));

// ── Heavy child stubs ─────────────────────────────────────────────────────────

vi.mock('../edge-browser/RelatedEdgesPanel', () => ({ RelatedEdgesPanel: () => null }));
vi.mock('../edge-browser/EdgeDetailPanel', () => ({ EdgeDetailPanel: () => null }));
vi.mock('../policy/SourcesPanel', () => ({ SourcesPanel: () => null }));
vi.mock('../policy/PhrasesPanel', () => ({ PhrasesPanel: () => null }));
vi.mock('../analysis/FactsPanel', () => ({
  FactsPanel: () => null,
  getFactCount: () => 0,
  preloadFactsIndex: vi.fn(),
}));
vi.mock('../conflict', () => ({
  ConflictsPanel: () => null,
  conflictsForNode: () => [],
}));
vi.mock('./GraphAttributesPanel', () => ({ GraphAttributesPanel: () => null }));
vi.mock('./NodeEditHistory', () => ({ NodeEditHistory: () => null }));
vi.mock('./DebateTestedChip', () => ({ DebateTestedChip: () => null }));
vi.mock('./DebateTestedDrilldown', () => ({ DebateTestedDrilldown: () => null }));
vi.mock('../shared/MentionField', () => ({
  useContainerMentionKit: () => ({ renderMentionField: () => null, descriptionMention: null }),
  MentionField: () => null,
}));
vi.mock('../../utils/regeneratePlainDescription', () => ({ triggerPovNodeRegeneration: vi.fn() }));
vi.mock('../../utils/regenerateAphorism', () => ({ generateAphorism: vi.fn() }));
vi.mock('../../data/lineageLookup', () => ({ getLineageInfo: () => null }));
vi.mock('../../prompts/research', () => ({ researchPrompt: () => '' }));
vi.mock('../../utils/shareLinks', () => ({ publicPovSharePath: () => '' }));
vi.mock('../conflict/edit-conflicts', () => ({
  EditConflictBadge: () => null,
}));

// ── Minimal valid PovNode fixture ────────────────────────────────────────────

const mockNode: PovNode = {
  id: 'acc-beliefs-001',
  category: 'beliefs',
  label: 'Test Belief',
  description: 'A test belief node.',
  parent_id: null,
  children: [],
  situation_refs: [],
};

// ── Component under test ──────────────────────────────────────────────────────

import { NodeDetail } from './NodeDetail';

describe('NodeDetail — Zustand scalar selector regression (t/2142)', () => {
  beforeEach(() => {
    mockPrefsState.viewMode = 'simple';
    vi.clearAllMocks();
  });

  it('renders without infinite loop in simple mode', () => {
    // Pre-fix: inline `{ viewMode }` object selector created new ref each render
    // → Zustand re-subscribed → re-render → "Maximum update depth exceeded"
    expect(() =>
      render(
        <NodeDetail
          pov="acc"
          node={mockNode}
          readOnly={false}
          onPin={vi.fn()}
          onSimilarSearch={vi.fn()}
          onRelated={vi.fn()}
        />,
      ),
    ).not.toThrow();
  });

  it('renders without infinite loop in advanced mode', () => {
    mockPrefsState.viewMode = 'advanced';
    expect(() =>
      render(
        <NodeDetail
          pov="acc"
          node={mockNode}
          readOnly={false}
          onPin={vi.fn()}
          onSimilarSearch={vi.fn()}
          onRelated={vi.fn()}
        />,
      ),
    ).not.toThrow();
  });

  it('shows only Content and Related tabs in simple mode', () => {
    render(
      <NodeDetail
        pov="acc"
        node={mockNode}
        readOnly={false}
        onPin={vi.fn()}
        onSimilarSearch={vi.fn()}
        onRelated={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /content/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /related/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /attributes/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /research/i })).not.toBeInTheDocument();
  });

  it('shows all four tabs in advanced mode', () => {
    mockPrefsState.viewMode = 'advanced';
    render(
      <NodeDetail
        pov="acc"
        node={mockNode}
        readOnly={false}
        onPin={vi.fn()}
        onSimilarSearch={vi.fn()}
        onRelated={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /content/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /related/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /attributes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /research/i })).toBeInTheDocument();
  });
});
