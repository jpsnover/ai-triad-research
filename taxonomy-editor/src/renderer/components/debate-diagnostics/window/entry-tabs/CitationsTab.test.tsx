// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CitationsTab } from './CitationsTab';
import type { CitationsTabProps } from './CitationsTab';

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBaseCitationRes(overrides: Record<string, unknown> = {}) {
  return {
    path: 'bank-scrub' as const,
    bank_size: 3,
    bank_sources: ['lecun-2022', 'bengio-2023', 'russell-2019'],
    citations_extracted: 2,
    citations_matched: 2,
    citations_fabricated: 0,
    resolution_time_ms: 450,
    matches: [],
    fabrications: [],
    warnings: [],
    ...overrides,
  };
}

function makeProps(overrides: Partial<CitationsTabProps> = {}): CitationsTabProps {
  return {
    diag: undefined,
    searchQuery: '',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CitationsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crash when diag is undefined', () => {
    expect(() => {
      render(<CitationsTab {...makeProps()} />);
    }).not.toThrow();
  });

  it('shows "not active" message when no citation_resolution on draft stage', () => {
    render(
      <CitationsTab
        {...makeProps({
          diag: {
            stage_diagnostics: [
              {
                stage: 'draft',
                model: 'gemini-1.5-pro',
                response_time_ms: 2000,
                // no citation_resolution field
                work_product: {},
              },
            ],
          } as any,
        })}
      />,
    );
    expect(
      screen.getByText(/Citation resolution was not active for this turn/),
    ).toBeInTheDocument();
  });

  it('renders summary cards when citation resolution data exists', () => {
    render(
      <CitationsTab
        {...makeProps({
          diag: {
            stage_diagnostics: [
              {
                stage: 'draft',
                model: 'gemini-1.5-pro',
                response_time_ms: 2000,
                work_product: {},
                citation_resolution: makeBaseCitationRes(),
              },
            ],
          } as any,
        })}
      />,
    );
    // Summary card labels
    expect(screen.getByText('Path')).toBeInTheDocument();
    expect(screen.getByText('Bank')).toBeInTheDocument();
    expect(screen.getByText('Matched')).toBeInTheDocument();
    expect(screen.getByText('Fabricated')).toBeInTheDocument();
    // Path value for bank-scrub
    expect(screen.getByText('Bank+Scrub')).toBeInTheDocument();
    // Clean fabrication value
    expect(screen.getByText('0 — clean')).toBeInTheDocument();
  });

  it('shows fabrication details when citations_fabricated > 0', () => {
    render(
      <CitationsTab
        {...makeProps({
          diag: {
            stage_diagnostics: [
              {
                stage: 'draft',
                model: 'gemini-1.5-pro',
                response_time_ms: 2000,
                work_product: {},
                citation_resolution: makeBaseCitationRes({
                  citations_fabricated: 1,
                  fabrications: [
                    {
                      citation_text: 'Smith et al. (2021)',
                      pattern: 'title',
                      action: 'removed',
                      replacement: undefined,
                    },
                  ],
                }),
              },
            ],
          } as any,
        })}
      />,
    );
    // Fabricated citations section heading
    expect(screen.getByText(/Fabricated Citations \(1\)/)).toBeInTheDocument();
    // The fabricated citation text appears in the component
    expect(screen.getByText(/Smith et al\. \(2021\)/)).toBeInTheDocument();
    // Pattern badge
    expect(screen.getByText('TITLE')).toBeInTheDocument();
    // Action badge
    expect(screen.getByText('removed')).toBeInTheDocument();
  });

  it('renders matched citations section when matches are present', () => {
    render(
      <CitationsTab
        {...makeProps({
          diag: {
            stage_diagnostics: [
              {
                stage: 'draft',
                model: 'gemini-1.5-pro',
                response_time_ms: 2000,
                work_product: {},
                citation_resolution: makeBaseCitationRes({
                  matches: [
                    {
                      citation_text: 'LeCun 2022',
                      doc_id: 'lecun-2022',
                      title: 'A Path Towards Autonomous Machine Intelligence',
                      similarity: 0.92,
                      match_type: 'exact',
                    },
                  ],
                }),
              },
            ],
          } as any,
        })}
      />,
    );
    expect(screen.getByText(/Matched Citations \(1\)/)).toBeInTheDocument();
    expect(screen.getByText('lecun-2022')).toBeInTheDocument();
    expect(screen.getByText('EXACT')).toBeInTheDocument();
  });
});
