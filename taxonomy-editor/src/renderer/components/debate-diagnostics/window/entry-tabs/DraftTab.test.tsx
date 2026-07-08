// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DraftTab } from './DraftTab';
import type { DraftTabProps } from './DraftTab';

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
  api: {
    clipboardWriteText: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@lib/debate/qbaf', () => ({
  computeQbafStrengths: vi.fn().mockReturnValue([]),
}));
vi.mock('../../../utils/qbafExplain', () => ({
  explainNodeStrength: vi.fn().mockReturnValue(''),
}));
vi.mock('@lib/debate/prompts', () => ({
  classifyOffScopeDrift: vi.fn().mockReturnValue('none'),
  offScopeRepairHint: vi.fn().mockReturnValue(''),
}));
vi.mock('../../../../utils/humanizeSpeakers', () => ({
  humanizeSpeakerIds: vi.fn((s: string) => s),
}));
vi.mock('../shared', () => ({
  classifyHintTarget: vi.fn().mockReturnValue('draft'),
  HINT_TARGET_STYLE: {
    draft: { label: 'DRAFT', color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
    cite: { label: 'CITE', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
  },
  ArtifactBlock: ({ label, text }: { label: string; text: string }) => <div data-testid={`artifact-${label}`}>{text}</div>,
}));
vi.mock('../../../TaxonomyRefDetail', () => ({
  TaxonomyRefDetail: () => <div data-testid="taxonomy-ref-detail" />,
}));

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<DraftTabProps['entry']> = {}): DraftTabProps['entry'] {
  return {
    id: 'e1',
    type: 'statement',
    speaker: 'accelerationist',
    content: undefined,
    metadata: {},
    taxonomy_refs: [],
    policy_refs: [],
    ...overrides,
  };
}

function makeProps(overrides: Partial<DraftTabProps> = {}): DraftTabProps {
  return {
    entry: makeEntry(),
    diag: undefined,
    meta: undefined,
    debate: { topic: {}, transcript: [] },
    turnValTrail: undefined,
    an: undefined,
    selectedTaxRefId: null,
    setSelectedTaxRefId: vi.fn(),
    nodeWeights: new Map(),
    taxNodeMap: new Map(),
    allEdges: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DraftTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crash when diag is undefined', () => {
    // Component returns null when there's no draftStage and no content
    // Providing content ensures something renders
    const { container } = render(
      <DraftTab {...makeProps({ entry: makeEntry({ content: 'Hello world' }) })} />,
    );
    expect(container).toBeDefined();
  });

  it('renders null when no draft stage and no content', () => {
    const { container } = render(
      <DraftTab {...makeProps({ diag: undefined, entry: makeEntry({ content: undefined }) })} />,
    );
    // Component returns null in this case — container should be empty
    expect(container.firstChild).toBeNull();
  });

  it('shows draft content when entry.content exists', () => {
    render(
      <DraftTab
        {...makeProps({
          entry: makeEntry({ content: 'AI safety is crucial.' }),
        })}
      />,
    );
    expect(screen.getByText('AI safety is crucial.')).toBeInTheDocument();
    // Should show the "Statement" summary in a details element
    expect(screen.getByText('Statement')).toBeInTheDocument();
  });

  it('renders topic alignment section when quality_gate data is present in diag', () => {
    render(
      <DraftTab
        {...makeProps({
          entry: makeEntry({ content: 'Some content' }),
          diag: {
            topic_alignment: {
              topic_aligned: true,
              scope_used: { core_proposition: 'Test topic', domain: 'AI safety' } as any,
              repaired: false,
            },
            quality_gate: {
              pre_repair: {
                grounded: true,
                falsifiable: true,
                engages: true,
                topic_aligned: true,
                pass: true,
                weaknesses: [],
              },
            },
          } as any,
        })}
      />,
    );
    expect(screen.getByText('Topic Alignment')).toBeInTheDocument();
  });

  it('shows draft stage model and timing when stage_diagnostics has a draft stage', () => {
    render(
      <DraftTab
        {...makeProps({
          entry: makeEntry({ content: 'Content' }),
          diag: {
            stage_diagnostics: [
              {
                stage: 'draft',
                model: 'gemini-1.5-pro',
                response_time_ms: 2500,
                temperature: 0.7,
                work_product: {},
              },
            ],
          } as any,
        })}
      />,
    );
    expect(screen.getByText('gemini-1.5-pro')).toBeInTheDocument();
    // 2500ms → 2.5s displayed
    expect(screen.getByText('2.5s')).toBeInTheDocument();
    expect(screen.getByText('DRAFT')).toBeInTheDocument();
  });
});
