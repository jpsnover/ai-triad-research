// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EntryView } from './EntryView';

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@bridge', () => ({
  api: { clipboardWriteText: vi.fn() },
}));

vi.mock('./helpers', () => ({
  CollapsibleSection: ({
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
  }) => (
    <div data-testid="collapsible">
      <div data-testid="collapsible-title">{title}</div>
      <div>{children}</div>
    </div>
  ),
  speakerLabel: (speaker: string) => {
    const map: Record<string, string> = {
      accelerationist: 'Accelerationist',
      safetyist: 'Safetyist',
      skeptic: 'Skeptic',
      system: 'System',
      moderator: 'Moderator',
      user: 'You',
    };
    return map[speaker] ?? speaker;
  },
}));

vi.mock('../../QbafOverlay', () => ({
  QbafClaimBadge: () => <span data-testid="qbaf-badge" />,
  QbafScoreSlider: () => <span data-testid="qbaf-slider" />,
  QbafEdgeIndicator: () => <span data-testid="qbaf-edge" />,
}));

vi.mock('@lib/debate/helpers', () => ({
  getMoveName: (m: unknown) => (typeof m === 'string' ? m : (m as { move: string }).move),
}));

let mockActiveDebate: unknown = null;

vi.mock('../../../hooks/useDebateStore', () => ({
  useDebateStore: (selector: (s: { activeDebate: unknown }) => unknown) =>
    selector({ activeDebate: mockActiveDebate }),
}));

vi.mock('../../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: Object.assign(
    (selector: (s: { qbafEnabled: boolean }) => unknown) =>
      selector({ qbafEnabled: false }),
    {
      getState: vi.fn().mockReturnValue({ situations: null }),
    },
  ),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    type: 'statement',
    speaker: 'accelerationist',
    content: 'Test content for the entry.',
    taxonomy_refs: [],
    policy_refs: [],
    metadata: {},
    ...overrides,
  };
}

