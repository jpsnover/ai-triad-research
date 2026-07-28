// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReflectionsPanel } from './ReflectionsPanel';

// ── Mocks ────────────────────────────────────────────────────

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));

const generatePlainPreview = vi.fn();
vi.mock('../../utils/regeneratePlainDescription', () => ({
  generatePlainPreview: (...args: unknown[]) => generatePlainPreview(...args),
}));

const debateStore: Record<string, any> = {
  reflections: [],
  newItemProposalStatus: {},
  debateGenerating: null,
  activeDebate: null,
  enrichmentStatus: {},
  requestReflections: vi.fn(),
  applyReflectionEdit: vi.fn(),
  retryReflectionEditAfterFix: vi.fn(),
  dismissReflectionEdit: vi.fn(),
  applyReflectionProposal: vi.fn(),
  dismissReflectionProposal: vi.fn(),
  retryEnrichment: vi.fn(),
  clearEnrichmentStatus: vi.fn(),
};

vi.mock('../../hooks/useDebateStore', () => ({
  useDebateStore: (selector: any) => selector(debateStore),
}));

const taxStore: Record<string, any> = { navigateToNode: vi.fn() };
vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: (selector: any) => selector(taxStore),
}));

vi.mock('zustand/react/shallow', () => ({ useShallow: (fn: any) => fn }));

vi.mock('../../types/debate', () => ({
  POVER_INFO: {
    accelerationist: { label: 'Accelerationist', color: 'var(--color-acc)' },
    safetyist: { label: 'Safetyist', color: 'var(--color-saf)' },
    skeptic: { label: 'Skeptic', color: 'var(--color-skp)' },
  },
}));

const LONG_FORMAL = 'A sufficiently long formal DOLCE description that exceeds the minimum length.';

function addReflection() {
  debateStore.reflections = [{
    pover: 'accelerationist',
    label: 'Accelerationist',
    reflection_summary: '',
    edits: [{
      edit_type: 'add',
      status: 'pending',
      category: 'Beliefs',
      node_id: '',
      proposed_label: 'New belief',
      proposed_description: LONG_FORMAL,
      rationale: 'because evidence supports it',
      evidence_entries: [],
    }],
  }];
}

beforeEach(() => {
  localStorage.clear(); // description mode defaults to 'plain'
  addReflection();
});

afterEach(() => { vi.clearAllMocks(); });

describe('ReflectionsPanel — plain description for new (add) proposals', () => {
  it('generates the plain preview on render when default mode is plain (AC1/AC2)', async () => {
    generatePlainPreview.mockResolvedValue('Plain-language version of the belief.');
    render(<ReflectionsPanel onClose={vi.fn()} />);

    await waitFor(() => expect(generatePlainPreview).toHaveBeenCalledWith(LONG_FORMAL));
    expect(await screen.findByText('Plain-language version of the belief.')).toBeInTheDocument();
  });

  it('surfaces a Retry affordance when generation fails instead of silently showing formal (AC3)', async () => {
    generatePlainPreview.mockResolvedValue(null); // AI/vernacular-model failure
    render(<ReflectionsPanel onClose={vi.fn()} />);

    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(retry).toBeInTheDocument();
    expect(screen.getByText(/Couldn't generate a plain description/)).toBeInTheDocument();

    // Retry re-arms generation; a subsequent success replaces the error.
    generatePlainPreview.mockResolvedValue('Recovered plain text.');
    fireEvent.click(retry);
    expect(await screen.findByText('Recovered plain text.')).toBeInTheDocument();
  });
});

// ── propose_new item proposals (t/1773 AC1) ───────────────────

function addProposalReflection() {
  debateStore.reflections = [{
    pover: 'accelerationist',
    label: 'Accelerationist',
    reflection_summary: '',
    edits: [],
    new_item_proposals: [{
      kind: 'propose_new',
      source: 'reflection_new_item',
      node_id: '',
      reason: 'r',
      debate_id: 'd1',
      requires_human_review: true,
      pov: 'accelerationist',
      category: 'Beliefs',
      label: 'Proposed New Belief',
      description: 'A newly proposed belief description.',
      rationale: 'It was surfaced repeatedly in the debate.',
      proposed_edges: [
        { target_node_id: 'acc-B-001', edge_type: 'SUPPORTS', new_node_role: 'source', rationale: 'supports the parent claim', confidence: 0.8 },
      ],
    }],
  }];
}

describe('ReflectionsPanel — propose_new item proposals (t/1773 AC1)', () => {
  beforeEach(() => {
    addProposalReflection();
    debateStore.newItemProposalStatus = {};
  });

  it('renders the new-item option with its label, proposed edges, and Approve/Dismiss actions', () => {
    render(<ReflectionsPanel onClose={vi.fn()} />);
    expect(screen.getByText('Proposed New Belief')).toBeInTheDocument();
    expect(screen.getByText('New Item')).toBeInTheDocument();
    expect(screen.getByText(/Proposed edges \(1\)/)).toBeInTheDocument();
    expect(screen.getByText('acc-B-001')).toBeInTheDocument();
    expect(screen.getByText(/SUPPORTS/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve & Apply' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('Approve & Apply calls applyReflectionProposal with the pov + proposal index', async () => {
    debateStore.applyReflectionProposal.mockResolvedValue({ ok: true, createdNodeId: 'acc-B-042' });
    render(<ReflectionsPanel onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve & Apply' }));
    await waitFor(() => expect(debateStore.applyReflectionProposal).toHaveBeenCalledWith('accelerationist', 0));
  });

  it('Dismiss calls dismissReflectionProposal', () => {
    render(<ReflectionsPanel onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(debateStore.dismissReflectionProposal).toHaveBeenCalledWith('accelerationist', 0);
  });
});
