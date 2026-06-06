// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClaimsTab } from './ClaimsTab';
import type { ClaimsTabProps } from './ClaimsTab';

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
    requestReExtractClaims: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@lib/debate/qbaf', () => ({
  computeQbafStrengths: vi.fn().mockReturnValue([]),
}));
vi.mock('../../../utils/qbafExplain', () => ({
  explainNodeStrength: vi.fn().mockReturnValue(''),
}));
vi.mock('../../../../types/debate', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../types/debate')>();
  return {
    ...original,
    POVER_INFO: {
      accelerationist: { label: 'Accelerationist', pov: 'accelerationist', color: '#f97316' },
      safetyist:       { label: 'Safetyist', pov: 'safetyist', color: '#3b82f6' },
      skeptic:         { label: 'Skeptic', pov: 'skeptic', color: '#a855f7' },
    },
  };
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<ClaimsTabProps['entry']> = {}): ClaimsTabProps['entry'] {
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

function makeProps(overrides: Partial<ClaimsTabProps> = {}): ClaimsTabProps {
  return {
    entry: makeEntry(),
    diag: undefined,
    meta: undefined,
    debate: { topic: {}, transcript: [] },
    an: undefined,
    nodeWeights: new Map(),
    searchQuery: '',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClaimsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crash when diag and meta are undefined', () => {
    expect(() => {
      render(<ClaimsTab {...makeProps()} />);
    }).not.toThrow();
  });

  it('renders claim sketches when meta.my_claims has data', () => {
    render(
      <ClaimsTab
        {...makeProps({
          meta: {
            my_claims: [
              { claim: 'AI progress benefits humanity', targets: ['safetyist'] },
              { claim: 'Regulation stifles innovation', targets: [] },
            ],
          },
        })}
      />,
    );
    expect(screen.getByText(/AI progress benefits humanity/)).toBeInTheDocument();
    expect(screen.getByText(/Regulation stifles innovation/)).toBeInTheDocument();
    // Section header shows count
    expect(screen.getByText(/Claim Sketches \(2\)/)).toBeInTheDocument();
  });

  it('shows anti-filibuster banner when extraction_trace has low_marginal_value rejections', () => {
    render(
      <ClaimsTab
        {...makeProps({
          diag: {
            extraction_trace: {
              candidates_proposed: 5,
              candidates_accepted: 2,
              candidates_rejected: 3,
              rejection_reasons: { low_marginal_value: 2 },
              an_node_count_before: 10,
              an_node_count_after: 12,
              an_nodes_added_ids: ['acc-B-001', 'acc-B-002'],
            },
          } as any,
        })}
      />,
    );
    expect(screen.getByText('ANTI-FILIBUSTER')).toBeInTheDocument();
    expect(screen.getByText(/2 low-value claims? filtered/)).toBeInTheDocument();
  });

  it('renders extracted claims section when diag.extracted_claims exists', () => {
    render(
      <ClaimsTab
        {...makeProps({
          diag: {
            extracted_claims: {
              accepted: [
                { id: 'acc-B-001', text: 'Safety concerns are valid', overlap_pct: 75 },
              ],
              rejected: [
                { text: 'Weak claim here', overlap_pct: 5, reason: 'low_overlap' },
              ],
            },
          } as any,
        })}
      />,
    );
    // Section header
    expect(screen.getByText(/Extracted Claims \(1 accepted, 1 rejected\)/)).toBeInTheDocument();
    // Accepted claim content
    expect(screen.getByText(/Safety concerns are valid/)).toBeInTheDocument();
    // Accepted claim ID
    expect(screen.getByText(/acc-B-001/)).toBeInTheDocument();
  });

  it('renders extraction trace section with candidate counts and rejection reasons', () => {
    render(
      <ClaimsTab
        {...makeProps({
          diag: {
            extraction_trace: {
              candidates_proposed: 5,
              candidates_accepted: 3,
              candidates_rejected: 2,
              rejection_reasons: { low_overlap: 1, duplicate_claim: 1 },
              an_node_count_before: 10,
              an_node_count_after: 13,
              an_nodes_added_ids: ['acc-B-001', 'acc-B-002', 'acc-B-003'],
            },
          } as any,
        })}
      />,
    );
    expect(screen.getByText(/Extraction Trace/)).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument(); // proposed
    expect(screen.getByText('3')).toBeInTheDocument(); // accepted
    expect(screen.getByText(/low overlap \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/duplicate claim \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/10 → 13/)).toBeInTheDocument();
  });

  it('renders raw prompt and response as top-level sections when claim_extraction exists', () => {
    render(
      <ClaimsTab
        {...makeProps({
          diag: {
            extracted_claims: { accepted: [], rejected: [] },
            claim_extraction: {
              prompt: 'Extract claims from the following statement...',
              raw_response: '{"claims": []}',
              claims_parsed: 0,
              schemes_classified: [],
              response_time_ms: 1500,
            },
          } as any,
        })}
      />,
    );
    expect(screen.getByText(/Raw Extraction Prompt/)).toBeInTheDocument();
    expect(screen.getByText(/Raw Extraction Response/)).toBeInTheDocument();
    expect(screen.getByText(/0 claims, 1.5s/)).toBeInTheDocument();
  });

  it('does not show anti-filibuster banner when low_marginal_value is 0', () => {
    render(
      <ClaimsTab
        {...makeProps({
          diag: {
            extraction_trace: {
              candidates_proposed: 3,
              candidates_accepted: 3,
              candidates_rejected: 0,
              rejection_reasons: { low_marginal_value: 0 },
              an_node_count_before: 5,
              an_node_count_after: 8,
              an_nodes_added_ids: [],
            },
          } as any,
        })}
      />,
    );
    expect(screen.queryByText('ANTI-FILIBUSTER')).not.toBeInTheDocument();
  });
});