function makeDebate(overrides: Record<string, unknown> = {}) {
  const entry = makeEntry();
  return {
    topic: {},
    transcript: [entry],
    diagnostics: { entries: {} },
    argument_network: undefined,
    commitments: undefined,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('EntryView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveDebate = null;
  });

  it('renders null when no active debate', () => {
    mockActiveDebate = null;
    const { container } = render(<EntryView entryId="e1" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders "Entry not found" when entryId does not match any transcript entry', () => {
    mockActiveDebate = makeDebate();
    render(<EntryView entryId="nonexistent" />);
    expect(screen.getByText('Entry not found')).toBeInTheDocument();
  });

  it('renders speaker label and entry type for a valid entry', () => {
    mockActiveDebate = makeDebate();
    render(<EntryView entryId="e1" />);
    expect(screen.getByText('Accelerationist')).toBeInTheDocument();
    expect(screen.getByText('statement')).toBeInTheDocument();
  });

  it('renders Model & Timing section when diag.model exists', () => {
    mockActiveDebate = makeDebate({
      diagnostics: {
        entries: {
          e1: {
            model: 'gemini-2.5-flash',
            response_time_ms: 2500,
            input_tokens: 1200,
            output_tokens: 350,
          },
        },
      },
    });
    render(<EntryView entryId="e1" />);
    const titles = screen.getAllByTestId('collapsible-title');
    const modelTitle = titles.find(t => t.textContent?.includes('Model & Timing'));
    expect(modelTitle).toBeDefined();
    expect(screen.getByText('gemini-2.5-flash')).toBeInTheDocument();
  });

  it('renders Extracted Claims section when diag has claims', () => {
    mockActiveDebate = makeDebate({
      diagnostics: {
        entries: {
          e1: {
            extracted_claims: {
              accepted: [{ id: 'acc-B-001', text: 'AI benefits outweigh risks', overlap_pct: 72 }],
              rejected: [{ text: 'Weak claim', overlap_pct: 8, reason: 'low_overlap' }],
            },
          },
        },
      },
    });
    render(<EntryView entryId="e1" />);
    const titles = screen.getAllByTestId('collapsible-title');
    const claimsTitle = titles.find(t => t.textContent?.includes('Extracted Claims'));
    expect(claimsTitle).toBeDefined();
    expect(claimsTitle!.textContent).toContain('1 accepted');
    expect(claimsTitle!.textContent).toContain('1 rejected');
    expect(screen.getByText(/AI benefits outweigh risks/)).toBeInTheDocument();
  });

  it('renders Dialectical Moves section when metadata has move_types', () => {
    mockActiveDebate = makeDebate({
      transcript: [makeEntry({ metadata: { move_types: ['rebut', 'concede'] } })],
    });
    render(<EntryView entryId="e1" />);
    const titles = screen.getAllByTestId('collapsible-title');
    const movesTitle = titles.find(t => t.textContent?.includes('Dialectical Moves'));
    expect(movesTitle).toBeDefined();
  });

  it('renders Key Assumptions section when metadata has key_assumptions', () => {
    mockActiveDebate = makeDebate({
      transcript: [makeEntry({
        metadata: {
          key_assumptions: [
            { assumption: 'Innovation will continue at current pace', if_wrong: 'Growth projections fail' },
          ],
        },
      })],
    });
    render(<EntryView entryId="e1" />);
    expect(screen.getByText(/Innovation will continue/)).toBeInTheDocument();
    expect(screen.getByText(/Growth projections fail/)).toBeInTheDocument();
  });

  it('renders Taxonomy Refs section when entry has taxonomy_refs', () => {
    mockActiveDebate = makeDebate({
      transcript: [makeEntry({
        taxonomy_refs: [
          { node_id: 'acc-B-001', relevance: 'Directly supports argument' },
          { node_id: 'saf-D-003', relevance: 'Counterpoint reference' },
        ],
      })],
    });
    render(<EntryView entryId="e1" />);
    const titles = screen.getAllByTestId('collapsible-title');
    const refsTitle = titles.find(t => t.textContent?.includes('Taxonomy Refs (2)'));
    expect(refsTitle).toBeDefined();
    expect(screen.getByText('acc-B-001')).toBeInTheDocument();
    expect(screen.getByText('saf-D-003')).toBeInTheDocument();
  });

  it('renders empty state when no diagnostic data exists', () => {
    mockActiveDebate = makeDebate();
    render(<EntryView entryId="e1" />);
    expect(screen.getByText(/No diagnostic data captured/)).toBeInTheDocument();
  });

  it('renders topic alignment badge when diag has topic_alignment', () => {
    mockActiveDebate = makeDebate({
      diagnostics: {
        entries: {
          e1: {
            topic_alignment: { topic_aligned: true, repaired: false, scope_used: {} },
          },
        },
      },
    });
    render(<EntryView entryId="e1" />);
    expect(screen.getByText('on-scope')).toBeInTheDocument();
  });

  it('renders off-scope badge when topic alignment failed', () => {
    mockActiveDebate = makeDebate({
      diagnostics: {
        entries: {
          e1: {
            topic_alignment: { topic_aligned: false, repaired: false, scope_used: {} },
          },
        },
      },
    });
    render(<EntryView entryId="e1" />);
    expect(screen.getByText('off-scope')).toBeInTheDocument();
  });

  it('renders repaired badge when topic alignment was repaired', () => {
    mockActiveDebate = makeDebate({
      diagnostics: {
        entries: {
          e1: {
            topic_alignment: { topic_aligned: true, repaired: true, scope_used: {} },
          },
        },
      },
    });
    render(<EntryView entryId="e1" />);
    expect(screen.getByText('repaired')).toBeInTheDocument();
  });

  it('renders Claim Extraction section when diag has claim_extraction', () => {
    mockActiveDebate = makeDebate({
      diagnostics: {
        entries: {
          e1: {
            claim_extraction: {
              prompt: 'Extract claims from...',
              raw_response: '{"claims":[]}',
              claims_parsed: 3,
              schemes_classified: ['ARGUMENT_FROM_EVIDENCE'],
              response_time_ms: 1200,
            },
          },
        },
      },
    });
    render(<EntryView entryId="e1" />);
    const titles = screen.getAllByTestId('collapsible-title');
    const ceTitle = titles.find(t => t.textContent?.includes('Claim Extraction'));
    expect(ceTitle).toBeDefined();
    expect(ceTitle!.textContent).toContain('3 claims');
    expect(screen.getByText('ARGUMENT_FROM_EVIDENCE')).toBeInTheDocument();
  });

  it('renders intervention metadata for moderator intervention entries', () => {
    mockActiveDebate = makeDebate({
      transcript: [makeEntry({
        type: 'intervention',
        speaker: 'moderator',
        intervention_metadata: {
          move: 'challenge_assumption',
          family: 'elicitation',
          force: 'soft',
          target_debater: 'accelerationist',
          burden: 0.35,
          trigger_reason: 'Unsubstantiated claim detected',
        },
      })],
    });
    render(<EntryView entryId="e1" />);
    const titles = screen.getAllByTestId('collapsible-title');
    const intTitle = titles.find(t => t.textContent?.includes('Intervention'));
    expect(intTitle).toBeDefined();
    expect(screen.getByText('elicitation')).toBeInTheDocument();
    expect(screen.getByText('challenge_assumption')).toBeInTheDocument();
    expect(screen.getByText(/Unsubstantiated claim detected/)).toBeInTheDocument();
  });

  it('renders Exclusion Guard with all-clear when extraction_trace has no violations', () => {
    mockActiveDebate = makeDebate({
      diagnostics: {
        entries: {
          e1: {
            extraction_trace: {
              exclusion_guard: {
                checked: 3,
                refs_with_exclusion_vector: 5,
                violations: [],
                threshold: 0.95,
              },
            },
          },
        },
      },
    });
    render(<EntryView entryId="e1" />);
    const titles = screen.getAllByTestId('collapsible-title');
    const guardTitle = titles.find(t => t.textContent?.includes('Exclusion Guard'));
    expect(guardTitle).toBeDefined();
    expect(screen.getByText(/All 3 claims within scope/)).toBeInTheDocument();
  });

  it('renders Exclusion Guard with violations when present', () => {
    mockActiveDebate = makeDebate({
      diagnostics: {
        entries: {
          e1: {
            extraction_trace: {
              exclusion_guard: {
                checked: 4,
                refs_with_exclusion_vector: 6,
                violations: [
                  { claim_id: 'acc-B-001', claim_text: 'Dangerous claim', node_id: 'saf-D-003', similarity_main: 0.92, similarity_exclusion: 0.97 },
                ],
                threshold: 0.95,
              },
            },
          },
        },
      },
    });
    render(<EntryView entryId="e1" />);
    const titles = screen.getAllByTestId('collapsible-title');
    const guardTitle = titles.find(t => t.textContent?.includes('Exclusion Guard'));
    expect(guardTitle).toBeDefined();
    expect(guardTitle!.textContent).toContain('1 issue');
    expect(screen.getByText(/acc-B-001/)).toBeInTheDocument();
  });

  it('renders Draft Scope Check all-clear when scope_drift_check has no warnings', () => {
    mockActiveDebate = makeDebate({
      diagnostics: {
        entries: {
          e1: {
            scope_drift_check: {
              checked: true,
              refs_checked: 8,
              refs_with_exclusion_vector: 4,
              warnings: [],
              threshold: 0.65,
            },
          },
        },
      },
    });
    render(<EntryView entryId="e1" />);
    expect(screen.getByText(/All 8 refs within scope/)).toBeInTheDocument();
  });

  it('renders no-data message when no exclusion trace exists but diag does', () => {
    mockActiveDebate = makeDebate({
      diagnostics: {
        entries: {
          e1: {
            model: 'gemini-2.5-flash',
          },
        },
      },
    });
    render(<EntryView entryId="e1" />);
    expect(screen.getByText(/No exclusion guard data/)).toBeInTheDocument();
  });
});
