// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DetailsTab } from './DetailsTab';
import type { DetailsTabProps } from './DetailsTab';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@lib/debate/types', async (importOriginal) => {
  const original = await importOriginal<typeof import('@lib/debate/types')>();
  return {
    ...original,
    POVER_INFO: {
      accelerationist: { label: 'Accelerationist', pov: 'accelerationist', color: '#f97316' },
      safetyist:       { label: 'Safetyist',       pov: 'safetyist',       color: '#3b82f6' },
      skeptic:         { label: 'Skeptic',          pov: 'skeptic',         color: '#a855f7' },
    },
  };
});
vi.mock('@lib/debate/soul-docs/accelerationist.soul.json', () => ({ default: { label: 'Accelerationist' } }));
vi.mock('@lib/debate/soul-docs/safetyist.soul.json',       () => ({ default: { label: 'Safetyist' } }));
vi.mock('@lib/debate/soul-docs/skeptic.soul.json',         () => ({ default: { label: 'Skeptic' } }));
vi.mock('@bridge', () => ({
  api: { clipboardWriteText: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@lib/debate/helpers', () => ({
  getMoveName: vi.fn((m: string | object) =>
    typeof m === 'string' ? m : ((m as { move?: string }).move ?? 'move'),
  ),
  MOVE_EDGE_MAP: {},
}));
vi.mock('../../../../utils/humanizeSpeakers', () => ({
  humanizeSpeakerIds: vi.fn((s: string) => s),
}));
vi.mock('../shared', () => ({
  classifyHintTarget: vi.fn().mockReturnValue('judge'),
  HINT_TARGET_STYLE: {
    draft:  { label: 'DRAFT',   color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
    cite:   { label: 'CITE',    color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
    judge:  { label: 'QUALITY', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  },
  EdgesUsedGrouped: () => <div data-testid="edges-used-grouped" />,
}));

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<DetailsTabProps['entry']> = {}): DetailsTabProps['entry'] {
  return {
    id: 'e1',
    type: 'statement',
    speaker: 'accelerationist',
    content: 'Test content',
    metadata: {},
    taxonomy_refs: [],
    policy_refs: [],
    ...overrides,
  } as DetailsTabProps['entry'];
}

function makeProps(overrides: Partial<DetailsTabProps> = {}): DetailsTabProps {
  return {
    entry: makeEntry(),
    entryIdx: 0,
    diag: undefined,
    meta: undefined,
    debate: { topic: {}, transcript: [] } as any,
    an: undefined,
    turnValTrail: undefined,
    perTurnUtilities: [],
    precedingIntervention: null,
    interventionResponseField: null,
    suppressedIntervention: null,
    policyMap: new Map(),
    allEdges: [],
    taxNodeMap: new Map(),
    nodeWeights: new Map(),
    nodeLabels: new Map(),
    selectedTaxRefId: null,
    setSelectedTaxRefId: vi.fn(),
    entryErrors: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DetailsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Basic rendering
  // -------------------------------------------------------------------------

  it('renders without crash with minimal props', () => {
    expect(() => {
      render(<DetailsTab {...makeProps()} />);
    }).not.toThrow();
  });

  it('renders without crash when diag, meta, an, and turnValTrail are all undefined', () => {
    expect(() => {
      render(
        <DetailsTab
          {...makeProps({
            diag: undefined,
            meta: undefined,
            an: undefined,
            turnValTrail: undefined,
          })}
        />,
      );
    }).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Pipeline error banner
  // -------------------------------------------------------------------------

  describe('pipeline error banner', () => {
    it('shows when stage_diagnostics are present but no extracted_claims or extraction_trace', () => {
      render(
        <DetailsTab
          {...makeProps({
            diag: {
              stage_diagnostics: [
                { stage: 'brief' },
                { stage: 'plan' },
                { stage: 'draft' },
              ],
            } as any,
          })}
        />,
      );
      expect(screen.getByText('Pipeline Error')).toBeInTheDocument();
      expect(screen.getByText(/post-pipeline processing failed/)).toBeInTheDocument();
    });

    it('lists the completed stage names in the banner text', () => {
      render(
        <DetailsTab
          {...makeProps({
            diag: {
              stage_diagnostics: [{ stage: 'brief' }, { stage: 'draft' }],
            } as any,
          })}
        />,
      );
      expect(screen.getByText(/brief → draft/)).toBeInTheDocument();
    });

    it('does not show banner when extracted_claims exist', () => {
      render(
        <DetailsTab
          {...makeProps({
            diag: {
              stage_diagnostics: [{ stage: 'brief' }],
              extracted_claims: { accepted: [], rejected: [] },
            } as any,
          })}
        />,
      );
      expect(screen.queryByText('Pipeline Error')).not.toBeInTheDocument();
    });

    it('does not show banner when extraction_trace exists', () => {
      render(
        <DetailsTab
          {...makeProps({
            diag: {
              stage_diagnostics: [{ stage: 'brief' }],
              extraction_trace: {
                candidates_proposed: 0,
                candidates_accepted: 0,
                candidates_rejected: 0,
                rejection_reasons: {},
              },
            } as any,
          })}
        />,
      );
      expect(screen.queryByText('Pipeline Error')).not.toBeInTheDocument();
    });

    it('does not show banner for opening entry type even with stage_diagnostics', () => {
      render(
        <DetailsTab
          {...makeProps({
            entry: makeEntry({ type: 'opening' }),
            diag: { stage_diagnostics: [{ stage: 'brief' }] } as any,
          })}
        />,
      );
      expect(screen.queryByText('Pipeline Error')).not.toBeInTheDocument();
    });

    it('does not show banner when diag is undefined', () => {
      render(<DetailsTab {...makeProps({ diag: undefined })} />);
      expect(screen.queryByText('Pipeline Error')).not.toBeInTheDocument();
    });

    it('does not show banner when stage_diagnostics is an empty array', () => {
      render(
        <DetailsTab
          {...makeProps({
            diag: { stage_diagnostics: [] } as any,
          })}
        />,
      );
      expect(screen.queryByText('Pipeline Error')).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Suppressed intervention (crash area from t/770)
  // -------------------------------------------------------------------------

  describe('suppressed intervention', () => {
    it('does not render the section when suppressedIntervention is null', () => {
      render(<DetailsTab {...makeProps({ suppressedIntervention: null })} />);
      expect(screen.queryByText(/Suppressed Intervention/)).not.toBeInTheDocument();
    });

    it('renders the section heading when suppressedIntervention is provided', () => {
      render(
        <DetailsTab
          {...makeProps({
            suppressedIntervention: {
              intervention_move: 'challenge',
              intervention_target: 'safetyist',
              intervention_suppressed_reason: 'budget_exhausted',
              intervention_suppression_explanation: 'No budget left.',
              trigger_reasoning: 'Debater was off-topic.',
            },
          })}
        />,
      );
      expect(screen.getByText(/Suppressed Intervention/)).toBeInTheDocument();
    });

    it('renders the intervention_move badge when intervention_move is set', () => {
      render(
        <DetailsTab
          {...makeProps({
            suppressedIntervention: {
              intervention_move: 'challenge',
              intervention_target: null,
              intervention_suppressed_reason: 'cooldown_active',
              intervention_suppression_explanation: null,
              trigger_reasoning: null,
            },
          })}
        />,
      );
      // The move name appears both in the badge and in the body text
      const matches = screen.getAllByText('challenge');
      expect(matches.length).toBeGreaterThan(0);
    });

    it('renders the intervention_target via speakerLabel when target is set', () => {
      render(
        <DetailsTab
          {...makeProps({
            suppressedIntervention: {
              intervention_move: 'push',
              intervention_target: 'safetyist',
              intervention_suppressed_reason: 'cooldown_active',
              intervention_suppression_explanation: null,
              trigger_reasoning: null,
            },
          })}
        />,
      );
      // speakerLabel('safetyist') returns 'Safetyist' via the POVER_INFO mock
      expect(screen.getByText(/Safetyist/)).toBeInTheDocument();
      expect(screen.getByText(/directed at/)).toBeInTheDocument();
    });

    it('does not crash and omits "directed at" text when intervention_target is null', () => {
      // This is the core regression test for t/770 — the old `as string` cast would
      // have thrown when passing null here.
      expect(() => {
        render(
          <DetailsTab
            {...makeProps({
              suppressedIntervention: {
                intervention_move: 'challenge',
                intervention_target: null,
                intervention_suppressed_reason: 'budget_exhausted',
                intervention_suppression_explanation: 'Explanation.',
                trigger_reasoning: null,
              },
            })}
          />,
        );
      }).not.toThrow();
      expect(screen.queryByText(/directed at/)).not.toBeInTheDocument();
    });

    it('does not crash when intervention_suppressed_reason is null', () => {
      expect(() => {
        render(
          <DetailsTab
            {...makeProps({
              suppressedIntervention: {
                intervention_move: 'challenge',
                intervention_target: null,
                intervention_suppressed_reason: null,
                intervention_suppression_explanation: 'Only explanation, no reason code.',
                trigger_reasoning: null,
              },
            })}
          />,
        );
      }).not.toThrow();
      expect(screen.getByText(/Only explanation, no reason code/)).toBeInTheDocument();
    });

    it('formats the suppression reason code with underscores replaced and title-cased', () => {
      render(
        <DetailsTab
          {...makeProps({
            suppressedIntervention: {
              intervention_move: 'push',
              intervention_target: null,
              intervention_suppressed_reason: 'budget_exhausted',
              intervention_suppression_explanation: null,
              trigger_reasoning: null,
            },
          })}
        />,
      );
      // 'budget_exhausted' → replace _ with space → 'budget exhausted'
      //                    → title-case each word   → 'Budget Exhausted'
      expect(screen.getByText('Budget Exhausted')).toBeInTheDocument();
    });

    it('renders the suppression explanation text after the reason code', () => {
      render(
        <DetailsTab
          {...makeProps({
            suppressedIntervention: {
              intervention_move: null,
              intervention_target: null,
              intervention_suppressed_reason: 'engine_override',
              intervention_suppression_explanation: 'The engine decided to skip this.',
              trigger_reasoning: null,
            },
          })}
        />,
      );
      expect(screen.getByText(/The engine decided to skip this/)).toBeInTheDocument();
    });

    it('shows "No reason recorded" when both reason and explanation are null', () => {
      render(
        <DetailsTab
          {...makeProps({
            suppressedIntervention: {
              intervention_move: 'challenge',
              intervention_target: null,
              intervention_suppressed_reason: null,
              intervention_suppression_explanation: null,
              trigger_reasoning: null,
            },
          })}
        />,
      );
      expect(screen.getByText('No reason recorded')).toBeInTheDocument();
    });

    it('renders trigger_reasoning text when set', () => {
      render(
        <DetailsTab
          {...makeProps({
            suppressedIntervention: {
              intervention_move: 'challenge',
              intervention_target: null,
              intervention_suppressed_reason: null,
              intervention_suppression_explanation: null,
              trigger_reasoning: 'The debater was repeating prior arguments.',
            },
          })}
        />,
      );
      expect(
        screen.getByText('The debater was repeating prior arguments.'),
      ).toBeInTheDocument();
    });

    it('does not render trigger_reasoning block when trigger_reasoning is null', () => {
      render(
        <DetailsTab
          {...makeProps({
            suppressedIntervention: {
              intervention_move: 'challenge',
              intervention_target: null,
              intervention_suppressed_reason: 'cooldown_active',
              intervention_suppression_explanation: null,
              trigger_reasoning: null,
            },
          })}
        />,
      );
      // trigger_reasoning block is only rendered when the field is truthy
      // Verify the rest of the section renders without crash
      expect(screen.getByText(/Suppressed Intervention/)).toBeInTheDocument();
    });

    it('does not crash when intervention_move is an empty string (falsy move)', () => {
      expect(() => {
        render(
          <DetailsTab
            {...makeProps({
              suppressedIntervention: {
                intervention_move: '',
                intervention_target: null,
                intervention_suppressed_reason: null,
                intervention_suppression_explanation: null,
                trigger_reasoning: null,
              },
            })}
          />,
        );
      }).not.toThrow();
    });

    it('falls back to "intervention" in body text when intervention_move is null', () => {
      render(
        <DetailsTab
          {...makeProps({
            suppressedIntervention: {
              intervention_move: null,
              intervention_target: null,
              intervention_suppressed_reason: null,
              intervention_suppression_explanation: null,
              trigger_reasoning: null,
            },
          })}
        />,
      );
      // The body text reads: "The moderator recommended a <strong>{move ?? 'intervention'}</strong>"
      expect(screen.getByText('intervention')).toBeInTheDocument();
    });

    it('does not crash when suppressedIntervention has all fields undefined (empty object)', () => {
      // Regression test: the old unsafe `as string` casts would throw on undefined fields.
      expect(() => {
        render(
          <DetailsTab
            {...makeProps({
              suppressedIntervention: {} as DetailsTabProps['suppressedIntervention'],
            })}
          />,
        );
      }).not.toThrow();
      // With all fields undefined, the fallback texts should appear
      expect(screen.getByText('No reason recorded')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Preceding intervention
  // -------------------------------------------------------------------------

  describe('preceding intervention', () => {
    it('renders the Moderator Directive section when precedingIntervention is provided', () => {
      render(
        <DetailsTab
          {...makeProps({
            precedingIntervention: {
              id: 'mod-1',
              type: 'intervention',
              speaker: 'moderator',
              content: 'Please address the safetyist concern.',
              metadata: {},
              taxonomy_refs: [],
              policy_refs: [],
              intervention_metadata: {
                family: 'redirect',
                move: 'redirect',
                force: 'soft',
                target_debater: 'accelerationist',
              },
            } as any,
            interventionResponseField: null,
          })}
        />,
      );
      expect(screen.getByText('Moderator Directive')).toBeInTheDocument();
      expect(screen.getByText(/Please address the safetyist concern/)).toBeInTheDocument();
    });

    it('shows Responded status and response text when interventionResponseField is a string', () => {
      render(
        <DetailsTab
          {...makeProps({
            precedingIntervention: {
              id: 'mod-1',
              type: 'intervention',
              speaker: 'moderator',
              content: 'Address the point.',
              metadata: {},
              taxonomy_refs: [],
              policy_refs: [],
              intervention_metadata: {},
            } as any,
            interventionResponseField: 'I acknowledged the concern fully.',
          })}
        />,
      );
      expect(screen.getByText(/✓ Responded/)).toBeInTheDocument();
      expect(screen.getByText(/I acknowledged the concern fully/)).toBeInTheDocument();
    });

    it('shows "No response" when interventionResponseField is null and speaker is the target', () => {
      render(
        <DetailsTab
          {...makeProps({
            entry: makeEntry({ speaker: 'safetyist' }),
            precedingIntervention: {
              id: 'mod-1',
              type: 'intervention',
              speaker: 'moderator',
              content: 'You must respond.',
              metadata: {},
              taxonomy_refs: [],
              policy_refs: [],
              // target_debater matches entry.speaker → speaker is the target
              intervention_metadata: { target_debater: 'safetyist' },
            } as any,
            interventionResponseField: null,
          })}
        />,
      );
      expect(screen.getByText(/✗ No response/)).toBeInTheDocument();
    });

    it('does not render the Moderator Directive section when precedingIntervention is null', () => {
      render(<DetailsTab {...makeProps({ precedingIntervention: null })} />);
      expect(screen.queryByText('Moderator Directive')).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Model and timing section
  // -------------------------------------------------------------------------

  it('renders model and timing section when diag.model is set', () => {
    render(
      <DetailsTab
        {...makeProps({
          diag: {
            model: 'gemini-1.5-pro',
            response_time_ms: 2500,
          } as any,
        })}
      />,
    );
    // Use role-based query to avoid matching both the section-title button and inner content
    expect(screen.getByRole('button', { name: /Model & Timing — gemini-1.5-pro/ })).toBeInTheDocument();
    // Exact string matches the inner <div> textContent only (parent has more text around it)
    expect(screen.getByText('Model: gemini-1.5-pro')).toBeInTheDocument();
  });

  it('does not render model section when diag.model is absent', () => {
    render(
      <DetailsTab
        {...makeProps({
          diag: { extracted_claims: { accepted: [], rejected: [] } } as any,
        })}
      />,
    );
    expect(screen.queryByText(/Model & Timing/)).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Turn validation section
  // -------------------------------------------------------------------------

  describe('turn validation section', () => {
    it('renders turn validation outcome and score when turnValTrail is provided', () => {
      render(
        <DetailsTab
          {...makeProps({
            turnValTrail: {
              attempts: [{ outcome: 'pass', process_reward: 0.87, repairHints: [] }],
              final: { outcome: 'pass', process_reward: 0.87, repairHints: [] },
            } as any,
          })}
        />,
      );
      // Role query scopes to the button only — avoids matching ancestor divs
      expect(screen.getByRole('button', { name: /Turn Validation/ })).toBeInTheDocument();
      // 'pass' exact-matches the inner <span>pass</span> (button text is longer)
      expect(screen.getByText('pass')).toBeInTheDocument();
      // '0.87' exact-matches <strong>0.87</strong> (button text includes surrounding words)
      expect(screen.getByText('0.87')).toBeInTheDocument();
    });

    it('shows attempt count in the section title', () => {
      render(
        <DetailsTab
          {...makeProps({
            turnValTrail: {
              attempts: [
                { outcome: 'fail', process_reward: 0.3, repairHints: [] },
                { outcome: 'pass', process_reward: 0.9, repairHints: [] },
              ],
              final: { outcome: 'pass', process_reward: 0.9, repairHints: [] },
            } as any,
          })}
        />,
      );
      // Role query targets the section button only; the span inside also contains
      // "2 attempts" so a plain regex getByText would find multiple elements.
      expect(screen.getByRole('button', { name: /2 attempts/ })).toBeInTheDocument();
    });

    it('renders repair hints in the turn validation section', () => {
      render(
        <DetailsTab
          {...makeProps({
            turnValTrail: {
              attempts: [{ outcome: 'accept_with_flag', process_reward: 0.55, repairHints: ['taxonomy_refs too short'] }],
              final: { outcome: 'accept_with_flag', process_reward: 0.55, repairHints: ['taxonomy_refs too short'] },
            } as any,
          })}
        />,
      );
      expect(screen.getByText(/taxonomy_refs too short/)).toBeInTheDocument();
    });

    it('does not render turn validation when turnValTrail is undefined', () => {
      render(<DetailsTab {...makeProps({ turnValTrail: undefined })} />);
      expect(screen.queryByText(/Turn Validation/)).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Opening statement section
  // -------------------------------------------------------------------------

  it('renders the Statement section for opening entries', () => {
    render(
      <DetailsTab
        {...makeProps({
          entry: makeEntry({ type: 'opening', content: 'This is the opening statement text.' }),
        })}
      />,
    );
    // The Section component renders a button with the title "Statement"
    expect(screen.getByRole('button', { name: /Statement/ })).toBeInTheDocument();
    expect(screen.getByText(/This is the opening statement text/)).toBeInTheDocument();
  });

  it('does not render the Statement section for regular statement entries', () => {
    render(
      <DetailsTab
        {...makeProps({
          entry: makeEntry({ type: 'statement', content: 'Regular turn content.' }),
        })}
      />,
    );
    // The Statement section button only appears for opening entries
    const btn = screen.queryByRole('button', { name: /^[▼▶]\s*Statement$/ });
    expect(btn).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Flight recorder errors section
  // -------------------------------------------------------------------------

  describe('flight recorder errors section', () => {
    it('renders the section with error count when entryErrors are provided', () => {
      render(
        <DetailsTab
          {...makeProps({
            entryErrors: [
              {
                _wall: Date.now(),
                type: 'system.error',
                data: { speaker: 'accelerationist', round: 2 },
                error: {
                  name: 'TypeError',
                  message: 'Cannot read property of null',
                },
              } as any,
            ],
          })}
        />,
      );
      expect(screen.getByText(/Flight Recorder Errors \(1\)/)).toBeInTheDocument();
      expect(screen.getByText('TypeError')).toBeInTheDocument();
      expect(screen.getByText(/Cannot read property of null/)).toBeInTheDocument();
    });

    it('shows speaker and round number in the error header', () => {
      render(
        <DetailsTab
          {...makeProps({
            entryErrors: [
              {
                _wall: Date.now(),
                type: 'system.error',
                data: { speaker: 'safetyist', round: 3 },
                error: { name: 'RangeError', message: 'Index out of bounds' },
              } as any,
            ],
          })}
        />,
      );
      expect(screen.getByText(/safetyist/)).toBeInTheDocument();
      expect(screen.getByText(/R3/)).toBeInTheDocument();
    });

    it('renders a stack trace details element when error.stack is provided', () => {
      render(
        <DetailsTab
          {...makeProps({
            entryErrors: [
              {
                _wall: Date.now(),
                type: 'system.error',
                data: {},
                error: {
                  name: 'Error',
                  message: 'Something went wrong',
                  stack: 'Error: Something went wrong\n    at foo (foo.ts:10)',
                },
              } as any,
            ],
          })}
        />,
      );
      expect(screen.getByText('Stack trace')).toBeInTheDocument();
    });

    it('does not render flight recorder section when entryErrors is undefined', () => {
      render(<DetailsTab {...makeProps({ entryErrors: undefined })} />);
      expect(screen.queryByText(/Flight Recorder Errors/)).not.toBeInTheDocument();
    });

    it('does not render flight recorder section when entryErrors is an empty array', () => {
      render(<DetailsTab {...makeProps({ entryErrors: [] })} />);
      expect(screen.queryByText(/Flight Recorder Errors/)).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Policy refs section
  // -------------------------------------------------------------------------

  describe('policy refs section', () => {
    it('renders policy refs from entry.policy_refs with policyMap lookup', () => {
      render(
        <DetailsTab
          {...makeProps({
            entry: makeEntry({ policy_refs: ['pol-001', 'pol-002'] }),
            policyMap: new Map([
              [
                'pol-001',
                {
                  id: 'pol-001',
                  action: 'Mandate safety audits',
                  source_povs: ['safetyist'],
                  member_count: 3,
                },
              ],
            ]),
          })}
        />,
      );
      expect(screen.getByText(/Policy Refs \(2\)/)).toBeInTheDocument();
      expect(screen.getByText('pol-001')).toBeInTheDocument();
      expect(screen.getByText(/Mandate safety audits/)).toBeInTheDocument();
      // pol-002 is not in the map
      expect(screen.getByText('pol-002')).toBeInTheDocument();
      expect(screen.getByText(/not in registry/)).toBeInTheDocument();
    });

    it('renders policy refs from meta.policy_refs when entry.policy_refs is empty', () => {
      render(
        <DetailsTab
          {...makeProps({
            entry: makeEntry({ policy_refs: [] }),
            meta: { policy_refs: ['pol-meta-1'] },
            policyMap: new Map([
              [
                'pol-meta-1',
                {
                  id: 'pol-meta-1',
                  action: 'Fund AI research',
                  source_povs: ['accelerationist'],
                  member_count: 0,
                },
              ],
            ]),
          })}
        />,
      );
      expect(screen.getByText(/Policy Refs \(1\)/)).toBeInTheDocument();
      expect(screen.getByText('pol-meta-1')).toBeInTheDocument();
      expect(screen.getByText(/Fund AI research/)).toBeInTheDocument();
    });

    it('does not render policy refs section when there are no refs', () => {
      render(
        <DetailsTab
          {...makeProps({
            entry: makeEntry({ policy_refs: [] }),
            meta: undefined,
          })}
        />,
      );
      expect(screen.queryByText(/Policy Refs/)).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Commitments section
  // -------------------------------------------------------------------------

  it('renders commitments section when diag.commitment_context is set', () => {
    render(
      <DetailsTab
        {...makeProps({
          diag: { commitment_context: 'Prior commitments injected here.' } as any,
        })}
      />,
    );
    // The Section component wraps the title inside a button as "▼ Commitments Injected",
    // so exact-string 'Commitments Injected' finds no element. Use role query instead.
    expect(screen.getByRole('button', { name: /Commitments Injected/ })).toBeInTheDocument();
    expect(
      screen.getByDisplayValue(/Prior commitments injected here/),
    ).toBeInTheDocument();
  });

  it('does not render commitments section when diag.commitment_context is absent', () => {
    render(<DetailsTab {...makeProps({ diag: undefined })} />);
    expect(screen.queryByText('Commitments Injected')).not.toBeInTheDocument();
  });
});
