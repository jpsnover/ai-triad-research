// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExclusionGuardTab } from './ExclusionGuardTab';
import type { ExclusionGuardTabProps } from './ExclusionGuardTab';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../helpers', () => ({
  Section: ({
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
    copyText?: string;
  }) => (
    <div data-testid="section">
      <div data-testid="section-title">{title}</div>
      <div>{children}</div>
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProps(overrides: Partial<ExclusionGuardTabProps> = {}): ExclusionGuardTabProps {
  return {
    diag: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExclusionGuardTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders no-data messages when diag is undefined', () => {
    render(<ExclusionGuardTab {...makeProps()} />);
    expect(screen.getByText(/No exclusion guard data/)).toBeInTheDocument();
    expect(screen.getByText(/No scope drift data/)).toBeInTheDocument();
  });

  it('renders all-clear for claim extraction when extraction_trace exists but no guard', () => {
    render(
      <ExclusionGuardTab
        {...makeProps({
          diag: {
            extraction_trace: {
              candidates_proposed: 3,
              candidates_accepted: 3,
              candidates_rejected: 0,
            },
          } as any,
        })}
      />,
    );
    expect(screen.getByText(/All claims within scope — 0 exclusion violations/)).toBeInTheDocument();
  });

  it('renders all-clear when exclusion_guard has zero violations', () => {
    render(
      <ExclusionGuardTab
        {...makeProps({
          diag: {
            extraction_trace: {
              exclusion_guard: {
                checked: 5,
                refs_with_exclusion_vector: 8,
                violations: [],
                threshold: 0.95,
              },
            },
          } as any,
        })}
      />,
    );
    expect(screen.getByText(/Checked/)).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText(/All 5 claims within scope — 0 exclusion violations/)).toBeInTheDocument();
  });

  it('renders violations when exclusion_guard has them', () => {
    render(
      <ExclusionGuardTab
        {...makeProps({
          diag: {
            extraction_trace: {
              exclusion_guard: {
                checked: 3,
                refs_with_exclusion_vector: 4,
                violations: [
                  {
                    claim_id: 'acc-B-001',
                    claim_text: 'Dangerous overlap claim',
                    node_id: 'saf-D-003',
                    similarity_main: 0.92,
                    similarity_exclusion: 0.97,
                  },
                ],
                threshold: 0.95,
              },
            },
          } as any,
        })}
      />,
    );
    expect(screen.getByText('acc-B-001')).toBeInTheDocument();
    expect(screen.getByText('saf-D-003')).toBeInTheDocument();
    expect(screen.getByText(/Dangerous overlap claim/)).toBeInTheDocument();
  });

  it('renders scope_drift_check all-clear when no warnings', () => {
    render(
      <ExclusionGuardTab
        {...makeProps({
          diag: {
            scope_drift_check: {
              checked: true,
              refs_checked: 10,
              refs_with_exclusion_vector: 6,
              warnings: [],
              threshold: 0.65,
            },
          } as any,
        })}
      />,
    );
    expect(screen.getByText(/All 10 refs within scope — 0 drift warnings/)).toBeInTheDocument();
  });

  it('renders scope drift warnings when present', () => {
    render(
      <ExclusionGuardTab
        {...makeProps({
          diag: {
            scope_drift_check: {
              checked: true,
              refs_checked: 5,
              refs_with_exclusion_vector: 3,
              warnings: [
                {
                  debater: 'accelerationist',
                  node_id: 'acc-B-042',
                  similarity: 0.78,
                  draft_excerpt: 'The economic impact of regulation...',
                },
              ],
              threshold: 0.65,
            },
          } as any,
        })}
      />,
    );
    expect(screen.getByText('accelerationist')).toBeInTheDocument();
    expect(screen.getByText('acc-B-042')).toBeInTheDocument();
    expect(screen.getByText(/The economic impact of regulation/)).toBeInTheDocument();
  });

  it('renders taxonomy injection trace when present', () => {
    render(
      <ExclusionGuardTab
        {...makeProps({
          diag: {
            taxonomy_injection_trace: {
              considered: 15,
              demoted: 2,
              demoted_nodes: [
                { node_id: 'saf-B-010', exclusion_similarity: 0.88 },
                { node_id: 'skp-I-005', exclusion_similarity: 0.72 },
              ],
            },
          } as any,
        })}
      />,
    );
    const titles = screen.getAllByTestId('section-title');
    const taxTitle = titles.find(t => t.textContent?.includes('Taxonomy Context Injection'));
    expect(taxTitle).toBeDefined();
    expect(taxTitle!.textContent).toContain('15 considered');
    expect(taxTitle!.textContent).toContain('2 demoted');
    expect(screen.getByText('saf-B-010')).toBeInTheDocument();
    expect(screen.getByText('skp-I-005')).toBeInTheDocument();
  });

  it('renders situation injection trace when present', () => {
    render(
      <ExclusionGuardTab
        {...makeProps({
          diag: {
            situation_injection_trace: {
              considered: 8,
              excluded: 1,
              excluded_situations: [
                { situation_id: 'sit-007', exclusion_similarity: 0.91 },
              ],
            },
          } as any,
        })}
      />,
    );
    const titles = screen.getAllByTestId('section-title');
    const sitTitle = titles.find(t => t.textContent?.includes('Situation Injection'));
    expect(sitTitle).toBeDefined();
    expect(sitTitle!.textContent).toContain('8 considered');
    expect(sitTitle!.textContent).toContain('1 excluded');
    expect(screen.getByText('sit-007')).toBeInTheDocument();
  });
});
