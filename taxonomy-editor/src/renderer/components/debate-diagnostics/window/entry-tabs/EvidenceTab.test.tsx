// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EvidenceTab } from './EvidenceTab';
import type { EvidenceTabProps } from './EvidenceTab';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@lib/debate/types', async (importOriginal) => {
  const original = await importOriginal<typeof import('@lib/debate/types')>();
  return {
    ...original,
    POVER_INFO: {
      accelerationist: { label: 'Accelerationist', pov: 'accelerationist', color: 'var(--color-acc)' },
      safetyist:       { label: 'Safetyist', pov: 'safetyist', color: 'var(--color-saf)' },
      skeptic:         { label: 'Skeptic', pov: 'skeptic', color: 'var(--color-skp)' },
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

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<EvidenceTabProps['entry']> = {}): EvidenceTabProps['entry'] {
  return {
    id: 'e1',
    type: 'statement',
    speaker: 'accelerationist',
    content: 'Test content',
    metadata: {},
    taxonomy_refs: [],
    policy_refs: [],
    ...overrides,
  };
}

function makeProps(overrides: Partial<EvidenceTabProps> = {}): EvidenceTabProps {
  return {
    entry: makeEntry(),
    diag: undefined,
    an: undefined,
    searchQuery: '',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EvidenceTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crash when diag is undefined', () => {
    expect(() => {
      render(<EvidenceTab {...makeProps()} />);
    }).not.toThrow();
  });

  it('shows opening statement message when entry.type is opening', () => {
    render(
      <EvidenceTab
        {...makeProps({
          entry: makeEntry({ type: 'opening' }),
          diag: undefined,
        })}
      />,
    );
    expect(
      screen.getByText(/Evidence retrieval does not run for opening statements/),
    ).toBeInTheDocument();
  });

  it('shows no evidence data message for non-opening when no evidence stage and no extraction trace', () => {
    render(
      <EvidenceTab
        {...makeProps({
          entry: makeEntry({ type: 'statement' }),
          diag: undefined,
        })}
      />,
    );
    expect(
      screen.getByText(/No evidence data available for this turn/),
    ).toBeInTheDocument();
  });

  it('renders evidence facts when evidence stage has work_product with facts', () => {
    render(
      <EvidenceTab
        {...makeProps({
          diag: {
            stage_diagnostics: [
              {
                stage: 'evidence',
                model: 'gemini-1.5-pro',
                response_time_ms: 1200,
                work_product: {
                  facts: [
                    {
                      claim: 'AI systems have improved rapidly since 2020.',
                      claim_label: 'Rapid improvement',
                      doc_id: 'lecun-2022',
                      specificity: 'precise',
                      temporal_bound: '2020-2022',
                      linked_taxonomy_nodes: ['acc-B-001'],
                    },
                  ],
                  keyPoints: [],
                  nodesCovered: ['acc-B-001'],
                  totalCandidates: 5,
                },
              },
            ],
          } as any,
        })}
      />,
    );
    // Summary section heading
    expect(screen.getByText('Source Evidence Retrieved')).toBeInTheDocument();
    // Facts section heading
    expect(screen.getByText(/Source Facts \(1\)/)).toBeInTheDocument();
    // Fact content
    expect(screen.getByText('AI systems have improved rapidly since 2020.')).toBeInTheDocument();
    // Doc ID link
    expect(screen.getByText('lecun-2022')).toBeInTheDocument();
  });

  it('renders extraction funnel when extraction_trace has candidates', () => {
    render(
      <EvidenceTab
        {...makeProps({
          diag: {
            extraction_trace: {
              candidates_proposed: 8,
              candidates_accepted: 5,
              candidates_rejected: 3,
              rejection_reasons: { low_overlap: 2, duplicate_claim: 1 },
              an_node_count_before: 10,
              an_node_count_after: 15,
              an_nodes_added_ids: ['acc-B-001', 'acc-B-002'],
            },
          } as any,
        })}
      />,
    );
    expect(screen.getByText('Extraction Funnel')).toBeInTheDocument();
    expect(screen.getByText('AN Delta')).toBeInTheDocument();
  });
});
