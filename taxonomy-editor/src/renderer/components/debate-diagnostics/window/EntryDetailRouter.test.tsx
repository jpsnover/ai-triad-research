// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EntryDetailRouter } from './EntryDetailRouter';
import type { EntryDetailRouterProps } from './EntryDetailRouter';
import type { EntryTab, OverviewTab, UtilitySnapshot } from './types';
import type { TaxRefEdge } from '../../taxonomy/TaxonomyRefDetail';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@lib/debate/types', async (importOriginal) => {
  const original = await importOriginal<typeof import('@lib/debate/types')>();
  return {
    ...original,
    POVER_INFO: {
      accelerationist: { label: 'Accelerationist', pov: 'accelerationist', color: '#f97316' },
      safetyist:       { label: 'Safetyist', pov: 'safetyist', color: '#3b82f6' },
      skeptic:         { label: 'Skeptic', pov: 'skeptic', color: '#a855f7' },
    },
  };
});
vi.mock('@lib/debate/soul-docs/accelerationist.soul.json', () => ({ default: { label: 'Accelerationist' } }));
vi.mock('@lib/debate/soul-docs/safetyist.soul.json',       () => ({ default: { label: 'Safetyist' } }));
vi.mock('@lib/debate/soul-docs/skeptic.soul.json',         () => ({ default: { label: 'Skeptic' } }));
vi.mock('@bridge', () => ({
  api: { clipboardWriteText: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@lib/debate/qbaf', () => ({
  computeQbafStrengths: vi.fn().mockReturnValue([]),
}));
vi.mock('../../../utils/qbafExplain', () => ({
  explainNodeStrength: vi.fn().mockReturnValue(''),
}));
vi.mock('@lib/debate/helpers', () => ({
  getMoveName: vi.fn().mockReturnValue(''),
  MOVE_EDGE_MAP: {},
}));
vi.mock('@lib/debate/prompts', () => ({
  classifyOffScopeDrift: vi.fn().mockReturnValue('none'),
  offScopeRepairHint: vi.fn().mockReturnValue(''),
}));
vi.mock('../../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: vi.fn().mockReturnValue({ nodes: [], edges: [] }),
}));
vi.mock('../../../utils/humanizeSpeakers', () => ({
  humanizeSpeakerIds: vi.fn((s: string) => s),
}));
// Mock the child tab components to isolate EntryDetailRouter's own behavior
vi.mock('./entry-tabs', () => ({
  DraftTab: () => <div data-testid="draft-tab">DraftTab</div>,
  ClaimsTab: () => <div data-testid="claims-tab">ClaimsTab</div>,
  EvidenceTab: () => <div data-testid="evidence-tab">EvidenceTab</div>,
  CitationsTab: () => <div data-testid="citations-tab">CitationsTab</div>,
  TaxRefsTab: () => <div data-testid="tax-refs-tab">TaxRefsTab</div>,
  DetailsTab: () => <div data-testid="details-tab">DetailsTab</div>,
  BriefTab: () => <div data-testid="brief-tab">BriefTab</div>,
  PlanTab: () => <div data-testid="plan-tab">PlanTab</div>,
  LookaheadTab: () => <div data-testid="lookahead-tab">LookaheadTab</div>,
  CiteTab: () => <div data-testid="cite-tab">CiteTab</div>,
}));

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeProps(overrides: Partial<EntryDetailRouterProps> = {}): EntryDetailRouterProps {
  const entry = {
    id: 'e1',
    type: 'statement',
    speaker: 'accelerationist',
    content: 'Test content',
    taxonomy_refs: [],
    policy_refs: [],
    metadata: {},
  };
  return {
    debate: { topic: {}, transcript: [entry], diagnostics: { entries: {} }, argument_network: undefined, commitments: undefined } as any,
    entry: entry as any,
    entryIdx: 0,
    diag: undefined,
    meta: undefined,
    turnValTrail: undefined,
    an: undefined,
    commitments: undefined,
    entryTab: 'details',
    setEntryTab: vi.fn(),
    effectiveOverviewTab: 'transcript',
    selectedEntry: 'e1',
    setSelectedEntry: vi.fn(),
    setOverviewTab: vi.fn(),
    setLocalOverride: vi.fn(),
    proxiedModeratorTrace: null,
    taxNodeMap: new Map(),
    policyMap: new Map(),
    allEdges: [],
    nodeWeights: new Map(),
    selectedTaxRefId: null,
    setSelectedTaxRefId: vi.fn(),
    selectedPolicyId: null,
    setSelectedPolicyId: vi.fn(),
    textCopyMenu: null,
    setTextCopyMenu: vi.fn(),
    tabContentRef: { current: null },
    searchQuery: '',
    perTurnUtilities: [],
    nodeLabels: new Map(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EntryDetailRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders speaker label and statement ID', () => {
    const entry = {
      id: 'e3',
      type: 'statement',
      speaker: 'accelerationist',
      content: 'Test content',
      taxonomy_refs: [],
      policy_refs: [],
      metadata: {},
    } as any;
    const transcript = [
      { id: 'e1', type: 'statement', speaker: 'safetyist', content: 'a', taxonomy_refs: [], policy_refs: [], metadata: {} },
      { id: 'e2', type: 'statement', speaker: 'skeptic', content: 'b', taxonomy_refs: [], policy_refs: [], metadata: {} },
      entry,
    ];
    render(
      <EntryDetailRouter
        {...makeProps({
          entry,
          entryIdx: 2,
          debate: { topic: {}, transcript, diagnostics: { entries: {} }, argument_network: undefined, commitments: undefined } as any,
        })}
      />,
    );
    // S3 = entryIdx(2) + 1
    expect(screen.getByText('S3')).toBeInTheDocument();
    expect(screen.getByText('Accelerationist')).toBeInTheDocument();
  });

  it('renders tab buttons including Draft when entry has content', () => {
    render(<EntryDetailRouter {...makeProps()} />);

    // 'Overview' is the label for the 'details' tab — it has no data here but the
    // button should still be rendered (just disabled).
    const overviewBtn = screen.getByRole('button', { name: /Overview/i });
    expect(overviewBtn).toBeInTheDocument();

    // Draft tab is visible because entry.content exists
    const draftBtn = screen.getByRole('button', { name: /Draft/i });
    expect(draftBtn).toBeInTheDocument();
    expect(draftBtn).not.toBeDisabled();

    // Brief tab should be disabled (no brief stage data)
    const briefBtn = screen.getByRole('button', { name: /Brief/i });
    expect(briefBtn).toBeDisabled();

    // Plan tab should be disabled (no plan stage data)
    const planBtn = screen.getByRole('button', { name: /Plan/i });
    expect(planBtn).toBeDisabled();
  });

  it('calls setEntryTab when a tab is clicked', async () => {
    const setEntryTab = vi.fn();
    render(<EntryDetailRouter {...makeProps({ setEntryTab })} />);

    // Draft tab should be enabled (entry.content exists)
    const draftBtn = screen.getByRole('button', { name: /Draft/i });
    await userEvent.click(draftBtn);

    expect(setEntryTab).toHaveBeenCalledWith('draft');
  });

  it('enables Moderator-Pre tab when proxiedModeratorTrace is provided', async () => {
    render(
      <EntryDetailRouter
        {...makeProps({
          proxiedModeratorTrace: { selected: 'skeptic', focus_point: 'Test focus' },
        })}
      />,
    );

    // Moderator-Pre is in the overflow menu — auto-selected as activeTab when it's the only tab with data,
    // so the trigger shows "Moderator-Pre ▾" instead of "More ▾"
    await userEvent.click(screen.getByRole('button', { name: /Moderator-Pre/i }));
    const modBtn = screen.getByRole('menuitem', { name: /Moderator-Pre/i });
    expect(modBtn).not.toBeDisabled();
  });

  it('disables Prev button at first entry and enables Next', () => {
    const transcript = [
      { id: 'e1', type: 'statement', speaker: 'accelerationist', content: 'a', taxonomy_refs: [], policy_refs: [], metadata: {} },
      { id: 'e2', type: 'statement', speaker: 'safetyist', content: 'b', taxonomy_refs: [], policy_refs: [], metadata: {} },
      { id: 'e3', type: 'statement', speaker: 'skeptic', content: 'c', taxonomy_refs: [], policy_refs: [], metadata: {} },
    ] as any[];
    render(
      <EntryDetailRouter
        {...makeProps({
          entryIdx: 0,
          entry: transcript[0],
          debate: { topic: {}, transcript, diagnostics: { entries: {} }, argument_network: undefined, commitments: undefined } as any,
        })}
      />,
    );

    const prevBtn = screen.getByTitle('Previous statement');
    const nextBtn = screen.getByTitle('Next statement');
    expect(prevBtn).toBeDisabled();
    expect(nextBtn).not.toBeDisabled();
  });

  it('handles undefined diag/meta/an gracefully (no crash)', () => {
    expect(() => {
      render(
        <EntryDetailRouter
          {...makeProps({
            diag: undefined,
            meta: undefined,
            an: undefined,
          })}
        />,
      );
    }).not.toThrow();
  });

  it('enables Claims tab when extracted_claims are present', () => {
    render(
      <EntryDetailRouter
        {...makeProps({
          diag: {
            extracted_claims: {
              accepted: [{ id: 'c1', text: 'test', overlap_pct: 50 }],
              rejected: [],
            },
          } as any,
        })}
      />,
    );

    const claimsBtn = screen.getByRole('button', { name: /Claims/i });
    expect(claimsBtn).not.toBeDisabled();
  });

  it('shows count badge on Taxonomy Refs tab in overflow menu', async () => {
    const entry = {
      id: 'e1',
      type: 'statement',
      speaker: 'accelerationist',
      content: 'Test content',
      taxonomy_refs: [{ node_id: 'acc-B-001', relevance: 'test' }],
      policy_refs: [],
      metadata: {},
    } as any;
    render(
      <EntryDetailRouter
        {...makeProps({ entry })}
      />,
    );

    // Taxonomy Refs is in the overflow menu — open it first
    await userEvent.click(screen.getByRole('button', { name: /More ▾/i }));
    const taxRefsBtn = screen.getByRole('menuitem', { name: /Taxonomy Refs/i });
    expect(taxRefsBtn).toBeInTheDocument();
    expect(taxRefsBtn.textContent).toContain('(1)');
  });

  it('shows ran-empty indicator on Claims tab when pipeline ran but produced no claims', () => {
    render(
      <EntryDetailRouter
        {...makeProps({
          entryTab: 'claims',
          diag: {
            stage_diagnostics: [{ stage: 'brief' }, { stage: 'plan' }, { stage: 'draft' }, { stage: 'cite' }],
            extraction_trace: { candidates_proposed: 3, candidates_accepted: 0, candidates_rejected: 3, rejection_reasons: {} },
            extracted_claims: undefined,
          } as any,
          meta: {},
        })}
      />,
    );

    const claimsBtn = screen.getByRole('button', { name: /Claims/i });
    expect(claimsBtn).not.toBeDisabled();
    expect(claimsBtn).toHaveAttribute('title', 'Claims — stage ran, no output');
    expect(claimsBtn.textContent).toContain('∅');
  });
});
